import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { requireStaff } from '@/lib/auth/session';
import { can, ROLE_LABEL, type Permission } from '@/lib/auth/permissions';
import { staffSignOut } from '@/actions/admin/auth';

export const metadata: Metadata = { title: { default: 'Admin', template: '%s | Admin' }, robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const NAV: Array<{ href: string; label: string; perm: Permission }> = [
  { href: '/admin', label: 'Dashboard', perm: 'dashboard.view' },
  { href: '/admin/orders', label: 'Orders', perm: 'orders.read' },
  { href: '/admin/returns', label: 'Returns', perm: 'orders.read' },
  { href: '/admin/products', label: 'Products', perm: 'catalog.read' },
  { href: '/admin/categories', label: 'Categories', perm: 'catalog.read' },
  { href: '/admin/inventory', label: 'Inventory', perm: 'catalog.read' },
  { href: '/admin/coupons', label: 'Coupons', perm: 'coupons.write' },
  { href: '/admin/delivery', label: 'Delivery', perm: 'delivery.write' },
  { href: '/admin/notifications', label: 'Notifications', perm: 'notifications.read' },
  { href: '/admin/audit', label: 'Audit log', perm: 'audit.read' },
  { href: '/admin/settings', label: 'Settings', perm: 'settings.write' },
];

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  const items = NAV.filter((n) => can(staff.role, n.perm));
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row">
      <aside className="md:w-52 md:shrink-0">
        <nav aria-label="Admin" className="flex flex-wrap gap-1 md:flex-col">
          {items.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-emerald-50 hover:text-emerald-800">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-4 border-t pt-4 text-xs text-zinc-500">
          <p className="truncate">{staff.fullName || staff.email}</p>
          <p>{ROLE_LABEL[staff.role]}</p>
          <form action={staffSignOut} className="mt-2">
            <button className="text-emerald-800 underline">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
