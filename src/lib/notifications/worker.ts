import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/messaging/email';
import { sendSms } from '@/lib/messaging/sms';
import { renderNotification } from '@/lib/notifications/templates';
import { logger, errorMessage } from '@/lib/logger';
import { chunk } from '@/lib/utils';
import type { FulfillmentRow, OrderItemRow, OrderRow } from '@/lib/types';

interface QueuedNotification {
  id: string;
  order_id: string | null;
  channel: 'email' | 'sms';
  template: string;
  recipient: string;
  payload: Record<string, any>;
  attempts: number;
}

export interface WorkerResult {
  claimed: number;
  sent: number;
  failed: number;
}

/**
 * Sends queued notifications. Called every minute by the send-notifications job.
 * claim_notifications locks a batch and schedules the retry (2, 4, 8 ... minutes);
 * complete_notification marks it sent, queued again, or failed after 5 attempts.
 * A failed email or SMS never affects the order itself.
 */
export async function processNotifications(limit = 50): Promise<WorkerResult> {
  const db = adminClient();
  const { data, error } = await db.rpc('claim_notifications', { p_limit: limit });
  if (error) throw new Error(`claim_notifications: ${error.message}`);
  const batch = (data ?? []) as QueuedNotification[];
  if (batch.length === 0) return { claimed: 0, sent: 0, failed: 0 };

  // Load every order, its items and latest fulfilment once for the whole batch.
  const orderIds = [...new Set(batch.map((n) => n.order_id).filter((x): x is string => !!x))];
  const orders = new Map<string, OrderRow>();
  const items = new Map<string, OrderItemRow[]>();
  const fulfillments = new Map<string, FulfillmentRow>();
  for (const ids of chunk(orderIds, 100)) {
    const [o, i, f] = await Promise.all([
      db.from('orders').select('*').in('id', ids),
      db.from('order_items').select('*').in('order_id', ids),
      db.from('fulfillments').select('*').in('order_id', ids).order('created_at', { ascending: true }),
    ]);
    for (const row of (o.data ?? []) as OrderRow[]) orders.set(row.id, row);
    for (const row of (i.data ?? []) as OrderItemRow[]) items.set(row.order_id, [...(items.get(row.order_id) ?? []), row]);
    for (const row of (f.data ?? []) as FulfillmentRow[]) fulfillments.set(row.order_id, row); // last one wins
  }

  let sent = 0;
  let failed = 0;
  for (const group of chunk(batch, 10)) {
    await Promise.all(
      group.map(async (n) => {
        try {
          const rendered = renderNotification(n.template, n.channel, {
            order: n.order_id ? (orders.get(n.order_id) ?? null) : null,
            items: n.order_id ? (items.get(n.order_id) ?? []) : [],
            fulfillment: n.order_id ? (fulfillments.get(n.order_id) ?? null) : null,
            payload: n.payload ?? {},
          });
          if (!rendered) {
            // nothing to send for this template and channel
            await db.rpc('complete_notification', { p_id: n.id, p_ok: true, p_provider_id: 'skipped' });
            return;
          }
          let providerId: string | null;
          if (n.channel === 'email') {
            providerId = (await sendEmail({ to: n.recipient, subject: rendered.subject ?? 'Notification', text: rendered.text, html: rendered.html ?? rendered.text })).id;
          } else {
            providerId = (await sendSms(n.recipient, rendered.text)).id;
          }
          await db.rpc('complete_notification', { p_id: n.id, p_ok: true, p_provider_id: providerId });
          sent++;
        } catch (e) {
          failed++;
          logger.warn('notification send failed', { id: n.id, template: n.template, channel: n.channel, attempts: n.attempts + 1, error: errorMessage(e) });
          await db.rpc('complete_notification', { p_id: n.id, p_ok: false, p_error: errorMessage(e) });
        }
      }),
    );
  }
  return { claimed: batch.length, sent, failed };
}

/** Queue a notification that is not tied to the order status trigger. Safe to call twice. */
export async function enqueueNotification(args: {
  orderId: string | null;
  template: string;
  channel: 'email' | 'sms';
  recipient: string;
  payload?: Record<string, unknown>;
  dedupeSuffix?: string;
}): Promise<void> {
  const { error } = await adminClient().rpc('enqueue_notification', {
    p_order_id: args.orderId,
    p_template: args.template,
    p_channel: args.channel,
    p_recipient: args.recipient,
    p_payload: args.payload ?? {},
    p_dedupe_suffix: args.dedupeSuffix ?? '',
  });
  if (error) throw new Error(`enqueue_notification: ${error.message}`);
}
