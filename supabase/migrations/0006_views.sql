-- =====================================================================
-- 0006: public read views
-- Views run with their owner's rights on purpose: they expose ONLY safe
-- columns, so customers get an "in stock" flag without ever seeing exact
-- stock numbers.
-- =====================================================================

-- In-stock and low-stock flags, never the numbers.
create view public_variant_stock as
  select variant_id,
         (on_hand - reserved) > 0 as in_stock,
         (on_hand - reserved) between 1 and low_stock_threshold as low_stock
  from inventory;

-- One row per active product with price range, availability and first image.
create view storefront_products as
select
  p.id, p.slug, p.name, p.brand, p.description, p.category_id, p.featured,
  p.created_at, p.search,
  v.min_price_pesewas, v.max_price_pesewas, v.min_compare_pesewas,
  coalesce(v.in_stock, false) as in_stock,
  img.storage_path as image_path, img.alt_text as image_alt
from products p
join lateral (
  select min(pv.price_pesewas) as min_price_pesewas,
         max(pv.price_pesewas) as max_price_pesewas,
         min(pv.compare_at_pesewas) filter (where pv.compare_at_pesewas > pv.price_pesewas) as min_compare_pesewas,
         bool_or(coalesce(i.on_hand - i.reserved, 0) > 0) as in_stock
  from product_variants pv
  left join inventory i on i.variant_id = pv.id
  where pv.product_id = p.id and pv.is_active
) v on v.min_price_pesewas is not null
left join lateral (
  select pi.storage_path, pi.alt_text from product_images pi
  where pi.product_id = p.id order by pi.sort_order, pi.id limit 1
) img on true
where p.status = 'active';
