-- =====================================================================
-- 0010: final sweep of function privileges.
--
-- Every business function (transition_order, mark_order_paid, adjust_stock,
-- create_order_from_cart, ...) must be callable ONLY by server code (service
-- role). PostgREST exposes every function that anon or authenticated may
-- execute as /rpc/<name>, so a stray PUBLIC grant would let any visitor call them.
-- Re-run this statement block in any future migration that adds functions.
-- =====================================================================
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- The only functions browsers may call:
--   * policy helpers used by row level security
--   * the storefront search
grant execute on function is_staff() to anon, authenticated;
grant execute on function has_staff_role(staff_role[]) to anon, authenticated;
grant execute on function search_storefront(text, text, int, int, boolean, text, int, int)
  to anon, authenticated;
