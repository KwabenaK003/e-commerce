import type { StaffRole } from '@/lib/types';

/**
 * What each staff role may do. Enforced on the server in every admin page and action;
 * hiding a button is never the only protection.
 *
 *  owner        everything, including staff and settings
 *  manager      catalog, orders, coupons, refunds, reports, costs
 *  support      orders and returns, no costs, no settings
 *  fulfillment  orders and fulfilment only
 */
export type Permission =
  | 'dashboard.view'
  | 'catalog.read'
  | 'catalog.write'
  | 'costs.read'
  | 'inventory.write'
  | 'imports.write'
  | 'orders.read'
  | 'orders.status'
  | 'orders.fulfil'
  | 'orders.refund'
  | 'orders.review'
  | 'returns.write'
  | 'coupons.write'
  | 'delivery.write'
  | 'payments.read'
  | 'notifications.read'
  | 'reports.read'
  | 'audit.read'
  | 'settings.write'
  | 'staff.write';

const ALL: Permission[] = [
  'dashboard.view', 'catalog.read', 'catalog.write', 'costs.read', 'inventory.write', 'imports.write',
  'orders.read', 'orders.status', 'orders.fulfil', 'orders.refund', 'orders.review', 'returns.write',
  'coupons.write', 'delivery.write', 'payments.read', 'notifications.read', 'reports.read', 'audit.read',
  'settings.write', 'staff.write',
];

const MATRIX: Record<StaffRole, ReadonlySet<Permission>> = {
  owner: new Set(ALL),
  manager: new Set(ALL.filter((p) => p !== 'settings.write' && p !== 'staff.write')),
  support: new Set<Permission>([
    'dashboard.view', 'catalog.read', 'orders.read', 'orders.status', 'orders.review', 'returns.write', 'notifications.read',
  ]),
  fulfillment: new Set<Permission>(['dashboard.view', 'orders.read', 'orders.fulfil']),
};

export function can(role: StaffRole, permission: Permission): boolean {
  return MATRIX[role]?.has(permission) ?? false;
}

export function permissionsFor(role: StaffRole): Permission[] {
  return [...(MATRIX[role] ?? [])];
}

export const ROLE_LABEL: Record<StaffRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  support: 'Support',
  fulfillment: 'Fulfilment',
};
