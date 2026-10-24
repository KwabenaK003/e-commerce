'use server';

import { adminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { friendlyDbError } from '@/lib/errors';
import type { ActionState } from '@/lib/types';
import { done, fail, refreshAdmin, refreshStorefront, str } from './_util';

export async function adjustStockAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('inventory.write');
  const variantId = str(fd, 'variant_id');
  const delta = Number(str(fd, 'delta'));
  const reason = str(fd, 'reason');
  if (!Number.isInteger(delta) || delta === 0) return fail('Enter a whole number other than zero (use a minus sign to remove stock).');
  if (!['restock', 'adjustment', 'damage'].includes(reason)) return fail('Choose a reason.');
  const { data, error } = await adminClient().rpc('adjust_stock', {
    p_variant_id: variantId,
    p_delta: delta,
    p_reason: reason,
    p_actor: staff.userId,
    p_note: str(fd, 'note') || null,
  });
  if (error) return fail(friendlyDbError(error.message));
  await audit({ actorId: staff.userId, action: 'stock.adjusted', entityType: 'variant', entityId: variantId, after: { delta, reason, on_hand: data } });
  refreshAdmin('/admin/inventory');
  refreshStorefront();
  return done(`Stock updated. On hand: ${data}.`);
}
