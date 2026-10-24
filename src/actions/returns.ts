'use server';

import { redirect } from 'next/navigation';
import { adminClient } from '@/lib/supabase/admin';
import { resolveCustomerOrderId } from '@/lib/orders';
import { returnRequestSchema, fieldErrors } from '@/lib/validation';
import { friendlyDbError, isKnownDbError } from '@/lib/errors';
import { clientIp } from '@/lib/security/request';
import { withinLimit, TOO_MANY } from '@/lib/security/rate-limit';
import { logger } from '@/lib/logger';
import type { ActionState } from '@/lib/types';

export async function requestReturnAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const number = String(fd.get('order_number') ?? '');
  const token = String(fd.get('token') ?? '');
  const orderId = await resolveCustomerOrderId(number, token);
  if (!orderId) return { ok: false, error: 'Order not found.' };
  if (!(await withinLimit('return_request_ip', await clientIp()))) return { ok: false, error: TOO_MANY };

  const parsed = returnRequestSchema.safeParse({
    reason: fd.get('reason'),
    resolution: fd.get('resolution'),
    note: fd.get('note') || undefined,
  });
  if (!parsed.success) return { ok: false, error: 'Please check the form.', fieldErrors: fieldErrors(parsed.error) };

  const items: Array<{ order_item_id: string; quantity: number }> = [];
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith('qty_')) continue;
    const q = Math.trunc(Number(value));
    if (q > 0) items.push({ order_item_id: key.slice(4), quantity: q });
  }
  if (items.length === 0) return { ok: false, error: 'Choose at least one item to return.' };

  const { error } = await adminClient().rpc('create_return', {
    p_order_id: orderId,
    p_user_id: null, // ownership was verified above (secret link token or signed-in owner)
    p_reason: parsed.data.reason,
    p_resolution: parsed.data.resolution,
    p_note: parsed.data.note ?? null,
    p_photos: [],
    p_items: items,
  });
  if (error) {
    if (!isKnownDbError(error.message)) logger.error('create_return failed', error);
    return { ok: false, error: friendlyDbError(error.message) };
  }
  redirect(`/orders/${encodeURIComponent(number)}?t=${encodeURIComponent(token)}&returned=1`);
}
