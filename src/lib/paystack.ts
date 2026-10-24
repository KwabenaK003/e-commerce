import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { requireEnv } from '@/lib/env';

const BASE = 'https://api.paystack.co';

export class PaystackError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'PaystackError';
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ data: T; meta?: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${requireEnv('PAYSTACK_SECRET_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T; meta?: any } | null;
  if (!res.ok || !json || json.status !== true) {
    throw new PaystackError(json?.message ?? `Paystack request failed (${res.status})`, res.status);
  }
  return { data: json.data as T, meta: json.meta };
}

/**
 * Paystack signs every webhook body with HMAC SHA512 using your secret key and sends the
 * hex digest in the x-paystack-signature header. Compared in constant time.
 */
export function verifySignature(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha512', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface PaystackTransaction {
  id: number;
  status: string; // success | failed | abandoned | ongoing | pending | reversed | queued
  reference: string;
  amount: number; // pesewas
  currency: string;
  channel?: string;
  gateway_response?: string;
  paid_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function initializeTransaction(args: {
  email: string;
  amountPesewas: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}): Promise<{ authorization_url: string; access_code: string; reference: string }> {
  const { data } = await call<{ authorization_url: string; access_code: string; reference: string }>(
    'POST',
    '/transaction/initialize',
    {
      email: args.email,
      amount: args.amountPesewas,
      currency: 'GHS',
      reference: args.reference,
      callback_url: args.callbackUrl,
      metadata: args.metadata ?? {},
    },
  );
  return data;
}

export async function verifyTransaction(reference: string): Promise<PaystackTransaction> {
  const { data } = await call<PaystackTransaction>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  return data;
}

export async function createRefund(args: {
  reference: string;
  amountPesewas: number;
  customerNote?: string;
  merchantNote?: string;
}): Promise<{ id: number | null; status: string }> {
  const { data } = await call<{ id?: number; status?: string }>('POST', '/refund', {
    transaction: args.reference,
    amount: args.amountPesewas,
    currency: 'GHS',
    customer_note: args.customerNote,
    merchant_note: args.merchantNote,
  });
  return { id: typeof data.id === 'number' ? data.id : null, status: data.status ?? 'pending' };
}

/** Every successful transaction in a time range (used by the daily reconciliation). */
export async function listSuccessfulTransactions(from: Date, to: Date, maxPages = 50): Promise<PaystackTransaction[]> {
  const out: PaystackTransaction[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({
      perPage: '100',
      page: String(page),
      status: 'success',
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const { data, meta } = await call<PaystackTransaction[]>('GET', `/transaction?${qs}`);
    out.push(...data);
    const pageCount = Number(meta?.pageCount ?? 1);
    if (page >= pageCount || data.length === 0) break;
  }
  return out;
}
