'use server';

import { revalidatePath } from 'next/cache';
import { addToCart, removeLine, setLineQuantity, type CartMutation } from '@/lib/cart';
import { isUuid } from '@/lib/utils';

export async function addToCartAction(variantId: string, quantity: number): Promise<CartMutation> {
  if (!isUuid(variantId)) return { ok: false, error: 'Choose an option first.' };
  return addToCart(variantId, quantity);
}

export async function updateQuantityAction(formData: FormData): Promise<void> {
  const variantId = String(formData.get('variant_id') ?? '');
  if (!isUuid(variantId)) return;
  await setLineQuantity(variantId, Number(formData.get('quantity')));
  revalidatePath('/cart');
}

export async function removeLineAction(formData: FormData): Promise<void> {
  const variantId = String(formData.get('variant_id') ?? '');
  if (!isUuid(variantId)) return;
  await removeLine(variantId);
  revalidatePath('/cart');
}
