'use server';

import { revalidatePath } from 'next/cache';
import { adminClient } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth/session';
import { recordConsent } from '@/lib/consent';
import type { ActionState } from '@/lib/types';

export async function saveProfileAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser('/account');
  const name = String(fd.get('full_name') ?? '').trim().slice(0, 100);
  const sms = fd.get('sms_marketing') === 'on';
  const email = fd.get('email_marketing') === 'on';
  const db = adminClient();
  const { data: before } = await db.from('profiles').select('sms_marketing_consent, email_marketing_consent, phone, email').eq('id', user.id).maybeSingle();
  const { error } = await db
    .from('profiles')
    .update({ full_name: name || null, sms_marketing_consent: sms, email_marketing_consent: email, consent_updated_at: new Date().toISOString() })
    .eq('id', user.id);
  if (error) return { ok: false, error: 'Could not save your details. Please try again.' };
  if (before && before.sms_marketing_consent !== sms) {
    await recordConsent({ userId: user.id, phone: before.phone, channel: 'sms', granted: sms, source: 'account' });
  }
  if (before && before.email_marketing_consent !== email) {
    await recordConsent({ userId: user.id, email: before.email, channel: 'email', granted: email, source: 'account' });
  }
  revalidatePath('/account');
  return { ok: true, message: 'Saved.' };
}
