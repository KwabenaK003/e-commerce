'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-reads the page every few seconds (up to a limit) while a payment is being confirmed. */
export function AutoRefresh({ intervalMs = 5000, max = 12 }: { intervalMs?: number; max?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n++;
      router.refresh();
      if (n >= max) clearInterval(id);
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs, max]);
  return null;
}
