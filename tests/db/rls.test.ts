import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, baseFixture, createDb, failure, one, placeOrder, rows, type Db, type Fixture } from './harness';

let db: Db;
let fx: Fixture;
let alice: string;
let bob: string;
const staff: Record<string, string> = {};
let orderId: string;

beforeAll(async () => {
  db = await createDb();
  fx = await baseFixture(db);
  alice = (await one(db, `insert into auth.users (email) values ('alice@example.com') returning id`)).id;
  bob = (await one(db, `insert into auth.users (email) values ('bob@example.com') returning id`)).id;
  for (const role of ['owner', 'manager', 'support', 'fulfillment']) {
    const u = await one(db, `insert into auth.users (email) values ($1) returning id`, [`${role}@example.com`]);
    staff[role] = u.id;
    await db.query(`insert into staff (user_id, role) values ($1, $2::staff_role)`, [u.id, role]);
  }
  for (const [uid, label] of [[alice, 'Alice home'], [bob, 'Bob home']] as const) {
    await db.query(
      `insert into addresses (user_id, label, recipient_name, phone, region, town, street_landmark)
       values ($1, $2, 'X', '+233200000001', 'Greater Accra', 'Osu', 'Near X')`,
      [uid, label],
    );
    await db.query(`insert into carts (user_id) values ($1)`, [uid]);
  }
  orderId = await placeOrder(db, fx, [{ variantId: fx.variantId, qty: 1 }]);
  await db.query(`insert into store_settings (key, value) values ('support_phone', '"+233200000000"')`);
  await db.query(`insert into products (name, slug, status) values ('Draft thing', 'draft-thing', 'draft')`);
});
afterAll(async () => {
  await db.close();
});

const count = async (table: string) => (await one(db, `select count(*)::int as n from ${table}`)).n as number;

describe('visitors (anon)', () => {
  it('see only active catalog rows', async () => {
    await asRole(db, 'anon', null, async () => {
      expect(await count('products')).toBe(1);
      expect(await count('product_variants')).toBe(2);
      expect(await count('categories')).toBe(1);
      expect(await count('delivery_zones')).toBe(1);
      expect(await count('storefront_products')).toBe(1);
    });
  });

  it('get stock as flags, never as numbers', async () => {
    await asRole(db, 'anon', null, async () => {
      const s = await rows(db, `select * from public_variant_stock`);
      expect(s).toHaveLength(2);
      expect(Object.keys(s[0]).sort()).toEqual(['in_stock', 'low_stock', 'variant_id']);
      expect(await failure(db, `select on_hand from inventory`)).toContain('permission denied');
    });
  });

  it('cannot read orders, payments, costs, settings or staff', async () => {
    await asRole(db, 'anon', null, async () => {
      for (const t of ['orders', 'order_items', 'payments', 'variant_costs', 'store_settings', 'staff', 'notifications', 'coupons', 'profiles', 'addresses', 'carts', 'audit_log', 'invoices']) {
        expect(await failure(db, `select * from ${t}`), t).toContain('permission denied');
      }
    });
  });

  it('cannot write anything', async () => {
    await asRole(db, 'anon', null, async () => {
      expect(await failure(db, `update products set name = 'x'`)).toContain('permission denied');
      expect(await failure(db, `insert into products (name, slug) values ('x', 'x')`)).toContain('permission denied');
      expect(await failure(db, `update product_variants set price_pesewas = 1`)).toContain('permission denied');
    });
  });

  it('cannot call the business functions', async () => {
    await asRole(db, 'anon', null, async () => {
      expect(await failure(db, `select transition_order($1, 'cancelled', 'staff')`, [orderId])).toContain('permission denied');
      expect(await failure(db, `select adjust_stock($1, 100, 'adjustment')`, [fx.variantId])).toContain('permission denied');
      expect(await failure(db, `select mark_order_paid('x', 1, 'GHS', 'x', 'x', 'x')`)).toContain('permission denied');
      expect(await failure(db, `select check_rate_limit('x', 1, 60)`)).toContain('permission denied');
    });
  });
});

describe('customers (authenticated, not staff)', () => {
  it('see only their own addresses, cart and profile', async () => {
    await asRole(db, 'authenticated', alice, async () => {
      const a = await rows(db, `select label from addresses`);
      expect(a).toEqual([{ label: 'Alice home' }]);
      expect(await count('carts')).toBe(1);
      expect(await count('profiles')).toBe(1);
    });
    await asRole(db, 'authenticated', bob, async () => {
      expect(await rows(db, `select label from addresses`)).toEqual([{ label: 'Bob home' }]);
    });
  });

  it("cannot touch another customer's rows", async () => {
    await asRole(db, 'authenticated', alice, async () => {
      const r = await db.query(`update addresses set town = 'Hacked' where label = 'Bob home'`);
      expect(r.affectedRows).toBe(0);
      const del = await db.query(`delete from carts where user_id = $1`, [bob]);
      expect(del.affectedRows).toBe(0);
      expect(await failure(db, `insert into addresses (user_id, recipient_name, phone, region, town, street_landmark)
        values ($1, 'X', '+233200000001', 'Ashanti', 'Kumasi', 'x')`, [bob])).toContain('row-level security');
    });
  });

  it('can edit their name and consent, but not their phone or email', async () => {
    await asRole(db, 'authenticated', alice, async () => {
      await db.query(`update profiles set full_name = 'Alice A', sms_marketing_consent = true, consent_updated_at = now()`);
      expect(await failure(db, `update profiles set phone = '+233200000009'`)).toContain('permission denied');
      expect(await failure(db, `update profiles set email = 'evil@example.com'`)).toContain('permission denied');
    });
  });

  it('cannot see orders, payments, costs or other staff-only data', async () => {
    await asRole(db, 'authenticated', alice, async () => {
      expect(await count('orders')).toBe(0);
      expect(await count('order_items')).toBe(0);
      expect(await count('payments')).toBe(0);
      expect(await count('variant_costs')).toBe(0);
      expect(await count('inventory')).toBe(0);
      expect(await count('coupons')).toBe(0);
      expect(await count('audit_log')).toBe(0);
      expect(await count('order_notes')).toBe(0);
      expect(await failure(db, `select * from store_settings`)).toContain('permission denied');
      expect(await failure(db, `select * from staff`)).toContain('permission denied');
    });
  });

  it('cannot write orders or inventory', async () => {
    await asRole(db, 'authenticated', alice, async () => {
      expect(await failure(db, `update orders set total_pesewas = 1`)).toContain('permission denied');
      expect(await failure(db, `update inventory set on_hand = 999`)).toContain('permission denied');
      expect(await failure(db, `select transition_order($1, 'cancelled', 'customer')`, [orderId])).toContain('permission denied');
    });
  });
});

describe('staff roles', () => {
  it('every active staff member can read orders, fulfillments and inventory', async () => {
    for (const role of Object.keys(staff)) {
      await asRole(db, 'authenticated', staff[role], async () => {
        expect(await count('orders'), role).toBe(1);
        expect(await count('order_items'), role).toBe(1);
        expect(await count('inventory'), role).toBe(2);
        expect(await count('order_notes'), role).toBe(0);
      });
    }
  });

  it('only owner and manager can read payments, refunds, costs, coupons and the audit log', async () => {
    await db.query(`insert into coupons (code, kind, value) values ('X1', 'fixed', 100)`);
    await db.query(`insert into audit_log (action, entity_type, entity_id) values ('t', 't', '1')`);
    await db.query(`select start_payment($1, 'rls-ref')`, [orderId]);
    for (const role of ['owner', 'manager']) {
      await asRole(db, 'authenticated', staff[role], async () => {
        expect(await count('payments'), role).toBe(1);
        expect(await count('variant_costs'), role).toBe(1);
        expect(await count('coupons'), role).toBe(1);
        expect(await count('audit_log'), role).toBe(1);
      });
    }
    for (const role of ['support', 'fulfillment']) {
      await asRole(db, 'authenticated', staff[role], async () => {
        expect(await count('payments'), role).toBe(0);
        expect(await count('variant_costs'), role).toBe(0);
        expect(await count('coupons'), role).toBe(0);
        expect(await count('audit_log'), role).toBe(0);
      });
    }
  });

  it('staff see draft products', async () => {
    await asRole(db, 'authenticated', staff.support, async () => {
      expect(await count('products')).toBe(2);
    });
  });

  it('a deactivated staff member loses access immediately', async () => {
    await db.query(`update staff set is_active = false where user_id = $1`, [staff.support]);
    await asRole(db, 'authenticated', staff.support, async () => {
      expect(await count('orders')).toBe(0);
      expect(await count('products')).toBe(1);
    });
    await db.query(`update staff set is_active = true where user_id = $1`, [staff.support]);
  });

  it('staff have no direct write access either: writes go through audited server actions', async () => {
    await asRole(db, 'authenticated', staff.owner, async () => {
      expect(await failure(db, `update orders set status = 'delivered'`)).toContain('permission denied');
      expect(await failure(db, `update products set name = 'x'`)).toContain('permission denied');
      expect(await failure(db, `select * from store_settings`)).toContain('permission denied');
    });
  });
});

describe('service role (server code)', () => {
  it('can read and write everything and call the functions', async () => {
    await asRole(db, 'service_role', null, async () => {
      expect(await count('orders')).toBe(1);
      expect(await count('store_settings')).toBe(1);
      await db.query(`select adjust_stock($1, 1, 'restock')`, [fx.variantId]);
      expect((await one(db, `select check_rate_limit('svc', 5, 60) as ok`)).ok).toBe(true);
    });
  });
});
