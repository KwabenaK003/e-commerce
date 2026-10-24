import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'No access', robots: { index: false, follow: false } };

export default function ForbiddenPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">You do not have access to that page</h1>
      <p className="mt-2 text-sm text-zinc-600">Your role does not include this area. Ask the store owner if you need it.</p>
      <Link href="/admin" className="mt-6 inline-block rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white">
        Back to admin
      </Link>
    </main>
  );
}
