/**
 * Site-wide settings. Everything comes from environment variables (see .env.example),
 * so a new brand needs no code changes. Safe to import from server and client code.
 */
const rawUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const siteConfig = {
  name: process.env.NEXT_PUBLIC_STORE_NAME ?? 'My Store',
  tagline: 'Quality products, delivered across Ghana',
  url: rawUrl.replace(/\/+$/, ''),
  supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? '',
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? '',
  /** Digits only, international format, e.g. 233200000000 */
  whatsapp: (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, ''),
  address: process.env.NEXT_PUBLIC_STORE_ADDRESS ?? 'Accra, Ghana',
  currency: 'GHS',
  locale: 'en-GH',
  timeZone: 'Africa/Accra',
  gaId: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? '',
  metaPixelId: process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '',
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '',
} as const;

export function absoluteUrl(path = '/'): string {
  return `${siteConfig.url}${path.startsWith('/') ? path : `/${path}`}`;
}

/** wa.me link that opens a chat with the store, optionally pre-filled. */
export function whatsappLink(message?: string): string | null {
  if (!siteConfig.whatsapp) return null;
  const q = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${siteConfig.whatsapp}${q}`;
}
