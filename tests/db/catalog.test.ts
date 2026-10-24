import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asRole, createDb, one, rows, type Db } from './harness';

let db: Db;

beforeAll(async () => {
  db = await createDb({ seed: true });
});
afterAll(async () => {
  await db.close();
});

async function search(args: Partial<Record<string, any>> = {}) {
  const a = { q: null, cat: null, min: null, max: null, stock: false, sort: 'relevance', limit: 24, offset: 0, ...args };
  return rows<any>(
    db,
    `select * from search_storefront($1, $2, $3, $4, $5, $6, $7, $8)`,
    [a.q, a.cat, a.min, a.max, a.stock, a.sort, a.limit, a.offset],
  );
}

describe('seed data', () => {
  it('creates active products, an inventory row per variant and settings', async () => {
    const p = await one(db, `select count(*)::int as n from storefront_products`);
    expect(p.n).toBe(5);
    const v = await one(db, `select count(*)::int as variants, (select count(*)::int from inventory) as inv from product_variants`);
    expect(v.variants).toBe(v.inv);
    const s = await one(db, `select value from store_settings where key = 'return_window_days'`);
    expect(s.value).toBe(7);
  });
});

describe('search_storefront', () => {
  it('lists everything with a total count and honours paging', async () => {
    const all = await search();
    expect(all).toHaveLength(5);
    expect(Number(all[0].total_count)).toBe(5);
    const page = await search({ limit: 2, offset: 4 });
    expect(page).toHaveLength(1);
    expect(Number(page[0].total_count)).toBe(5);
  });

  it('matches word prefixes and brand names', async () => {
    expect((await search({ q: 'earb' })).map((r) => r.slug)).toEqual(['wireless-earbuds']);
    expect((await search({ q: 'voltplus' })).map((r) => r.slug)).toEqual(['power-bank-10000']);
    expect((await search({ q: 'shea cream' })).map((r) => r.slug)).toEqual(['shea-body-cream-250']);
  });

  it('tolerates a typo through trigram similarity', async () => {
    const r = await search({ q: 'wireles earbudz' });
    expect(r.map((x) => x.slug)).toContain('wireless-earbuds');
  });

  it('returns nothing for a nonsense query and survives hostile input', async () => {
    expect(await search({ q: 'zzzzqqqq' })).toHaveLength(0);
    expect(await search({ q: `'; drop table products; --` })).toHaveLength(0);
    expect(await search({ q: '&|!():*' })).toHaveLength(0); // no usable terms: must not throw
  });

  it('filters by category (including children), price and stock', async () => {
    expect((await search({ cat: 'electronics' })).map((r) => r.slug).sort()).toEqual(['power-bank-10000', 'wireless-earbuds']);
    await db.query(
      `insert into categories (name, slug, parent_id) values ('Audio', 'audio', (select id from categories where slug = 'electronics'))`,
    );
    await db.query(
      `update products set category_id = (select id from categories where slug = 'audio') where slug = 'wireless-earbuds'`,
    );
    expect((await search({ cat: 'electronics' })).map((r) => r.slug).sort()).toEqual(['power-bank-10000', 'wireless-earbuds']);
    expect((await search({ cat: 'audio' })).map((r) => r.slug)).toEqual(['wireless-earbuds']);
    expect(await search({ cat: 'does-not-exist' })).toHaveLength(0);

    expect((await search({ min: 20000 })).map((r) => r.slug).sort()).toEqual(['wireless-earbuds']);
    expect((await search({ max: 7000 })).map((r) => r.slug)).toEqual(['shea-body-cream-250']);

    await db.query(`update inventory set on_hand = 0 where variant_id in (select id from product_variants where sku = 'PWR-10K')`);
    const inStock = await search({ stock: true });
    expect(inStock.map((r) => r.slug)).not.toContain('power-bank-10000');
    expect((await search()).find((r) => r.slug === 'power-bank-10000').in_stock).toBe(false);
  });

  it('sorts by price and newest', async () => {
    const asc = (await search({ sort: 'price_asc' })).map((r) => r.min_price_pesewas);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    const desc = (await search({ sort: 'price_desc' })).map((r) => r.min_price_pesewas);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
  });

  it('hides drafts and archived products and inactive variants', async () => {
    await db.query(`update products set status = 'draft' where slug = 'nonstick-frying-pan-28'`);
    expect((await search()).map((r) => r.slug)).not.toContain('nonstick-frying-pan-28');
    await db.query(`update product_variants set is_active = false where sku like 'TEE-%'`);
    expect((await search()).map((r) => r.slug)).not.toContain('classic-cotton-tshirt');
  });

  it('is callable by anonymous visitors', async () => {
    const r = await asRole(db, 'anon', null, () => search({ q: 'earb' }));
    expect(r).toHaveLength(1);
  });
});

describe('import_catalog_rows', () => {
  beforeEach(async () => {
    await db.exec(`
      delete from inventory_movements where variant_id in (select id from product_variants where sku like 'IMP-%');
      delete from product_variants where sku like 'IMP-%';
      delete from products where slug in ('imported-hoodie', 'other-product');
    `);
  });

  const row = (n: number, over: Record<string, any> = {}) => ({
    row: n,
    product_slug: 'imported-hoodie',
    product_name: 'Imported Hoodie',
    category_slug: 'fashion',
    brand: 'Kente Basics',
    description: 'Warm hoodie',
    option_names: ['size'],
    status: 'active',
    sku: `IMP-${n}`,
    variant_name: `Size ${n}`,
    option_values: { size: String(n) },
    price_pesewas: 12000,
    compare_at_pesewas: null,
    cost_pesewas: 7000,
    stock: 10,
    ...over,
  });

  const run = async (rowsIn: any[]) =>
    (await one(db, `select import_catalog_rows($1::jsonb, null) as r`, [JSON.stringify(rowsIn)])).r;

  it('creates a product with variants, costs and stock through the ledger', async () => {
    const r = await run([row(2), row(3)]);
    expect(r).toMatchObject({ created_products: 1, created_variants: 2, updated_variants: 0, errors: [] });
    const inv = await one(db, `select on_hand from inventory where variant_id = (select id from product_variants where sku = 'IMP-2')`);
    expect(inv.on_hand).toBe(10);
    const mv = await rows(db, `select reason from inventory_movements where variant_id = (select id from product_variants where sku = 'IMP-2')`);
    expect(mv).toEqual([{ reason: 'import' }]);
    const cost = await one(db, `select cost_pesewas from variant_costs where variant_id = (select id from product_variants where sku = 'IMP-3')`);
    expect(cost.cost_pesewas).toBe(7000);
  });

  it('changes only rows that differ when the same file is uploaded again', async () => {
    await run([row(2), row(3)]);
    const again = await run([row(2), row(3, { price_pesewas: 13000 })]);
    expect(again).toMatchObject({ created_variants: 0, updated_variants: 1, unchanged_variants: 1, errors: [] });
    expect(again.created_products + again.updated_products).toBe(0);
    const p = await one(db, `select price_pesewas from product_variants where sku = 'IMP-3'`);
    expect(p.price_pesewas).toBe(13000);
    expect((await one(db, `select count(*)::int as n from inventory_movements where variant_id = (select id from product_variants where sku = 'IMP-2')`)).n).toBe(1);
  });

  it('reports a bad row without stopping the rest of the batch', async () => {
    const r = await run([
      row(2),
      row(3, { category_slug: 'nope' }),
      row(4, { price_pesewas: -5 }),
      row(5),
    ]);
    expect(r.created_variants).toBe(2);
    expect(r.errors.map((e: any) => e.row).sort()).toEqual([3, 4]);
    expect(r.errors.find((e: any) => e.row === 3).message).toContain('unknown_category');
    expect((await one(db, `select count(*)::int as n from product_variants where sku in ('IMP-3', 'IMP-4')`)).n).toBe(0);
  });

  it('never moves a SKU to a different product', async () => {
    await run([row(2)]);
    const r = await run([row(2, { product_slug: 'other-product', product_name: 'Other' })]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toContain('sku_belongs_to_other_product');
    const owner = await one(db, `select p.slug from product_variants v join products p on p.id = v.product_id where v.sku = 'IMP-2'`);
    expect(owner.slug).toBe('imported-hoodie');
  });

  it('refuses to cut stock below what is reserved', async () => {
    await run([row(2, { stock: 5 })]);
    await db.query(`update inventory set reserved = 4 where variant_id = (select id from product_variants where sku = 'IMP-2')`);
    const r = await run([row(2, { stock: 2 })]);
    expect(r.errors).toHaveLength(1);
    expect((await one(db, `select on_hand from inventory where variant_id = (select id from product_variants where sku = 'IMP-2')`)).on_hand).toBe(5);
  });
});

describe('order prefix setting', () => {
  it('uses the configured prefix for new order numbers', async () => {
    await db.query(`insert into store_settings (key, value) values ('order_prefix', '"SHOP"') on conflict (key) do update set value = '"SHOP"'`);
    const r = await one(db, `select gen_order_number() as n`);
    expect(r.n).toMatch(/^SHOP-\d{6}$/);
    await db.query(`delete from store_settings where key = 'order_prefix'`);
    expect((await one(db, `select gen_order_number() as n`)).n).toMatch(/^ODH-\d{6}$/);
  });
});

describe('profile sync', () => {
  it('creates a profile for a new user and records phone verification', async () => {
    const u = await one(db, `insert into auth.users (phone, raw_user_meta_data) values ('233201234567', '{"full_name":"Kofi"}') returning id`);
    let p = await one(db, `select * from profiles where id = $1`, [u.id]);
    expect(p).toMatchObject({ phone: '+233201234567', full_name: 'Kofi', phone_verified_at: null });
    await db.query(`update auth.users set phone_confirmed_at = now() where id = $1`, [u.id]);
    p = await one(db, `select * from profiles where id = $1`, [u.id]);
    expect(p.phone_verified_at).not.toBeNull();
  });

  it('survives a user with no usable phone number', async () => {
    const u = await one(db, `insert into auth.users (email, phone) values ('a@example.com', 'not-a-phone') returning id`);
    const p = await one(db, `select phone, email from profiles where id = $1`, [u.id]);
    expect(p).toEqual({ phone: null, email: 'a@example.com' });
  });
});
