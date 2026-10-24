import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Runs the real migrations in an in-memory Postgres (PGlite), with just enough
 * of Supabase stubbed (roles, auth.users, auth.uid) for row level security to behave
 * the way it does in production. No Docker needed.
 *
 * Note: PGlite is single-connection, so these tests prove the SQL rules (a second
 * buyer is refused the last unit, a duplicate webhook changes nothing) but not true
 * parallel contention. Row-level locking in the functions covers that in Postgres.
 */

const STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    phone text,
    phone_confirmed_at timestamptz,
    raw_user_meta_data jsonb not null default '{}'
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;

  -- Supabase's own default privileges for the public schema
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');
const SEED_FILE = path.resolve(__dirname, '../../supabase/seed.sql');

export type Db = PGlite;

export async function createDb(opts: { seed?: boolean } = {}): Promise<Db> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(STUBS);
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    try {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  if (opts.seed) await db.exec(fs.readFileSync(SEED_FILE, 'utf8'));
  return db;
}

/** Run a callback as a given database role (and optional auth user), then restore. */
export async function asRole<T>(
  db: Db,
  role: 'anon' | 'authenticated' | 'service_role',
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId ?? ''}', false)`);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

export async function one<T = any>(db: Db, sql: string, params: any[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0] as T;
}

export async function rows<T = any>(db: Db, sql: string, params: any[] = []): Promise<T[]> {
  const r = await db.query<T>(sql, params);
  return r.rows as T[];
}

/** Expect a query to fail and return the Postgres error message. */
export async function failure(db: Db, sql: string, params: any[] = []): Promise<string> {
  try {
    await db.query(sql, params);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`Expected failure but succeeded: ${sql}`);
}

export interface Fixture {
  zoneId: string;
  pickupId: string;
  categoryId: string;
  productId: string;
  variantId: string;
  variant2Id: string;
}

/** Minimal catalog: one product, two variants, one delivery zone, one pickup location. */
export async function baseFixture(db: Db, stock = { v1: 5, v2: 3 }): Promise<Fixture> {
  const cat = await one(db, `insert into categories (name, slug) values ('Test', 'test') returning id`);
  const prod = await one(
    db,
    `insert into products (category_id, name, slug, status) values ($1, 'Test Product', 'test-product', 'active') returning id`,
    [cat.id],
  );
  const v1 = await one(
    db,
    `insert into product_variants (product_id, sku, name, price_pesewas) values ($1, 'SKU-1', 'One', 10000) returning id`,
    [prod.id],
  );
  const v2 = await one(
    db,
    `insert into product_variants (product_id, sku, name, price_pesewas) values ($1, 'SKU-2', 'Two', 2500) returning id`,
    [prod.id],
  );
  await db.query(`update inventory set on_hand = $2 where variant_id = $1`, [v1.id, stock.v1]);
  await db.query(`update inventory set on_hand = $2 where variant_id = $1`, [v2.id, stock.v2]);
  await db.query(`insert into variant_costs (variant_id, cost_pesewas) values ($1, 6000)`, [v1.id]);
  const zone = await one(
    db,
    `insert into delivery_zones (name, regions, fee_pesewas, free_over_pesewas) values ('Accra', array['Greater Accra'], 2000, 100000) returning id`,
  );
  const pickup = await one(db, `insert into pickup_locations (name, address) values ('Store', 'Accra') returning id`);
  return {
    zoneId: zone.id,
    pickupId: pickup.id,
    categoryId: cat.id,
    productId: prod.id,
    variantId: v1.id,
    variant2Id: v2.id,
  };
}

export const ADDRESS = {
  recipient_name: 'Ama Mensah',
  phone: '+233200000001',
  region: 'Greater Accra',
  town: 'Osu',
  street_landmark: 'Near the post office',
};

/** Create a guest cart with the given items and return its id. */
export async function makeCart(db: Db, items: Array<{ variantId: string; qty: number }>): Promise<string> {
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const cart = await one(db, `insert into carts (guest_token) values ($1) returning id`, [token]);
  for (const it of items) {
    await db.query(`insert into cart_items (cart_id, variant_id, quantity) values ($1, $2, $3)`, [
      cart.id,
      it.variantId,
      it.qty,
    ]);
  }
  return cart.id;
}

export async function placeOrder(
  db: Db,
  fx: Fixture,
  items: Array<{ variantId: string; qty: number }>,
  over: Partial<{
    phone: string;
    email: string | null;
    fulfillment: 'delivery' | 'pickup';
    paymentMethod: 'paystack' | 'pay_on_delivery';
    coupon: string | null;
    address: any;
  }> = {},
): Promise<string> {
  const cartId = await makeCart(db, items);
  const fulfillment = over.fulfillment ?? 'delivery';
  const r = await one(
    db,
    `select create_order_from_cart($1, $2, $3, $4::fulfillment_method, $5::jsonb, $6, $7, $8, $9, $10) as id`,
    [
      cartId,
      over.email === undefined ? 'ama@example.com' : over.email,
      over.phone ?? '+233200000001',
      fulfillment,
      JSON.stringify(over.address ?? ADDRESS),
      fulfillment === 'delivery' ? fx.zoneId : null,
      fulfillment === 'pickup' ? fx.pickupId : null,
      over.paymentMethod ?? 'paystack',
      over.coupon ?? null,
      null,
    ],
  );
  return r.id;
}

let refCounter = 0;
/** Start a payment for an order and return its reference. */
export async function startPayment(db: Db, orderId: string): Promise<string> {
  const ref = `ref-${Date.now()}-${++refCounter}`;
  await db.query(`select start_payment($1, $2)`, [orderId, ref]);
  return ref;
}

export async function payOrder(db: Db, orderId: string, amount?: number): Promise<string> {
  const ref = await startPayment(db, orderId);
  const o = await one(db, `select total_pesewas from orders where id = $1`, [orderId]);
  await db.query(`select mark_order_paid($1, $2, 'GHS', 'txn_1', 'mobile_money', 'Approved')`, [
    ref,
    amount ?? o.total_pesewas,
  ]);
  return ref;
}

export async function stock(db: Db, variantId: string): Promise<{ on_hand: number; reserved: number }> {
  return one(db, `select on_hand, reserved from inventory where variant_id = $1`, [variantId]);
}
