-- =====================================================================
-- Sample data for local development and staging.
-- Applied automatically by `supabase db reset`.
-- Delivery fees, prices and settings are examples: change them in /admin.
-- =====================================================================

-- Store settings (all editable in /admin/settings) -----------------------
insert into store_settings (key, value) values
  ('reservation_minutes', '30'),
  ('tax_rate_bps', '0'),                      -- basis points: 1250 = 12.5%. Set with your accountant.
  ('tax_inclusive', 'true'),
  ('cod_max_pesewas', '100000'),              -- max pay-on-delivery order: GHS 1,000
  ('cod_regions', '[]'),                      -- [] = all regions allowed
  ('review_total_ceiling_pesewas', '500000'), -- orders at or above GHS 5,000 need manual review
  ('return_window_days', '7'),
  ('big_sale_threshold_pesewas', '300000'),   -- alert owners above GHS 3,000
  ('alert_phones', '[]'),                     -- e.g. ["+233200000000"]
  ('alert_emails', '[]')
on conflict (key) do nothing;

-- Categories -------------------------------------------------------------
insert into categories (name, slug, sort_order) values
  ('Electronics', 'electronics', 1),
  ('Fashion', 'fashion', 2),
  ('Home and Kitchen', 'home-kitchen', 3),
  ('Beauty and Care', 'beauty-care', 4)
on conflict (slug) do nothing;

-- Delivery zones (by Ghana region) ---------------------------------------
insert into delivery_zones (name, regions, fee_pesewas, free_over_pesewas, eta_min_days, eta_max_days)
values
  ('Greater Accra', array['Greater Accra'], 2000, 50000, 1, 2),
  ('Southern belt', array['Central', 'Eastern', 'Western', 'Western North', 'Volta', 'Oti'], 4000, 80000, 2, 4),
  ('Middle belt', array['Ashanti', 'Bono', 'Bono East', 'Ahafo'], 4500, 80000, 2, 4),
  ('Northern belt', array['Northern', 'Savannah', 'North East', 'Upper East', 'Upper West'], 6500, 120000, 3, 6);

insert into pickup_locations (name, address, phone, hours) values
  ('Main store, Accra', 'Replace with your pickup address', '+233200000000', 'Mon to Sat, 9am to 6pm');

-- Sample products ---------------------------------------------------------
do $$
declare
  pid uuid;
  cat_electronics uuid := (select id from categories where slug = 'electronics');
  cat_fashion uuid := (select id from categories where slug = 'fashion');
  cat_home uuid := (select id from categories where slug = 'home-kitchen');
  cat_beauty uuid := (select id from categories where slug = 'beauty-care');
begin
  insert into products (category_id, name, slug, brand, description, option_names, status, featured)
  values (cat_electronics, 'Wireless Earbuds', 'wireless-earbuds', 'SoundCo',
          'Bluetooth 5.3 earbuds with charging case and up to 24 hours of playtime.',
          array['color'], 'active', true)
  returning id into pid;
  insert into product_variants (product_id, sku, name, option_values, price_pesewas, compare_at_pesewas)
  values (pid, 'EAR-BLK', 'Black', '{"color":"Black"}', 24900, 29900),
         (pid, 'EAR-WHT', 'White', '{"color":"White"}', 24900, 29900);

  insert into products (category_id, name, slug, brand, description, option_names, status, featured)
  values (cat_electronics, '10,000mAh Power Bank', 'power-bank-10000', 'VoltPlus',
          'Slim power bank with fast charging and two USB ports.',
          '{}', 'active', true)
  returning id into pid;
  insert into product_variants (product_id, sku, name, price_pesewas)
  values (pid, 'PWR-10K', 'Standard', 18500);

  insert into products (category_id, name, slug, brand, description, option_names, status, featured)
  values (cat_fashion, 'Classic Cotton T-Shirt', 'classic-cotton-tshirt', 'Kente Basics',
          'Soft 100% cotton crew-neck t-shirt, pre-washed.',
          array['size', 'color'], 'active', true)
  returning id into pid;
  insert into product_variants (product_id, sku, name, option_values, price_pesewas)
  values (pid, 'TEE-BLK-M', 'Black / M', '{"size":"M","color":"Black"}', 7500),
         (pid, 'TEE-BLK-L', 'Black / L', '{"size":"L","color":"Black"}', 7500),
         (pid, 'TEE-WHT-M', 'White / M', '{"size":"M","color":"White"}', 7500),
         (pid, 'TEE-WHT-L', 'White / L', '{"size":"L","color":"White"}', 7500);

  insert into products (category_id, name, slug, brand, description, option_names, status, featured)
  values (cat_home, 'Non-stick Frying Pan 28cm', 'nonstick-frying-pan-28', 'HomeChef',
          'Durable non-stick pan suitable for gas, electric and induction hobs.',
          '{}', 'active', false)
  returning id into pid;
  insert into product_variants (product_id, sku, name, price_pesewas, compare_at_pesewas)
  values (pid, 'PAN-28', '28cm', 14500, 17500);

  insert into products (category_id, name, slug, brand, description, option_names, status, featured)
  values (cat_beauty, 'Shea Butter Body Cream 250ml', 'shea-body-cream-250', 'Nkoko Naturals',
          'Rich body cream made with unrefined Ghanaian shea butter.',
          '{}', 'active', true)
  returning id into pid;
  insert into product_variants (product_id, sku, name, price_pesewas)
  values (pid, 'SHEA-250', '250ml', 6500);
end $$;

-- Stock and cost prices ----------------------------------------------------
update inventory i set on_hand = 25 from product_variants v where v.id = i.variant_id;

insert into inventory_movements (variant_id, delta, reason, note)
  select variant_id, on_hand, 'import', 'seed data' from inventory where on_hand > 0;

insert into variant_costs (variant_id, cost_pesewas)
  select id, (price_pesewas * 0.6)::int from product_variants;

-- Sample coupon --------------------------------------------------------------
insert into coupons (code, kind, value, min_subtotal_pesewas, max_uses_per_customer)
values ('WELCOME10', 'percent', 10, 10000, 1)
on conflict (code) do nothing;
