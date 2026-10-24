import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { can, type Permission } from '@/lib/auth/permissions';
import type { StaffRole } from '@/lib/types';

/** The signed-in customer or staff user, or null. Verified with Supabase Auth, not just the cookie. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

export async function requireUser(next = '/account'): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export interface StaffContext {
  userId: string;
  email: string;
  role: StaffRole;
  fullName: string | null;
}

export const getStaffMember = cache(async (): Promise<StaffContext | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data } = await adminClient()
    .from('staff')
    .select('role, full_name, is_active')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!data || !data.is_active) return null;
  return { userId: user.id, email: user.email ?? '', role: data.role as StaffRole, fullName: (data.full_name as string) ?? null };
});

export type StaffAccess =
  | { ok: true; staff: StaffContext }
  | { ok: false; reason: 'login' | 'enroll_mfa' | 'verify_mfa' | 'forbidden' };

const mfaRequired = () => process.env.ADMIN_REQUIRE_MFA !== 'false';

/**
 * Checks everything an admin request needs: signed in, active staff member, a second factor
 * (TOTP) for this session, and the permission. Returns a reason instead of redirecting so route
 * handlers can answer with 401 or 403.
 */
export async function staffAccess(permission?: Permission): Promise<StaffAccess> {
  const staff = await getStaffMember();
  if (!staff) return { ok: false, reason: 'login' };

  if (mfaRequired()) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!data || data.nextLevel === 'aal1') return { ok: false, reason: 'enroll_mfa' };
    if (data.currentLevel !== 'aal2') return { ok: false, reason: 'verify_mfa' };
  }
  if (permission && !can(staff.role, permission)) return { ok: false, reason: 'forbidden' };
  return { ok: true, staff };
}

/** For admin pages and server actions: redirects to the right screen when access is missing. */
export async function requireStaff(permission?: Permission): Promise<StaffContext> {
  const access = await staffAccess(permission);
  if (access.ok) return access.staff;
  switch (access.reason) {
    case 'login':
      redirect('/admin/login');
    case 'enroll_mfa':
      redirect('/admin/mfa?mode=enroll');
    case 'verify_mfa':
      redirect('/admin/mfa?mode=verify');
    default:
      redirect('/admin/forbidden');
  }
}
