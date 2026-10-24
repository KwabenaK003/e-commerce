'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/phone';
import { withinLimit, TOO_MANY } from '@/lib/security/rate-limit';
import { verifyTurnstile, BOT_CHECK_FAILED } from '@/lib/security/turnstile';
import { clientIp } from '@/lib/security/request';
import { mergeGuestCartIntoUser } from '@/lib/cart';
import type { ActionState } from '@/lib/types';

/** Step 1 of phone sign-in: Supabase generates a code and its Send SMS hook delivers it through Arkesel. */
export async function requestOtp(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const phone = normalizePhone(String(fd.get('phone') ?? ''));
  if (!phone) return { error: 'Enter a valid phone number, for example 024 123 4567.' };
  const ip = await clientIp();
  if (!(await verifyTurnstile(String(fd.get('cf-turnstile-response') ?? '') || null, ip))) return { error: BOT_CHECK_FAILED };
  if (!(await withinLimit('otp_phone', phone)) || !(await withinLimit('otp_phone_hour', phone)) || !(await withinLimit('otp_ip', ip))) {
    return { error: TOO_MANY };
  }
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } });
  if (error) return { error: 'We could not send a code right now. Please try again shortly.' };
  return { ok: true, message: phone };
}

/** Step 2: check the code, start the session, fold the guest cart into the account. */
export async function verifyOtp(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const phone = normalizePhone(String(fd.get('phone') ?? ''));
  const token = String(fd.get('token') ?? fd.get('code') ?? '').replace(/\D/g, '');
  const next = String(fd.get('next') ?? '/account');
  if (!phone || token.length < 4) return { error: 'Enter the code we sent you.', message: phone ?? '' };
  if (!(await withinLimit('sign_in', phone)) || !(await withinLimit('sign_in', await clientIp()))) return { error: TOO_MANY, message: phone };

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
  if (error || !data.user) return { ok: true, error: 'That code is wrong or has expired.', message: phone };
  await mergeGuestCartIntoUser(data.user.id);
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/account');
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect('/');
}
