import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { LoginForm } from '@/components/LoginForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = '/account' } = await searchParams;
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/account';
  if (await getCurrentUser()) redirect(safeNext);
  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <p className="text-zinc-600">Enter your phone number and we will text you a code. No password needed. You can also check out without an account.</p>
      <LoginForm next={safeNext} />
    </div>
  );
}
