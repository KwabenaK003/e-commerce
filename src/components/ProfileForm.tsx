'use client';

import { useActionState } from 'react';
import { saveProfileAction } from '@/actions/account';
import { SubmitButton } from '@/components/SubmitButton';
import type { ActionState } from '@/lib/types';

export function ProfileForm({ fullName, sms, email }: { fullName: string; sms: boolean; email: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(saveProfileAction, {});
  return (
    <form action={action} className="space-y-3">
      <div><label htmlFor="full_name" className="label">Name</label><input id="full_name" name="full_name" defaultValue={fullName} className="input" /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sms_marketing" defaultChecked={sms} /> Send me offers by SMS</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="email_marketing" defaultChecked={email} /> Send me offers by email</label>
      {state.message && <p role="status" className="text-sm text-emerald-800">{state.message}</p>}
      {state.error && <p role="alert" className="err">{state.error}</p>}
      <SubmitButton>Save</SubmitButton>
    </form>
  );
}
