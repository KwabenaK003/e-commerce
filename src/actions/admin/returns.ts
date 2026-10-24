'use server';

import { adminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { friendlyDbError } from '@/lib/errors';
import type { ActionState } from '@/lib/types';
import { bool, done, fail, refreshAdmin, str } from './_util';

export async function transitionReturnAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('returns.write');
  const id = str(fd, 'return_id');
  const to = str(fd, 'to');
  if (!['approved', 'rejected', 'received', 'closed'].includes(to)) return fail('Unknown status.');
  const note = str(fd, 'staff_note') || null;
  if (to === 'rejected' && !note) return fail('Tell the customer why the return was rejected.');
  const { error } = await adminClient().rpc('transition_return', {
    p_return_id: id,
    p_to: to,
    p_actor: staff.userId,
    p_staff_note: note,
    p_restock: to === 'received' && bool(fd, 'restock'),
  });
  if (error) return fail(friendlyDbError(error.message));
  await audit({ actorId: staff.userId, action: 'return.status_changed', entityType: 'return', entityId: id, after: { to, note } });
  refreshAdmin('/admin/returns', `/admin/returns/${id}`, '/admin');
  return done(`Return marked ${to}.`);
}
