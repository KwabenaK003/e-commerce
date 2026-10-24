import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import { createRefund } from '@/lib/paystack';
import { friendlyDbError, isKnownDbError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { logger, errorMessage } from '@/lib/logger';

export type IssueRefundResult = { ok: true; refundId: string; status: string } | { ok: false; error: string };

/**
 * Refunds are two steps. First the database checks the refund fits what is left on the payment
 * and records it as pending. Then Paystack is asked to send the money back; the
 * refund.processed webhook finishes it (see settleRefundFromWebhook). If Paystack rejects the
 * request, the refund is marked failed so the amount becomes available again.
 */
export async function issueRefund(args: {
  orderId: string;
  paymentId: string;
  amountPesewas: number;
  reason: string;
  returnId?: string | null;
  actorId: string;
}): Promise<IssueRefundResult> {
  const db = adminClient();
  if (!Number.isInteger(args.amountPesewas) || args.amountPesewas <= 0) return { ok: false, error: 'Enter a refund amount above zero.' };

  const { data: refundId, error } = await db.rpc('create_refund', {
    p_order_id: args.orderId,
    p_payment_id: args.paymentId,
    p_return_id: args.returnId ?? null,
    p_amount: args.amountPesewas,
    p_reason: args.reason || null,
    p_actor: args.actorId,
  });
  if (error || !refundId) {
    if (!isKnownDbError(error?.message)) logger.error('create_refund failed', error);
    return { ok: false, error: friendlyDbError(error?.message) };
  }
  const id = refundId as string;

  const { data: payment } = await db.from('payments').select('reference').eq('id', args.paymentId).single();
  try {
    const res = await createRefund({
      reference: payment!.reference as string,
      amountPesewas: args.amountPesewas,
      merchantNote: args.reason || undefined,
    });
    if (res.id !== null) await db.from('refunds').update({ provider_refund_id: String(res.id) }).eq('id', id);
    if (res.status === 'processed') await db.rpc('settle_refund', { p_refund_id: id, p_status: 'processed', p_provider_refund_id: res.id === null ? null : String(res.id) });
    await audit({
      actorId: args.actorId,
      action: 'refund.issued',
      entityType: 'order',
      entityId: args.orderId,
      after: { refundId: id, amountPesewas: args.amountPesewas, reason: args.reason, status: res.status },
    });
    return { ok: true, refundId: id, status: res.status };
  } catch (e) {
    await db.rpc('settle_refund', { p_refund_id: id, p_status: 'failed' });
    logger.error('paystack refund failed', e, { refundId: id });
    return { ok: false, error: `Paystack could not process the refund: ${errorMessage(e)}` };
  }
}

/**
 * Handles refund.processed and refund.failed webhooks. Paystack's refund payload carries the
 * original transaction reference, so the refund row is found through its payment: the pending
 * refund with the same provider id, else the same amount, else the oldest pending one.
 */
export async function settleRefundFromWebhook(
  data: { id?: number | string; transaction_reference?: string; amount?: number },
  status: 'processed' | 'failed',
): Promise<{ handled: boolean }> {
  const db = adminClient();
  if (!data.transaction_reference) return { handled: false };
  const { data: payment } = await db.from('payments').select('id').eq('reference', data.transaction_reference).maybeSingle();
  if (!payment) return { handled: false };

  const { data: pending } = await db
    .from('refunds')
    .select('id, amount_pesewas, provider_refund_id, status')
    .eq('payment_id', payment.id)
    .in('status', ['pending'])
    .order('created_at');
  if (!pending || pending.length === 0) return { handled: true }; // already settled: duplicate delivery

  const providerId = data.id === undefined ? null : String(data.id);
  const match =
    pending.find((r) => providerId && r.provider_refund_id === providerId) ??
    pending.find((r) => data.amount !== undefined && (r.amount_pesewas === data.amount || r.amount_pesewas === Math.round(Number(data.amount) * 100))) ??
    pending[0];

  const { error } = await db.rpc('settle_refund', { p_refund_id: match.id, p_status: status, p_provider_refund_id: providerId });
  if (error) throw new Error(`settle_refund: ${error.message}`);
  return { handled: true };
}
