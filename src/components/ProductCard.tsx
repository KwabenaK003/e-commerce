import Link from 'next/link';
import { formatGhs } from '@/lib/money';
import type { StorefrontProduct } from '@/lib/types';
import { ProductImage } from '@/components/ProductImage';

export function ProductCard({ product }: { product: StorefrontProduct }) {
  const from = product.min_price_pesewas !== product.max_price_pesewas;
  return (
    <Link href={`/products/${product.slug}`} className="group block overflow-hidden rounded-xl border border-zinc-200 bg-white transition hover:shadow-md">
      <div className="relative aspect-square bg-zinc-100">
        <ProductImage path={product.image_path} alt={product.image_alt ?? product.name} />
        {!product.in_stock && <span className="absolute left-2 top-2 rounded bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-white">Sold out</span>}
        {product.in_stock && product.min_compare_pesewas && (
          <span className="absolute left-2 top-2 rounded bg-emerald-700 px-2 py-0.5 text-xs font-semibold text-white">Sale</span>
        )}
      </div>
      <div className="p-3">
        {product.brand && <p className="text-xs text-zinc-500">{product.brand}</p>}
        <h3 className="line-clamp-2 text-sm font-semibold group-hover:text-emerald-800">{product.name}</h3>
        <p className="mt-1 font-bold">
          {from && <span className="text-xs font-normal text-zinc-500">From </span>}
          {formatGhs(product.min_price_pesewas)}
          {product.min_compare_pesewas && !from && <span className="ml-2 text-xs font-normal text-zinc-400 line-through">{formatGhs(product.min_compare_pesewas)}</span>}
        </p>
      </div>
    </Link>
  );
}
