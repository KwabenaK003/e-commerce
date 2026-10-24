import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/config/site';
import { getCategories, listProductSlugs } from '@/lib/catalog';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories] = await Promise.all([listProductSlugs(), getCategories()]);
  return [
    { url: absoluteUrl('/'), changeFrequency: 'daily', priority: 1 },
    { url: absoluteUrl('/products'), changeFrequency: 'daily', priority: 0.9 },
    ...categories.map((c) => ({ url: absoluteUrl(`/products?category=${c.slug}`), changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...products.map((p) => ({ url: absoluteUrl(`/products/${p.slug}`), lastModified: p.updated, changeFrequency: 'weekly' as const, priority: 0.8 })),
    ...['delivery', 'returns', 'privacy', 'terms'].map((s) => ({ url: absoluteUrl(`/policies/${s}`), priority: 0.3 })),
    { url: absoluteUrl('/about'), priority: 0.3 },
    { url: absoluteUrl('/contact'), priority: 0.3 },
  ];
}
