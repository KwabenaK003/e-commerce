'use client';

import { useActionState, useState } from 'react';
import { requestOtp, verifyOtp } from '@/actions/auth';
import { Turnstile } from '@/components/Turnstile';
import { SubmitButton } from '@/components/SubmitButton';
import type { ActionState } from '@/lib/types';

export function LoginForm({ next }: { next: string }) {
  const [phone, setPhone] = useState('');
  const [reqState, reqAction] = useActionState<ActionState, FormData>(requestOtp, {});
  const [verState, verAction] = useActionState<ActionState, FormData>(verifyOtp, {});

  if (reqState.ok) {
    return (
      <form action={verAction} className="space-y-4">
        <input type="hidden" name="phone" value={phone} />
        <input type="hidden" name="next" value={next} />
        <p className="text-sm text-zinc-600">We sent a 6-digit code to {phone}. It expires in 5 minutes.</p>
        {verState.error && <p role="alert" className="err">{verState.error}</p>}
        <div>
          <label htmlFor="token" className="label">Verification code</label>
          <input id="token" name="token" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} className="input text-center text-2xl tracking-widest" required autoFocus />
        </div>
        <SubmitButton pendingText="Checking...">Sign in</SubmitButton>
      </form>
    );
  }
  return (
    <form action={reqAction} className="space-y-4">
      {reqState.error && <p role="alert" className="err">{reqState.error}</p>}
      <div>
        <label htmlFor="phone" className="label">Phone number</label>
        <input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="024 123 4567" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </div>
      <Turnstile />
      <SubmitButton pendingText="Sending code...">Send me a code</SubmitButton>
    </form>
  );
}
