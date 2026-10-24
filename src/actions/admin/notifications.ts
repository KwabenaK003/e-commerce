'use server';

import { adminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import type { ActionState } from '@/lib/types';
import { done, fail, refreshAdmin, str } from './_util';

export async function retryNotification(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('notifications.read');
  const id = str(fd, 'id');
  const { error } = await adminClient()
    .from('notifications')
    .update({ status: 'queued', attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null })
    .eq('id', id)
    .eq('status', 'failed');
  if (error) return fail(error.message);
  await audit({ actorId: staff.userId, action: 'notification.retried', entityType: 'notification', entityId: id });
  refreshAdmin('/admin/notifications', '/admin');
  return done('Queued again. It sends within a minute.');
}
