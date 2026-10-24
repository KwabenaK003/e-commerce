-- =====================================================================
-- 0011: customer name on the order.
-- Pickup orders have no shipping address, so the buyer's name needs its own column.
-- Set by the server right after create_order_from_cart.
-- =====================================================================
alter table orders add column contact_name text;
