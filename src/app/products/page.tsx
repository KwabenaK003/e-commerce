import type { Metadata } from 'next';
import Link from 'next/link';
import { buildCategoryTree, getCategories, searchProducts, type SearchParams } from '@/lib/catalog';
import { parseGhsToPesewas } from '@/lib/money';
import { ProductCard } from '@/components/ProductCard';

export const revalidate = 60;
export const metadata: Metadata = { title: 'Shop' };

type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 80);
  const category = one(sp.category);
  const sortRaw = one(sp.sort);
  const sort = (['relevance', 'price_asc', 'price_desc', 'newest'].includes(sortRaw) ? sortRaw : q ? 'relevance' : 'newest') as NonNullable<SearchParams['sort']>;
  const min = parseGhsToPesewas(one(sp.min));
  const max = parseGhsToPesewas(one(sp.max));
  const inStock = one(sp.stock) === '1';
  const page = Math.max(Number(one(sp.page)) || 1, 1);

  const [categories, result] = await Promise.all([
    getCategories(),
    searchProducts({ q, category: category || undefined, minPrice: min ?? undefined, maxPrice: max ?? undefined, inStock, sort, page }),
  ]);
  const roots = buildCategoryTree(categories);

  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | number | undefined> = { q, category, sort: sortRaw, min: one(sp.min), max: one(sp.max), stock: inStock ? '1' : '', page, ...over };
    for (const [k, v] of Object.entries(base)) if (v !== undefined && v !== '' && v !== 0) p.set(k, String(v));
    return `/products?${p}`;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside aria-label="Filters" className="space-y-5">
        <form action="/products" className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
          <div>
            <label htmlFor="q" className="label">Search</label>
            <input id="q" name="q" defaultValue={q} className="input" />
          </div>
          <div>
            <label htmlFor="category" className="label">Category</label>
            <select id="category" name="category" defaultValue={category} className="input">
              <option value="">All</option>
              {roots.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  <option value={c.slug}>All {c.name}</option>
                  {c.children.map((ch) => <option key={ch.id} value={ch.slug}>{ch.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label htmlFor="min" className="label">Min GH₵</label><input id="min" name="min" inputMode="decimal" defaultValue={one(sp.min)} className="input" /></div>
            <div><label htmlFor="max" className="label">Max GH₵</label><input id="max" name="max" inputMode="decimal" defaultValue={one(sp.max)} className="input" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="stock" value="1" defaultChecked={inStock} /> In stock only</label>
          <div>
            <label htmlFor="sort" className="label">Sort by</label>
            <select id="sort" name="sort" defaultValue={sortRaw || sort} className="input">
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
          </div>
          <button className="btn w-full" type="submit">Apply</button>
        </form>
      </aside>

      <section aria-live="polite">
        <h1 className="mb-1 text-2xl font-bold">{q ? `Results for "${q}"` : 'Shop'}</h1>
        <p className="mb-4 text-sm text-zinc-600">{result.total} product{result.total === 1 ? '' : 's'}</p>
        {result.items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-600">
            Nothing matched. Try a different word or <Link href="/products" className="font-semibold underline">clear the filters</Link>.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {result.items.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
        {result.pageCount > 1 && (
          <nav aria-label="Pages" className="mt-8 flex items-center justify-center gap-3">
            {page > 1 && <Link className="btn btn-outline" href={qs({ page: page - 1 })}>Previous</Link>}
            <span className="text-sm">Page {page} of {result.pageCount}</span>
            {page < result.pageCount && <Link className="btn btn-outline" href={qs({ page: page + 1 })}>Next</Link>}
          </nav>
        )}
      </section>
    </div>
  );
}
