'use server';

import { redirect } from 'next/navigation';
import { adminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { audit } from '@/lib/audit';
import { parseGhsToPesewas } from '@/lib/money';
import { slugify } from '@/lib/utils';
import { friendlyDbError } from '@/lib/errors';
import { addProductImage, deleteProductImage, MAX_IMAGE_BYTES } from '@/lib/images';
import type { ActionState } from '@/lib/types';
import { bool, done, fail, intOrNull, refreshAdmin, refreshStorefront, str } from './_util';

function parseOptionNames(s: string): string[] {
  return [...new Set(s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 3);
}

/** "size=M; color=Black" -> { size: "M", color: "Black" } */
function parseOptionValues(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(/[;\n]/)) {
    const [k, ...rest] = part.split('=');
    const key = k?.trim().toLowerCase();
    const val = rest.join('=').trim();
    if (key && val) out[key] = val;
  }
  return out;
}

export async function saveProduct(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('catalog.write');
  const db = adminClient();
  const id = str(fd, 'id');
  const name = str(fd, 'name');
  if (name.length < 2) return fail('Enter a product name.');
  const slug = slugify(str(fd, 'slug') || name);
  if (!slug) return fail('Enter a valid slug.');
  const status = str(fd, 'status');
  if (!['draft', 'active', 'archived'].includes(status)) return fail('Choose a status.');

  const row = {
    name,
    slug,
    brand: str(fd, 'brand') || null,
    category_id: str(fd, 'category_id') || null,
    description: str(fd, 'description') || null,
    size_guide: str(fd, 'size_guide') || null,
    option_names: parseOptionNames(str(fd, 'option_names')),
    status,
    featured: bool(fd, 'featured'),
    seo_title: str(fd, 'seo_title') || null,
    seo_description: str(fd, 'seo_description') || null,
  };

  if (!id) {
    const { data, error } = await db.from('products').insert(row).select('id').single();
    if (error) return fail(error.message.includes('products_slug_key') ? 'That slug is already used by another product.' : error.message);
    await audit({ actorId: staff.userId, action: 'product.created', entityType: 'product', entityId: data.id as string, after: row });
    refreshAdmin('/admin/products');
    redirect(`/admin/products/${data.id}`);
  }

  const { data: before } = await db.from('products').select('*').eq('id', id).maybeSingle();
  const { error } = await db.from('products').update(row).eq('id', id);
  if (error) return fail(error.message.includes('products_slug_key') ? 'That slug is already used by another product.' : error.message);
  await audit({ actorId: staff.userId, action: 'product.updated', entityType: 'product', entityId: id, before, after: row });
  refreshAdmin('/admin/products', `/admin/products/${id}`);
  refreshStorefront(row.slug);
  if (before?.slug && before.slug !== row.slug) refreshStorefront(before.slug as string);
  return done('Product saved.');
}

export async function archiveProduct(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('catalog.write');
  const id = str(fd, 'id');
  const { data, error } = await adminClient().from('products').update({ status: 'archived' }).eq('id', id).select('slug').single();
  if (error) return fail(error.message);
  await audit({ actorId: staff.userId, action: 'product.archived', entityType: 'product', entityId: id });
  refreshAdmin('/admin/products', `/admin/products/${id}`);
  refreshStorefront(data.slug as string);
  return done('Product archived. It is hidden from the store but kept for order history.');
}

export async function saveVariant(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('catalog.write');
  const db = adminClient();
  const productId = str(fd, 'product_id');
  const variantId = str(fd, 'variant_id');
  const sku = str(fd, 'sku');
  if (!sku || sku.length > 64) return fail('Enter a SKU (up to 64 characters).');
  const price = parseGhsToPesewas(str(fd, 'price'));
  if (price === null) return fail('Enter a valid price, for example 125.50.');
  const compareRaw = str(fd, 'compare_at');
  const compare = compareRaw ? parseGhsToPesewas(compareRaw) : null;
  if (compareRaw && compare === null) return fail('Enter a valid compare-at price.');
  if (compare !== null && compare <= price) return fail('Compare-at price must be higher than the price.');
  const costRaw = str(fd, 'cost');
  const cost = costRaw ? parseGhsToPesewas(costRaw) : null;
  if (costRaw && cost === null) return fail('Enter a valid cost price.');
  const stock = intOrNull(fd, 'stock');
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) return fail('Stock must be a whole number, zero or more.');

  const row = {
    product_id: productId,
    sku,
    name: str(fd, 'name') || null,
    option_values: parseOptionValues(str(fd, 'option_values')),
    price_pesewas: price,
    compare_at_pesewas: compare,
    is_active: variantId ? bool(fd, 'is_active') : true,
  };

  let id = variantId;
  if (!variantId) {
    const { data, error } = await db.from('product_variants').insert(row).select('id').single();
    if (error) return fail(error.message.includes('sku') ? 'That SKU already exists.' : error.message);
    id = data.id as string;
  } else {
    const { data: before } = await db.from('product_variants').select('price_pesewas, sku').eq('id', variantId).maybeSingle();
    const { error } = await db.from('product_variants').update(row).eq('id', variantId);
    if (error) return fail(error.message.includes('sku') ? 'That SKU already exists.' : error.message);
    if (before && before.price_pesewas !== price) {
      await audit({ actorId: staff.userId, action: 'product.price_changed', entityType: 'variant', entityId: variantId, before: { price_pesewas: before.price_pesewas }, after: { price_pesewas: price } });
    }
  }

  if (cost !== null && can(staff.role, 'costs.read')) {
    await db.from('variant_costs').upsert({ variant_id: id, cost_pesewas: cost }, { onConflict: 'variant_id' });
  }
  if (stock !== null && can(staff.role, 'inventory.write')) {
    const { error } = await db.rpc('set_stock', { p_variant_id: id, p_target: stock, p_reason: variantId ? 'adjustment' : 'restock', p_actor: staff.userId, p_note: 'set from product page' });
    if (error) return fail(friendlyDbError(error.message));
  }
  await audit({ actorId: staff.userId, action: variantId ? 'variant.updated' : 'variant.created', entityType: 'variant', entityId: id, after: row });
  const { data: p } = await db.from('products').select('slug').eq('id', productId).maybeSingle();
  refreshAdmin(`/admin/products/${productId}`, '/admin/inventory');
  refreshStorefront(p?.slug as string | undefined);
  return done(variantId ? 'Variant saved.' : 'Variant added.');
}

export async function uploadImages(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('catalog.write');
  const productId = str(fd, 'product_id');
  const files = fd.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return fail('Choose at least one image.');
  let added = 0;
  const problems: string[] = [];
  for (const f of files) {
    if (f.size > MAX_IMAGE_BYTES) {
      problems.push(`${f.name}: larger than 5 MB`);
      continue;
    }
    try {
      await addProductImage(productId, Buffer.from(await f.arrayBuffer()), { alt: str(fd, 'alt') || null });
      added++;
    } catch (e) {
      problems.push(`${f.name}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }
  if (added) await audit({ actorId: staff.userId, action: 'product.images_added', entityType: 'product', entityId: productId, after: { added } });
  const { data: p } = await adminClient().from('products').select('slug').eq('id', productId).maybeSingle();
  refreshAdmin(`/admin/products/${productId}`);
  refreshStorefront(p?.slug as string | undefined);
  if (problems.length) return { ok: added > 0, error: problems.join('; '), message: added ? `${added} image(s) added.` : undefined };
  return done(`${added} image(s) added.`);
}

export async function deleteImage(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('catalog.write');
  const id = str(fd, 'image_id');
  const productId = str(fd, 'product_id');
  await deleteProductImage(id);
  await audit({ actorId: staff.userId, action: 'product.image_deleted', entityType: 'product', entityId: productId });
  const { data: p } = await adminClient().from('products').select('slug').eq('id', productId).maybeSingle();
  refreshAdmin(`/admin/products/${productId}`);
  refreshStorefront(p?.slug as string | undefined);
  return done('Image removed.');
}

/** Swap an image with its neighbour; the first image is the main one. */
export async function moveImage(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff('catalog.write');
  const db = adminClient();
  const productId = str(fd, 'product_id');
  const id = str(fd, 'image_id');
  const dir = str(fd, 'dir') === 'up' ? -1 : 1;
  const { data } = await db.from('product_images').select('id').eq('product_id', productId).order('sort_order').order('id');
  const ids = (data ?? []).map((r) => r.id as string);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= ids.length) return done('');
  [ids[i], ids[j]] = [ids[j], ids[i]];
  for (let k = 0; k < ids.length; k++) await db.from('product_images').update({ sort_order: k }).eq('id', ids[k]);
  const { data: p } = await db.from('products').select('slug').eq('id', productId).maybeSingle();
  refreshAdmin(`/admin/products/${productId}`);
  refreshStorefront(p?.slug as string | undefined);
  return done('Order updated.');
}

export async function saveCategory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('catalog.write');
  const db = adminClient();
  const id = str(fd, 'id');
  const name = str(fd, 'name');
  if (name.length < 2) return fail('Enter a category name.');
  const slug = slugify(str(fd, 'slug') || name);
  const parent = str(fd, 'parent_id') || null;
  if (id && parent === id) return fail('A category cannot be its own parent.');
  const row = { name, slug, parent_id: parent, sort_order: Number(str(fd, 'sort_order')) || 0, is_active: id ? bool(fd, 'is_active') : true };
  const res = id ? await db.from('categories').update(row).eq('id', id) : await db.from('categories').insert(row);
  if (res.error) return fail(res.error.message.includes('slug') ? 'That slug is already used.' : res.error.message);
  await audit({ actorId: staff.userId, action: id ? 'category.updated' : 'category.created', entityType: 'category', entityId: id || slug, after: row });
  refreshAdmin('/admin/categories');
  refreshStorefront();
  return done(id ? 'Category saved.' : 'Category added.');
}
