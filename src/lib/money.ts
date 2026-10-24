/**
 * Money is stored and calculated as integer pesewas (GHS x 100). Never floats.
 * The pricing helpers below mirror the SQL in create_order_from_cart so the cart
 * can show an estimate; the database is always the authority at checkout.
 */

export const MAX_PESEWAS = 2_000_000_000; // stays inside a Postgres int

/** "GH₵1,234.50" for screens. */
export function formatGhs(pesewas: number): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(pesewas / 100);
}

/** "GHS 1,234.50" for SMS, email text and PDFs (standard PDF fonts have no cedi glyph). */
export function formatGhsPlain(pesewas: number): string {
  const sign = pesewas < 0 ? '-' : '';
  const abs = Math.abs(Math.round(pesewas));
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const cents = String(abs % 100).padStart(2, '0');
  return `${sign}GHS ${whole}.${cents}`;
}

/** 12550 -> "125.50" (for form inputs). */
export function pesewasToInput(pesewas: number | null | undefined): string {
  if (pesewas === null || pesewas === undefined) return '';
  return (pesewas / 100).toFixed(2);
}

/**
 * Parse text such as "1,234.50", "GH₵ 12", "12.5" into pesewas.
 * Strict: at most two decimals, no negatives, no exponent notation.
 * Integer arithmetic only, so 19.99 never becomes 1998.9999.
 */
export function parseGhsToPesewas(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input)
    .replace(/GH[S₵]|₵/gi, '')
    .replace(/[\s,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const pesewas = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(pesewas) || pesewas > MAX_PESEWAS) return null;
  return pesewas;
}

export type CouponKind = 'percent' | 'fixed';

/** Same rounding as the SQL: integer division truncates, never exceeds the subtotal. */
export function couponDiscount(subtotal: number, kind: CouponKind, value: number): number {
  const raw = kind === 'percent' ? Math.floor((subtotal * value) / 100) : value;
  return Math.min(subtotal, Math.max(raw, 0));
}

export interface ZoneFee {
  fee_pesewas: number;
  free_over_pesewas: number | null;
}

export function shippingFee(subtotal: number, zone: ZoneFee | null | undefined): number {
  if (!zone) return 0;
  if (zone.free_over_pesewas !== null && zone.free_over_pesewas !== undefined && subtotal >= zone.free_over_pesewas) return 0;
  return zone.fee_pesewas;
}

export interface TaxSettings {
  rateBps: number; // 1500 = 15%
  inclusive: boolean;
}

/** tax: the tax amount; added: what gets added on top of the total (0 when prices include tax). */
export function taxFor(base: number, t: TaxSettings): { tax: number; added: number } {
  if (t.rateBps <= 0) return { tax: 0, added: 0 };
  if (t.inclusive) {
    return { tax: Math.round(base - (base * 10000) / (10000 + t.rateBps)), added: 0 };
  }
  const tax = Math.round((base * t.rateBps) / 10000);
  return { tax, added: tax };
}

export function orderTotal(args: {
  subtotal: number;
  discount: number;
  shipping: number;
  tax: TaxSettings;
}): { total: number; tax: number } {
  const base = args.subtotal - args.discount;
  const { tax, added } = taxFor(base, args.tax);
  return { total: base + args.shipping + added, tax };
}
