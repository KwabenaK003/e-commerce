import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth/session';
import { findCartId, getCartView, setCartCountCookie } from '@/lib/cart';
import { checkoutSchema, fieldErrors } from '@/lib/validation';
import { withinLimit, TOO_MANY } from '@/lib/security/rate-limit';
import { verifyTurnstile, BOT_CHECK_FAILED } from '@/lib/security/turnstile';
import { clientIp } from '@/lib/security/request';
import { recordConsent } from '@/lib/consent';
import { dbErrorCode, dbErrorDetail, friendlyDbError, isKnownDbError } from '@/lib/errors';
import { startPaystackPayment } from '@/lib/payments';
import { orderUrl } from '@/lib/orders';
import { logger } from '@/lib/logger';

export type PlaceOrderResult =
  | { ok: false; error?: string; fieldErrors?: Record<string, string> }
  | { ok: true; redirectTo: string };

/**
 * Turns the checkout form into an order.
 *  1. validate input, bot check, rate limits
 *  2. create_order_from_cart (database): prices from the database, stock reserved, one transaction
 *  3. pay on delivery: done, wait for staff confirmation
 *     online: create the payment attempt and send the customer to Paystack's hosted page
 */
export async function placeOrder(raw: Record<string, FormDataEntryValue>, turnstileToken: string | null): Promise<PlaceOrderResult> {
  const parsed = checkoutSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Please check the highlighted fields.', fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  const ip = await clientIp();
  if (!(await verifyTurnstile(turnstileToken, ip))) return { ok: false, error: BOT_CHECK_FAILED };
  if (!(await withinLimit('place_order_ip', ip)) || !(await withinLimit('place_order_phone', v.contact_phone))) {
    return { ok: false, error: TOO_MANY };
  }

  const cartId = await findCartId();
  if (!cartId) return { ok: false, error: 'Your cart is empty.' };
  const cart = await getCartView(cartId);
  if (cart.lines.length === 0) return { ok: false, error: 'Your cart is empty.' };
  if (cart.hasIssues) return { ok: false, error: 'Some items in your cart are no longer available. Please review your cart.' };

  const db = adminClient();

  let zoneId: string | null = null;
  let address: Record<string, string | null> | null = null;
  if (v.fulfillment === 'delivery') {
    const { data: zone } = await db.from('delivery_zones').select('id').eq('is_active', true).contains('regions', [v.region]).limit(1).maybeSingle();
    if (!zone) return { ok: false, fieldErrors: { region: 'We do not deliver to that region yet.' }, error: 'We do not deliver to that region yet.' };
    zoneId = zone.id as string;
    const deliveryPhone = v.delivery_phone ? (await import('@/lib/phone')).normalizePhone(v.delivery_phone) : null;
    address = {
      recipient_name: v.recipient_name || v.contact_name,
      phone: deliveryPhone ?? v.contact_phone,
      region: v.region ?? null,
      town: v.town ?? null,
      street_landmark: v.street_landmark ?? null,
      digital_address: v.digital_address ? v.digital_address.toUpperCase() : null,
    };
  }

  const { data: orderId, error } = await db.rpc('create_order_from_cart', {
    p_cart_id: cartId,
    p_email: v.contact_email,
    p_phone: v.contact_phone,
    p_fulfillment: v.fulfillment,
    p_address: address,
    p_zone_id: zoneId,
    p_pickup_id: v.fulfillment === 'pickup' ? v.pickup_location_id || null : null,
    p_payment_method: v.payment_method,
    p_coupon_code: v.coupon_code || null,
    p_note: v.note || null,
  });
  if (error || !orderId) {
    const message = error?.message ?? '';
    if (dbErrorCode(message) === 'insufficient_stock') {
      const { data: variant } = await db.from('product_variants').select('name, product:products(name)').eq('sku', dbErrorDetail(message)).maybeSingle();
      const p: any = variant ? (Array.isArray(variant.product) ? variant.product[0] : variant.product) : null;
      const label = p ? `${p.name}${variant?.name ? ` (${variant.name})` : ''}` : 'An item in your cart';
      return { ok: false, error: `${label} just sold out or has less stock than you asked for. Please update your cart.` };
    }
    if (!isKnownDbError(message)) logger.error('create_order_from_cart failed', error, { phone: v.contact_phone });
    if (dbErrorCode(message).startsWith('coupon') || dbErrorCode(message) === 'invalid_coupon') {
      return { ok: false, error: friendlyDbError(message), fieldErrors: { coupon_code: friendlyDbError(message) } };
    }
    return { ok: false, error: friendlyDbError(message) };
  }

  const id = orderId as string;
  const user = await getCurrentUser();
  await db.from('orders').update({ contact_name: v.contact_name }).eq('id', id);
  await setCartCountCookie(0);

  // Marketing consent is recorded only when ticked; order messages need none.
  if (v.sms_marketing) await recordConsent({ userId: user?.id, phone: v.contact_phone, channel: 'sms', granted: true, source: 'checkout' });
  if (v.email_marketing && v.contact_email) {
    await recordConsent({ userId: user?.id, email: v.contact_email, channel: 'email', granted: true, source: 'checkout' });
  }
  if (user) {
    const patch: Record<string, unknown> = {};
    if (v.sms_marketing) patch.sms_marketing_consent = true;
    if (v.email_marketing && v.contact_email) patch.email_marketing_consent = true;
    if (Object.keys(patch).length) await db.from('profiles').update({ ...patch, consent_updated_at: new Date().toISOString() }).eq('id', user.id);
    await db.from('profiles').update({ full_name: v.contact_name }).eq('id', user.id).is('full_name', null);
    if (v.save_address && address) await saveAddressIfNew(user.id, address);
  }

  const { data: order } = await db.from('orders').select('order_number, public_token').eq('id', id).single();
  const orderPage = orderUrl(order as { order_number: string; public_token: string });

  if (v.payment_method === 'pay_on_delivery') return { ok: true, redirectTo: orderPage };

  const pay = await startPaystackPayment(id);
  if (!pay.ok) return { ok: true, redirectTo: `${orderPage}&pay=failed` };
  return { ok: true, redirectTo: pay.url };
}

async function saveAddressIfNew(userId: string, a: Record<string, string | null>): Promise<void> {
  const db = adminClient();
  const { data: existing } = await db
    .from('addresses')
    .select('id')
    .eq('user_id', userId)
    .eq('region', a.region)
    .eq('town', a.town)
    .eq('street_landmark', a.street_landmark)
    .limit(1);
  if (existing && existing.length) return;
  const { count } = await db.from('addresses').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  await db.from('addresses').insert({
    user_id: userId,
    recipient_name: a.recipient_name,
    phone: a.phone,
    region: a.region,
    town: a.town,
    street_landmark: a.street_landmark,
    digital_address: a.digital_address,
    is_default: (count ?? 0) === 0,
  });
}
