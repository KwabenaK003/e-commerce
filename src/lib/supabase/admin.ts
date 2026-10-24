import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from '@/lib/env';

let client: SupabaseClient | null = null;

/**
 * Service-role client. BYPASSES row level security, so it may only be used in server
 * code after identity and role have been checked. Never import it into a client component.
 */
export function adminClient(): SupabaseClient {
  if (client) return client;
  client = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** Unwrap a PostgREST result or throw with context. */
export function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}
