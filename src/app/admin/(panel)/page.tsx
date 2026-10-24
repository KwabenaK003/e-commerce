import Link from 'next/link';
import { adminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth/session';
import { formatGhs } from '@/lib/money';
import { cardCls, PageHeader, Table, thCls, tdCls } from '@/components/admin/ui';

interface Dashboard {
  orders_today: number;
  orders_period: number;
  paid_orders_period: number;
  revenue_period_pesewas: number;
  awaiting_confirmation: number;
  to_fulfil: number;
  open_reviews: number;
  open_returns: number;
  failed_notifications: number;
  low_stock_variants: number;
  payment_success_rate: number | null;
  sales_by_day: Array<{ day: string; orders: number; revenue_pesewas: number }>;
  top_products: Array<{ name: string; units: number; revenue_pesewas: number }>;
}

function Card({ label, value, href, alert }: { label: string; value: string | number; href?: string; alert?: boolean }) {
  const body = (
    <div className={`${cardCls} ${alert ? 'border-amber-400 bg-amber-50' : ''}`}>
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function SalesChart({ rows }: { rows: Dashboard['sales_by_day'] }) {
  const max = Math.max(1, ...rows.map((r) => r.revenue_pesewas));
  const w = 720;
  const h = 160;
  const bw = w / Math.max(rows.length, 1);
  return (
    <svg viewBox={`0 0 ${w} ${h + 22}`} role="img" aria-label="Revenue per day, last 30 days" className="w-full">
      {rows.map((r, i) => {
        const bh = Math.round((r.revenue_pesewas / max) * h);
        return (
          <g key={r.day}>
            <rect x={i * bw + 2} y={h - bh} width={Math.max(bw - 4, 1)} height={bh} rx={2} className="fill-emerald-600">
              <title>{`${r.day}: ${formatGhs(r.revenue_pesewas)}, ${r.orders} orders`}</title>
            </rect>
          </g>
        );
      })}
      <line x1={0} x2={w} y1={h} y2={h} className="stroke-zinc-300" />
      <text x={0} y={h + 16} className="fill-zinc-500 text-[11px]">{rows[0]?.day.slice(5)}</text>
      <text x={w} y={h + 16} textAnchor="end" className="fill-zinc-500 text-[11px]">{rows.at(-1)?.day.slice(5)}</text>
    </svg>
  );
}

export default async function AdminDashboard() {
  await requireStaff('dashboard.view');
  const { data, error } = await adminClient().rpc('admin_dashboard', { p_days: 30 });
  if (error) throw new Error(error.message);
  const d = data as Dashboard;
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Last 30 days" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="Orders today" value={d.orders_today} href="/admin/orders" />
        <Card label="Revenue (paid)" value={formatGhs(d.revenue_period_pesewas)} />
        <Card label="To fulfil" value={d.to_fulfil} href="/admin/orders?status=processing" alert={d.to_fulfil > 0} />
        <Card label="Awaiting confirmation" value={d.awaiting_confirmation} href="/admin/orders?status=awaiting_confirmation" alert={d.awaiting_confirmation > 0} />
        <Card label="Orders to review" value={d.open_reviews} href="/admin/orders?review=1" alert={d.open_reviews > 0} />
        <Card label="Open returns" value={d.open_returns} href="/admin/returns" alert={d.open_returns > 0} />
        <Card label="Failed notifications" value={d.failed_notifications} href="/admin/notifications" alert={d.failed_notifications > 0} />
        <Card label="Low stock" value={d.low_stock_variants} href="/admin/inventory" alert={d.low_stock_variants > 0} />
      </div>
      <div className={`${cardCls} mt-4`}>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Revenue per day</h2>
          <p className="text-xs text-zinc-500">
            {d.paid_orders_period} paid orders
            {d.payment_success_rate !== null ? ` · payment success ${d.payment_success_rate}%` : ''}
          </p>
        </div>
        <SalesChart rows={d.sales_by_day} />
      </div>
      <h2 className="mb-2 mt-6 text-sm font-semibold">Top products</h2>
      <Table>
        <thead>
          <tr>
            <th className={thCls}>Product</th>
            <th className={thCls}>Units</th>
            <th className={thCls}>Revenue</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {d.top_products.length === 0 ? (
            <tr><td className={tdCls} colSpan={3}>No paid orders yet.</td></tr>
          ) : (
            d.top_products.map((p) => (
              <tr key={p.name}>
                <td className={tdCls}>{p.name}</td>
                <td className={tdCls}>{p.units}</td>
                <td className={tdCls}>{formatGhs(p.revenue_pesewas)}</td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </>
  );
}
