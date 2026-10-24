import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth/session';
import { isProd } from '@/lib/env';

/**
 * Carts live in the database so a guest cart survives refreshes and can feed abandoned-cart
 * recovery later. A guest is identified by a random token in an httpOnly cookie; a signed-in
 * customer by their user id. All access goes through the server (service role) after the
 * ownership check below: there are no client policies on guest carts.
 *
 * Prices are always read from product_variants. Nothing the browser sends is trusted.
 */

export const CART_COOKIE = 'cart_token';
/** Non-sensitive item count for the header badge (readable by client code). */
export const CART_COUNT_COOKIE = 'cart_count';
export const MAX_LINE_QTY = 20;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export interface CartLine {
  variantId: string;
  productId: string;
  sku: string;
  slug: string;
  productName: string;
  variantName: string | null;
  imagePath: string | null;
  unitPricePesewas: number;
  quantity: number;
  lineTotalPesewas: number;
  /** false when the variant or product was deactivated, or stock is gone */
  purchasable: boolean;
  inStock: boolean;
  /** units available right now, capped at MAX_LINE_QTY (never shown as an exact stock level) */
  maxQty: number;
}

export interface CartView {
  id: string | null;
  lines: CartLine[];
  subtotalPesewas: number;
  itemCount: number;
  /** true when something in the cart cannot be bought as it stands */
  hasIssues: boolean;
}

export const EMPTY_CART: CartView = { id: null, lines: [], subtotalPesewas: 0, itemCount: 0, hasIssues: false };

async function guestToken(): Promise<string | null> {
  return (await cookies()).get(CART_COOKIE)?.value ?? null;
}

/** The current visitor's cart id, or null when they have none yet. Safe in Server Components. */
export async function findCartId(): Promise<string | null> {
  const db = adminClient();
  const user = await getCurrentUser();
  if (user) {
    const { data } = await db.from('carts').select('id').eq('user_id', user.id).order('created_at').limit(1).maybeSingle();
    return (data?.id as string) ?? null;
  }
  const token = await guestToken();
  if (!token) return null;
  const { data } = await db.from('carts').select('id').eq('guest_token', token).maybeSingle();
  return (data?.id as string) ?? null;
}

/** Find or create the visitor's cart. Server Actions and Route Handlers only (it may set a cookie). */
export async function ensureCartId(): Promise<string> {
  const existing = await findCartId();
  if (existing) return existing;
  const db = adminClient();
  const user = await getCurrentUser();
  if (user) {
    const { data, error } = await db.from('carts').insert({ user_id: user.id }).select('id').single();
    if (error) throw new Error(`cart: ${error.message}`);
    return data.id as string;
  }
  const token = randomBytes(24).toString('base64url');
  const { data, error } = await db.from('carts').insert({ guest_token: token }).select('id').single();
  if (error) throw new Error(`cart: ${error.message}`);
  (await cookies()).set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return data.id as string;
}

export async function setCartCountCookie(count: number): Promise<void> {
  (await cookies()).set(CART_COUNT_COOKIE, String(Math.max(0, count)), {
    httpOnly: false,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

/** Cart with live prices and availability. */
export async function getCartView(cartId?: string | null): Promise<CartView> {
  const id = cartId === undefined ? await findCartId() : cartId;
  if (!id) return EMPTY_CART;
  const db = adminClient();

  const { data: items, error } = await db
    .from('cart_items')
    .select(
      'variant_id, quantity, added_at, variant:product_variants(id, sku, name, price_pesewas, is_active, product_id, product:products(id, slug, name, status))',
    )
    .eq('cart_id', id)
    .order('added_at');
  if (error) throw new Error(`cart items: ${error.message}`);
  if (!items || items.length === 0) return { ...EMPTY_CART, id };

  const variantIds = items.map((i) => i.variant_id as string);
  const productIds = [
    ...new Set(items.map((i: any) => (Array.isArray(i.variant) ? i.variant[0]?.product_id : i.variant?.product_id)).filter(Boolean)),
  ] as string[];

  const [inv, imgs] = await Promise.all([
    db.from('inventory').select('variant_id, on_hand, reserved').in('variant_id', variantIds),
    db.from('product_images').select('product_id, storage_path, sort_order').in('product_id', productIds).order('sort_order').order('id'),
  ]);
  const available = new Map<string, number>();
  for (const r of inv.data ?? []) available.set(r.variant_id as string, Math.max(0, (r.on_hand as number) - (r.reserved as number)));
  const firstImage = new Map<string, string>();
  for (const r of imgs.data ?? []) if (!firstImage.has(r.product_id as string)) firstImage.set(r.product_id as string, r.storage_path as string);

  const lines: CartLine[] = [];
  for (const raw of items as any[]) {
    const v = Array.isArray(raw.variant) ? raw.variant[0] : raw.variant;
    const p = v ? (Array.isArray(v.product) ? v.product[0] : v.product) : null;
    if (!v || !p) continue;
    const avail = available.get(v.id) ?? 0;
    const purchasable = !!v.is_active && p.status === 'active' && avail > 0;
    lines.push({
      variantId: v.id,
      productId: p.id,
      sku: v.sku,
      slug: p.slug,
      productName: p.name,
      variantName: v.name,
      imagePath: firstImage.get(p.id) ?? null,
      unitPricePesewas: v.price_pesewas,
      quantity: raw.quantity,
      lineTotalPesewas: v.price_pesewas * raw.quantity,
      purchasable: purchasable && raw.quantity <= avail,
      inStock: avail > 0 && !!v.is_active && p.status === 'active',
      maxQty: Math.min(avail, MAX_LINE_QTY),
    });
  }
  return {
    id,
    lines,
    subtotalPesewas: lines.reduce((s, l) => s + l.lineTotalPesewas, 0),
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    hasIssues: lines.some((l) => !l.purchasable),
  };
}

export type CartMutation = { ok: true; itemCount: number; message?: string } | { ok: false; error: string };

async function countItems(cartId: string): Promise<number> {
  const { data } = await adminClient().from('cart_items').select('quantity').eq('cart_id', cartId);
  return (data ?? []).reduce((s, r) => s + (r.quantity as number), 0);
}

async function variantAvailability(variantId: string): Promise<{ ok: boolean; available: number; name: string }> {
  const db = adminClient();
  const { data: v } = await db
    .from('product_variants')
    .select('id, is_active, product:products(name, status)')
    .eq('id', variantId)
    .maybeSingle();
  if (!v) return { ok: false, available: 0, name: '' };
  const p: any = Array.isArray(v.product) ? v.product[0] : v.product;
  if (!v.is_active || !p || p.status !== 'active') return { ok: false, available: 0, name: p?.name ?? '' };
  const { data: inv } = await db.from('inventory').select('on_hand, reserved').eq('variant_id', variantId).maybeSingle();
  const available = inv ? Math.max(0, (inv.on_hand as number) - (inv.reserved as number)) : 0;
  return { ok: true, available, name: p.name };
}

export async function addToCart(variantId: string, quantity: number): Promise<CartMutation> {
  const qty = Math.trunc(quantity);
  if (!Number.isFinite(qty) || qty < 1) return { ok: false, error: 'Choose a quantity of at least 1.' };
  const info = await variantAvailability(variantId);
  if (!info.ok) return { ok: false, error: 'This item is no longer available.' };
  if (info.available <= 0) return { ok: false, error: 'Sorry, this item is out of stock.' };

  const cartId = await ensureCartId();
  const db = adminClient();
  const { data: existing } = await db.from('cart_items').select('quantity').eq('cart_id', cartId).eq('variant_id', variantId).maybeSingle();
  const current = (existing?.quantity as number) ?? 0;
  const cap = Math.min(info.available, MAX_LINE_QTY);
  const wanted = current + qty;
  const finalQty = Math.min(wanted, cap);
  const capped = finalQty < wanted;
  if (finalQty <= current && capped) {
    return { ok: false, error: current >= MAX_LINE_QTY ? `You can buy up to ${MAX_LINE_QTY} of an item per order.` : 'You already have all the available stock in your cart.' };
  }
  const { error } = await db
    .from('cart_items')
    .upsert({ cart_id: cartId, variant_id: variantId, quantity: finalQty }, { onConflict: 'cart_id,variant_id' });
  if (error) throw new Error(`cart add: ${error.message}`);
  const itemCount = await countItems(cartId);
  await setCartCountCookie(itemCount);
  return { ok: true, itemCount, message: capped ? 'Added the last available units to your cart.' : undefined };
}

export async function setLineQuantity(variantId: string, quantity: number): Promise<CartMutation> {
  const cartId = await findCartId();
  if (!cartId) return { ok: false, error: 'Your cart is empty.' };
  const db = adminClient();
  const qty = Math.trunc(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    await db.from('cart_items').delete().eq('cart_id', cartId).eq('variant_id', variantId);
  } else {
    const info = await variantAvailability(variantId);
    if (!info.ok || info.available <= 0) return { ok: false, error: 'This item is no longer available.' };
    const finalQty = Math.min(qty, info.available, MAX_LINE_QTY);
    const { error } = await db.from('cart_items').update({ quantity: finalQty }).eq('cart_id', cartId).eq('variant_id', variantId);
    if (error) throw new Error(`cart update: ${error.message}`);
  }
  const itemCount = await countItems(cartId);
  await setCartCountCookie(itemCount);
  return { ok: true, itemCount };
}

export async function removeLine(variantId: string): Promise<CartMutation> {
  return setLineQuantity(variantId, 0);
}

/**
 * On sign-in: fold the guest cart into the customer's cart (add quantities, cap at available
 * stock), then drop the guest cart and its cookie.
 */
export async function mergeGuestCartIntoUser(userId: string): Promise<void> {
  const store = await cookies();
  const token = store.get(CART_COOKIE)?.value;
  if (!token) return;
  const db = adminClient();
  const { data: guest } = await db.from('carts').select('id').eq('guest_token', token).maybeSingle();
  store.delete(CART_COOKIE);
  if (!guest) return;

  let { data: mine } = await db.from('carts').select('id').eq('user_id', userId).order('created_at').limit(1).maybeSingle();
  if (!mine) {
    const created = await db.from('carts').insert({ user_id: userId }).select('id').single();
    if (created.error) throw new Error(`cart merge: ${created.error.message}`);
    mine = created.data;
  }
  const myCartId = mine!.id as string;

  const [{ data: guestItems }, { data: myItems }] = await Promise.all([
    db.from('cart_items').select('variant_id, quantity').eq('cart_id', guest.id),
    db.from('cart_items').select('variant_id, quantity').eq('cart_id', myCartId),
  ]);
  const have = new Map((myItems ?? []).map((r) => [r.variant_id as string, r.quantity as number]));
  for (const g of guestItems ?? []) {
    const info = await variantAvailability(g.variant_id as string);
    if (!info.ok || info.available <= 0) continue;
    const merged = Math.min((have.get(g.variant_id as string) ?? 0) + (g.quantity as number), info.available, MAX_LINE_QTY);
    await db.from('cart_items').upsert({ cart_id: myCartId, variant_id: g.variant_id, quantity: merged }, { onConflict: 'cart_id,variant_id' });
  }
  await db.from('carts').delete().eq('id', guest.id);
  await setCartCountCookie(await countItems(myCartId));
}
