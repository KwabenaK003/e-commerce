import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth/session';
import type { FulfillmentRow, OrderItemRow, OrderRow, PaymentRow, RefundRow, ReturnRow, StatusHistoryRow } from '@/lib/types';

export interface OrderBundle {
  order: OrderRow;
  items: OrderItemRow[];
  payments: PaymentRow[];
  fulfillments: FulfillmentRow[];
  history: StatusHistoryRow[];
  returns: Array<ReturnRow & { items: Array<{ order_item_id: string; quantity: number }> }>;
  refunds: RefundRow[];
  invoiceNumber: string | null;
}

/** Everything about one order. Staff use the full bundle; customers get toCustomerBundle(). */
export async function loadOrderBundle(orderId: string): Promise<OrderBundle | null> {
  const db = adminClient();
  const { data: order } = await db.from('orders').select('*').eq('id', orderId).maybeSingle();
  if (!order) return null;
  const [items, payments, fulfillments, history, returns, refunds, invoice] = await Promise.all([
    db.from('order_items').select('*').eq('order_id', orderId).order('product_name'),
    db.from('payments').select('*').eq('order_id', orderId).order('created_at'),
    db.from('fulfillments').select('*').eq('order_id', orderId).order('created_at'),
    db.from('order_status_history').select('*').eq('order_id', orderId).order('created_at').order('id'),
    db.from('returns').select('*, return_items(order_item_id, quantity)').eq('order_id', orderId).order('requested_at', { ascending: false }),
    db.from('refunds').select('*').eq('order_id', orderId).order('created_at'),
    db.from('invoices').select('invoice_number').eq('order_id', orderId).maybeSingle(),
  ]);
  return {
    order: order as OrderRow,
    items: (items.data ?? []) as OrderItemRow[],
    payments: (payments.data ?? []) as PaymentRow[],
    fulfillments: (fulfillments.data ?? []) as FulfillmentRow[],
    history: (history.data ?? []) as StatusHistoryRow[],
    returns: ((returns.data ?? []) as any[]).map(({ return_items, ...r }) => ({ ...r, items: return_items ?? [] })),
    refunds: (refunds.data ?? []) as RefundRow[],
    invoiceNumber: (invoice.data?.invoice_number as string) ?? null,
  };
}

/** What a customer may see: no risk flags, no review state, no cost prices, no raw gateway data. */
export type CustomerOrderBundle = Omit<OrderBundle, 'order' | 'items' | 'payments'> & {
  order: Omit<OrderRow, 'risk_flags' | 'needs_review' | 'public_token' | 'user_id'> & { public_token: string };
  items: Array<Omit<OrderItemRow, 'cost_pesewas'>>;
  payments: Array<Pick<PaymentRow, 'id' | 'status' | 'channel' | 'amount_pesewas' | 'paid_at' | 'created_at'>>;
};

export function toCustomerBundle(b: OrderBundle): CustomerOrderBundle {
  const { risk_flags: _r, needs_review: _n, user_id: _u, ...order } = b.order;
  return {
    ...b,
    order,
    items: b.items.map(({ cost_pesewas: _c, ...i }) => i),
    payments: b.payments.map((p) => ({
      id: p.id,
      status: p.status,
      channel: p.channel,
      amount_pesewas: p.amount_pesewas,
      paid_at: p.paid_at,
      created_at: p.created_at,
    })),
  };
}

/**
 * Who may open an order page: the holder of its secret link token (guests, and the links
 * in emails and SMS) or the signed-in customer who owns it.
 */
export async function resolveCustomerOrderId(orderNumber: string, token?: string | null): Promise<string | null> {
  const db = adminClient();
  if (token) {
    const { data } = await db.from('orders').select('id').eq('order_number', orderNumber).eq('public_token', token).maybeSingle();
    if (data) return data.id as string;
  }
  const user = await getCurrentUser();
  if (user) {
    const { data } = await db.from('orders').select('id').eq('order_number', orderNumber).eq('user_id', user.id).maybeSingle();
    if (data) return data.id as string;
  }
  return null;
}

/** Guest order lookup: order number plus the phone number used at checkout. */
export async function findTrackingToken(orderNumber: string, phoneE164: string): Promise<string | null> {
  const { data } = await adminClient()
    .from('orders')
    .select('public_token')
    .eq('order_number', orderNumber.trim().toUpperCase())
    .eq('contact_phone', phoneE164)
    .maybeSingle();
  return (data?.public_token as string) ?? null;
}

export async function listOrdersForUser(userId: string, limit = 50): Promise<OrderRow[]> {
  const { data } = await adminClient()
    .from('orders')
    .select('*')
    .eq('user_id', userId)
    .order('placed_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as OrderRow[];
}

export function orderUrl(order: Pick<OrderRow, 'order_number' | 'public_token'>, suffix = ''): string {
  return `/orders/${order.order_number}${suffix}?t=${order.public_token}`;
}
