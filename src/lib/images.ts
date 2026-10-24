import 'server-only';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { BUCKETS } from '@/lib/storage';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['jpeg', 'png', 'webp', 'avif', 'gif']);

/** Auto-rotate, shrink to at most 1600px, convert to WebP. Throws for anything that is not an image. */
export async function processProductImage(input: Buffer): Promise<Buffer> {
  const meta = await sharp(input, { limitInputPixels: 50_000_000 }).metadata();
  if (!meta.format || !ALLOWED.has(meta.format)) throw new Error('Unsupported image type. Use JPG, PNG, WebP or AVIF.');
  return sharp(input, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
}

/** Process, upload to the public product-images bucket and record the row. */
export async function addProductImage(
  productId: string,
  input: Buffer,
  opts: { alt?: string | null; variantId?: string | null; sourceRef?: string | null } = {},
): Promise<{ id: string; path: string }> {
  const db = adminClient();
  if (input.length > MAX_IMAGE_BYTES) throw new Error('Image is larger than 5 MB.');
  const out = await processProductImage(input);
  const path = `${productId}/${randomUUID()}.webp`;
  const up = await db.storage.from(BUCKETS.productImages).upload(path, out, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false,
  });
  if (up.error) throw new Error(`upload: ${up.error.message}`);

  const { data: last } = await db
    .from('product_images')
    .select('sort_order')
    .eq('product_id', productId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await db
    .from('product_images')
    .insert({
      product_id: productId,
      variant_id: opts.variantId ?? null,
      storage_path: path,
      alt_text: opts.alt ?? null,
      sort_order: ((last?.sort_order as number) ?? -1) + 1,
      source_ref: opts.sourceRef ?? null,
    })
    .select('id')
    .single();
  if (error) {
    await db.storage.from(BUCKETS.productImages).remove([path]);
    throw new Error(`image row: ${error.message}`);
  }
  return { id: data.id as string, path };
}

export async function deleteProductImage(imageId: string): Promise<void> {
  const db = adminClient();
  const { data } = await db.from('product_images').select('storage_path').eq('id', imageId).maybeSingle();
  if (!data) return;
  await db.from('product_images').delete().eq('id', imageId);
  if (!/^https?:\/\//.test(data.storage_path as string)) {
    await db.storage.from(BUCKETS.productImages).remove([data.storage_path as string]);
  }
}
