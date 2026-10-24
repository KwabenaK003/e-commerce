/**
 * Store settings live in the store_settings table and are editable in /admin/settings.
 * This file is the single list of known keys, their types and defaults. It has no
 * server-only imports so it can be unit-tested and reused by the admin form.
 */

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export const DEFAULT_RATE_LIMITS = {
  otp_phone: { limit: 3, windowSeconds: 600 },
  otp_phone_hour: { limit: 10, windowSeconds: 3600 },
  otp_ip: { limit: 10, windowSeconds: 600 },
  sign_in: { limit: 5, windowSeconds: 600 },
  sign_up_ip: { limit: 10, windowSeconds: 3600 },
  place_order_phone: { limit: 5, windowSeconds: 3600 },
  place_order_ip: { limit: 5, windowSeconds: 3600 },
  coupon_ip: { limit: 10, windowSeconds: 3600 },
  track_ip: { limit: 10, windowSeconds: 600 },
  return_request_ip: { limit: 5, windowSeconds: 3600 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof DEFAULT_RATE_LIMITS;

export interface StoreSettings {
  reservationMinutes: number;
  taxRateBps: number;
  taxInclusive: boolean;
  codMaxPesewas: number;
  codRegions: string[];
  reviewCeilingPesewas: number;
  returnWindowDays: number;
  bigSaleThresholdPesewas: number | null;
  alertPhones: string[];
  alertEmails: string[];
  orderPrefix: string;
  freeDeliveryBanner: string;
  rateLimits: Record<RateLimitName, RateLimitRule>;
}

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}
function toStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
}

export function parseSettings(raw: Record<string, unknown>): StoreSettings {
  const overrides = (raw.rate_limits && typeof raw.rate_limits === 'object' ? raw.rate_limits : {}) as Record<string, any>;
  const rateLimits = { ...DEFAULT_RATE_LIMITS } as Record<RateLimitName, RateLimitRule>;
  for (const name of Object.keys(DEFAULT_RATE_LIMITS) as RateLimitName[]) {
    const o = overrides[name];
    if (o && typeof o === 'object') {
      rateLimits[name] = {
        limit: Math.max(1, toInt(o.limit, DEFAULT_RATE_LIMITS[name].limit)),
        windowSeconds: Math.max(10, toInt(o.windowSeconds, DEFAULT_RATE_LIMITS[name].windowSeconds)),
      };
    }
  }
  const threshold = raw.big_sale_threshold_pesewas;
  return {
    reservationMinutes: Math.max(5, toInt(raw.reservation_minutes, 30)),
    taxRateBps: Math.max(0, toInt(raw.tax_rate_bps, 0)),
    taxInclusive: toBool(raw.tax_inclusive, true),
    codMaxPesewas: Math.max(0, toInt(raw.cod_max_pesewas, 100000)),
    codRegions: toStrArray(raw.cod_regions),
    reviewCeilingPesewas: Math.max(0, toInt(raw.review_total_ceiling_pesewas, 500000)),
    returnWindowDays: Math.max(0, toInt(raw.return_window_days, 7)),
    bigSaleThresholdPesewas: threshold === undefined || threshold === null ? null : toInt(threshold, 0),
    alertPhones: toStrArray(raw.alert_phones),
    alertEmails: toStrArray(raw.alert_emails),
    orderPrefix: typeof raw.order_prefix === 'string' && raw.order_prefix.trim() ? raw.order_prefix.trim() : 'ODH',
    freeDeliveryBanner: typeof raw.free_delivery_banner === 'string' ? raw.free_delivery_banner : '',
    rateLimits,
  };
}

export type SettingKind = 'int' | 'bool' | 'pesewas' | 'text' | 'list' | 'json';

export interface SettingDef {
  key: string;
  label: string;
  kind: SettingKind;
  help: string;
}

/** Drives the /admin/settings form. */
export const SETTING_DEFS: SettingDef[] = [
  { key: 'order_prefix', label: 'Order number prefix', kind: 'text', help: 'Appears at the start of every new order number, e.g. ODH-010001.' },
  { key: 'reservation_minutes', label: 'Stock hold (minutes)', kind: 'int', help: 'How long stock is held for an unpaid online order. Default 30.' },
  { key: 'tax_rate_bps', label: 'Tax rate (basis points)', kind: 'int', help: '1250 = 12.5%. Leave 0 until you have agreed the VAT and levy treatment with your accountant.' },
  { key: 'tax_inclusive', label: 'Prices include tax', kind: 'bool', help: 'On: shelf prices already contain tax. Off: tax is added at checkout.' },
  { key: 'cod_max_pesewas', label: 'Pay on delivery: maximum order (GHS)', kind: 'pesewas', help: 'Orders above this amount must be paid online.' },
  { key: 'cod_regions', label: 'Pay on delivery: allowed regions', kind: 'list', help: 'One region per line. Leave empty to allow every region.' },
  { key: 'review_total_ceiling_pesewas', label: 'Manual review above (GHS)', kind: 'pesewas', help: 'Orders at or above this total are held for review before shipping.' },
  { key: 'return_window_days', label: 'Return window (days)', kind: 'int', help: 'Customers can request a return this many days after delivery.' },
  { key: 'big_sale_threshold_pesewas', label: 'Big sale alert above (GHS)', kind: 'pesewas', help: 'Paid orders at or above this total alert the owners by email and SMS.' },
  { key: 'alert_phones', label: 'Alert phone numbers', kind: 'list', help: 'One number per line, international format (+233...). Receive big-sale and system alerts by SMS.' },
  { key: 'alert_emails', label: 'Alert email addresses', kind: 'list', help: 'One address per line. Receive big-sale alerts, the low-stock digest and system alerts.' },
  { key: 'free_delivery_banner', label: 'Announcement bar text', kind: 'text', help: 'Shown at the top of every page. Leave empty to hide.' },
  { key: 'rate_limits', label: 'Rate limit overrides (JSON)', kind: 'json', help: 'Advanced. Example: {"place_order_ip":{"limit":10,"windowSeconds":3600}}' },
];
