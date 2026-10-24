-- =====================================================================
-- 0004: fulfillment, returns, refunds, coupons, notifications outbox,
--       audit log, imports, reconciliation, settings, invoices, rate limits
-- =====================================================================

-- ---------------------------------------------------------------------
-- Fulfillment, returns and refunds
-- ---------------------------------------------------------------------
create table fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'packed', 'dispatched', 'delivered', 'failed', 'returned')),
  carrier_name text,
  rider_name text,
  rider_phone text,
  tracking_ref text,
  failure_reason text,
  packed_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fulfillments_order_idx on fulfillments (order_id);

create table returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  status return_status not null default 'requested',
  reason text not null,
  resolution text not null default 'refund' check (resolution in ('refund', 'exchange')),
  customer_note text,
  photo_paths text[] not null default '{}',
  staff_note text,
  handled_by uuid,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index returns_order_idx on returns (order_id);
create index returns_status_idx on returns (status, requested_at);

create table return_items (
  return_id uuid not null references returns(id) on delete cascade,
  order_item_id uuid not null references order_items(id),
  quantity int not null check (quantity > 0),
  primary key (return_id, order_item_id)
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  payment_id uuid not null references payments(id),
  return_id uuid references returns(id),
  amount_pesewas int not null check (amount_pesewas > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'processed', 'failed')),
  provider_refund_id text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index refunds_order_idx on refunds (order_id);
create index refunds_payment_idx on refunds (payment_id);

-- ---------------------------------------------------------------------
-- Promotions
-- ---------------------------------------------------------------------
create table coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code)),
  kind text not null check (kind in ('percent', 'fixed')),
  value int not null check (value > 0),                -- percent (1-100), or pesewas
  min_subtotal_pesewas int not null default 0,
  max_uses int,
  max_uses_per_customer int not null default 1,
  uses int not null default 0,
  starts_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100)
);
alter table orders add foreign key (coupon_id) references coupons(id);

create table coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references coupons(id),
  order_id uuid not null unique references orders(id),
  customer_key text not null,                          -- user id or normalised phone
  amount_pesewas int not null,
  created_at timestamptz not null default now()
);
create index redemptions_customer_idx on coupon_redemptions (coupon_id, customer_key);

-- ---------------------------------------------------------------------
-- Notifications outbox: failed sends never break an order and can be retried.
-- ---------------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  user_id uuid references profiles(id) on delete set null,
  channel notif_channel not null,
  template text not null,                              -- 'order_paid', 'order_shipped', ...
  recipient text not null,                             -- email address or E.164 phone
  payload jsonb not null default '{}',
  status notif_status not null default 'queued',
  dedupe_key text not null unique,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notif_queue_idx on notifications (next_attempt_at) where status = 'queued';
create index notif_failed_idx on notifications (created_at) where status = 'failed';

-- ---------------------------------------------------------------------
-- Admin, audit, imports, reconciliation, settings
-- ---------------------------------------------------------------------
create table audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,                                       -- null = system
  action text not null,                                -- 'product.price_changed'
  entity_type text not null,
  entity_id text not null,
  before jsonb,
  after jsonb,
  ip inet,
  created_at timestamptz not null default now()
);
create index audit_entity_idx on audit_log (entity_type, entity_id, created_at desc);
create index audit_created_idx on audit_log (created_at desc);

create table import_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null,
  file_path text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'validating', 'preview_ready', 'importing', 'done', 'failed')),
  total_rows int,
  valid_rows int,
  error_rows int,
  created_rows int,
  updated_rows int,
  error_report_path text,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null unique,
  paystack_total_pesewas bigint,
  database_total_pesewas bigint,
  mismatches jsonb not null default '[]',
  status text not null default 'ok' check (status in ('ok', 'mismatch', 'error')),
  created_at timestamptz not null default now()
);

create table store_settings (
  key text primary key,                                -- 'reservation_minutes', 'support_phone'
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Gap-free invoice numbers, one counter per year.
create table invoice_counters (
  year int primary key,
  last_number int not null default 0
);

create table invoices (
  order_id uuid primary key references orders(id) on delete cascade,
  invoice_number text not null unique,
  issued_at timestamptz not null default now()
);

-- Fixed-window counters for rate limiting (no extra infrastructure needed).
create table rate_limits (
  key text not null,
  bucket bigint not null,
  hits int not null default 0,
  expires_at timestamptz not null,
  primary key (key, bucket)
);
create index rate_limits_expiry_idx on rate_limits (expires_at);

create trigger trg_fulfillments_updated before update on fulfillments
  for each row execute function set_updated_at();
create trigger trg_store_settings_updated before update on store_settings
  for each row execute function set_updated_at();
