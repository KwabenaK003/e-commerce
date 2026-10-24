-- =====================================================================
-- 0008: storage buckets (no-op outside Supabase)
--  product-images  public read, written by server only (resized on upload)
--  imports         private, bulk import files
--  return-photos   private, viewed through short-lived signed URLs
-- No storage.objects policies are created: with RLS on, that means browsers
-- cannot upload or list anything. All writes use the service role.
-- =====================================================================
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values
      ('product-images', 'product-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
      ('imports', 'imports', false, 20971520, null),
      ('return-photos', 'return-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end $$;
