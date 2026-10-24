import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADDRESS,
  baseFixture,
  createDb,
  failure,
  makeCart,
  one,
  payOrder,
  placeOrder,
  rows,
  startPayment,
  stock,
  type Db,
  type Fixture,
} from './harness';

let db: Db;
let fx: Fixture;

beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  // Clean slate for every test, keeping the schema.
  await db.exec(`
    truncate order_status_history, order_items, coupon_redemptions, notifications, invoices,
      refunds, return_items, returns, payments, payment_events, orders, cart_items, carts,
      inventory_movements, product_images, variant_costs, inventory, product_variants, products,
      categories, delivery_zones, pickup_locations, coupons, store_settings, rate_limits,
      invoice_counters restart identity cascade;
  `);
  fx = await baseFixture(db);
});

describe('creating an order', () => {
  it('prices from the database, reserves stock and snapshots the sale', async () => {
    const id = await placeOrder(db, fx, [
      { variantId: fx.variantId, qty: 2 },
      { variantId: fx.variant2Id, qty: 1 },
    ]);
    const o = await one(db, `select * from orders where id = $1`, [id]);
    expect(o.status).toBe('pending_payment');
    expect(o.subtotal_pesewas).toBe(22500);
    expect(o.shipping_pesewas).toBe(2000);
    expect(o.total_pesewas).toBe(24500);
    expect(o.order_number).toMatch(/^ODH-\d{6}$/);
    expect(o.public_token).toHaveLength(32);
    expect(o.reserved_until).not.toBeNull();

    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 5, reserved: 2 });
    expect(await stock(db, fx.variant2Id)).toEqual({ on_hand: 3, reserved: 1 });

    const items = await rows(db, `select * from order_items where order_id = $1 order by sku`, [id]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ sku: 'SKU-1', unit_price_pesewas: 10000, cost_pesewas: 6000, quantity: 2 });

    const hist = await rows(db, `select to_status from order_status_history where order_id = $1`, [id]);
    expect(hist.map((h) => h.to_status)).toEqual(['pending_payment']);
  });

  it('empties the cart after ordering', async () => {
    const cartId = await makeCart(db, [{ variantId: fx.variantId, qty: 1 }]);
    await db.query(`select create_order_from_cart($1, null, '+233200000001', 'delivery', $2::jsonb, $3, null, 'paystack', null, null)`, [
      cartId,
      JSON.stringify(ADDRESS),
      fx.zoneId,
    ]);
    const left = await one(db, `select count(*)::int as n from cart_items where cart_id = $1`, [cartId]);
    expect(left.n).toBe(0);
  });

  it('refuses when stock is short and leaves nothing reserved', async () => {
    const cartId = await makeCart(db, [
      { variantId: fx.variantId, qty: 1 },
      { variantId: fx.variant2Id, qty: 9 },
    ]);
    const msg = await failure(
      db,
      `select create_order_from_cart($1, null, '+233200000001', 'delivery', $2::jsonb, $3, null, 'paystack', null, null)`,
      [cartId, JSON.stringify(ADDRESS), fx.zoneId],
    );
    expect(msg).toContain('insufficient_stock');
    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 5, reserved: 0 });
    expect(await stock(db, fx.variant2Id)).toEqual({ on_hand: 3, reserved: 0 });
    expect((await one(db, `select count(*)::int as n from orders`)).n).toBe(0);
  });

  it('gives the last unit to exactly one buyer', async () => {
    await db.query(`update inventory set on_hand = 1 where variant_id = $1`, [fx.variantId]);
    const cartA = await makeCart(db, [{ variantId: fx.variantId, qty: 1 }]);
    const cartB = await makeCart(db, [{ variantId: fx.variantId, qty: 1 }]);
    const sql = `select create_order_from_cart($1, null, '+233200000001', 'delivery', $2::jsonb, $3, null, 'paystack', null, null)`;
    const results = await Promise.allSettled([
      db.query(sql, [cartA, JSON.stringify(ADDRESS), fx.zoneId]),
      db.query(sql, [cartB, JSON.stringify(ADDRESS), fx.zoneId]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 1, reserved: 1 });
  });

  it('rejects an empty cart and a missing delivery zone', async () => {
    const empty = await makeCart(db, []);
    expect(
      await failure(db, `select create_order_from_cart($1, null, '+233200000001', 'delivery', $2::jsonb, $3, null, 'paystack', null, null)`, [
        empty,
        JSON.stringify(ADDRESS),
        fx.zoneId,
      ]),
    ).toContain('empty_cart');
    const cart = await makeCart(db, [{ variantId: fx.variantId, qty: 1 }]);
    expect(
      await failure(db, `select create_order_from_cart($1, null, '+233200000001', 'delivery', $2::jsonb, null, null, 'paystack', null, null)`, [
        cart,
        JSON.stringify(ADDRESS),
      ]),
    ).toContain('no_delivery_zone');
    expect((await one(db, `select reserved from inventory where variant_id = $1`, [fx.variantId])).reserved).toBe(0);
  });

  it('gives free delivery above the threshold and none for pickup', async () => {
    await db.query(`update inventory set on_hand = 50`);
    const big = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 10 }]); // 100,000 = threshold
    expect((await one(db, `select shipping_pesewas from orders where id = $1`, [big])).shipping_pesewas).toBe(0);
    const pickup = await placeOrder(db, fx, [{ variantId: fx.variant2Id, qty: 1 }], { fulfillment: 'pickup' });
    const p = await one(db, `select shipping_pesewas, shipping_address, pickup_location_id from orders where id = $1`, [pickup]);
    expect(p.shipping_pesewas).toBe(0);
    expect(p.shipping_address).toBeNull();
    expect(p.pickup_location_id).toBe(fx.pickupId);
  });

  it('applies percent coupons once per customer and releases them on cancel', async () => {
    await db.query(`insert into coupons (code, kind, value, max_uses_per_customer) values ('SAVE10', 'percent', 10, 1)`);
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }], { coupon: 'save10' });
    const o = await one(db, `select discount_pesewas, total_pesewas, coupon_code from orders where id = $1`, [id]);
    expect(o).toMatchObject({ discount_pesewas: 1000, total_pesewas: 11000, coupon_code: 'SAVE10' });
    expect((await one(db, `select uses from coupons where code = 'SAVE10'`)).uses).toBe(1);

    const cart = await makeCart(db, [{ variantId: fx.variant2Id, qty: 1 }]);
    expect(
      await failure(db, `select create_order_from_cart($1, null, '+233200000001', 'delivery', $2::jsonb, $3, null, 'paystack', 'SAVE10', null)`, [
        cart,
        JSON.stringify(ADDRESS),
        fx.zoneId,
      ]),
    ).toContain('coupon_already_used');

    await db.query(`select transition_order($1, 'cancelled', 'staff', null, 'test')`, [id]);
    expect((await one(db, `select uses from coupons where code = 'SAVE10'`)).uses).toBe(0);
    expect((await one(db, `select count(*)::int as n from coupon_redemptions`)).n).toBe(0);
  });

  it('rejects unknown, expired and below-minimum coupons', async () => {
    await db.query(`insert into coupons (code, kind, value, expires_at) values ('OLD', 'fixed', 500, now() - interval '1 day')`);
    await db.query(`insert into coupons (code, kind, value, min_subtotal_pesewas) values ('BIG', 'fixed', 500, 999999)`);
    for (const code of ['NOPE', 'OLD', 'BIG']) {
      const cart = await makeCart(db, [{ variantId: fx.variant2Id, qty: 1 }]);
      expect(
        await failure(db, `select create_order_from_cart($1, null, '+233200000001', 'delivery', $2::jsonb, $3, null, 'paystack', $4, null)`, [
          cart,
          JSON.stringify(ADDRESS),
          fx.zoneId,
          code,
        ]),
      ).toContain('invalid_coupon');
    }
  });

  it('adds tax on top when prices are tax-exclusive, and reports it when inclusive', async () => {
    await db.query(`insert into store_settings (key, value) values ('tax_rate_bps', '1500'), ('tax_inclusive', 'false')`);
    const a = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
    const oa = await one(db, `select tax_pesewas, tax_inclusive, total_pesewas from orders where id = $1`, [a]);
    expect(oa).toMatchObject({ tax_pesewas: 1500, tax_inclusive: false, total_pesewas: 10000 + 1500 + 2000 });

    await db.query(`update store_settings set value = 'true' where key = 'tax_inclusive'`);
    const b = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
    const ob = await one(db, `select tax_pesewas, tax_inclusive, total_pesewas from orders where id = $1`, [b]);
    expect(ob.tax_inclusive).toBe(true);
    expect(ob.total_pesewas).toBe(10000 + 2000); // tax is inside the price
    expect(ob.tax_pesewas).toBe(1304); // 10000 - 10000 / 1.15
  });
});

describe('pay on delivery', () => {
  it('waits for staff confirmation, then commits stock', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 2 }], { paymentMethod: 'pay_on_delivery' });
    expect((await one(db, `select status from orders where id = $1`, [id])).status).toBe('awaiting_confirmation');
    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 5, reserved: 2 });

    await db.query(`select transition_order($1, 'processing', 'staff', null, 'called customer')`, [id]);
    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 3, reserved: 0 });

    await db.query(`select transition_order($1, 'shipped', 'staff')`, [id]);
    await db.query(`select transition_order($1, 'delivered', 'staff')`, [id]);
    const o = await one(db, `select status, payment_status, paid_at from orders where id = $1`, [id]);
    expect(o.status).toBe('delivered');
    expect(o.payment_status).toBe('paid');
    expect(o.paid_at).not.toBeNull();
    expect((await one(db, `select count(*)::int as n from invoices where order_id = $1`, [id])).n).toBe(1);
  });

  it('queues a confirmation request and refuses oversize orders and blocked regions', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }], { paymentMethod: 'pay_on_delivery' });
    const n = await rows(db, `select channel, template from notifications where order_id = $1 order by channel`, [id]);
    expect(n).toEqual([
      { channel: 'email', template: 'order_confirm_request' },
      { channel: 'sms', template: 'order_confirm_request' },
    ]);

    await db.query(`insert into store_settings (key, value) values ('cod_max_pesewas', '5000')`);
    const cart = await makeCart(db, [{ variantId: fx.variantId, qty: 1 }]);
    expect(
      await failure(db, `select create_order_from_cart($1, null, '+233200000001', 'delivery', $2::jsonb, $3, null, 'pay_on_delivery', null, null)`, [
        cart,
        JSON.stringify(ADDRESS),
        fx.zoneId,
      ]),
    ).toContain('cod_amount_too_high');

    await db.query(`update store_settings set value = '1000000' where key = 'cod_max_pesewas'`);
    await db.query(`insert into store_settings (key, value) values ('cod_regions', '["Ashanti"]')`);
    const cart2 = await makeCart(db, [{ variantId: fx.variantId, qty: 1 }]);
    expect(
      await failure(db, `select create_order_from_cart($1, null, '+233200000001', 'delivery', $2::jsonb, $3, null, 'pay_on_delivery', null, null)`, [
        cart2,
        JSON.stringify(ADDRESS),
        fx.zoneId,
      ]),
    ).toContain('cod_region_not_allowed');
  });

  it('cancels unconfirmed orders after the cut-off and releases the hold', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 2 }], { paymentMethod: 'pay_on_delivery' });
    await db.query(`update orders set placed_at = now() - interval '30 hours' where id = $1`, [id]);
    const n = await one(db, `select cancel_stale_cod(24) as n`);
    expect(n.n).toBe(1);
    expect((await one(db, `select status from orders where id = $1`, [id])).status).toBe('cancelled');
    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 5, reserved: 0 });
  });
});

describe('review flags', () => {
  it('flags high-value orders and blocks shipping until cleared', async () => {
    await db.query(`update inventory set on_hand = 100`);
    await db.query(`insert into store_settings (key, value) values ('review_total_ceiling_pesewas', '50000')`);
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 6 }]); // 60,000
    const o = await one(db, `select needs_review, risk_flags from orders where id = $1`, [id]);
    expect(o.needs_review).toBe(true);
    expect(o.risk_flags).toContain('high_value');

    await payOrder(db, id);
    await db.query(`select transition_order($1, 'processing', 'staff')`, [id]);
    expect(await failure(db, `select transition_order($1, 'shipped', 'staff')`, [id])).toContain('order_needs_review');
    await db.query(`update orders set needs_review = false where id = $1`, [id]);
    await db.query(`select transition_order($1, 'shipped', 'staff')`, [id]);
  });

  it('flags the fourth order from one phone within an hour', async () => {
    await db.query(`update inventory set on_hand = 100`);
    for (let i = 0; i < 3; i++) await placeOrder(db, fx, [{ variantId: fx.variant2Id, qty: 1 }]);
    const fourth = await placeOrder(db, fx, [{ variantId: fx.variant2Id, qty: 1 }]);
    const o = await one(db, `select risk_flags from orders where id = $1`, [fourth]);
    expect(o.risk_flags).toContain('velocity_phone');
  });
});

describe('payments', () => {
  it('turns a reservation into a sale, invoices it and queues receipts', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 2 }]);
    await payOrder(db, id);
    const o = await one(db, `select status, payment_status, paid_at from orders where id = $1`, [id]);
    expect(o).toMatchObject({ status: 'paid', payment_status: 'paid' });
    expect(o.paid_at).not.toBeNull();
    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 3, reserved: 0 });
    const mv = await rows(db, `select delta, reason from inventory_movements where order_id = $1`, [id]);
    expect(mv).toEqual([{ delta: -2, reason: 'sale' }]);
    expect((await one(db, `select invoice_number from invoices where order_id = $1`, [id])).invoice_number).toMatch(/^INV-\d{4}-000001$/);
    const n = await rows(db, `select channel from notifications where order_id = $1 and template = 'order_paid' order by channel`, [id]);
    expect(n.map((r) => r.channel)).toEqual(['email', 'sms']);
  });

  it('does nothing the second time for the same reference (duplicate webhook)', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 2 }]);
    const ref = await payOrder(db, id);
    const again = await one(db, `select mark_order_paid($1, 24500, 'GHS', 'txn_1', 'card', 'Approved') as id`, [ref]);
    expect(again.id).toBe(id);
    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 3, reserved: 0 });
    expect((await one(db, `select count(*)::int as n from invoices`)).n).toBe(1);
    expect((await one(db, `select count(*)::int as n from notifications where template = 'order_paid'`)).n).toBe(2);
    expect((await one(db, `select count(*)::int as n from order_status_history where order_id = $1 and to_status = 'paid'`, [id])).n).toBe(1);
  });

  it('flags an amount mismatch and does not mark the order paid', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
    const ref = await startPayment(db, id);
    const r = await one(db, `select mark_order_paid($1, 100, 'GHS', 'txn_x', 'card', 'Approved') as id`, [ref]);
    expect(r.id).toBeNull();
    const o = await one(db, `select status, payment_status, needs_review, risk_flags from orders where id = $1`, [id]);
    expect(o).toMatchObject({ status: 'pending_payment', payment_status: 'unpaid', needs_review: true });
    expect(o.risk_flags).toContain('amount_mismatch');
    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 5, reserved: 1 });
    expect((await one(db, `select status from payments where reference = $1`, [ref])).status).toBe('failed');
  });

  it('flags a payment that arrives after the order was cancelled', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
    const ref = await startPayment(db, id);
    await db.query(`select transition_order($1, 'cancelled', 'system', null, 'reservation expired')`, [id]);
    await db.query(`select mark_order_paid($1, 12000, 'GHS', 'txn_late', 'card', 'Approved')`, [ref]);
    const o = await one(db, `select status, payment_status, needs_review, risk_flags from orders where id = $1`, [id]);
    expect(o).toMatchObject({ status: 'cancelled', payment_status: 'paid', needs_review: true });
    expect(o.risk_flags).toContain('paid_after_cancel');
    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 5, reserved: 0 });
  });

  it('flags a second successful payment on an already paid order', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
    const r1 = await startPayment(db, id);
    const r2 = await startPayment(db, id);
    await db.query(`select mark_order_paid($1, 12000, 'GHS', 'a', 'card', 'ok')`, [r1]);
    await db.query(`select mark_order_paid($1, 12000, 'GHS', 'b', 'card', 'ok')`, [r2]);
    const o = await one(db, `select status, risk_flags from orders where id = $1`, [id]);
    expect(o.status).toBe('paid');
    expect(o.risk_flags).toContain('duplicate_payment');
    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 4, reserved: 0 }); // only one sale
  });

  it('refuses to start a payment on an expired or paid order', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
    await db.query(`update orders set reserved_until = now() - interval '1 minute' where id = $1`, [id]);
    expect(await failure(db, `select start_payment($1, 'late')`, [id])).toContain('reservation_expired');
    await db.query(`update orders set reserved_until = now() + interval '10 minutes' where id = $1`, [id]);
    await payOrder(db, id);
    expect(await failure(db, `select start_payment($1, 'again')`, [id])).toContain('order_not_payable');
  });

  it('marks abandoned attempts without touching the order', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
    const ref = await startPayment(db, id);
    await db.query(`select mark_payment_failed($1, 'abandoned', 'closed')`, [ref]);
    expect((await one(db, `select status from payments where reference = $1`, [ref])).status).toBe('abandoned');
    expect((await one(db, `select status from orders where id = $1`, [id])).status).toBe('pending_payment');
  });
});

describe('holds and cancellations', () => {
  it('releases expired holds silently', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 3 }]);
    await db.query(`update orders set reserved_until = now() - interval '1 minute' where id = $1`, [id]);
    const n = await one(db, `select release_expired_reservations() as n`);
    expect(n.n).toBe(1);
    expect((await one(db, `select status from orders where id = $1`, [id])).status).toBe('cancelled');
    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 5, reserved: 0 });
    expect((await one(db, `select count(*)::int as n from notifications where order_id = $1`, [id])).n).toBe(0);
  });

  it('keeps the hold while a payment prompt is open', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
    await startPayment(db, id);
    await db.query(`update orders set reserved_until = now() - interval '1 minute' where id = $1`, [id]);
    expect((await one(db, `select release_expired_reservations() as n`)).n).toBe(0);
    await db.query(`update payments set created_at = now() - interval '20 minutes' where order_id = $1`, [id]);
    expect((await one(db, `select release_expired_reservations() as n`)).n).toBe(1);
  });

  it('restocks a paid order that is cancelled and flags the refund', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 2 }]);
    await payOrder(db, id);
    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 3, reserved: 0 });
    await db.query(`select transition_order($1, 'cancelled', 'staff', null, 'customer asked')`, [id]);
    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 5, reserved: 0 });
    const o = await one(db, `select needs_review, risk_flags from orders where id = $1`, [id]);
    expect(o.needs_review).toBe(true);
    expect(o.risk_flags).toContain('refund_due');
    const n = await rows(db, `select channel from notifications where order_id = $1 and template = 'order_cancelled'`, [id]);
    expect(n).toHaveLength(2);
  });
});

describe('order status rules', () => {
  it('rejects invalid transitions', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
    expect(await failure(db, `select transition_order($1, 'shipped', 'staff')`, [id])).toContain('invalid_transition');
    await payOrder(db, id);
    expect(await failure(db, `select transition_order($1, 'delivered', 'staff')`, [id])).toContain('invalid_transition');
    await db.query(`select transition_order($1, 'processing', 'staff')`, [id]);
    await db.query(`select transition_order($1, 'shipped', 'staff')`, [id]);
    expect(await failure(db, `select transition_order($1, 'cancelled', 'staff')`, [id])).toContain('invalid_transition');
  });

  it('records every step and queues shipping and delivery messages', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
    await payOrder(db, id);
    for (const s of ['processing', 'shipped', 'delivered']) {
      await db.query(`select transition_order($1, $2::order_status, 'staff')`, [id, s]);
    }
    const hist = await rows(db, `select to_status from order_status_history where order_id = $1 order by id`, [id]);
    expect(hist.map((h) => h.to_status)).toEqual(['pending_payment', 'paid', 'processing', 'shipped', 'delivered']);
    const t = await rows(db, `select distinct template from notifications where order_id = $1 order by template`, [id]);
    expect(t.map((x) => x.template)).toEqual(['order_delivered', 'order_paid', 'order_shipped']);
    expect((await one(db, `select delivered_at from orders where id = $1`, [id])).delivered_at).not.toBeNull();
  });

  it('sends a failed delivery back to processing', async () => {
    const id = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
    await payOrder(db, id);
    await db.query(`select transition_order($1, 'processing', 'staff')`, [id]);
    await db.query(`select transition_order($1, 'shipped', 'staff')`, [id]);
    await db.query(`select transition_order($1, 'processing', 'staff', null, 'failed delivery')`, [id]);
    expect((await one(db, `select status from orders where id = $1`, [id])).status).toBe('processing');
  });
});

describe('stock adjustments', () => {
  it('never lets on_hand drop below what is reserved', async () => {
    await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 4 }]);
    expect(await failure(db, `select adjust_stock($1, -2, 'adjustment')`, [fx.variantId])).toContain('stock_adjustment_not_allowed');
    await db.query(`select adjust_stock($1, -1, 'damage', null, 'broken')`, [fx.variantId]);
    expect(await stock(db, fx.variantId)).toEqual({ on_hand: 4, reserved: 4 });
  });

  it('sets an exact stock level and writes the ledger', async () => {
    await db.query(`select set_stock($1, 12, 'import', null, 'stock take')`, [fx.variantId]);
    expect((await stock(db, fx.variantId)).on_hand).toBe(12);
    const mv = await one(db, `select delta, reason from inventory_movements where variant_id = $1 order by id desc limit 1`, [fx.variantId]);
    expect(mv).toEqual({ delta: 7, reason: 'import' });
    expect(await failure(db, `select set_stock($1, -1, 'import')`, [fx.variantId])).toContain('negative_stock');
  });
});

describe('rate limiting', () => {
  it('allows the limit then blocks, per key', async () => {
    const hit = async (k: string) => (await one(db, `select check_rate_limit($1, 3, 600) as ok`, [k])).ok as boolean;
    expect([await hit('a'), await hit('a'), await hit('a'), await hit('a')]).toEqual([true, true, true, false]);
    expect(await hit('b')).toBe(true);
  });

  it('purges expired counters', async () => {
    await db.query(`select check_rate_limit('x', 5, 60)`);
    await db.query(`update rate_limits set expires_at = now() - interval '1 minute'`);
    expect((await one(db, `select purge_expired_rate_limits() as n`)).n).toBe(1);
  });
});

describe('invoice numbers', () => {
  it('are sequential with no gaps', async () => {
    const a = await placeOrder(db, fx, [{ variantId: fx.variant2Id, qty: 1 }]);
    const b = await placeOrder(db, fx, [{ variantId: fx.variant2Id, qty: 1 }]);
    await payOrder(db, a);
    await payOrder(db, b);
    const inv = await rows(db, `select invoice_number from invoices order by invoice_number`);
    const year = new Date().getFullYear();
    expect(inv.map((i) => i.invoice_number)).toEqual([`INV-${year}-000001`, `INV-${year}-000002`]);
  });
});

describe('admin dashboard', () => {
  it('summarises orders, revenue and queues', async () => {
    const a = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
    await placeOrder(db, fx, [{ variantId: fx.variant2Id, qty: 1 }], { paymentMethod: 'pay_on_delivery' });
    await payOrder(db, a);
    const d = (await one(db, `select admin_dashboard(7) as d`)).d;
    expect(d.orders_period).toBe(2);
    expect(d.paid_orders_period).toBe(1);
    expect(d.revenue_period_pesewas).toBe(12000);
    expect(d.awaiting_confirmation).toBe(1);
    expect(d.to_fulfil).toBe(1);
    expect(d.sales_by_day).toHaveLength(7);
    expect(d.top_products[0]).toMatchObject({ name: 'Test Product' });
    expect(d.payment_success_rate).toBe(100);
  });
});
