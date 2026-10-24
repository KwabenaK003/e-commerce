import 'server-only';
import { isProd, optionalEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Sends an email through Resend's HTTP API. The "from" address must be on a domain you
 * have verified in Resend. Without an API key, development logs the message instead.
 */
export async function sendEmail(args: { to: string; subject: string; html: string; text: string }): Promise<{ id: string | null }> {
  const key = optionalEnv('RESEND_API_KEY');
  if (!key) {
    if (isProd) throw new Error('RESEND_API_KEY is not set');
    logger.info('[dev] email not sent (no RESEND_API_KEY)', { to: args.to, subject: args.subject });
    return { id: 'dev-log' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: optionalEnv('EMAIL_FROM') ?? 'Store <onboarding@resend.dev>',
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!res.ok || !json?.id) {
    throw new Error(`Resend: ${json?.message ?? `HTTP ${res.status}`}`);
  }
  return { id: json.id };
}
