import Link from 'next/link';
import { siteConfig } from '@/config/site';
import { buildCategoryTree, getCategories, getFeaturedProducts, getNewArrivals } from '@/lib/catalog';
import { ProductCard } from '@/components/ProductCard';

export const revalidate = 60;

export default async function HomePage() {
  const [categories, featured, fresh] = await Promise.all([getCategories(), getFeaturedProducts(8), getNewArrivals(8)]);
  const roots = buildCategoryTree(categories);
  return (
    <div className="space-y-12">
      <section className="rounded-2xl bg-emerald-800 px-6 py-12 text-white sm:px-12">
        <h1 className="max-w-xl text-3xl font-extrabold sm:text-4xl">{siteConfig.tagline}</h1>
        <p className="mt-3 max-w-xl text-emerald-100">Pay with mobile money or card. Delivery across all 16 regions of Ghana.</p>
        <Link href="/products" className="btn mt-6 !bg-white !text-emerald-900 hover:!bg-emerald-50">Shop now</Link>
      </section>

      <section aria-label="Why shop with us" className="grid gap-3 text-sm sm:grid-cols-3">
        {[
          ['Secure payment', 'Mobile money and cards through Paystack'],
          ['Nationwide delivery', 'Tracked orders with SMS updates'],
          ['Easy returns', 'Request a return from your order page'],
        ].map(([t, d]) => (
          <div key={t} className="rounded-xl border border-zinc-200 bg-white p-4">
            <p className="font-bold">{t}</p>
            <p className="text-zinc-600">{d}</p>
          </div>
        ))}
      </section>

      {roots.length > 0 && (
        <section aria-labelledby="cats">
          <h2 id="cats" className="mb-3 text-xl font-bold">Shop by category</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {roots.map((c) => (
              <Link key={c.id} href={`/products?category=${c.slug}`} className="rounded-xl border border-zinc-200 bg-white p-4 text-center font-semibold hover:border-emerald-700 hover:text-emerald-800">
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {featured.length > 0 && (
        <section aria-labelledby="feat">
          <h2 id="feat" className="mb-3 text-xl font-bold">Featured</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {featured.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {fresh.length > 0 && (
        <section aria-labelledby="new">
          <h2 id="new" className="mb-3 text-xl font-bold">New arrivals</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {fresh.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {featured.length === 0 && fresh.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-600">No products yet. Add some in the admin area.</p>
      )}
    </div>
  );
}
