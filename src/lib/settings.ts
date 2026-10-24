import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import { parseSettings, type StoreSettings } from '@/lib/settings-schema';

const TTL_MS = 30_000;
let cache: { at: number; raw: Record<string, unknown> } | null = null;

/** Raw key to value map from store_settings, cached per server instance for 30 seconds. */
export async function getRawSettings(force = false): Promise<Record<string, unknown>> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.raw;
  const { data, error } = await adminClient().from('store_settings').select('key, value');
  if (error) {
    if (cache) return cache.raw; // keep serving the last good copy
    throw new Error(`settings: ${error.message}`);
  }
  const raw: Record<string, unknown> = {};
  for (const row of data ?? []) raw[row.key as string] = row.value;
  cache = { at: Date.now(), raw };
  return raw;
}

export async function getSettings(force = false): Promise<StoreSettings> {
  return parseSettings(await getRawSettings(force));
}

export function invalidateSettings() {
  cache = null;
}
