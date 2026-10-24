-- =====================================================================
-- 0003: orders, order items, payments, webhook events, status history
-- An order is a frozen record of one sale: address, prices and names
-- are copied at purchase time.
-- =====================================================================

create sequence order_number_seq start 10001;

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique
    default ('ODH-' || lpad(nextval('order_number_seq')::text, 6, '0')),
  public_token text not null unique
    default replace(gen_random_uuid()::text, '-', ''),    -- guest tracking secret
  user_id uuid references profiles(id) on delete set null,
  contact_email text,
  contact_phone text not null check (contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  status order_status not null default 'pending_payment',
  payment_status payment_status not null default 'unpaid',
  payment_method text not null default 'paystack'
    check (payment_method in ('paystack', 'pay_on_delivery')),
  fulfillment fulfillment_method not null default 'delivery',
  shipping_address jsonb,                               -- snapshot; null for pickup
  delivery_zone_id uuid references delivery_zones(id),
  pickup_location_id uuid references pickup_locations(id),
  subtotal_pesewas int not null check (subtotal_pesewas >= 0),
  discount_pesewas int not null default 0 check (discount_pesewas >= 0),
  shipping_pesewas int not null default 0 check (shipping_pesewas >= 0),
  tax_pesewas int not null default 0 check (tax_pesewas >= 0),
  tax_inclusive boolean not null default true,          -- true: tax is already inside the subtotal
  total_pesewas int not null check (total_pesewas >= 0),
  currency char(3) not null default 'GHS',
  coupon_id uuid,                                       -- FK added with coupons
  coupon_code text,
  customer_note text,
  reserved_until timestamptz,                           -- stock hold for unpaid orders
  needs_review boolean not null default false,          -- fraud / manual check
  risk_flags text[] not null default '{}',
  placed_at timestamptz not null default now(),
  paid_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (total_pesewas = subtotal_pesewas - discount_pesewas + shipping_pesewas
                         + case when tax_inclusive then 0 else tax_pesewas end),
  check ((fulfillment = 'delivery' and shipping_address is not null)
      or (fulfillment = 'pickup' and pickup_location_id is not null))
);
create index orders_user_idx on orders (user_id, placed_at desc);
create index orders_status_idx on orders (status, placed_at desc);
create index orders_phone_idx on orders (contact_phone);
create index orders_review_idx on orders (placed_at) where needs_review;
create index orders_expiry_idx on orders (reserved_until) where status = 'pending_payment';

alter table inventory_movements
  add foreign key (order_id) references orders(id);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete set null,
  sku text not null,                                    -- snapshots from here down
  product_name text not null,
  variant_name text,
  image_path text,
  unit_price_pesewas int not null check (unit_price_pesewas >= 0),
  cost_pesewas int,                                     -- for margin reports; server/staff only
  quantity int not null check (quantity > 0),
  line_total_pesewas int generated always as (unit_price_pesewas * quantity) stored
);
create index order_items_order_idx on order_items (order_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  provider text not null default 'paystack',
  reference text not null unique,                       -- we generate it, send it to Paystack
  provider_txn_id text,
  amount_pesewas int not null check (amount_pesewas > 0),
  currency char(3) not null default 'GHS',
  status text not null default 'initialized'
    check (status in ('initialized', 'success', 'failed', 'abandoned', 'reversed')),
  channel text,                                         -- card, mobile_money, ...
  gateway_response text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_order_idx on payments (order_id);
create index payments_pending_idx on payments (created_at) where status = 'initialized';

-- Every webhook is stored raw before it is processed.
create table payment_events (
  id bigint generated always as identity primary key,
  provider text not null default 'paystack',
  event_key text not null,                              -- e.g. 'charge.success:<reference>'
  payload jsonb not null,
  signature_valid boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, event_key)                          -- duplicate delivery = no-op
);

create table order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders(id) on delete cascade,
  from_status order_status,
  to_status order_status not null,
  actor_type text not null check (actor_type in ('system', 'customer', 'staff')),
  actor_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index status_hist_order_idx on order_status_history (order_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['orders', 'payments']
  loop
    execute format(
      'create trigger trg_%1$s_updated before update on %1$I
         for each row execute function set_updated_at()', t);
  end loop;
end $$;
