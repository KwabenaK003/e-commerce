import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import { getSettings } from '@/lib/settings';
import { logger } from '@/lib/logger';
import type { RateLimitName } from '@/lib/settings-schema';

/**
 * Fixed-window rate limiting backed by Postgres (check_rate_limit in the database), so it
 * works on serverless hosting with no Redis. Pass every key that should be limited (for
 * example the phone number and the IP); the request is allowed only if all of them are.
 *
 * Fails open if the database call itself errors, so a limiter fault never blocks sales.
 */
export async function withinLimit(name: RateLimitName, ...keys: Array<string | null | undefined>): Promise<boolean> {
  const real = keys.filter((k): k is string => !!k && k !== 'unknown');
  if (real.length === 0) return true;
  const rule = (await getSettings()).rateLimits[name];
  for (const key of real) {
    const { data, error } = await adminClient().rpc('check_rate_limit', {
      p_key: `${name}:${key}`,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) {
      logger.error('rate limit check failed', error, { name });
      return true;
    }
    if (data === false) return false;
  }
  return true;
}

export const TOO_MANY = 'Too many attempts. Please wait a few minutes and try again.';
