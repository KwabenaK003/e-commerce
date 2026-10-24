-- =====================================================================
-- 0005: business logic in SQL.
-- Stock, prices and order status change ONLY through these functions,
-- called from server code with the service role. Browsers never can:
-- execute is revoked from public, anon and authenticated below.
-- =====================================================================

-- Functions created from here on are not callable by browser roles.
-- NOTE: Postgres grants EXECUTE to PUBLIC on every new function by default, and a
-- per-schema "alter default privileges ... revoke" cannot remove that global default.
-- So the global form below is required, and migration 0010 sweeps everything again.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function setting_int(p_key text, p_default int) returns int
language sql stable as $$
  select coalesce((select (value #>> '{}')::int from store_settings where key = p_key), p_default)
$$;

create or replace function setting_bool(p_key text, p_default boolean) returns boolean
language sql stable as $$
  select coalesce((select (value #>> '{}')::boolean from store_settings where key = p_key), p_default)
$$;

create or replace function order_lines(p_order_id uuid)
returns table (variant_id uuid, qty int) language sql stable as $$
  select oi.variant_id, sum(oi.quantity)::int from order_items oi
  where oi.order_id = p_order_id and oi.variant_id is not null
  group by oi.variant_id
$$;

create or replace function enqueue_notification(
  p_order_id uuid, p_template text, p_channel notif_channel,
  p_recipient text, p_payload jsonb default '{}', p_dedupe_suffix text default '')
returns void language sql as $$
  insert into notifications (order_id, channel, template, recipient, payload, dedupe_key)
  select p_order_id, p_channel, p_template, p_recipient, p_payload,
         p_template || ':' || coalesce(p_order_id::text, '-') || ':' || p_channel::text
                    || ':' || p_recipient || ':' || p_dedupe_suffix
  where p_recipient is not null and p_recipient <> ''
  on conflict (dedupe_key) do nothing
$$;

create or replace function commit_order_stock(p_order_id uuid, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update inventory i
     set on_hand = i.on_hand - q.qty, reserved = i.reserved - q.qty, updated_at = now()
    from order_lines(p_order_id) q where i.variant_id = q.variant_id;
  insert into inventory_movements (variant_id, delta, reason, order_id, actor_id)
    select variant_id, -qty, 'sale', p_order_id, p_actor from order_lines(p_order_id);
end $$;

create or replace function issue_invoice(p_order_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_year int := extract(year from now())::int;
  v_num int;
  v_no text;
begin
  perform 1 from orders where id = p_order_id for update;   -- serialise per order, no gaps
  select invoice_number into v_no from invoices where order_id = p_order_id;
  if found then return v_no; end if;
  insert into invoice_counters (year, last_number) values (v_year, 1)
    on conflict (year) do update set last_number = invoice_counters.last_number + 1
    returning last_number into v_num;
  v_no := 'INV-' || v_year::text || '-' || lpad(v_num::text, 6, '0');
  insert into invoices (order_id, invoice_number) values (p_order_id, v_no);
  return v_no;
end $$;

-- ---------------------------------------------------------------------
-- Order status changes: one function, one place for the rules.
-- ---------------------------------------------------------------------
create or replace function transition_order(
  p_order_id uuid, p_to order_status, p_actor_type text,
  p_actor_id uuid default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  o orders%rowtype;
  v_committed boolean;
  allowed constant jsonb := '{
    "pending_payment":["paid","cancelled"],
    "awaiting_confirmation":["processing","cancelled"],
    "paid":["processing","cancelled"],
    "processing":["shipped","cancelled"],
    "shipped":["delivered","processing"],
    "delivered":[],
    "cancelled":[]}';
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if not ((allowed -> o.status::text) ? p_to::text) then
    raise exception 'invalid_transition:% -> %', o.status, p_to;
  end if;
  if o.needs_review and p_to in ('shipped', 'delivered') then
    raise exception 'order_needs_review';
  end if;

  -- has stock already left on_hand for this order?
  v_committed := (o.payment_method = 'paystack' and o.payment_status in ('paid', 'partially_refunded', 'refunded'))
              or (o.payment_method = 'pay_on_delivery' and o.status = 'processing');

  if p_to = 'processing' and o.status = 'awaiting_confirmation' then
    perform commit_order_stock(o.id, p_actor_id);          -- pay on delivery confirmed
  elsif p_to = 'cancelled' then
    if v_committed then
      update inventory i set on_hand = i.on_hand + q.qty, updated_at = now()
        from order_lines(o.id) q where i.variant_id = q.variant_id;
      insert into inventory_movements (variant_id, delta, reason, order_id, actor_id, note)
        select variant_id, qty, 'return', o.id, p_actor_id, 'order cancelled'
        from order_lines(o.id);
      if o.payment_status = 'paid' then                    -- money must go back
        update orders set needs_review = true,
               risk_flags = array_append(risk_flags, 'refund_due') where id = o.id;
      end if;
    else
      update inventory i set reserved = greatest(i.reserved - q.qty, 0), updated_at = now()
        from order_lines(o.id) q where i.variant_id = q.variant_id;
    end if;
    if o.coupon_id is not null then
      update coupons set uses = greatest(uses - 1, 0) where id = o.coupon_id;
      delete from coupon_redemptions where order_id = o.id;
    end if;
  end if;

  update orders set
    status = p_to,
    reserved_until = null,
    cancelled_at = case when p_to = 'cancelled' then now() else cancelled_at end,
    delivered_at = case when p_to = 'delivered' then now() else delivered_at end,
    payment_status = case when p_to = 'delivered' and payment_method = 'pay_on_delivery'
                          then 'paid'::payment_status else payment_status end,
    paid_at = case when p_to = 'delivered' and payment_method = 'pay_on_delivery'
                   then now() else paid_at end
  where id = o.id;

  if p_to = 'delivered' and o.payment_method = 'pay_on_delivery' then
    perform issue_invoice(o.id);                           -- cash collected: invoice now
  end if;

  insert into order_status_history (order_id, from_status, to_status, actor_type, actor_id, note)
  values (o.id, o.status, p_to, p_actor_type, p_actor_id, p_note);
end $$;

-- ---------------------------------------------------------------------
-- Creating an order from a cart.
-- Prices come from the database, stock is reserved atomically, and the whole
-- function succeeds or rolls back as one unit.
-- ---------------------------------------------------------------------
create or replace function create_order_from_cart(
  p_cart_id uuid, p_email text, p_phone text, p_fulfillment fulfillment_method,
  p_address jsonb, p_zone_id uuid, p_pickup_id uuid,
  p_payment_method text, p_coupon_code text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_user_id uuid;
  v_subtotal int := 0;  v_shipping int := 0;  v_discount int := 0;
  v_tax int := 0;       v_total int;          v_base int;
  v_lines int := 0;     v_hold int;           v_key text;
  v_rate int;           v_inclusive boolean;
  v_coupon_id uuid;     v_coupon_code text;
  v_flags text[] := '{}';
  v_ceiling int;        v_cod_regions jsonb;
  v_status order_status;
  cp coupons%rowtype;
  r record;
begin
  if p_payment_method not in ('paystack', 'pay_on_delivery') then
    raise exception 'invalid_payment_method';
  end if;

  select user_id into v_user_id from carts where id = p_cart_id;
  if not found then raise exception 'cart_not_found'; end if;
  v_key := coalesce(v_user_id::text, p_phone);
  v_hold := setting_int('reservation_minutes', 30);

  -- price every line from the database; reserve stock in a fixed order (no deadlocks)
  for r in
    select ci.variant_id, ci.quantity, v.sku, v.price_pesewas
    from cart_items ci
    join product_variants v on v.id = ci.variant_id and v.is_active
    join products p on p.id = v.product_id and p.status = 'active'
    where ci.cart_id = p_cart_id
    order by ci.variant_id
  loop
    update inventory set reserved = reserved + r.quantity, updated_at = now()
     where variant_id = r.variant_id and on_hand - reserved >= r.quantity;
    if not found then raise exception 'insufficient_stock:%', r.sku; end if;
    v_subtotal := v_subtotal + r.price_pesewas * r.quantity;
    v_lines := v_lines + 1;
  end loop;
  if v_lines = 0 then raise exception 'empty_cart'; end if;
  if v_lines <> (select count(*) from cart_items where cart_id = p_cart_id) then
    raise exception 'unavailable_item';
  end if;

  if p_fulfillment = 'delivery' then
    select case when free_over_pesewas is not null and v_subtotal >= free_over_pesewas
                then 0 else fee_pesewas end
      into v_shipping from delivery_zones where id = p_zone_id and is_active;
    if not found then raise exception 'no_delivery_zone'; end if;
  else
    perform 1 from pickup_locations where id = p_pickup_id and is_active;
    if not found then raise exception 'no_pickup_location'; end if;
  end if;

  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    select * into cp from coupons
     where code = upper(trim(p_coupon_code)) and is_active
       and (starts_at is null or starts_at <= now())
       and (expires_at is null or expires_at > now())
       and v_subtotal >= min_subtotal_pesewas
       and (max_uses is null or uses < max_uses)
     for update;
    if not found then raise exception 'invalid_coupon'; end if;
    if (select count(*) from coupon_redemptions
         where coupon_id = cp.id and customer_key = v_key) >= cp.max_uses_per_customer then
      raise exception 'coupon_already_used';
    end if;
    v_discount := least(v_subtotal,
      case cp.kind when 'percent' then v_subtotal * cp.value / 100 else cp.value end);
    v_coupon_id := cp.id;  v_coupon_code := cp.code;
  end if;

  -- tax: rate and inclusive/exclusive come from store_settings (set with your accountant)
  v_rate := setting_int('tax_rate_bps', 0);
  v_inclusive := setting_bool('tax_inclusive', true);
  v_base := v_subtotal - v_discount;
  if v_rate > 0 then
    if v_inclusive then
      v_tax := round(v_base - v_base * 10000.0 / (10000 + v_rate))::int;
    else
      v_tax := round(v_base * v_rate / 10000.0)::int;
    end if;
  end if;
  v_total := v_base + v_shipping + case when v_inclusive then 0 else v_tax end;

  -- pay on delivery limits
  if p_payment_method = 'pay_on_delivery' then
    if v_total > setting_int('cod_max_pesewas', 100000) then
      raise exception 'cod_amount_too_high';
    end if;
    select value into v_cod_regions from store_settings where key = 'cod_regions';
    if v_cod_regions is not null and jsonb_typeof(v_cod_regions) = 'array'
       and jsonb_array_length(v_cod_regions) > 0
       and (p_address is null or not (v_cod_regions ? (p_address ->> 'region'))) then
      raise exception 'cod_region_not_allowed';
    end if;
    if (select count(*) from orders
         where contact_phone = p_phone and payment_method = 'pay_on_delivery'
           and status = 'cancelled') >= 2 then
      v_flags := array_append(v_flags, 'cod_repeat_cancel');
    end if;
  end if;

  -- fraud and review flags
  v_ceiling := setting_int('review_total_ceiling_pesewas', 500000);
  if (select count(*) from orders
       where contact_phone = p_phone and placed_at > now() - interval '1 hour') >= 3 then
    v_flags := array_append(v_flags, 'velocity_phone');
  end if;
  if v_total >= v_ceiling then
    v_flags := array_append(v_flags, 'high_value');
  end if;
  if p_address is not null and (p_address ->> 'phone') is not null
     and (p_address ->> 'phone') <> p_phone and v_total >= v_ceiling / 2 then
    v_flags := array_append(v_flags, 'phone_mismatch');
  end if;

  v_status := case when p_payment_method = 'pay_on_delivery'
                   then 'awaiting_confirmation' else 'pending_payment' end;

  insert into orders (id, user_id, contact_email, contact_phone, status, payment_method,
      fulfillment, shipping_address, delivery_zone_id, pickup_location_id,
      subtotal_pesewas, discount_pesewas, shipping_pesewas, tax_pesewas, tax_inclusive,
      total_pesewas, coupon_id, coupon_code, customer_note, reserved_until,
      needs_review, risk_flags)
  values (v_order_id, v_user_id, nullif(p_email, ''), p_phone, v_status, p_payment_method,
      p_fulfillment, case when p_fulfillment = 'delivery' then p_address end,
      case when p_fulfillment = 'delivery' then p_zone_id end,
      case when p_fulfillment = 'pickup' then p_pickup_id end,
      v_subtotal, v_discount, v_shipping, v_tax, v_inclusive,
      v_total, v_coupon_id, v_coupon_code, p_note,
      now() + make_interval(mins => v_hold),
      coalesce(array_length(v_flags, 1), 0) > 0, v_flags);

  insert into order_items (order_id, variant_id, sku, product_name, variant_name,
      image_path, unit_price_pesewas, cost_pesewas, quantity)
  select v_order_id, ci.variant_id, v.sku, p.name, v.name,
         (select i.storage_path from product_images i
           where i.product_id = p.id order by i.sort_order, i.id limit 1),
         v.price_pesewas, vc.cost_pesewas, ci.quantity
  from cart_items ci
  join product_variants v on v.id = ci.variant_id
  join products p on p.id = v.product_id
  left join variant_costs vc on vc.variant_id = v.id
  where ci.cart_id = p_cart_id;

  if v_coupon_id is not null then
    update coupons set uses = uses + 1 where id = v_coupon_id;
    insert into coupon_redemptions (coupon_id, order_id, customer_key, amount_pesewas)
    values (v_coupon_id, v_order_id, v_key, v_discount);
  end if;

  insert into order_status_history (order_id, from_status, to_status, actor_type, note)
  values (v_order_id, null, v_status, 'customer', 'order created');

  delete from cart_items where cart_id = p_cart_id;
  return v_order_id;
end $$;

-- ---------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------
create or replace function start_payment(p_order_id uuid, p_reference text)
returns uuid language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_id uuid;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status <> 'pending_payment' or o.payment_method <> 'paystack' then
    raise exception 'order_not_payable';
  end if;
  if o.reserved_until is not null and o.reserved_until < now() then
    raise exception 'reservation_expired';
  end if;
  insert into payments (order_id, reference, amount_pesewas, currency)
  values (o.id, p_reference, o.total_pesewas, o.currency)
  returning id into v_id;
  return v_id;
end $$;

create or replace function mark_payment_failed(
  p_reference text, p_status text, p_gateway_response text)
returns void language sql security definer set search_path = public as $$
  update payments set status = p_status, gateway_response = p_gateway_response, updated_at = now()
  where reference = p_reference and status = 'initialized'
    and p_status in ('failed', 'abandoned')
$$;

-- Marking an order paid. Safe to call any number of times for the same reference.
create or replace function mark_order_paid(
  p_reference text, p_amount int, p_currency text,
  p_provider_txn_id text, p_channel text, p_gateway_response text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  pay payments%rowtype;
  o orders%rowtype;
  v_threshold int;
  v_to text;
begin
  select * into pay from payments where reference = p_reference for update;
  if not found then raise exception 'unknown_reference'; end if;
  if pay.status = 'success' then return pay.order_id; end if;        -- duplicate delivery

  select * into o from orders where id = pay.order_id for update;

  if p_amount <> o.total_pesewas or p_currency <> o.currency then
    update payments set status = 'failed', gateway_response = 'amount_mismatch',
           provider_txn_id = p_provider_txn_id, updated_at = now() where id = pay.id;
    update orders set needs_review = true,
           risk_flags = array_append(risk_flags, 'amount_mismatch') where id = o.id;
    return null;
  end if;

  update payments set status = 'success', provider_txn_id = p_provider_txn_id,
         channel = p_channel, gateway_response = p_gateway_response,
         paid_at = now(), updated_at = now() where id = pay.id;

  if o.payment_status in ('paid', 'partially_refunded', 'refunded') then
    -- the order was already paid through another payment: staff must refund one of them
    update orders set needs_review = true,
           risk_flags = array_append(risk_flags, 'duplicate_payment') where id = o.id;
    return o.id;
  end if;

  if o.status = 'cancelled' then                    -- paid after the hold expired: staff decide
    update orders set payment_status = 'paid', paid_at = now(), needs_review = true,
           risk_flags = array_append(risk_flags, 'paid_after_cancel') where id = o.id;
    return o.id;
  end if;

  if o.status <> 'pending_payment' then
    update orders set payment_status = 'paid', paid_at = now(), needs_review = true,
           risk_flags = array_append(risk_flags, 'paid_unexpected_state') where id = o.id;
    return o.id;
  end if;

  update orders set payment_status = 'paid', paid_at = now() where id = o.id;
  perform commit_order_stock(o.id);
  perform transition_order(o.id, 'paid', 'system', null, 'paystack ' || p_reference);
  perform issue_invoice(o.id);

  perform enqueue_notification(o.id, 'order_paid', 'email', o.contact_email);
  perform enqueue_notification(o.id, 'order_paid', 'sms', o.contact_phone);

  select (value #>> '{}')::int into v_threshold
    from store_settings where key = 'big_sale_threshold_pesewas';
  if v_threshold is not null and o.total_pesewas >= v_threshold then
    for v_to in select jsonb_array_elements_text(value)
                  from store_settings where key = 'alert_phones' loop
      perform enqueue_notification(o.id, 'admin_big_sale', 'sms', v_to);
    end loop;
    for v_to in select jsonb_array_elements_text(value)
                  from store_settings where key = 'alert_emails' loop
      perform enqueue_notification(o.id, 'admin_big_sale', 'email', v_to);
    end loop;
  end if;
  return o.id;
end $$;

-- ---------------------------------------------------------------------
-- Scheduled sweeps
-- ---------------------------------------------------------------------
-- Run every minute. Skips orders whose customer has a payment prompt open
-- (for example a mobile money approval) in the last 15 minutes.
create or replace function release_expired_reservations() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select o.id from orders o
    where o.status = 'pending_payment' and o.reserved_until < now()
      and not exists (select 1 from payments p
            where p.order_id = o.id and p.status = 'initialized'
              and p.created_at > now() - interval '15 minutes')
    order by o.reserved_until limit 100 for update of o skip locked
  loop
    perform transition_order(r.id, 'cancelled', 'system', null, 'reservation expired');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Run hourly. Cancels unconfirmed pay-on-delivery orders.
create or replace function cancel_stale_cod(p_hours int default 24) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select o.id from orders o
    where o.status = 'awaiting_confirmation'
      and o.placed_at < now() - make_interval(hours => p_hours)
    order by o.placed_at limit 100 for update of o skip locked
  loop
    perform transition_order(r.id, 'cancelled', 'system', null, 'unconfirmed pay on delivery');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function purge_expired_rate_limits() returns int
language sql security definer set search_path = public as $$
  with d as (delete from rate_limits where expires_at < now() returning 1)
  select count(*)::int from d
$$;

-- ---------------------------------------------------------------------
-- Rate limiting (fixed window counter)
-- ---------------------------------------------------------------------
create or replace function check_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_bucket bigint; v_hits int;
begin
  v_bucket := floor(extract(epoch from now()) / p_window_seconds)::bigint;
  insert into rate_limits (key, bucket, hits, expires_at)
  values (p_key || ':' || p_window_seconds::text, v_bucket, 1,
          now() + make_interval(secs => p_window_seconds * 2))
  on conflict (key, bucket) do update set hits = rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end $$;

-- ---------------------------------------------------------------------
-- Notifications: status trigger, claim and complete
-- ---------------------------------------------------------------------
create or replace function notify_on_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; t text;
begin
  t := case new.to_status
         when 'awaiting_confirmation' then 'order_confirm_request'
         when 'shipped'   then 'order_shipped'
         when 'delivered' then 'order_delivered'
         when 'cancelled' then 'order_cancelled'
       end;
  if t is null
     or (new.to_status = 'cancelled' and new.note = 'reservation expired') then
    return new;                         -- expired unpaid holds stay silent
  end if;
  select * into o from orders where id = new.order_id;
  perform enqueue_notification(o.id, t, 'email', o.contact_email);
  perform enqueue_notification(o.id, t, 'sms', o.contact_phone);
  return new;
end $$;

create trigger trg_notify_status after insert on order_status_history
  for each row execute function notify_on_status();

-- Worker claims a batch; failures back off 2, 4, 8 ... minutes
create or replace function claim_notifications(p_limit int default 50)
returns setof notifications language sql security definer set search_path = public as $$
  update notifications n
     set attempts = n.attempts + 1,
         next_attempt_at = now()
           + (power(2, least(n.attempts, 6))::int::text || ' minutes')::interval
   where n.id in (select id from notifications
                  where status = 'queued' and next_attempt_at <= now()
                  order by next_attempt_at limit p_limit for update skip locked)
  returning n.*
$$;

create or replace function complete_notification(
  p_id uuid, p_ok boolean, p_provider_id text default null,
  p_error text default null, p_max_attempts int default 5)
returns void language sql security definer set search_path = public as $$
  update notifications set
    status = case when p_ok then 'sent'::notif_status
                  when attempts >= p_max_attempts then 'failed'::notif_status
                  else 'queued'::notif_status end,
    sent_at = case when p_ok then now() else sent_at end,
    provider_message_id = coalesce(p_provider_id, provider_message_id),
    last_error = case when p_ok then null else left(p_error, 500) end
  where id = p_id
$$;

-- ---------------------------------------------------------------------
-- Inventory adjustments (admin and import)
-- ---------------------------------------------------------------------
create or replace function adjust_stock(
  p_variant_id uuid, p_delta int, p_reason text,
  p_actor uuid default null, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_on_hand int;
begin
  update inventory set on_hand = on_hand + p_delta
   where variant_id = p_variant_id and on_hand + p_delta >= reserved
  returning on_hand into v_on_hand;
  if not found then raise exception 'stock_adjustment_not_allowed'; end if;
  insert into inventory_movements (variant_id, delta, reason, actor_id, note)
  values (p_variant_id, p_delta, p_reason, p_actor, p_note);
  return v_on_hand;
end $$;

-- Set on_hand to an exact number (stock take, bulk import).
create or replace function set_stock(
  p_variant_id uuid, p_target int, p_reason text,
  p_actor uuid default null, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_cur int;
begin
  if p_target < 0 then raise exception 'negative_stock'; end if;
  select on_hand into v_cur from inventory where variant_id = p_variant_id for update;
  if not found then raise exception 'inventory_row_missing'; end if;
  if p_target = v_cur then return v_cur; end if;
  return adjust_stock(p_variant_id, p_target - v_cur, p_reason, p_actor, p_note);
end $$;

-- ---------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------
create or replace function create_refund(
  p_order_id uuid, p_payment_id uuid, p_return_id uuid,
  p_amount int, p_reason text, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; v_sum int; v_id uuid;
begin
  select * into pay from payments where id = p_payment_id and order_id = p_order_id for update;
  if not found or pay.status <> 'success' then raise exception 'payment_not_refundable'; end if;
  select coalesce(sum(amount_pesewas), 0) into v_sum
    from refunds where payment_id = pay.id and status <> 'failed';
  if v_sum + p_amount > pay.amount_pesewas then raise exception 'refund_exceeds_payment'; end if;
  insert into refunds (order_id, payment_id, return_id, amount_pesewas, reason, created_by)
  values (p_order_id, p_payment_id, p_return_id, p_amount, p_reason, p_actor)
  returning id into v_id;
  return v_id;
end $$;

create or replace function settle_refund(
  p_refund_id uuid, p_status text, p_provider_refund_id text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r refunds%rowtype; pay payments%rowtype; v_processed int; o orders%rowtype;
begin
  if p_status not in ('processed', 'failed') then raise exception 'invalid_refund_status'; end if;
  select * into r from refunds where id = p_refund_id for update;
  if not found then raise exception 'refund_not_found'; end if;
  if r.status = 'processed' then return; end if;                    -- idempotent
  update refunds set status = p_status,
         provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id)
   where id = r.id;
  if p_status = 'processed' then
    select * into pay from payments where id = r.payment_id for update;
    select coalesce(sum(amount_pesewas), 0) into v_processed
      from refunds where payment_id = pay.id and status = 'processed';
    update orders set payment_status =
      (case when v_processed >= pay.amount_pesewas then 'refunded' else 'partially_refunded' end)::payment_status
     where id = r.order_id;
    if v_processed >= pay.amount_pesewas then                  -- the money has gone back: clear the flag
      update orders set
        risk_flags = array_remove(risk_flags, 'refund_due'),
        needs_review = coalesce(array_length(array_remove(risk_flags, 'refund_due'), 1), 0) > 0
       where id = r.order_id;
    end if;
    if r.return_id is not null then
      update returns set status = 'refunded', resolved_at = now()
       where id = r.return_id and status in ('approved', 'received');
    end if;
    select * into o from orders where id = r.order_id;
    perform enqueue_notification(o.id, 'refund_processed', 'email', o.contact_email,
      jsonb_build_object('amount_pesewas', r.amount_pesewas), r.id::text);
    perform enqueue_notification(o.id, 'refund_processed', 'sms', o.contact_phone,
      jsonb_build_object('amount_pesewas', r.amount_pesewas), r.id::text);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Returns
-- ---------------------------------------------------------------------
-- p_items: [{"order_item_id": "...", "quantity": 1}, ...]
create or replace function create_return(
  p_order_id uuid, p_user_id uuid, p_reason text, p_resolution text,
  p_note text, p_photos text[], p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o orders%rowtype;
  v_id uuid;
  it jsonb;
  oi order_items%rowtype;
  v_qty int;
  v_already int;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if p_user_id is not null and o.user_id is distinct from p_user_id then
    raise exception 'not_your_order';
  end if;
  if o.status <> 'delivered' or o.delivered_at is null then
    raise exception 'order_not_delivered';
  end if;
  if o.delivered_at < now() - make_interval(days => setting_int('return_window_days', 7)) then
    raise exception 'return_window_closed';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items';
  end if;

  insert into returns (order_id, reason, resolution, customer_note, photo_paths)
  values (p_order_id, p_reason, p_resolution, p_note, coalesce(p_photos, '{}'))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into oi from order_items
     where id = (it ->> 'order_item_id')::uuid and order_id = p_order_id;
    if not found then raise exception 'item_not_in_order'; end if;
    v_qty := (it ->> 'quantity')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid_quantity'; end if;
    select coalesce(sum(ri.quantity), 0) into v_already
      from return_items ri join returns r on r.id = ri.return_id
     where ri.order_item_id = oi.id and r.status <> 'rejected' and r.id <> v_id;
    if v_already + v_qty > oi.quantity then raise exception 'return_quantity_too_high'; end if;
    insert into return_items (return_id, order_item_id, quantity) values (v_id, oi.id, v_qty);
  end loop;

  return v_id;
end $$;

create or replace function transition_return(
  p_return_id uuid, p_to return_status, p_actor uuid,
  p_staff_note text default null, p_restock boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  r returns%rowtype;
  o orders%rowtype;
  li record;
  allowed constant jsonb := '{
    "requested":["approved","rejected"],
    "approved":["received","closed"],
    "received":["refunded","closed"],
    "refunded":["closed"],
    "rejected":[],
    "closed":[]}';
begin
  select * into r from returns where id = p_return_id for update;
  if not found then raise exception 'return_not_found'; end if;
  if not ((allowed -> r.status::text) ? p_to::text) then
    raise exception 'invalid_return_transition:% -> %', r.status, p_to;
  end if;

  if p_to = 'received' and p_restock then
    for li in
      select oi.variant_id, ri.quantity from return_items ri
        join order_items oi on oi.id = ri.order_item_id
       where ri.return_id = r.id and oi.variant_id is not null
    loop
      perform adjust_stock(li.variant_id, li.quantity, 'return', p_actor, 'return received');
    end loop;
  end if;

  update returns set status = p_to, handled_by = p_actor,
         staff_note = coalesce(p_staff_note, staff_note),
         resolved_at = case when p_to in ('rejected', 'refunded', 'closed') then now() else resolved_at end
   where id = r.id;

  select * into o from orders where id = r.order_id;
  perform enqueue_notification(o.id, 'return_update', 'email', o.contact_email,
    jsonb_build_object('status', p_to::text, 'return_id', r.id), r.id::text || ':' || p_to::text);
end $$;

-- ---------------------------------------------------------------------
-- Admin dashboard in one call
-- ---------------------------------------------------------------------
create or replace function admin_dashboard(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := date_trunc('day', now()) - make_interval(days => p_days - 1);
  v_result jsonb;
begin
  select jsonb_build_object(
    'orders_today', (select count(*) from orders where placed_at >= date_trunc('day', now())),
    'orders_period', (select count(*) from orders where placed_at >= v_from),
    'paid_orders_period', (select count(*) from orders
        where placed_at >= v_from and payment_status in ('paid', 'partially_refunded')),
    'revenue_period_pesewas', (select coalesce(sum(total_pesewas), 0) from orders
        where placed_at >= v_from and payment_status in ('paid', 'partially_refunded')),
    'awaiting_confirmation', (select count(*) from orders where status = 'awaiting_confirmation'),
    'to_fulfil', (select count(*) from orders where status in ('paid', 'processing')),
    'open_reviews', (select count(*) from orders where needs_review),
    'open_returns', (select count(*) from returns where status in ('requested', 'approved', 'received')),
    'failed_notifications', (select count(*) from notifications
        where status = 'failed' and created_at > now() - interval '7 days'),
    'low_stock_variants', (select count(*) from inventory i
        join product_variants v on v.id = i.variant_id and v.is_active
        where i.on_hand - i.reserved <= i.low_stock_threshold),
    'payment_success_rate', (select case when count(*) = 0 then null
        else round(100.0 * count(*) filter (where status = 'success') / count(*), 1) end
        from payments where created_at >= v_from and status <> 'initialized'),
    'sales_by_day', (select coalesce(jsonb_agg(jsonb_build_object(
          'day', d::date,
          'orders', coalesce(s.orders, 0),
          'revenue_pesewas', coalesce(s.revenue, 0)) order by d), '[]'::jsonb)
        from generate_series(v_from, date_trunc('day', now()), interval '1 day') d
        left join (select date_trunc('day', placed_at) as day, count(*) as orders,
                          sum(total_pesewas) filter (where payment_status in ('paid', 'partially_refunded')) as revenue
                   from orders where placed_at >= v_from group by 1) s on s.day = d),
    'top_products', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select oi.product_name as name, sum(oi.quantity)::int as units,
               sum(oi.line_total_pesewas)::bigint as revenue_pesewas
        from order_items oi join orders o on o.id = oi.order_id
        where o.placed_at >= v_from and o.payment_status in ('paid', 'partially_refunded')
        group by oi.product_name order by sum(oi.quantity) desc limit 5) t)
  ) into v_result;
  return v_result;
end $$;
