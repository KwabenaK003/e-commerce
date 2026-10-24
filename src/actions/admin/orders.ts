'use server';

import { adminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { friendlyDbError, isKnownDbError } from '@/lib/errors';
import { parseGhsToPesewas } from '@/lib/money';
import { issueRefund } from '@/lib/refunds';
import { normalizePhone } from '@/lib/phone';
import type { ActionState, OrderStatus } from '@/lib/types';
import { done, fail, refreshAdmin, str } from './_util';

const STATUSES: OrderStatus[] = ['pending_payment', 'awaiting_confirmation', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'];

export async function changeOrderStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const orderId = str(fd, 'order_id');
  const to = str(fd, 'to') as OrderStatus;
  if (!STATUSES.includes(to)) return fail('Unknown status.');
  const staff = await requireStaff(to === 'processing' || to === 'cancelled' ? 'orders.status' : 'orders.fulfil');
  // cancelling or confirming is a support/manager decision; shipping and delivering can be done by fulfilment
  if ((to === 'cancelled' || to === 'processing') && staff.role === 'fulfillment') return fail('Your role cannot do this.');
  const note = str(fd, 'note') || null;
  if (to === 'cancelled' && !note) return fail('Add a note explaining why the order is cancelled.');

  const { error } = await adminClient().rpc('transition_order', {
    p_order_id: orderId,
    p_to: to,
    p_actor_type: 'staff',
    p_actor_id: staff.userId,
    p_note: note,
  });
  if (error) return fail(friendlyDbError(error.message));
  await audit({ actorId: staff.userId, action: 'order.status_changed', entityType: 'order', entityId: orderId, after: { to, note } });
  refreshAdmin('/admin/orders', `/admin/orders/${orderId}`, '/admin');
  return done(`Order moved to ${to.replace('_', ' ')}.`);
}

export async function saveFulfillment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('orders.fulfil');
  const db = adminClient();
  const orderId = str(fd, 'order_id');
  const status = str(fd, 'status');
  if (!['pending', 'packed', 'dispatched', 'delivered', 'failed', 'returned'].includes(status)) return fail('Choose a fulfilment status.');
  const riderPhoneRaw = str(fd, 'rider_phone');
  const riderPhone = riderPhoneRaw ? normalizePhone(riderPhoneRaw) : null;
  if (riderPhoneRaw && !riderPhone) return fail('Enter a valid rider phone number.');

  const { data: existing } = await db.from('fulfillments').select('*').eq('order_id', orderId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    order_id: orderId,
    status,
    carrier_name: str(fd, 'carrier_name') || null,
    rider_name: str(fd, 'rider_name') || null,
    rider_phone: riderPhone,
    tracking_ref: str(fd, 'tracking_ref') || null,
    failure_reason: status === 'failed' ? str(fd, 'failure_reason') || null : null,
  };
  if (status === 'packed' && !existing?.packed_at) row.packed_at = now;
  if (status === 'dispatched' && !existing?.dispatched_at) row.dispatched_at = now;
  if (status === 'delivered' && !existing?.delivered_at) row.delivered_at = now;

  const res = existing ? await db.from('fulfillments').update(row).eq('id', existing.id) : await db.from('fulfillments').insert(row);
  if (res.error) return fail(res.error.message);
  await audit({ actorId: staff.userId, action: 'order.fulfillment_saved', entityType: 'order', entityId: orderId, after: row });
  refreshAdmin(`/admin/orders/${orderId}`);
  return done('Fulfilment details saved. To tell the customer it is on its way, move the order to Shipped.');
}

export async function clearReviewFlag(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('orders.review');
  const db = adminClient();
  const orderId = str(fd, 'order_id');
  const note = str(fd, 'note');
  if (note.length < 3) return fail('Add a note saying what you checked.');
  const { data: before } = await db.from('orders').select('risk_flags, needs_review, payment_status').eq('id', orderId).maybeSingle();
  if (!before) return fail('Order not found.');
  const keepRefund = (before.risk_flags as string[]).includes('refund_due') && before.payment_status === 'paid';
  const { error } = await db
    .from('orders')
    .update({ needs_review: keepRefund, risk_flags: keepRefund ? ['refund_due'] : [] })
    .eq('id', orderId);
  if (error) return fail(error.message);
  await db.from('order_notes').insert({ order_id: orderId, author_id: staff.userId, body: `Review cleared: ${note}` });
  await audit({ actorId: staff.userId, action: 'order.review_cleared', entityType: 'order', entityId: orderId, before, after: { note } });
  refreshAdmin('/admin/orders', `/admin/orders/${orderId}`, '/admin');
  return done(keepRefund ? 'Flags cleared. The refund-due flag stays until the money is returned.' : 'Review flag cleared.');
}

export async function addOrderNote(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('orders.read');
  const orderId = str(fd, 'order_id');
  const body = str(fd, 'body');
  if (!body) return fail('Write a note first.');
  if (body.length > 2000) return fail('Notes can be up to 2000 characters.');
  const { error } = await adminClient().from('order_notes').insert({ order_id: orderId, author_id: staff.userId, body });
  if (error) return fail(error.message);
  refreshAdmin(`/admin/orders/${orderId}`);
  return done('Note added.');
}

export async function refundAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('orders.refund');
  const orderId = str(fd, 'order_id');
  const amount = parseGhsToPesewas(str(fd, 'amount'));
  if (amount === null || amount <= 0) return fail('Enter a refund amount, for example 50.00.');
  const reason = str(fd, 'reason');
  if (reason.length < 3) return fail('Give a reason for the refund.');
  const res = await issueRefund({
    orderId,
    paymentId: str(fd, 'payment_id'),
    amountPesewas: amount,
    reason,
    returnId: str(fd, 'return_id') || null,
    actorId: staff.userId,
  });
  refreshAdmin('/admin/orders', `/admin/orders/${orderId}`, '/admin/returns');
  if (!res.ok) return fail(isKnownDbError(res.error) ? friendlyDbError(res.error) : res.error);
  return done('Refund requested from Paystack. It completes when Paystack confirms it (usually within minutes to a few days).');
}
