'use server';

import { adminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { parseGhsToPesewas } from '@/lib/money';
import type { ActionState } from '@/lib/types';
import { bool, done, fail, refreshAdmin, str } from './_util';

function toIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function saveCoupon(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('coupons.write');
  const db = adminClient();
  const id = str(fd, 'id');
  const code = str(fd, 'code').toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return fail('Code: 3 to 30 letters, numbers, - or _.');
  const kind = str(fd, 'kind');
  if (kind !== 'percent' && kind !== 'fixed') return fail('Choose percent or fixed amount.');
  let value: number | null;
  if (kind === 'percent') {
    value = Number(str(fd, 'value'));
    if (!Number.isInteger(value) || value < 1 || value > 100) return fail('Percent must be a whole number from 1 to 100.');
  } else {
    value = parseGhsToPesewas(str(fd, 'value'));
    if (value === null || value <= 0) return fail('Enter a fixed discount amount in GHS.');
  }
  const minRaw = str(fd, 'min_subtotal');
  const min = minRaw ? parseGhsToPesewas(minRaw) : 0;
  if (min === null) return fail('Enter a valid minimum order amount.');
  const maxUses = str(fd, 'max_uses') ? Number(str(fd, 'max_uses')) : null;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) return fail('Maximum uses must be a whole number.');
  const perCustomer = Number(str(fd, 'max_uses_per_customer') || 1);
  if (!Number.isInteger(perCustomer) || perCustomer < 1) return fail('Uses per customer must be at least 1.');

  const row = {
    code,
    kind,
    value,
    min_subtotal_pesewas: min,
    max_uses: maxUses,
    max_uses_per_customer: perCustomer,
    starts_at: toIso(str(fd, 'starts_at')),
    expires_at: toIso(str(fd, 'expires_at')),
    is_active: id ? bool(fd, 'is_active') : true,
  };
  const res = id ? await db.from('coupons').update(row).eq('id', id) : await db.from('coupons').insert(row);
  if (res.error) return fail(res.error.message.includes('coupons_code_key') ? 'That code already exists.' : res.error.message);
  await audit({ actorId: staff.userId, action: id ? 'coupon.updated' : 'coupon.created', entityType: 'coupon', entityId: id || code, after: row });
  refreshAdmin('/admin/coupons');
  return done(id ? 'Coupon saved.' : 'Coupon created.');
}

export async function saveZone(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('delivery.write');
  const db = adminClient();
  const id = str(fd, 'id');
  const name = str(fd, 'name');
  const regions = fd.getAll('regions').map(String);
  if (!name) return fail('Enter a zone name.');
  if (regions.length === 0) return fail('Choose at least one region.');
  const fee = parseGhsToPesewas(str(fd, 'fee'));
  if (fee === null) return fail('Enter the delivery fee in GHS (0 for free).');
  const freeRaw = str(fd, 'free_over');
  const freeOver = freeRaw ? parseGhsToPesewas(freeRaw) : null;
  if (freeRaw && freeOver === null) return fail('Enter a valid free-delivery threshold.');
  const etaMin = Number(str(fd, 'eta_min_days') || 1);
  const etaMax = Number(str(fd, 'eta_max_days') || 3);
  if (!Number.isInteger(etaMin) || !Number.isInteger(etaMax) || etaMin < 0 || etaMax < etaMin) return fail('Check the delivery estimate days.');
  const row = { name, regions, fee_pesewas: fee, free_over_pesewas: freeOver, eta_min_days: etaMin, eta_max_days: etaMax, is_active: id ? bool(fd, 'is_active') : true };
  const res = id ? await db.from('delivery_zones').update(row).eq('id', id) : await db.from('delivery_zones').insert(row);
  if (res.error) return fail(res.error.message);
  await audit({ actorId: staff.userId, action: id ? 'zone.updated' : 'zone.created', entityType: 'delivery_zone', entityId: id || name, after: row });
  refreshAdmin('/admin/delivery');
  return done(id ? 'Zone saved.' : 'Zone added.');
}

export async function savePickup(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('delivery.write');
  const db = adminClient();
  const id = str(fd, 'id');
  const name = str(fd, 'name');
  const address = str(fd, 'address');
  if (!name || !address) return fail('Enter a name and an address.');
  const row = { name, address, phone: str(fd, 'phone') || null, hours: str(fd, 'hours') || null, is_active: id ? bool(fd, 'is_active') : true };
  const res = id ? await db.from('pickup_locations').update(row).eq('id', id) : await db.from('pickup_locations').insert(row);
  if (res.error) return fail(res.error.message);
  await audit({ actorId: staff.userId, action: id ? 'pickup.updated' : 'pickup.created', entityType: 'pickup_location', entityId: id || name, after: row });
  refreshAdmin('/admin/delivery');
  return done(id ? 'Pickup location saved.' : 'Pickup location added.');
}
