import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadOrderBundle, resolveCustomerOrderId, toCustomerBundle } from '@/lib/orders';
import { settleReference } from '@/lib/payments';
import { formatGhs } from '@/lib/money';
import { formatAddress, formatDateTime, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { logger } from '@/lib/logger';
import { payNowAction } from '@/actions/checkout';
import { AutoRefresh } from '@/components/AutoRefresh';
import { SubmitButton } from '@/components/SubmitButton';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your order', robots: { index: false, follow: false } };

type Props = { params: Promise<{ orderNumber: string }>; searchParams: Promise<{ t?: string; pay?: string; returned?: string }> };

export default async function OrderPage({ params, searchParams }: Props) {
  const { orderNumber } = await params;
  const sp = await searchParams;
  const token = sp.t ?? '';
  const id = await resolveCustomerOrderId(decodeURIComponent(orderNumber), token);
  if (!id) notFound();

  let full = await loadOrderBundle(id);
  if (!full) notFound();

  // Self-heal: back from Paystack but the webhook has not landed yet. Ask Paystack directly.
  if (full.order.status === 'pending_payment' && full.order.payment_method === 'paystack') {
    const open = [...full.payments].reverse().find((p) => p.status === 'initialized');
    if (open) {
      try {
        await settleReference(open.reference, 'order_page');
        full = (await loadOrderBundle(id)) ?? full;
      } catch {
        logger.warn('order page settle failed', { reference: open.reference });
      }
    }
  }

  const b = toCustomerBundle(full);
  const o = b.order;
  const waiting = o.status === 'pending_payment' && o.payment_method === 'paystack' && b.payments.some((p) => p.status === 'initialized') && !sp.pay;
  const canPay = o.status === 'pending_payment' && o.payment_method === 'paystack' && (!o.reserved_until || new Date(o.reserved_until) > new Date());
  const rider = b.fulfillments.at(-1);
  const linkToken = token || o.public_token;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {waiting && <AutoRefresh />}
      <div>
        <p className="text-sm text-zinc-600">Order</p>
        <h1 className="text-2xl font-extrabold">{o.order_number}</h1>
        <p className="mt-1 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-emerald-100 px-3 py-0.5 font-semibold text-emerald-900">{ORDER_STATUS_LABEL[o.status]}</span>
          <span className="rounded-full bg-zinc-100 px-3 py-0.5 font-semibold">{PAYMENT_STATUS_LABEL[o.payment_status]}</span>
          <span className="text-zinc-500">Placed {formatDateTime(o.placed_at)}</span>
        </p>
      </div>

      {sp.returned && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-900">Your return request was sent. We will email or text you with the next step.</p>}
      {sp.pay === 'failed' && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">We could not start the payment. Please try again.</p>}
      {waiting && <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">Confirming your payment. This page updates by itself.</p>}
      {o.status === 'awaiting_confirmation' && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">We received your order. Our team will call you to confirm it before dispatch.</p>}
      {o.status === 'cancelled' && <p className="rounded-lg bg-zinc-100 p-3">This order was cancelled. If you paid, a refund will follow. Questions? Contact us.</p>}

      {canPay && (
        <form action={payNowAction} className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <input type="hidden" name="order_number" value={o.order_number} />
          <input type="hidden" name="token" value={linkToken} />
          <p className="mb-3 font-semibold">Your items are on hold. Complete your payment of {formatGhs(o.total_pesewas)}.</p>
          <SubmitButton pendingText="Opening payment...">Pay now</SubmitButton>
        </form>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white">
        <h2 className="border-b border-zinc-100 p-4 font-bold">Items</h2>
        <ul className="divide-y divide-zinc-100">
          {b.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-4 p-4">
              <span>{i.product_name}{i.variant_name && <span className="text-zinc-600"> ({i.variant_name})</span>} &times; {i.quantity}</span>
              <span className="font-semibold">{formatGhs(i.line_total_pesewas)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t border-zinc-100 p-4 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatGhs(o.subtotal_pesewas)}</dd></div>
          {o.discount_pesewas > 0 && <div className="flex justify-between"><dt>Discount{o.coupon_code ? ` (${o.coupon_code})` : ''}</dt><dd>-{formatGhs(o.discount_pesewas)}</dd></div>}
          <div className="flex justify-between"><dt>Delivery</dt><dd>{formatGhs(o.shipping_pesewas)}</dd></div>
          {o.tax_pesewas > 0 && <div className="flex justify-between"><dt>Tax{o.tax_inclusive ? ' (included)' : ''}</dt><dd>{formatGhs(o.tax_pesewas)}</dd></div>}
          <div className="flex justify-between border-t pt-2 text-base font-bold"><dt>Total</dt><dd>{formatGhs(o.total_pesewas)}</dd></div>
        </dl>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm">
          <h2 className="mb-1 font-bold">{o.fulfillment === 'pickup' ? 'Pickup' : 'Delivery address'}</h2>
          {o.fulfillment === 'pickup' ? <p>Store pickup. We will tell you when it is ready.</p> : (
            <>
              <p>{o.shipping_address?.recipient_name}</p>
              <p>{formatAddress(o.shipping_address)}</p>
              <p>{displayPhone(o.shipping_address?.phone)}</p>
            </>
          )}
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm">
          <h2 className="mb-1 font-bold">Delivery progress</h2>
          {rider?.rider_name || rider?.carrier_name ? (
            <p>
              {rider.rider_name ? `Rider: ${rider.rider_name}${rider.rider_phone ? `, ${displayPhone(rider.rider_phone)}` : ''}` : `Carrier: ${rider.carrier_name}${rider.tracking_ref ? ` (${rider.tracking_ref})` : ''}`}
            </p>
          ) : <p className="text-zinc-600">Updates will appear here and by SMS.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-2 font-bold">History</h2>
        <ol className="space-y-2 text-sm">
          {b.history.map((h) => (
            <li key={h.id} className="flex justify-between gap-4"><span>{ORDER_STATUS_LABEL[h.to_status]}</span><span className="text-zinc-500">{formatDateTime(h.created_at)}</span></li>
          ))}
        </ol>
      </section>

      <div className="flex flex-wrap gap-3">
        {b.invoiceNumber && <a className="btn btn-outline" href={`/api/orders/${o.order_number}/invoice?t=${encodeURIComponent(linkToken)}`}>Download invoice {b.invoiceNumber}</a>}
        {o.status === 'delivered' && <Link className="btn btn-outline" href={`/orders/${o.order_number}/return?t=${encodeURIComponent(linkToken)}`}>Request a return</Link>}
        <Link className="btn btn-outline" href="/products">Keep shopping</Link>
      </div>
    </div>
  );
}
