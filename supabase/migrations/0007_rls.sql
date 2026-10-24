-- =====================================================================
-- 0007: Row Level Security and access model
--
--  * The browser can read public catalog data and a signed-in customer's
--    own profile, addresses and cart. Nothing else.
--  * Orders, payments, refunds, returns, coupons, notifications, audit log,
--    imports and settings are read and written ONLY by server code
--    (service role) that checks identity and role first.
--  * Staff get read-only policies as defence in depth; staff WRITES always
--    go through server actions that also write audit_log.
--  * A table with RLS enabled and no policy denies all client access.
-- =====================================================================

-- 1. Lock everything, then grant only what is needed ------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- 2. Helpers (callable by browser roles because policies use them) -----
create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where user_id = auth.uid() and is_active)
$$;

create or replace function has_staff_role(roles staff_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff
    where user_id = auth.uid() and is_active and role = any(roles))
$$;

grant execute on function is_staff() to anon, authenticated;
grant execute on function has_staff_role(staff_role[]) to anon, authenticated;

-- 3. Public catalog -----------------------------------------------------
grant select on categories, products, product_variants, product_images,
  delivery_zones, pickup_locations to anon, authenticated;
grant select on public_variant_stock, storefront_products to anon, authenticated;

create policy cat_read on categories for select
  using (is_active or is_staff());
create policy prod_read on products for select
  using (status = 'active' or is_staff());
create policy variant_read on product_variants for select
  using (is_staff() or (is_active and exists (
    select 1 from products p where p.id = product_id and p.status = 'active')));
create policy image_read on product_images for select
  using (is_staff() or exists (
    select 1 from products p where p.id = product_id and p.status = 'active'));
create policy zone_read on delivery_zones for select
  using (is_active or is_staff());
create policy pickup_read on pickup_locations for select
  using (is_active or is_staff());

-- 4. Customer-owned rows ------------------------------------------------
grant select on profiles to authenticated;
-- only these columns can be changed by the customer; phone and email change through auth
grant update (full_name, sms_marketing_consent, email_marketing_consent, consent_updated_at)
  on profiles to authenticated;
grant select, insert, update, delete on addresses to authenticated;
grant select, insert, update, delete on carts, cart_items to authenticated;

create policy own_profile_read on profiles for select using (id = auth.uid());
create policy own_profile_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy own_addresses on addresses for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_cart on carts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_cart_items on cart_items for all
  using (exists (select 1 from carts c where c.id = cart_id and c.user_id = auth.uid()))
  with check (exists (select 1 from carts c where c.id = cart_id and c.user_id = auth.uid()));

-- 5. Staff read access (writes go through server actions) ---------------
grant select on orders, order_items, order_status_history, payments,
  payment_events, refunds, returns, return_items, fulfillments,
  inventory, inventory_movements, coupons, notifications, audit_log,
  variant_costs to authenticated;

create policy staff_read on orders for select using (is_staff());
create policy staff_read on order_items for select using (is_staff());
create policy staff_read on order_status_history for select using (is_staff());
create policy staff_read on payments for select
  using (has_staff_role(array['owner', 'manager']::staff_role[]));
create policy staff_read on payment_events for select
  using (has_staff_role(array['owner', 'manager']::staff_role[]));
create policy staff_read on refunds for select
  using (has_staff_role(array['owner', 'manager']::staff_role[]));
create policy staff_read on returns for select using (is_staff());
create policy staff_read on return_items for select using (is_staff());
create policy staff_read on fulfillments for select using (is_staff());
create policy staff_read on inventory for select using (is_staff());
create policy staff_read on inventory_movements for select using (is_staff());
create policy staff_read on coupons for select
  using (has_staff_role(array['owner', 'manager']::staff_role[]));
create policy staff_read on notifications for select using (is_staff());
create policy staff_read on audit_log for select
  using (has_staff_role(array['owner', 'manager']::staff_role[]));
create policy staff_read on variant_costs for select
  using (has_staff_role(array['owner', 'manager']::staff_role[]));

-- Server only (RLS on, no client grants, no policies):
--   staff, store_settings, import_jobs, reconciliation_runs, coupon_redemptions,
--   invoices, invoice_counters, rate_limits.
