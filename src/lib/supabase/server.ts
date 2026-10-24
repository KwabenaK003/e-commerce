import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireEnv } from '@/lib/env';

/** Client bound to the signed-in user's cookies. Row level security applies as that user. */
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(list) {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, which cannot set cookies.
          // The middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
