'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { withinLimit, TOO_MANY } from '@/lib/security/rate-limit';
import { clientIp } from '@/lib/security/request';
import type { ActionState } from '@/lib/types';

export async function staffSignIn(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const password = String(fd.get('password') ?? '');
  if (!email || !password) return { ok: false, error: 'Enter your email and password.' };

  const ip = await clientIp();
  if (!(await withinLimit('sign_in', email, ip))) return { ok: false, error: TOO_MANY };

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: 'Wrong email or password.' };
  redirect('/admin');
}

export async function staffSignOut(): Promise<void> {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect('/admin/login');
}
