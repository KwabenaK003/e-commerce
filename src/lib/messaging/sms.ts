import 'server-only';
import { isProd, optionalEnv } from '@/lib/env';
import { toSmsRecipient } from '@/lib/phone';
import { logger } from '@/lib/logger';

/**
 * Sends an SMS through Arkesel. `to` is E.164 (+233...). Use a registered sender ID.
 * Without an API key, development logs the message instead; production throws so the
 * notification stays queued and retries.
 */
export async function sendSms(to: string, message: string): Promise<{ id: string | null }> {
  const key = optionalEnv('ARKESEL_API_KEY');
  if (!key) {
    if (isProd) throw new Error('ARKESEL_API_KEY is not set');
    logger.info('[dev] SMS not sent (no ARKESEL_API_KEY)', { to, message });
    return { id: 'dev-log' };
  }
  const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: optionalEnv('ARKESEL_SENDER_ID') ?? 'Store',
      message,
      recipients: [toSmsRecipient(to)],
    }),
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => null)) as { status?: string; message?: string; data?: Array<{ id?: string }> } | null;
  if (!res.ok || !json || json.status !== 'success') {
    throw new Error(`Arkesel: ${json?.message ?? `HTTP ${res.status}`}`);
  }
  return { id: json.data?.[0]?.id ?? null };
}
