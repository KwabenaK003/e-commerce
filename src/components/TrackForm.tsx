'use client';

import { useActionState } from 'react';
import { trackAction } from '@/actions/track';
import { SubmitButton } from '@/components/SubmitButton';
import type { ActionState } from '@/lib/types';

export function TrackForm() {
  const [state, action] = useActionState<ActionState, FormData>(trackAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{state.error}</p>}
      <div><label htmlFor="order_number" className="label">Order number</label><input id="order_number" name="order_number" placeholder="ODH-010001" className="input uppercase" required /></div>
      <div><label htmlFor="phone" className="label">Phone number used at checkout</label><input id="phone" name="phone" type="tel" placeholder="024 123 4567" className="input" required /></div>
      <SubmitButton>Track order</SubmitButton>
    </form>
  );
}
