'use server';

import { redirect } from 'next/navigation';
import { placeOrder } from '@/lib/checkout';
import { formToObject } from '@/lib/validation';
import { startPaystackPayment } from '@/lib/payments';
import { resolveCustomerOrderId } from '@/lib/orders';
import { withinLimit, TOO_MANY } from '@/lib/security/rate-limit';
import { clientIp } from '@/lib/security/request';
import { normalizePhone } from '@/lib/phone';
import { findTrackingToken } from '@/lib/orders';
import type { ActionState } from '@/lib/types';

export async function checkoutAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const token = String(fd.get('cf-turnstile-response') ?? '') || null;
  const result = await placeOrder(formToObject(fd), token);
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  redirect(result.redirectTo);
}

/** "Pay now" on the order page: a fresh payment attempt while the stock hold is valid. */
export async function payNowAction(formData: FormData): Promise<void> {
  const orderNumber = String(formData.get('order_number') ?? '');
  const token = String(formData.get('token') ?? '');
  const orderId = await resolveCustomerOrderId(orderNumber, token);
  if (!orderId) redirect('/track');
  const res = await startPaystackPayment(orderId);
  if (res.ok) redirect(res.url);
  redirect(`/orders/${orderNumber}?t=${token}&pay=failed`);
}

export async function trackOrderAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await withinLimit('track_ip', await clientIp()))) return { error: TOO_MANY };
  const number = String(fd.get('order_number') ?? '').trim().toUpperCase();
  const phone = normalizePhone(String(fd.get('phone') ?? ''));
  const generic = 'We could not find an order with those details.';
  if (!number || !phone) return { error: generic };
  const token = await findTrackingToken(number, phone);
  if (!token) return { error: generic };
  redirect(`/orders/${number}?t=${token}`);
}
