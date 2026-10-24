import 'server-only';
import { randomBytes } from 'node:crypto';
import { siteConfig } from '@/config/site';
import { adminClient } from '@/lib/supabase/admin';
import { initializeTransaction, verifyTransaction, PaystackError } from '@/lib/paystack';
import { friendlyDbError } from '@/lib/errors';
import { logger, errorMessage } from '@/lib/logger';
import { sendMetaPurchase } from '@/lib/analytics-server';
import type { OrderRow } from '@/lib/types';

export type SettleSource = 'webhook' | 'callback' | 'sweep' | 'order_page';
export interface SettleResult {
  status: 'paid' | 'failed' | 'pending' | 'unknown';
  orderId: string | null;
}

/**
 * Settles one Paystack payment: ask Paystack for the truth (never trust the browser redirect
 * or the webhook body alone), then call mark_order_paid, which checks the amount and currency
 * against the order and is safe to call any number of times for the same reference.
 */
export async function settleReference(reference: string, source: SettleSource): Promise<SettleResult> {
  const db = adminClient();
  const { data: pay } = await db.from('payments').select('id, order_id, status').eq('reference', reference).maybeSingle();
  if (!pay) return { status: 'unknown', orderId: null };
  const orderId = pay.order_id as string;
  if (pay.status === 'success') return { status: 'paid', orderId };

  let tx;
  try {
    tx = await verifyTransaction(reference);
  } catch (e) {
    // Paystack answers 404 for a reference the customer never reached the payment page with.
    if (e instanceof PaystackError && e.status === 404) return { status: 'pending', orderId };
    throw e;
  }

  if (tx.status === 'success') {
    const { data, error } = await db.rpc('mark_order_paid', {
      p_reference: reference,
      p_amount: tx.amount,
      p_currency: tx.currency,
      p_provider_txn_id: String(tx.id),
      p_channel: tx.channel ?? null,
      p_gateway_response: tx.gateway_response ?? null,
    });
    if (error) throw new Error(`mark_order_paid: ${error.message}`);
    if (data === null) {
      logger.error('payment amount did not match the order', undefined, { reference, orderId, paid: tx.amount });
      return { status: 'failed', orderId };
    }
    logger.info('order paid', { reference, orderId, source });
    const { data: order } = await db
      .from('orders')
      .select('order_number, total_pesewas, currency, contact_email, contact_phone')
      .eq('id', orderId)
      .maybeSingle();
    if (order) void sendMetaPurchase(order as Pick<OrderRow, 'order_number' | 'total_pesewas' | 'currency' | 'contact_email' | 'contact_phone'>);
    return { status: 'paid', orderId };
  }

  if (tx.status === 'failed' || tx.status === 'abandoned' || tx.status === 'reversed') {
    await db.rpc('mark_payment_failed', {
      p_reference: reference,
      p_status: tx.status === 'abandoned' ? 'abandoned' : 'failed',
      p_gateway_response: tx.gateway_response ?? tx.status,
    });
    return { status: 'failed', orderId };
  }
  return { status: 'pending', orderId };
}

/**
 * Covers a lost webhook: payments still "initialized" after 10 minutes are checked with
 * Paystack directly. Anything older than a day that never completed is marked abandoned.
 */
export async function sweepStuckPayments(limit = 50): Promise<{ checked: number; paid: number; failed: number; errors: number }> {
  const db = adminClient();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data } = await db
    .from('payments')
    .select('reference, created_at')
    .eq('status', 'initialized')
    .lt('created_at', tenMinutesAgo)
    .order('created_at')
    .limit(limit);
  const result = { checked: 0, paid: 0, failed: 0, errors: 0 };
  for (const p of data ?? []) {
    result.checked++;
    try {
      const r = await settleReference(p.reference as string, 'sweep');
      if (r.status === 'paid') result.paid++;
      else if (r.status === 'failed') result.failed++;
      else if (Date.now() - new Date(p.created_at as string).getTime() > 24 * 3600_000) {
        await db.rpc('mark_payment_failed', { p_reference: p.reference, p_status: 'abandoned', p_gateway_response: 'never completed' });
        result.failed++;
      }
    } catch (e) {
      result.errors++;
      logger.error('payment sweep failed for a reference', e, { reference: p.reference });
    }
  }
  return result;
}

/** Paystack requires an email. Phone-only customers get a stable placeholder on the store's own domain. */
export function paystackEmail(order: Pick<OrderRow, 'contact_email' | 'contact_phone'>): string {
  if (order.contact_email) return order.contact_email;
  let host = 'example.com';
  try {
    const h = new URL(siteConfig.url).hostname;
    if (h.includes('.') && h !== 'localhost') host = h.replace(/^www\./, '');
  } catch {
    /* keep default */
  }
  return `${order.contact_phone.replace(/\D/g, '')}@${process.env.PAYSTACK_FALLBACK_EMAIL_DOMAIN || host}`;
}

/** Creates a payment attempt and returns the Paystack hosted checkout URL. Used at checkout and by "Pay now". */
export async function startPaystackPayment(orderId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const db = adminClient();
  const { data: order } = await db
    .from('orders')
    .select('id, order_number, contact_email, contact_phone, total_pesewas, status, payment_method')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: 'Order not found.' };

  const reference = `${order.order_number}-${randomBytes(4).toString('hex')}`;
  const { error } = await db.rpc('start_payment', { p_order_id: orderId, p_reference: reference });
  if (error) return { ok: false, error: friendlyDbError(error.message) };

  try {
    const init = await initializeTransaction({
      email: paystackEmail(order as Pick<OrderRow, 'contact_email' | 'contact_phone'>),
      amountPesewas: order.total_pesewas as number,
      reference,
      callbackUrl: `${siteConfig.url}/checkout/callback`,
      metadata: { order_id: orderId, order_number: order.order_number },
    });
    return { ok: true, url: init.authorization_url };
  } catch (e) {
    logger.error('paystack initialize failed', e, { orderId, reference });
    await db.rpc('mark_payment_failed', { p_reference: reference, p_status: 'failed', p_gateway_response: `initialize_failed: ${errorMessage(e)}`.slice(0, 200) });
    return { ok: false, error: 'We could not reach the payment service. Please try again in a moment.' };
  }
}
