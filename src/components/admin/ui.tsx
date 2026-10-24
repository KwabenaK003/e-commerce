import Link from 'next/link';
import type { ReactNode } from 'react';

export const inputCls =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-600';
export const labelCls = 'block text-xs font-medium text-zinc-600 mb-1';
export const cardCls = 'rounded-lg border border-zinc-200 bg-white p-4 shadow-sm';
export const thCls = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500';
export const tdCls = 'px-3 py-2 text-sm align-top';

export function PageHeader({ title, children, subtitle }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">{title}</h1>
        {subtitle ? <p className="text-sm text-zinc-500">{subtitle}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

export function Badge({ children, tone = 'zinc' }: { children: ReactNode; tone?: 'zinc' | 'green' | 'amber' | 'red' | 'blue' }) {
  const t = {
    zinc: 'bg-zinc-100 text-zinc-700',
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    blue: 'bg-sky-100 text-sky-800',
  }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function statusTone(status: string): 'zinc' | 'green' | 'amber' | 'red' | 'blue' {
  switch (status) {
    case 'paid':
    case 'delivered':
    case 'refunded':
    case 'processed':
    case 'sent':
    case 'active':
      return 'green';
    case 'pending_payment':
    case 'awaiting_confirmation':
    case 'requested':
    case 'pending':
    case 'queued':
    case 'draft':
      return 'amber';
    case 'cancelled':
    case 'failed':
    case 'rejected':
      return 'red';
    case 'processing':
    case 'shipped':
    case 'approved':
    case 'received':
      return 'blue';
    default:
      return 'zinc';
  }
}

export function LinkButton({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' }) {
  const s = variant === 'primary' ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50';
  return (
    <Link href={href} className={`rounded-md px-3 py-2 text-sm font-medium ${s}`}>
      {children}
    </Link>
  );
}

export function Pagination({ page, pageCount, basePath, params }: { page: number; pageCount: number; basePath: string; params: Record<string, string | undefined> }) {
  if (pageCount <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set('page', String(p));
    return `${basePath}?${q}`;
  };
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <span className="text-zinc-500">Page {page} of {pageCount}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link className="rounded border px-3 py-1 hover:bg-zinc-50" href={href(page - 1)}>Previous</Link> : null}
        {page < pageCount ? <Link className="rounded border px-3 py-1 hover:bg-zinc-50" href={href(page + 1)}>Next</Link> : null}
      </div>
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="min-w-full divide-y divide-zinc-200">{children}</table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">{children}</p>;
}

/** Strip characters that would break a PostgREST filter expression. */
export function safeSearch(q: string | undefined): string {
  return (q ?? '').replace(/[,()%*\\]/g, ' ').trim().slice(0, 60);
}

export function pageNum(v: string | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
