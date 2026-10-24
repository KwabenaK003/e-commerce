import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listOrdersForUser, orderUrl } from '@/lib/orders';
import { adminClient } from '@/lib/supabase/admin';
import { formatGhs } from '@/lib/money';
import { formatDate, ORDER_STATUS_LABEL } from '@/lib/format';
import { signOut } from '@/actions/auth';
import { ProfileForm } from '@/components/ProfileForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My account', robots: { index: false } };

export default async function AccountPage() {
  const user = await requireUser('/account');
  const [orders, profile] = await Promise.all([
    listOrdersForUser(user.id),
    adminClient().from('profiles').select('full_name, phone, sms_marketing_consent, email_marketing_consent').eq('id', user.id).maybeSingle(),
  ]);
  const p = profile.data;
  return (
    <div className="grid gap-8 md:grid-cols-[1fr_320px]">
      <section>
        <h1 className="mb-4 text-2xl font-bold">My orders</h1>
        {orders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-600">No orders yet. <Link href="/products" className="font-semibold underline">Start shopping</Link></p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={orderUrl(o)} className="flex items-center justify-between gap-4 p-4 hover:bg-zinc-50">
                  <span><span className="font-bold">{o.order_number}</span><br /><span className="text-sm text-zinc-600">{formatDate(o.placed_at)}</span></span>
                  <span className="text-right"><span className="font-semibold">{formatGhs(o.total_pesewas)}</span><br /><span className="text-sm text-zinc-600">{ORDER_STATUS_LABEL[o.status]}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <aside className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="font-bold">My details</h2>
        <p className="text-sm text-zinc-600">{p?.phone}</p>
        <ProfileForm fullName={p?.full_name ?? ''} sms={!!p?.sms_marketing_consent} email={!!p?.email_marketing_consent} />
        <form action={signOut}><button className="text-sm font-semibold text-red-700 underline" type="submit">Sign out</button></form>
      </aside>
    </div>
  );
}
