import type { Metadata } from 'next';
import { ActionForm, SubmitButton } from '@/components/admin/forms';
import { Field, inputCls } from '@/components/admin/ui';
import { staffSignIn } from '@/actions/admin/auth';

export const metadata: Metadata = { title: 'Staff sign in', robots: { index: false, follow: false } };

export default function AdminLoginPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm items-center px-4">
      <div className="w-full rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">Staff sign in</h1>
        <p className="mb-4 text-sm text-zinc-500">Admin access only. You will be asked for a code from your authenticator app.</p>
        <ActionForm action={staffSignIn} className="space-y-3">
          <Field label="Email">
            <input name="email" type="email" required autoComplete="username" className={inputCls} />
          </Field>
          <Field label="Password">
            <input name="password" type="password" required autoComplete="current-password" className={inputCls} />
          </Field>
          <SubmitButton className="w-full">Sign in</SubmitButton>
        </ActionForm>
      </div>
    </main>
  );
}
