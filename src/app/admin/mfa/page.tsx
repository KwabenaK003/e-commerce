import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MfaForm } from '@/components/admin/MfaForm';
import { getStaffMember } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Two-factor sign in', robots: { index: false, follow: false } };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const staff = await getStaffMember();
  if (!staff) redirect('/admin/login');
  const { mode } = await searchParams;
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm items-center px-4">
      <div className="w-full rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="mb-3 text-xl font-semibold">{mode === 'enroll' ? 'Set up two-factor' : 'Two-factor check'}</h1>
        <MfaForm mode={mode === 'enroll' ? 'enroll' : 'verify'} />
      </div>
    </main>
  );
}
