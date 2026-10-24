'use client';

import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/lib/types';

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function SubmitButton({ children, className, variant = 'primary' }: { children: ReactNode; className?: string; variant?: 'primary' | 'secondary' | 'danger' }) {
  const { pending } = useFormStatus();
  const styles = {
    primary: 'bg-emerald-700 text-white hover:bg-emerald-800',
    secondary: 'bg-white text-zinc-800 border border-zinc-300 hover:bg-zinc-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  }[variant];
  return (
    <button type="submit" disabled={pending} className={`rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60 ${styles} ${className ?? ''}`}>
      {pending ? 'Working...' : children}
    </button>
  );
}

/** A form bound to a server action that shows its success or error message. */
export function ActionForm({ action, children, className, encType }: { action: Action; children: ReactNode; className?: string; encType?: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={formAction} className={className} encType={encType}>
      {children}
      {state.error ? (
        <p role="alert" className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      ) : state.message ? (
        <p role="status" className="mt-2 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>
      ) : null}
    </form>
  );
}
