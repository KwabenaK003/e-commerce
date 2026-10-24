'use server';

import { redirect } from 'next/navigation';
import { findTrackingToken } from '@/lib/orders';
import { normalizePhone } from '@/lib/phone';
import { clientIp } from '@/lib/security/request';
import { withinLimit, TOO_MANY } from '@/lib/security/rate-limit';
import type { ActionState } from '@/lib/types';

const GENERIC = 'We could not find an order with those details. Check the order number and the phone number you used at checkout.';

export async function trackAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await withinLimit('track_ip', await clientIp()))) return { ok: false, error: TOO_MANY };
  const number = String(fd.get('order_number') ?? '').trim().toUpperCase();
  const phone = normalizePhone(String(fd.get('phone') ?? ''));
  if (!number || !phone) return { ok: false, error: GENERIC };
  const token = await findTrackingToken(number, phone);
  if (!token) return { ok: false, error: GENERIC };
  redirect(`/orders/${encodeURIComponent(number)}?t=${token}`);
}
