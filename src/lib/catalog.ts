import 'server-only';
import { publicClient } from '@/lib/supabase/public';
import type { CategoryRow, ProductDetail, StorefrontProduct } from '@/lib/types';

/**
 * Storefront reads. They use the cookie-free anonymous client, so pages built on them can be
 * statically generated and refreshed in the background (ISR). Row level security still applies:
 * only active products are visible, and stock is exposed as a flag, never as a number.
 */

const isBuildPhase = () => process.env.NEXT_PHASE === 'phase-production-build';

/** During `next build` a missing database must not fail the build; at runtime errors surface normally. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isBuildPhase()) return fallback;
    throw e;
  }
}

const PRODUCT_COLUMNS =
  'id, slug, name, brand, category_id, featured, created_at, min_price_pesewas, max_price_pesewas, min_compare_pesewas, in_stock, image_path, image_alt';

export async function getCategories(): Promise<CategoryRow[]> {
  return safe(async () => {
    const { data, error } = await publicClient()
      .from('categories')
      .select('id, parent_id, name, slug, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order')
      .order('name');
    if (error) throw new Error(`categories: ${error.message}`);
    return (data ?? []) as CategoryRow[];
  }, []);
}

export async function getFeaturedProducts(limit = 8): Promise<StorefrontProduct[]> {
  return safe(async () => {
    const db = publicClient();
    const { data, error } = await db
      .from('storefront_products')
      .select(PRODUCT_COLUMNS)
      .eq('featured', true)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`featured: ${error.message}`);
    return (data ?? []) as StorefrontProduct[];
  }, []);
}

export async function getNewArrivals(limit = 8): Promise<StorefrontProduct[]> {
  return safe(async () => {
    const { data, error } = await publicClient()
      .from('storefront_products')
      .select(PRODUCT_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`new arrivals: ${error.message}`);
    return (data ?? []) as StorefrontProduct[];
  }, []);
}

export interface SearchParams {
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'newest';
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  items: StorefrontProduct[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export async function searchProducts(p: SearchParams): Promise<SearchResult> {
  const pageSize = Math.min(Math.max(p.pageSize ?? 24, 1), 60);
  const page = Math.max(p.page ?? 1, 1);
  return safe(
    async () => {
      const { data, error } = await publicClient().rpc('search_storefront', {
        p_query: p.q?.trim() || null,
        p_category_slug: p.category || null,
        p_min_price: p.minPrice ?? null,
        p_max_price: p.maxPrice ?? null,
        p_in_stock: p.inStock ?? false,
        p_sort: p.sort ?? 'relevance',
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
      });
      if (error) throw new Error(`search: ${error.message}`);
      const rows = (data ?? []) as Array<StorefrontProduct & { total_count: number }>;
      const total = rows.length ? Number(rows[0].total_count) : 0;
      const items = rows.map(({ total_count: _t, ...rest }) => rest as StorefrontProduct);
      return { items, total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1) };
    },
    { items: [], total: 0, page, pageSize, pageCount: 1 },
  );
}

export async function getProductDetail(slug: string): Promise<ProductDetail | null> {
  const db = publicClient();
  const { data: product, error } = await db
    .from('products')
    .select('id, slug, name, brand, description, size_guide, option_names, seo_title, seo_description, category:categories(id, name, slug)')
    .eq('slug', slug)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(`product: ${error.message}`);
  if (!product) return null;

  const [variantsRes, imagesRes] = await Promise.all([
    db
      .from('product_variants')
      .select('id, sku, name, option_values, price_pesewas, compare_at_pesewas, is_active')
      .eq('product_id', product.id)
      .eq('is_active', true)
      .order('price_pesewas')
      .order('name'),
    db
      .from('product_images')
      .select('id, storage_path, alt_text, sort_order, variant_id')
      .eq('product_id', product.id)
      .order('sort_order')
      .order('id'),
  ]);
  if (variantsRes.error) throw new Error(`variants: ${variantsRes.error.message}`);
  if (imagesRes.error) throw new Error(`images: ${imagesRes.error.message}`);

  const variantIds = (variantsRes.data ?? []).map((v) => v.id as string);
  const stock = new Map<string, { in_stock: boolean; low_stock: boolean }>();
  if (variantIds.length) {
    const { data: flags } = await db.from('public_variant_stock').select('variant_id, in_stock, low_stock').in('variant_id', variantIds);
    for (const f of flags ?? []) stock.set(f.variant_id as string, { in_stock: !!f.in_stock, low_stock: !!f.low_stock });
  }

  const category = Array.isArray(product.category) ? (product.category[0] ?? null) : (product.category ?? null);
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    description: product.description,
    size_guide: product.size_guide,
    option_names: product.option_names ?? [],
    seo_title: product.seo_title,
    seo_description: product.seo_description,
    category: category as ProductDetail['category'],
    variants: (variantsRes.data ?? []).map((v) => ({
      id: v.id,
      sku: v.sku,
      name: v.name,
      option_values: (v.option_values ?? {}) as Record<string, string>,
      price_pesewas: v.price_pesewas,
      compare_at_pesewas: v.compare_at_pesewas,
      is_active: v.is_active,
      in_stock: stock.get(v.id)?.in_stock ?? false,
      low_stock: stock.get(v.id)?.low_stock ?? false,
    })),
    images: (imagesRes.data ?? []) as ProductDetail['images'],
  };
}

export async function getRelatedProducts(categoryId: string | null, excludeId: string, limit = 4): Promise<StorefrontProduct[]> {
  if (!categoryId) return [];
  return safe(async () => {
    const { data } = await publicClient()
      .from('storefront_products')
      .select(PRODUCT_COLUMNS)
      .eq('category_id', categoryId)
      .neq('id', excludeId)
      .order('featured', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as StorefrontProduct[];
  }, []);
}

/** Every active product slug, for the sitemap. */
export async function listProductSlugs(): Promise<Array<{ slug: string; updated: string }>> {
  return safe(async () => {
    const { data } = await publicClient()
      .from('products')
      .select('slug, updated_at')
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(5000);
    return (data ?? []).map((r) => ({ slug: r.slug as string, updated: r.updated_at as string }));
  }, []);
}

/** Active categories as a tree, for navigation menus. */
export interface CategoryNode extends CategoryRow {
  children: CategoryNode[];
}
export function buildCategoryTree(rows: CategoryRow[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
