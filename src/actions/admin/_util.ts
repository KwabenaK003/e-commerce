import 'server-only';
import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/lib/types';

export const fail = (error: string): ActionState => ({ ok: false, error });
export const done = (message = 'Saved.'): ActionState => ({ ok: true, message });

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
}
export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === 'on' || v === 'true';
}
export function intOrNull(fd: FormData, key: string): number | null {
  const s = str(fd, key);
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : NaN;
}

export function refreshAdmin(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
}
export function refreshStorefront(slug?: string | null) {
  revalidatePath('/');
  revalidatePath('/products');
  if (slug) revalidatePath(`/products/${slug}`);
}
