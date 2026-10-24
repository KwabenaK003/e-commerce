import { redirect } from 'next/navigation';
import { adminClient } from '@/lib/supabase/admin';
import { settleReference } from '@/lib/payments';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

/**
 * Paystack sends the customer back here with ?reference=. We verify with Paystack ourselves
 * (never trusting the redirect), then show the order page, which reads status from our database.
 */
export default async function CallbackPage({ searchParams }: { searchParams: Promise<{ reference?: string; trxref?: string }> }) {
  const sp = await searchParams;
  const reference = (sp.reference ?? sp.trxref ?? '').trim();
  if (!reference) redirect('/track');

  try {
    await settleReference(reference, 'callback');
  } catch (e) {
    logger.error('callback settle failed', e, { reference });
  }
  const { data } = await adminClient().from('payments').select('order:orders(order_number, public_token)').eq('reference', reference).maybeSingle();
  const order: any = data ? (Array.isArray(data.order) ? data.order[0] : data.order) : null;
  if (!order) redirect('/track');
  redirect(`/orders/${order.order_number}?t=${order.public_token}`);
}
