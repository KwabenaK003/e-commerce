import 'server-only';
import { createHash } from 'node:crypto';
import { siteConfig } from '@/config/site';
import { optionalEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import type { OrderRow } from '@/lib/types';

const sha256 = (v: string) => createHash('sha256').update(v.trim().toLowerCase()).digest('hex');

/**
 * Meta Conversions API: reports a paid order from the server, so purchases are counted even
 * when the browser blocks the pixel. The order number is the event_id, so Meta de-duplicates
 * it against the browser pixel's Purchase event. Does nothing unless the pixel id and
 * META_CAPI_ACCESS_TOKEN are set. Failures are logged and never affect the order.
 */
export async function sendMetaPurchase(order: Pick<OrderRow, 'order_number' | 'total_pesewas' | 'currency' | 'contact_email' | 'contact_phone'>): Promise<void> {
  const pixel = siteConfig.metaPixelId;
  const token = optionalEnv('META_CAPI_ACCESS_TOKEN');
  if (!pixel || !token) return;
  try {
    const version = optionalEnv('META_GRAPH_VERSION') ?? 'v23.0';
    const res = await fetch(`https://graph.facebook.com/${version}/${pixel}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [
          {
            event_name: 'Purchase',
            event_time: Math.floor(Date.now() / 1000),
            event_id: order.order_number,
            action_source: 'website',
            event_source_url: `${siteConfig.url}/orders/${order.order_number}`,
            user_data: {
              ph: [sha256(order.contact_phone.replace(/\D/g, ''))],
              ...(order.contact_email ? { em: [sha256(order.contact_email)] } : {}),
            },
            custom_data: { currency: order.currency, value: order.total_pesewas / 100, order_id: order.order_number },
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) logger.warn('meta capi rejected the event', { status: res.status, order: order.order_number });
  } catch (e) {
    logger.warn('meta capi failed', { order: order.order_number, error: e instanceof Error ? e.message : String(e) });
  }
}
