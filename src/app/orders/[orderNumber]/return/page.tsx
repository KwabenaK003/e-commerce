import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadOrderBundle, resolveCustomerOrderId } from '@/lib/orders';
import { ReturnForm } from '@/components/ReturnForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Request a return', robots: { index: false, follow: false } };

export default async function ReturnPage({ params, searchParams }: { params: Promise<{ orderNumber: string }>; searchParams: Promise<{ t?: string }> }) {
  const { orderNumber } = await params;
  const { t = '' } = await searchParams;
  const number = decodeURIComponent(orderNumber);
  const id = await resolveCustomerOrderId(number, t);
  if (!id) notFound();
  const b = await loadOrderBundle(id);
  if (!b) notFound();
  const token = t || b.order.public_token;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Request a return for {b.order.order_number}</h1>
      {b.order.status !== 'delivered' ? (
        <p className="rounded-lg bg-amber-50 p-3">Returns can be requested once your order has been delivered.</p>
      ) : (
        <ReturnForm orderNumber={b.order.order_number} token={token} items={b.items.map((i) => ({ id: i.id, label: `${i.product_name}${i.variant_name ? ` (${i.variant_name})` : ''}`, quantity: i.quantity }))} />
      )}
      <Link href={`/orders/${b.order.order_number}?t=${encodeURIComponent(token)}`} className="text-sm font-semibold underline">Back to order</Link>
    </div>
  );
}
