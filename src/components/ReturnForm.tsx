'use client';

import { useActionState } from 'react';
import { requestReturnAction } from '@/actions/returns';
import { SubmitButton } from '@/components/SubmitButton';
import type { ActionState } from '@/lib/types';

export function ReturnForm({ orderNumber, token, items }: { orderNumber: string; token: string; items: Array<{ id: string; label: string; quantity: number }> }) {
  const [state, action] = useActionState<ActionState, FormData>(requestReturnAction, {});
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="order_number" value={orderNumber} />
      <input type="hidden" name="token" value={token} />
      {state.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{state.error}</p>}
      <fieldset className="space-y-2">
        <legend className="mb-1 font-bold">Which items?</legend>
        {items.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3">
            <label htmlFor={`qty_${i.id}`}>{i.label} (bought {i.quantity})</label>
            <input id={`qty_${i.id}`} name={`qty_${i.id}`} type="number" min={0} max={i.quantity} defaultValue={0} className="input !w-20" />
          </div>
        ))}
      </fieldset>
      <div>
        <label htmlFor="reason" className="label">Reason</label>
        <input id="reason" name="reason" className="input" required />
        {state.fieldErrors?.reason && <p className="err">{state.fieldErrors.reason}</p>}
      </div>
      <div>
        <label htmlFor="resolution" className="label">What would you like?</label>
        <select id="resolution" name="resolution" className="input"><option value="refund">Refund</option><option value="exchange">Exchange</option></select>
      </div>
      <div>
        <label htmlFor="note" className="label">Anything else we should know? (optional)</label>
        <textarea id="note" name="note" rows={3} className="input" />
      </div>
      <SubmitButton>Send return request</SubmitButton>
    </form>
  );
}
