import Link from 'next/link';
import { siteConfig } from '@/config/site';
import { CartBadge } from '@/components/CartBadge';
import { getCategories, buildCategoryTree } from '@/lib/catalog';

export async function Header({ banner }: { banner?: string }) {
  const tree = buildCategoryTree(await getCategories().catch(() => []));
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white">
      {banner && <div className="bg-emerald-800 px-4 py-1.5 text-center text-sm text-white">{banner}</div>}
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link href="/" className="text-xl font-extrabold text-emerald-800">
          {siteConfig.name}
        </Link>
        <form action="/products" role="search" className="mx-2 hidden flex-1 sm:block">
          <input name="q" type="search" placeholder="Search products" aria-label="Search products" className="input" />
        </form>
        <nav className="ml-auto flex items-center gap-1 text-sm">
          <Link href="/account" className="rounded-lg px-3 py-2 font-semibold hover:bg-zinc-100">
            Account
          </Link>
          <CartBadge />
        </nav>
      </div>
      <form action="/products" role="search" className="px-4 pb-3 sm:hidden">
        <input name="q" type="search" placeholder="Search products" aria-label="Search products" className="input" />
      </form>
      {tree.length > 0 && (
        <nav aria-label="Categories" className="border-t border-zinc-100">
          <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-1 text-sm">
            {tree.map((c) => (
              <li key={c.id}>
                <Link href={`/products?category=${c.slug}`} className="block whitespace-nowrap rounded-lg px-3 py-1.5 hover:bg-zinc-100">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
