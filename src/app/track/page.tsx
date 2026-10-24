import type { Metadata } from 'next';
import { TrackForm } from '@/components/TrackForm';

export const metadata: Metadata = { title: 'Track your order' };

export default function TrackPage() {
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Track your order</h1>
      <p className="text-zinc-600">Enter your order number and the phone number you used at checkout. No account needed.</p>
      <TrackForm />
    </div>
  );
}
