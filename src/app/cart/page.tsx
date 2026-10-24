import type { Metadata } from 'next';
import Link from 'next/link';
import { getCartView } from '@/lib/cart';
import { formatGhs } from '@/lib/money';
import { removeLineAction, updateQuantityAction } from '@/actions/cart';
import { ProductImage } from '@/components/ProductImage';

export const metadata: Metadata = { title: 'Your cart', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const cart = await getCartView();
  if (cart.lines.length === 0) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-2xl font-bold">Your cart is empty</h1>
        <p className="mt-2 text-zinc-600">Find something you like and add it to your cart.</p>
        <Link href="/products" className="btn mt-6">Continue shopping</Link>
      </div>
    );
  }
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <section>
        <h1 className="mb-4 text-2xl font-bold">Your cart</h1>
        {cart.hasIssues && (
          <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Some items are sold out or have less stock than in your cart. Update or remove them to continue.
          </p>
        )}
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white">
          {cart.lines.map((l) => (
            <li key={l.variantId} className="flex gap-4 p-4">
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-zinc-100">
                <ProductImage path={l.imagePath} alt={l.productName} sizes="96px" />
              </div>
              <div className="flex-1">
                <Link href={`/products/${l.slug}`} className="font-semibold hover:underline">{l.productName}</Link>
                {l.variantName && <p className="text-sm text-zinc-600">{l.variantName}</p>}
                <p className="text-sm">{formatGhs(l.unitPricePesewas)} each</p>
                {!l.purchasable && <p className="err">{l.inStock ? `Only ${l.maxQty} available. Lower the quantity.` : 'Sold out. Remove it to continue.'}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <form action={updateQuantityAction} className="flex items-center gap-2">
                    <input type="hidden" name="variant_id" value={l.variantId} />
                    <label htmlFor={`q-${l.variantId}`} className="sr-only">Quantity</label>
                    <input id={`q-${l.variantId}`} name="quantity" type="number" min={1} max={20} defaultValue={l.quantity} className="input !w-20" />
                    <button className="btn btn-outline !py-2" type="submit">Update</button>
                  </form>
                  <form action={removeLineAction}>
                    <input type="hidden" name="variant_id" value={l.variantId} />
                    <button className="text-sm font-semibold text-red-700 underline" type="submit">Remove</button>
                  </form>
                </div>
              </div>
              <p className="font-bold">{formatGhs(l.lineTotalPesewas)}</p>
            </li>
          ))}
        </ul>
      </section>
      <aside className="h-fit space-y-3 rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-bold">Summary</h2>
        <p className="flex justify-between"><span>Subtotal ({cart.itemCount} items)</span><span className="font-bold">{formatGhs(cart.subtotalPesewas)}</span></p>
        <p className="text-sm text-zinc-600">Delivery fee and coupons are applied at checkout.</p>
        {cart.hasIssues ? (
          <button className="btn w-full" disabled>Checkout</button>
        ) : (
          <Link href="/checkout" className="btn w-full">Checkout</Link>
        )}
        <Link href="/products" className="block text-center text-sm font-semibold text-emerald-800 underline">Continue shopping</Link>
      </aside>
    </div>
  );
}
