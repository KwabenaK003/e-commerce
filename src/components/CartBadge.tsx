'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

function readCount(): number {
  const m = document.cookie.match(/(?:^|; )cart_count=(\d+)/);
  return m ? Number(m[1]) : 0;
}

/** Reads the non-sensitive cart_count cookie so the header never makes pages dynamic. */
export function CartBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(readCount());
    const update = (e?: Event) => {
      const detail = (e as CustomEvent<number> | undefined)?.detail;
      setCount(typeof detail === 'number' ? detail : readCount());
    };
    window.addEventListener('cart:update', update);
    window.addEventListener('focus', update);
    return () => {
      window.removeEventListener('cart:update', update);
      window.removeEventListener('focus', update);
    };
  }, []);
  return (
    <Link href="/cart" className="relative inline-flex items-center gap-1 rounded-lg px-3 py-2 font-semibold hover:bg-zinc-100" aria-label={`Cart, ${count} items`}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 6h15l-1.5 9h-12z" />
        <path d="M6 6 5 3H2" />
        <circle cx="9" cy="20" r="1.5" />
        <circle cx="18" cy="20" r="1.5" />
      </svg>
      <span className="hidden sm:inline">Cart</span>
      {count > 0 && <span className="rounded-full bg-emerald-700 px-2 text-xs font-bold text-white">{count}</span>}
    </Link>
  );
}
