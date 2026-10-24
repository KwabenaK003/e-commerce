-- =====================================================================
-- 0001: extensions, enums, shared helpers, catalog and inventory
-- Money is always integer pesewas (GHS x 100). Never floats.
-- =====================================================================

-- Extensions live in their own schema (as on Supabase) so that revoking function
-- privileges on `public` later never touches extension functions.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pg_trgm with schema extensions;

create type order_status as enum (
  'pending_payment', 'awaiting_confirmation', 'paid', 'processing',
  'shipped', 'delivered', 'cancelled');
create type payment_status as enum (
  'unpaid', 'paid', 'failed', 'partially_refunded', 'refunded');
create type fulfillment_method as enum ('delivery', 'pickup');
create type return_status as enum (
  'requested', 'approved', 'rejected', 'received', 'refunded', 'closed');
create type notif_channel as enum ('email', 'sms');
create type notif_status as enum ('queued', 'sent', 'failed');
create type staff_role as enum ('owner', 'manager', 'support', 'fulfillment');

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------
create table categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references categories(id),
  name text not null,
  slug text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id),
  name text not null,
  slug text not null unique,
  brand text,
  description text,
  option_names text[] not null default '{}',          -- e.g. {size,color}
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  featured boolean not null default false,
  seo_title text,
  seo_description text,
  search tsvector generated always as (
    to_tsvector('simple',
      coalesce(name, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(description, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_search_idx on products using gin (search);
create index products_name_trgm on products using gin (name extensions.gin_trgm_ops);
create index products_status_cat on products (status, category_id);

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete restrict,
  sku text not null unique,
  name text,                                          -- e.g. 'Black / XL'
  option_values jsonb not null default '{}',          -- {"size":"XL","color":"Black"}
  price_pesewas int not null check (price_pesewas >= 0),
  compare_at_pesewas int check (compare_at_pesewas >= 0),
  weight_grams int,
  barcode text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index variants_product_idx on product_variants (product_id);

-- Staff-only. Never exposed to customers.
create table variant_costs (
  variant_id uuid primary key references product_variants(id) on delete cascade,
  cost_pesewas int not null check (cost_pesewas >= 0),
  updated_at timestamptz not null default now()
);

create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete set null,
  storage_path text not null,                         -- Supabase Storage key in product-images bucket
  alt_text text,
  sort_order int not null default 0
);
create index images_product_idx on product_images (product_id, sort_order);

create table inventory (
  variant_id uuid primary key references product_variants(id) on delete cascade,
  on_hand int not null default 0 check (on_hand >= 0),
  reserved int not null default 0 check (reserved >= 0),
  low_stock_threshold int not null default 5,
  updated_at timestamptz not null default now(),
  check (reserved <= on_hand)
);
-- available to sell = on_hand - reserved

create table inventory_movements (
  id bigint generated always as identity primary key,
  variant_id uuid not null references product_variants(id),
  delta int not null,                                 -- + in, - out
  reason text not null check (reason in
    ('sale', 'restock', 'adjustment', 'return', 'import', 'damage')),
  order_id uuid,                                      -- FK added once orders exist
  actor_id uuid,                                      -- staff user; null = system
  note text,
  created_at timestamptz not null default now()
);
create index inv_mov_variant_idx on inventory_movements (variant_id, created_at desc);

-- Every variant gets an inventory row automatically.
create or replace function create_inventory_row() returns trigger
language plpgsql as $$
begin
  insert into inventory (variant_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger trg_variant_inventory after insert on product_variants
  for each row execute function create_inventory_row();

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['categories', 'products', 'product_variants', 'variant_costs', 'inventory']
  loop
    execute format(
      'create trigger trg_%1$s_updated before update on %1$I
         for each row execute function set_updated_at()', t);
  end loop;
end $$;
