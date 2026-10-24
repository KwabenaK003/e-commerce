import 'server-only';
import { isProd, optionalEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Cloudflare Turnstile verification. The widget puts its token in the form field
 * "cf-turnstile-response". In development with no secret configured the check passes;
 * in production a missing secret fails closed, so a forgotten setting cannot silently
 * remove the protection.
 */
export async function verifyTurnstile(token: string | null | undefined, ip?: string): Promise<boolean> {
  const secret = optionalEnv('TURNSTILE_SECRET_KEY');
  if (!secret) {
    if (isProd) logger.error('TURNSTILE_SECRET_KEY is not set; refusing the request');
    return !isProd;
  }
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== 'unknown') body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(6000),
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch (e) {
    logger.error('turnstile verification failed', e);
    return false;
  }
}

export const BOT_CHECK_FAILED = 'We could not confirm you are human. Please refresh and try again.';
