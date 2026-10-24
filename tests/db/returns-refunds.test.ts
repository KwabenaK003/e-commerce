import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { baseFixture, createDb, failure, one, payOrder, placeOrder, rows, stock, type Db, type Fixture } from './harness';

let db: Db;
let fx: Fixture;

beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`
    truncate order_status_history, order_items, coupon_redemptions, notifications, invoices,
      refunds, return_items, returns, payments, payment_events, orders, cart_items, carts,
      inventory_movements, product_images, variant_costs, inventory, product_variants, products,
      categories, delivery_zones, pickup_locations, coupons, store_settings, rate_limits,
      invoice_counters restart identity cascade;
  `);
  fx = await baseFixture(db);
});

/** A paid and delivered order of two units, plus its payment and first order item. */
async function deliveredOrder() {
  const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 2 }]);
  await payOrder(db, id);
  for (const s of ['processing', 'shipped', 'delivered']) {
    await db.query(`select transition_order($1, $2::order_status, 'staff')`, [id, s]);
  }
  const item = await one(db, `select id from order_items where order_id = $1`, [id]);
  const pay = await one(db, `select id, amount_pesewas from payments where order_id = $1`, [id]);
  return { id, itemId: item.id as string, payId: pay.id as string, amount: pay.amount_pesewas as number };
}

const ask = (orderId: string, items: any[], over: Partial<{ user: string | null; reason: string }> = {}) =>
  db.query(`select create_return($1, $2, $3, 'refund', 'note', '{}'::text[], $4::jsonb) as id`, [
    orderId,
    over.user ?? null,
    over.reason ?? 'Wrong size',
    JSON.stringify(items),
  ]);

describe('create_return', () => {
  it('records the request and its items', async () => {
    const o = await deliveredOrder();
    const r = await ask(o.id, [{ order_item_id: o.itemId, quantity: 1 }]);
    const id = (r.rows[0] as any).id;
    const ret = await one(db, `select status, reason from returns where id = $1`, [id]);
    expect(ret).toEqual({ status: 'requested', reason: 'Wrong size' });
    expect(await rows(db, `select quantity from return_items where return_id = $1`, [id])).toEqual([{ quantity: 1 }]);
  });

  it('only allows delivered orders, inside the window, and never more than was bought', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
    await payOrder(db, id);
    const item = await one(db, `select id from order_items where order_id = $1`, [id]);
    expect(await failure(db, `select create_return($1, null, 'x', 'refund', null, '{}', $2::jsonb)`, [id, JSON.stringify([{ order_item_id: item.id, quantity: 1 }])])).toContain('order_not_delivered');

    const o = await deliveredOrder();
    await ask(o.id, [{ order_item_id: o.itemId, quantity: 2 }]);
    await expect(ask(o.id, [{ order_item_id: o.itemId, quantity: 1 }])).rejects.toThrow('return_quantity_too_high');

    await db.query(`update orders set delivered_at = now() - interval '8 days' where id = $1`, [o.id]);
    await expect(ask(o.id, [{ order_item_id: o.itemId, quantity: 1 }])).rejects.toThrow('return_window_closed');
  });

  it('refuses another customer and an empty or foreign item list', async () => {
    const o = await deliveredOrder();
    const other = await one(db, `insert into auth.users (email) values ('z@example.com') returning id`);
    await expect(ask(o.id, [{ order_item_id: o.itemId, quantity: 1 }], { user: other.id })).rejects.toThrow('not_your_order');
    await expect(ask(o.id, [])).rejects.toThrow('no_items');
    await expect(ask(o.id, [{ order_item_id: '00000000-0000-0000-0000-000000000000', quantity: 1 }])).rejects.toThrow('item_not_in_order');
    expect((await one(db, `select count(*)::int as n from returns`)).n).toBe(0);
  });

  it('lets a rejected request be raised again', async () => {
    const o = await deliveredOrder();
    const id = ((await ask(o.id, [{ order_item_id: o.itemId, quantity: 2 }])).rows[0] as any).id;
    await db.query(`select transition_return($1, 'rejected', null, 'not eligible')`, [id]);
    await ask(o.id, [{ order_item_id: o.itemId, quantity: 2 }]);
  });
});

describe('transition_return', () => {
  it('walks requested, approved, received (restocking), refunded', async () => {
    const o = await deliveredOrder();
    const before = await stock(db, fx.variantId);
    const id = ((await ask(o.id, [{ order_item_id: o.itemId, quantity: 1 }])).rows[0] as any).id;
    await db.query(`select transition_return($1, 'approved', null, 'ok')`, [id]);
    await db.query(`select transition_return($1, 'received', null, 'resellable', true)`, [id]);
    expect((await stock(db, fx.variantId)).on_hand).toBe(before.on_hand + 1);
    const mv = await one(db, `select reason from inventory_movements where order_id is null order by id desc limit 1`);
    expect(mv.reason).toBe('return');

    const refundId = (await one(db, `select create_refund($1, $2, $3, 10000, 'return', null) as id`, [o.id, o.payId, id])).id;
    await db.query(`select settle_refund($1, 'processed', 'rf_1')`, [refundId]);
    const ret = await one(db, `select status, resolved_at from returns where id = $1`, [id]);
    expect(ret.status).toBe('refunded');
    expect(ret.resolved_at).not.toBeNull();
    const t = await rows(db, `select distinct template from notifications where order_id = $1 and template in ('return_update', 'refund_processed') order by template`, [o.id]);
    expect(t.map((x) => x.template)).toEqual(['refund_processed', 'return_update']);
  });

  it('does not restock unless asked, and rejects invalid transitions', async () => {
    const o = await deliveredOrder();
    const before = await stock(db, fx.variantId);
    const id = ((await ask(o.id, [{ order_item_id: o.itemId, quantity: 1 }])).rows[0] as any).id;
    expect(await failure(db, `select transition_return($1, 'received', null)`, [id])).toContain('invalid_return_transition');
    await db.query(`select transition_return($1, 'approved', null)`, [id]);
    await db.query(`select transition_return($1, 'received', null, 'damaged', false)`, [id]);
    expect(await stock(db, fx.variantId)).toEqual(before);
    await db.query(`select transition_return($1, 'closed', null)`, [id]);
    expect(await failure(db, `select transition_return($1, 'approved', null)`, [id])).toContain('invalid_return_transition');
  });
});

describe('refunds', () => {
  it('never exceeds the payment, counting pending refunds', async () => {
    const o = await deliveredOrder();
    expect(o.amount).toBe(22000); // 2 x 10000 + 2000 delivery
    await db.query(`select create_refund($1, $2, null, 15000, 'partial', null)`, [o.id, o.payId]);
    expect(await failure(db, `select create_refund($1, $2, null, 7001, 'too much', null)`, [o.id, o.payId])).toContain('refund_exceeds_payment');
    await db.query(`select create_refund($1, $2, null, 7000, 'rest', null)`, [o.id, o.payId]);
  });

  it('frees the amount again when a refund fails', async () => {
    const o = await deliveredOrder();
    const r = (await one(db, `select create_refund($1, $2, null, 22000, 'full', null) as id`, [o.id, o.payId])).id;
    await db.query(`select settle_refund($1, 'failed')`, [r]);
    await db.query(`select create_refund($1, $2, null, 22000, 'retry', null)`, [o.id, o.payId]);
  });

  it('sets partially_refunded then refunded, and is idempotent', async () => {
    const o = await deliveredOrder();
    const a = (await one(db, `select create_refund($1, $2, null, 10000, 'a', null) as id`, [o.id, o.payId])).id;
    await db.query(`select settle_refund($1, 'processed', 'rf_a')`, [a]);
    await db.query(`select settle_refund($1, 'processed', 'rf_a')`, [a]);
    expect((await one(db, `select payment_status from orders where id = $1`, [o.id])).payment_status).toBe('partially_refunded');
    const b = (await one(db, `select create_refund($1, $2, null, 12000, 'b', null) as id`, [o.id, o.payId])).id;
    await db.query(`select settle_refund($1, 'processed', 'rf_b')`, [b]);
    expect((await one(db, `select payment_status from orders where id = $1`, [o.id])).payment_status).toBe('refunded');
    expect((await one(db, `select count(*)::int as n from notifications where template = 'refund_processed' and channel = 'sms'`)).n).toBe(2);
  });

  it('only refunds successful payments of the same order', async () => {
    const o = await deliveredOrder();
    const other = await placeOrder(db, fx, [{ variantId: fx.variant2Id, qty: 1 }]);
    expect(await failure(db, `select create_refund($1, $2, null, 100, 'x', null)`, [other, o.payId])).toContain('payment_not_refundable');
  });

  it('clears the refund-due flag once a cancelled order is fully refunded', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
    await payOrder(db, id);
    await db.query(`select transition_order($1, 'cancelled', 'staff', null, 'customer asked')`, [id]);
    expect((await one(db, `select needs_review from orders where id = $1`, [id])).needs_review).toBe(true);
    const pay = await one(db, `select id, amount_pesewas from payments where order_id = $1`, [id]);
    const r = (await one(db, `select create_refund($1, $2, null, $3, 'cancelled', null) as id`, [id, pay.id, pay.amount_pesewas])).id;
    await db.query(`select settle_refund($1, 'processed', 'rf_c')`, [r]);
    const o = await one(db, `select needs_review, risk_flags, payment_status from orders where id = $1`, [id]);
    expect(o).toEqual({ needs_review: false, risk_flags: [], payment_status: 'refunded' });
  });
});
