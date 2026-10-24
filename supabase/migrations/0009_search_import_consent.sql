-- =====================================================================
-- 0009: storefront search, bulk import, consent records, order notes,
--       size guides, configurable order prefix, profile sync
-- =====================================================================

-- ---------------------------------------------------------------------
-- Small column additions
-- ---------------------------------------------------------------------
alter table products add column size_guide text;                 -- shown on the product page

alter table product_images add column source_ref text;           -- original file name or URL (bulk import)
create unique index product_images_source_idx
  on product_images (product_id, source_ref) where source_ref is not null;

alter table import_jobs add column processed_rows int not null default 0;
alter table import_jobs add column images_zip_path text;
alter table import_jobs add column summary jsonb not null default '{}';

-- ---------------------------------------------------------------------
-- Order number prefix is a setting (store_settings.order_prefix, default ODH)
-- ---------------------------------------------------------------------
create or replace function gen_order_number() returns text
language plpgsql as $$
declare v_prefix text;
begin
  select nullif(trim(value #>> '{}'), '') into v_prefix
    from store_settings where key = 'order_prefix';
  return coalesce(v_prefix, 'ODH') || '-' || lpad(nextval('order_number_seq')::text, 6, '0');
end $$;

alter table orders alter column order_number set default gen_order_number();

-- ---------------------------------------------------------------------
-- Consent records (SMS and email marketing) and staff order notes
-- ---------------------------------------------------------------------
create table consent_log (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete set null,
  email text,
  phone text,
  channel text not null check (channel in ('email', 'sms')),
  granted boolean not null,
  source text not null,                                  -- 'checkout', 'account', 'admin'
  ip inet,
  created_at timestamptz not null default now(),
  check (user_id is not null or email is not null or phone is not null)
);
create index consent_log_user_idx on consent_log (user_id);
create index consent_log_phone_idx on consent_log (phone);
create index consent_log_email_idx on consent_log (email);

create table order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  author_id uuid,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index order_notes_order_idx on order_notes (order_id, created_at);

-- Tables created after 0007 must opt in to RLS explicitly.
alter table consent_log enable row level security;
alter table order_notes enable row level security;
grant select on consent_log, order_notes to authenticated;
create policy staff_read on consent_log for select
  using (has_staff_role(array['owner', 'manager']::staff_role[]));
create policy staff_read on order_notes for select using (is_staff());

-- ---------------------------------------------------------------------
-- Keep profiles in step with auth.users (phone verification, email change)
-- ---------------------------------------------------------------------
create or replace function handle_user_updated() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_phone text;
begin
  v_phone := case
    when new.phone ~ '^[0-9]{8,15}$' then '+' || new.phone
    when new.phone ~ '^\+[1-9][0-9]{7,14}$' then new.phone
    else null end;
  update profiles set
    email = new.email,
    phone = v_phone,
    phone_verified_at = case
      when v_phone is not null and new.phone_confirmed_at is not null
        then coalesce(profiles.phone_verified_at, new.phone_confirmed_at)
      else null end
  where id = new.id;
  return new;
end $$;

create trigger on_auth_user_updated
  after update of email, phone, phone_confirmed_at on auth.users
  for each row execute function handle_user_updated();

-- ---------------------------------------------------------------------
-- Storefront search: prefix matching, typo tolerance (trigrams), filters, paging.
-- Runs as the caller (anon is fine): storefront_products already exposes
-- only active products and safe columns.
-- ---------------------------------------------------------------------
create or replace function search_storefront(
  p_query text default null,
  p_category_slug text default null,
  p_min_price int default null,
  p_max_price int default null,
  p_in_stock boolean default false,
  p_sort text default 'relevance',
  p_limit int default 24,
  p_offset int default 0)
returns table (
  id uuid, slug text, name text, brand text, category_id uuid, featured boolean,
  created_at timestamptz, min_price_pesewas int, max_price_pesewas int,
  min_compare_pesewas int, in_stock boolean, image_path text, image_alt text,
  total_count bigint)
language plpgsql stable set search_path = public, extensions as $$
declare
  v_q text := nullif(trim(p_query), '');
  v_terms text;
  v_tsq tsquery;
  v_cat_ids uuid[];
begin
  if p_category_slug is not null then
    with recursive tree as (
      select c.id from categories c where c.slug = p_category_slug and c.is_active
      union all
      select c.id from categories c join tree t on c.parent_id = t.id where c.is_active)
    select array_agg(tree.id) into v_cat_ids from tree;
    if v_cat_ids is null then return; end if;
  end if;

  if v_q is not null then
    select string_agg(s.w || ':*', ' & ') into v_terms from (
      select regexp_replace(lower(x), '[^[:alnum:]]', '', 'g') as w
      from unnest(string_to_array(left(v_q, 80), ' ')) x) s
    where s.w <> '';
    if v_terms is not null then v_tsq := to_tsquery('simple', v_terms); end if;
  end if;

  return query
  select r.id, r.slug, r.name, r.brand, r.category_id, r.featured, r.created_at,
         r.min_price_pesewas, r.max_price_pesewas, r.min_compare_pesewas,
         r.in_stock, r.image_path, r.image_alt, count(*) over () as total_count
  from (
    select sp.*,
           case when v_q is null then 0
                else coalesce(ts_rank(sp.search, v_tsq), 0) + similarity(sp.name, v_q) end as rnk
    from storefront_products sp
    where (v_cat_ids is null or sp.category_id = any(v_cat_ids))
      and (p_min_price is null or sp.max_price_pesewas >= p_min_price)
      and (p_max_price is null or sp.min_price_pesewas <= p_max_price)
      and (not p_in_stock or sp.in_stock)
      and (v_q is null
           or (v_tsq is not null and sp.search @@ v_tsq)
           or sp.name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%'
           or similarity(sp.name, v_q) > 0.3)
  ) r
  order by
    case when p_sort = 'price_asc' then r.min_price_pesewas end asc,
    case when p_sort = 'price_desc' then r.min_price_pesewas end desc,
    case when p_sort = 'newest' then r.created_at end desc,
    case when p_sort = 'relevance' and v_q is not null then r.rnk end desc,
    r.featured desc, r.created_at desc, r.id
  limit greatest(least(p_limit, 60), 1)
  offset greatest(p_offset, 0);
end $$;

grant execute on function search_storefront(text, text, int, int, boolean, text, int, int)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- Bulk import. One call = one batch (100 to 200 rows) = one transaction,
-- but a bad row is isolated in a sub-transaction and reported, so it never
-- stops the rest of the batch.
--
-- p_rows: [{ "row": 2, "product_slug": "...", "product_name": "...",
--   "category_slug": "...", "brand": "...", "description": "...",
--   "option_names": ["size"], "status": "active", "sku": "...",
--   "variant_name": "...", "option_values": {"size":"M"},
--   "price_pesewas": 7500, "compare_at_pesewas": null,
--   "cost_pesewas": 4500, "stock": 10 }]
-- Returns counts plus per-row errors:
--   {"created_variants":n,"updated_variants":n,"unchanged_variants":n,
--    "created_products":n,"updated_products":n,"errors":[{"row":n,"message":"..."}]}
-- ---------------------------------------------------------------------
create or replace function import_catalog_rows(p_rows jsonb, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  v_cat uuid;
  v_pid uuid;
  v_vid uuid;
  v_existing_pid uuid;
  v_inserted boolean;
  v_changed int;
  v_row int;
  v_created_v int := 0;  v_updated_v int := 0;  v_unchanged_v int := 0;
  v_created_p int := 0;  v_updated_p int := 0;
  v_errors jsonb := '[]';
  v_opts text[];
begin
  for it in select * from jsonb_array_elements(p_rows) loop
    v_row := (it ->> 'row')::int;
    begin
      v_cat := null;
      if nullif(it ->> 'category_slug', '') is not null then
        select id into v_cat from categories where slug = it ->> 'category_slug';
        if v_cat is null then raise exception 'unknown_category:%', it ->> 'category_slug'; end if;
      end if;

      select coalesce(array_agg(x), '{}') into v_opts
        from jsonb_array_elements_text(coalesce(it -> 'option_names', '[]')) x;

      -- product (insert or update only when something differs)
      insert into products (slug, name, category_id, brand, description, option_names, status, size_guide)
      values (it ->> 'product_slug', it ->> 'product_name', v_cat,
              nullif(it ->> 'brand', ''), nullif(it ->> 'description', ''), v_opts,
              coalesce(nullif(it ->> 'status', ''), 'draft'), nullif(it ->> 'size_guide', ''))
      on conflict (slug) do update set
        name = excluded.name, category_id = excluded.category_id, brand = excluded.brand,
        description = excluded.description, option_names = excluded.option_names,
        status = excluded.status,
        size_guide = coalesce(excluded.size_guide, products.size_guide)
      where (products.name, products.category_id, products.brand, products.description,
             products.option_names, products.status)
            is distinct from
            (excluded.name, excluded.category_id, excluded.brand, excluded.description,
             excluded.option_names, excluded.status)
      returning id, (xmax = 0) into v_pid, v_inserted;

      if v_pid is null then                       -- existed and unchanged
        select id into v_pid from products where slug = it ->> 'product_slug';
      elsif v_inserted then
        v_created_p := v_created_p + 1;
      else
        v_updated_p := v_updated_p + 1;
      end if;

      -- variant, keyed on SKU. A SKU can never move to a different product.
      select product_id into v_existing_pid from product_variants where sku = it ->> 'sku';
      if v_existing_pid is not null and v_existing_pid <> v_pid then
        raise exception 'sku_belongs_to_other_product:%', it ->> 'sku';
      end if;

      insert into product_variants (product_id, sku, name, option_values, price_pesewas, compare_at_pesewas)
      values (v_pid, it ->> 'sku', nullif(it ->> 'variant_name', ''),
              coalesce(it -> 'option_values', '{}'),
              (it ->> 'price_pesewas')::int, (it ->> 'compare_at_pesewas')::int)
      on conflict (sku) do update set
        name = excluded.name, option_values = excluded.option_values,
        price_pesewas = excluded.price_pesewas, compare_at_pesewas = excluded.compare_at_pesewas
      where (product_variants.name, product_variants.option_values,
             product_variants.price_pesewas, product_variants.compare_at_pesewas)
            is distinct from
            (excluded.name, excluded.option_values, excluded.price_pesewas, excluded.compare_at_pesewas)
      returning id, (xmax = 0) into v_vid, v_inserted;

      v_changed := 0;
      if v_vid is null then
        select id into v_vid from product_variants where sku = it ->> 'sku';
      elsif v_inserted then
        v_created_v := v_created_v + 1;  v_changed := 1;
      else
        v_updated_v := v_updated_v + 1;   v_changed := 1;
      end if;

      if (it ->> 'cost_pesewas') is not null then
        insert into variant_costs (variant_id, cost_pesewas)
        values (v_vid, (it ->> 'cost_pesewas')::int)
        on conflict (variant_id) do update set cost_pesewas = excluded.cost_pesewas
        where variant_costs.cost_pesewas is distinct from excluded.cost_pesewas;
      end if;

      if (it ->> 'stock') is not null then
        perform set_stock(v_vid, (it ->> 'stock')::int, 'import', p_actor, 'bulk import');
      end if;

      if v_changed = 0 then v_unchanged_v := v_unchanged_v + 1; end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'created_variants', v_created_v, 'updated_variants', v_updated_v,
    'unchanged_variants', v_unchanged_v,
    'created_products', v_created_p, 'updated_products', v_updated_p,
    'errors', v_errors);
end $$;
