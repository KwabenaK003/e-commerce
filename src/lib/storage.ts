/**
 * Storage helpers that are safe to import from server and client code.
 * Product images live in the public "product-images" bucket.
 */
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');

export function productImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${SUPABASE_URL}/storage/v1/object/public/product-images/${encoded}`;
}

/** next/image refuses private addresses, so local Supabase images are served unoptimised. */
export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === 'host.docker.internal' || h.endsWith('.local');
  } catch {
    return false;
  }
}

export const BUCKETS = {
  productImages: 'product-images',
  imports: 'imports',
  returnPhotos: 'return-photos',
} as const;
