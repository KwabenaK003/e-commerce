import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { verifySignature } from '@/lib/paystack';
import { settleReference } from '@/lib/payments';
import { settleRefundFromWebhook } from '@/lib/refunds';
import { logger, errorMessage } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Paystack webhook: the source of truth for payment.
 *  1. verify the HMAC SHA512 signature on the RAW body
 *  2. store the event (unique key makes a duplicate delivery a no-op)
 *  3. confirm with Paystack's verify endpoint, then mark the order paid
 * Any unexpected failure returns 500 so Paystack retries; every step is safe to repeat.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const valid = !!secret && verifySignature(raw, req.headers.get('x-paystack-signature'), secret);
  const db = adminClient();

  let event: { event?: string; data?: Record<string, any> };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  if (!valid) {
    // Keep a record of rejected calls, under a key that cannot collide with a real event.
    await db.from('payment_events').upsert(
      { provider: 'paystack', event_key: `invalid:${createHash('sha256').update(raw).digest('hex')}`, payload: event, signature_valid: false },
      { onConflict: 'provider,event_key', ignoreDuplicates: true },
    );
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const data = event.data ?? {};
  const name = String(event.event ?? 'unknown');
  const ref = String(data.refund_reference ?? data.reference ?? data.transaction_reference ?? data.id ?? '');
  const eventKey = `${name}:${ref}`;

  await db
    .from('payment_events')
    .upsert({ provider: 'paystack', event_key: eventKey, payload: event, signature_valid: true }, { onConflict: 'provider,event_key', ignoreDuplicates: true });
  const { data: row } = await db.from('payment_events').select('id, processed_at').eq('provider', 'paystack').eq('event_key', eventKey).single();
  if (row?.processed_at) return NextResponse.json({ ok: true, duplicate: true });

  try {
    if (name === 'charge.success' && data.reference) {
      await settleReference(String(data.reference), 'webhook');
    } else if (name === 'refund.processed') {
      await settleRefundFromWebhook(data, 'processed');
    } else if (name === 'refund.failed') {
      await settleRefundFromWebhook(data, 'failed');
    }
    await db.from('payment_events').update({ processed_at: new Date().toISOString(), error: null }).eq('id', row!.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.error('paystack webhook processing failed', e, { eventKey });
    await db.from('payment_events').update({ error: errorMessage(e).slice(0, 500) }).eq('id', row!.id);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
