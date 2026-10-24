import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { absoluteUrl, siteConfig } from '@/config/site';
import { getProductDetail, getRelatedProducts } from '@/lib/catalog';
import { formatGhs } from '@/lib/money';
import { productImageUrl } from '@/lib/storage';
import { AddToCart } from '@/components/AddToCart';
import { ProductImage } from '@/components/ProductImage';
import { ProductCard } from '@/components/ProductCard';

export const revalidate = 60;
export async function generateStaticParams() {
  return []; // pages are built on first visit, then refreshed every 60 seconds
}

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const p = await getProductDetail(slug);
  if (!p) return { title: 'Product not found' };
  const img = productImageUrl(p.images[0]?.storage_path);
  const desc = p.seo_description ?? p.description?.slice(0, 160) ?? undefined;
  return {
    title: p.seo_title ?? p.name,
    description: desc,
    alternates: { canonical: absoluteUrl(`/products/${p.slug}`) },
    openGraph: { title: p.name, description: desc, images: img ? [img] : undefined },
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { slug } = await params;
  const p = await getProductDetail(slug);
  if (!p) notFound();
  const related = await getRelatedProducts(p.category?.id ?? null, p.id);
  const prices = p.variants.map((v) => v.price_pesewas);
  const min = prices.length ? Math.min(...prices) : 0;
  const anyStock = p.variants.some((v) => v.in_stock);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.description ?? undefined,
    brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined,
    image: p.images.map((i) => productImageUrl(i.storage_path)).filter(Boolean),
    sku: p.variants[0]?.sku,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'GHS',
      lowPrice: (min / 100).toFixed(2),
      highPrice: ((prices.length ? Math.max(...prices) : 0) / 100).toFixed(2),
      offerCount: p.variants.length,
      availability: anyStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: absoluteUrl(`/products/${p.slug}`),
    },
  };

  return (
    <div className="space-y-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <nav aria-label="Breadcrumb" className="text-sm text-zinc-600">
        <Link href="/" className="hover:underline">Home</Link> / <Link href="/products" className="hover:underline">Shop</Link>
        {p.category && <> / <Link href={`/products?category=${p.category.slug}`} className="hover:underline">{p.category.name}</Link></>}
      </nav>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          <div className="relative aspect-square overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
            <ProductImage path={p.images[0]?.storage_path} alt={p.images[0]?.alt_text ?? p.name} sizes="(min-width: 768px) 50vw, 100vw" priority />
          </div>
          {p.images.length > 1 && (
            <ul className="grid grid-cols-4 gap-2">
              {p.images.slice(1, 9).map((i) => (
                <li key={i.id} className="relative aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
                  <ProductImage path={i.storage_path} alt={i.alt_text ?? p.name} sizes="120px" />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-5">
          {p.brand && <p className="text-sm text-zinc-500">{p.brand}</p>}
          <h1 className="text-2xl font-extrabold sm:text-3xl">{p.name}</h1>
          <p className="text-2xl font-bold">
            {prices.length > 1 && Math.min(...prices) !== Math.max(...prices) && <span className="text-base font-normal text-zinc-500">From </span>}
            {formatGhs(min)}
          </p>
          <AddToCart variants={p.variants} />
          <ul className="space-y-1 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
            <li>Delivery across Ghana, with SMS updates. <Link href="/policies/delivery" className="underline">Delivery info</Link></li>
            <li>Pay by mobile money or card. Pay on delivery in some areas.</li>
            <li>Returns accepted within the return window. <Link href="/policies/returns" className="underline">Returns policy</Link></li>
          </ul>
          {p.description && (
            <section>
              <h2 className="mb-1 font-bold">Description</h2>
              <p className="whitespace-pre-line text-zinc-700">{p.description}</p>
            </section>
          )}
          {p.size_guide && (
            <details className="rounded-xl border border-zinc-200 bg-white p-4">
              <summary className="cursor-pointer font-bold">Size guide</summary>
              <p className="mt-2 whitespace-pre-line text-sm text-zinc-700">{p.size_guide}</p>
            </details>
          )}
          <p className="text-xs text-zinc-500">Questions? Message {siteConfig.name} on WhatsApp using the button below.</p>
        </div>
      </div>

      {related.length > 0 && (
        <section aria-labelledby="rel">
          <h2 id="rel" className="mb-3 text-xl font-bold">You may also like</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {related.map((r) => <ProductCard key={r.id} product={r} />)}
          </div>
        </section>
      )}
    </div>
  );
}
