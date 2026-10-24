import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies a "Standard Webhooks" signature, the scheme Supabase uses to sign its auth hooks.
 * Headers: webhook-id, webhook-timestamp, webhook-signature ("v1,<base64> v1,<base64>").
 * The secret looks like "v1,whsec_<base64>".
 */
export function verifyStandardWebhook(args: {
  body: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  toleranceSeconds?: number;
  nowMs?: number;
}): boolean {
  const { body, id, timestamp, signature, secret } = args;
  if (!id || !timestamp || !signature || !secret) return false;

  const tolerance = args.toleranceSeconds ?? 300;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSeconds = (args.nowMs ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - ts) > tolerance) return false;

  const rawSecret = secret.replace(/^v1,/, '').replace(/^whsec_/, '');
  const key = Buffer.from(rawSecret, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`, 'utf8').digest('base64');
  const expectedBuf = Buffer.from(expected, 'utf8');

  for (const part of signature.split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    const given = Buffer.from(sig, 'utf8');
    if (given.length === expectedBuf.length && timingSafeEqual(given, expectedBuf)) return true;
  }
  return false;
}
