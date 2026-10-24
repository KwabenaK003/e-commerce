import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from '@/lib/env';

let client: SupabaseClient | null = null;

/**
 * Anonymous client for public catalog reads. It carries no cookies, so pages that use it
 * can be cached and regenerated (ISR). Row level security still applies.
 */
export function publicClient(): SupabaseClient {
  if (client) return client;
  client = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
