'use client';

import { useState, useTransition } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { addToCartAction } from '@/actions/cart';
import { formatGhs } from '@/lib/money';
import type { ProductVariant } from '@/lib/types';

export function AddToCart({ variants }: { variants: ProductVariant[] }) {
  const firstAvailable = variants.find((v) => v.in_stock) ?? variants[0];
  const [variantId, setVariantId] = useState(firstAvailable?.id ?? '');
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [added, setAdded] = useState(0);
  const [pending, start] = useTransition();
  const selected = variants.find((v) => v.id === variantId);

  if (variants.length === 0) return <p className="text-zinc-600">This product is not available right now.</p>;

  function add() {
    setMsg(null);
    start(async () => {
      const res = await addToCartAction(variantId, qty);
      if (res.ok) {
        setAdded((n) => n + 1);
        setMsg({ ok: true, text: res.message ?? 'Added to your cart.' });
        window.dispatchEvent(new CustomEvent('cart:update', { detail: res.itemCount }));
      } else setMsg({ ok: false, text: res.error });
    });
  }

  return (
    <div className="space-y-4">
      {variants.length > 1 && (
        <div>
          <label htmlFor="variant" className="label">Choose an option</label>
          <select id="variant" className="input" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            {variants.map((v) => (
              <option key={v.id} value={v.id} disabled={!v.in_stock}>
                {(v.name ?? 'Standard') + ' - ' + formatGhs(v.price_pesewas) + (v.in_stock ? '' : ' (sold out)')}
              </option>
            ))}
          </select>
        </div>
      )}
      {selected?.low_stock && <p className="text-sm font-semibold text-amber-700">Almost gone: low stock.</p>}
      <div className="flex items-end gap-3">
        <div className="w-24">
          <label htmlFor="qty" className="label">Quantity</label>
          <input id="qty" type="number" min={1} max={20} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="input" />
        </div>
        <motion.button
          key={added}
          initial={{ scale: 1 }}
          animate={{ scale: added ? [1, 1.06, 1] : 1 }}
          transition={{ duration: 0.3 }}
          type="button"
          onClick={add}
          disabled={pending || !selected?.in_stock}
          className="btn flex-1"
        >
          {!selected?.in_stock ? 'Sold out' : pending ? 'Adding...' : 'Add to cart'}
        </motion.button>
      </div>
      <p role="status" aria-live="polite" className={msg ? (msg.ok ? 'text-sm text-emerald-800' : 'err') : 'sr-only'}>
        {msg?.text}
        {msg?.ok && (
          <>
            {' '}
            <Link href="/cart" className="font-semibold underline">View cart</Link>
          </>
        )}
      </p>
    </div>
  );
}
