import { siteConfig } from '@/config/site';
import { escapeHtml } from '@/lib/utils';
import { formatGhsPlain } from '@/lib/money';
import { formatAddress } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import type { FulfillmentRow, OrderItemRow, OrderRow } from '@/lib/types';

/**
 * Message templates. SMS stays short (one segment where possible) and uses plain
 * "GHS 123.45" because the cedi sign is not in the basic SMS alphabet.
 * Transactional messages about an order the customer placed need no marketing consent.
 */
export interface NotificationContext {
  order: OrderRow | null;
  items: OrderItemRow[];
  fulfillment: FulfillmentRow | null;
  payload: Record<string, any>;
}

export interface Rendered {
  subject?: string;
  text: string;
  html?: string;
}

export function trackingUrl(order: Pick<OrderRow, 'order_number' | 'public_token'>): string {
  return `${siteConfig.url}/orders/${order.order_number}?t=${order.public_token}`;
}

const store = () => siteConfig.name;

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="background:#047857;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden" cellspacing="0" cellpadding="0">
<tr><td style="background:#047857;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:700">${escapeHtml(store())}</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h1>${bodyHtml}${button}</td></tr>
<tr><td style="padding:16px 24px;background:#fafafa;color:#71717a;font-size:12px">Questions? ${siteConfig.supportPhone ? `Call ${escapeHtml(displayPhone(siteConfig.supportPhone))}` : ''}${siteConfig.supportEmail ? ` or email ${escapeHtml(siteConfig.supportEmail)}` : ''}. You are receiving this because you placed an order with ${escapeHtml(store())}.</td></tr>
</table></td></tr></table></body></html>`;
}

function itemsTable(items: OrderItemRow[], order: OrderRow): string {
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0">${escapeHtml(i.product_name)}${i.variant_name ? ` <span style="color:#71717a">(${escapeHtml(i.variant_name)})</span>` : ''} &times; ${i.quantity}</td><td align="right" style="padding:6px 0">${escapeHtml(formatGhsPlain(i.line_total_pesewas))}</td></tr>`,
    )
    .join('');
  const line = (label: string, v: number, bold = false) =>
    `<tr><td style="padding:4px 0;${bold ? 'font-weight:700;border-top:1px solid #e4e4e7' : 'color:#52525b'}">${label}</td><td align="right" style="padding:4px 0;${bold ? 'font-weight:700;border-top:1px solid #e4e4e7' : ''}">${escapeHtml(formatGhsPlain(v))}</td></tr>`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;margin:12px 0">${rows}
${line('Subtotal', order.subtotal_pesewas)}
${order.discount_pesewas > 0 ? line('Discount', -order.discount_pesewas) : ''}
${line('Delivery', order.shipping_pesewas)}
${line('Total', order.total_pesewas, true)}</table>`;
}

function itemsText(items: OrderItemRow[]): string {
  return items.map((i) => `- ${i.product_name}${i.variant_name ? ` (${i.variant_name})` : ''} x${i.quantity}`).join('\n');
}

const RETURN_TEXT: Record<string, string> = {
  approved: 'has been approved. Please send the item(s) back as agreed.',
  rejected: 'could not be approved. Contact us if you have questions.',
  received: 'has been received. We are processing it now.',
  refunded: 'has been refunded.',
  closed: 'is now closed.',
};

export function renderNotification(template: string, channel: 'email' | 'sms', ctx: NotificationContext): Rendered | null {
  const { order, items, fulfillment, payload } = ctx;

  if (template === 'low_stock_digest') {
    if (channel !== 'email') return null;
    const list: Array<{ sku: string; name: string; available: number }> = payload.variants ?? [];
    const text = `Low stock (${list.length} items):\n` + list.map((v) => `- ${v.sku} ${v.name}: ${v.available} left`).join('\n');
    const html = layout(
      `Low stock: ${list.length} item${list.length === 1 ? '' : 's'}`,
      `<table role="presentation" width="100%" style="font-size:14px">${list
        .map((v) => `<tr><td style="padding:4px 0">${escapeHtml(v.sku)} ${escapeHtml(v.name)}</td><td align="right">${v.available} left</td></tr>`)
        .join('')}</table>`,
      { label: 'Open inventory', url: `${siteConfig.url}/admin/inventory` },
    );
    return { subject: `${store()}: ${list.length} items low on stock`, text, html };
  }

  if (template === 'system_alert') {
    const title = String(payload.title ?? 'Attention needed');
    const lines: string[] = Array.isArray(payload.lines) ? payload.lines.map(String) : [];
    if (channel === 'sms') return { text: `${store()} alert: ${title}`.slice(0, 300) };
    return {
      subject: `${store()} alert: ${title}`,
      text: `${title}\n\n${lines.join('\n')}`,
      html: layout(title, `<ul style="padding-left:18px;font-size:14px">${lines.map((l) => `<li style="margin:4px 0">${escapeHtml(l)}</li>`).join('')}</ul>`, {
        label: 'Open admin',
        url: `${siteConfig.url}/admin`,
      }),
    };
  }

  if (!order) return null;
  const url = trackingUrl(order);
  const n = order.order_number;
  const total = formatGhsPlain(order.total_pesewas);

  switch (template) {
    case 'order_confirm_request': {
      const text = `${store()}: We received order ${n} (${total}). Our team will call to confirm it before dispatch. Details: ${url}`;
      if (channel === 'sms') return { text };
      return {
        subject: `${store()}: we received order ${n}`,
        text: `${text}\n\n${itemsText(items)}`,
        html: layout(
          `We received your order ${n}`,
          `<p>Thank you for your order. Because you chose pay on delivery, our team will call or message you shortly to confirm it before we dispatch.</p>${itemsTable(items, order)}<p style="font-size:14px;color:#52525b">Delivery to: ${escapeHtml(order.fulfillment === 'pickup' ? 'Store pickup' : formatAddress(order.shipping_address))}</p>`,
          { label: 'View your order', url },
        ),
      };
    }
    case 'order_paid': {
      const text = `${store()}: Payment received for order ${n} (${total}). Thank you! Track it: ${url}`;
      if (channel === 'sms') return { text };
      return {
        subject: `${store()}: payment received for order ${n}`,
        text: `${text}\n\n${itemsText(items)}`,
        html: layout(
          `Payment received for order ${n}`,
          `<p>Thank you. We have received your payment and are preparing your order.</p>${itemsTable(items, order)}<p style="font-size:14px;color:#52525b">${order.fulfillment === 'pickup' ? 'We will tell you when it is ready for pickup.' : `Delivery to: ${escapeHtml(formatAddress(order.shipping_address))}`}</p>`,
          { label: 'Track your order', url },
        ),
      };
    }
    case 'order_shipped': {
      const rider = fulfillment?.rider_name
        ? ` Rider: ${fulfillment.rider_name}${fulfillment.rider_phone ? ` ${displayPhone(fulfillment.rider_phone)}` : ''}.`
        : fulfillment?.carrier_name
          ? ` Carrier: ${fulfillment.carrier_name}${fulfillment.tracking_ref ? ` (${fulfillment.tracking_ref})` : ''}.`
          : '';
      const text = `${store()}: Order ${n} is on its way.${rider} Track: ${url}`;
      if (channel === 'sms') return { text };
      return {
        subject: `${store()}: order ${n} is on its way`,
        text,
        html: layout(`Order ${n} is on its way`, `<p>Your order has been dispatched.${escapeHtml(rider)}</p>`, { label: 'Track your order', url }),
      };
    }
    case 'order_delivered': {
      const text = `${store()}: Order ${n} was delivered. Thank you for shopping with us! Problem with an item? ${url}`;
      if (channel === 'sms') return { text };
      return {
        subject: `${store()}: order ${n} delivered`,
        text,
        html: layout(`Order ${n} was delivered`, `<p>Thank you for shopping with us. If anything is wrong with your items you can request a return from your order page.</p>`, { label: 'View your order', url }),
      };
    }
    case 'order_cancelled': {
      const refundNote = order.payment_status === 'paid' ? ' A refund will follow.' : '';
      const text = `${store()}: Order ${n} was cancelled.${refundNote} Questions? ${displayPhone(siteConfig.supportPhone) || url}`;
      if (channel === 'sms') return { text };
      return {
        subject: `${store()}: order ${n} cancelled`,
        text,
        html: layout(`Order ${n} was cancelled`, `<p>Your order has been cancelled.${escapeHtml(refundNote)} If you did not expect this, please contact us.</p>`, { label: 'View your order', url }),
      };
    }
    case 'refund_processed': {
      const amount = formatGhsPlain(Number(payload.amount_pesewas ?? 0));
      const text = `${store()}: We refunded ${amount} for order ${n}. It can take a few days to show in your account.`;
      if (channel === 'sms') return { text };
      return {
        subject: `${store()}: refund for order ${n}`,
        text,
        html: layout(`Refund issued for order ${n}`, `<p>We refunded <strong>${escapeHtml(amount)}</strong>. Depending on your bank or mobile money provider it can take a few days to appear.</p>`, { label: 'View your order', url }),
      };
    }
    case 'return_update': {
      if (channel !== 'email') return null;
      const what = RETURN_TEXT[String(payload.status)] ?? 'was updated.';
      return {
        subject: `${store()}: return for order ${n}`,
        text: `Your return request for order ${n} ${what}`,
        html: layout(`Return update for order ${n}`, `<p>Your return request ${escapeHtml(what)}</p>`, { label: 'View your order', url }),
      };
    }
    case 'admin_big_sale': {
      const text = `Big sale: ${n} ${total} (${items.reduce((s, i) => s + i.quantity, 0)} items) from ${order.contact_phone}`;
      if (channel === 'sms') return { text };
      return {
        subject: `Big sale ${total}: order ${n}`,
        text: `${text}\n\n${itemsText(items)}`,
        html: layout(`Big sale: ${total}`, `<p>Order <strong>${escapeHtml(n)}</strong> was just paid.</p>${itemsTable(items, order)}<p style="font-size:14px">Customer: ${escapeHtml(order.contact_phone)}${order.contact_email ? ` / ${escapeHtml(order.contact_email)}` : ''}</p>`, {
          label: 'Open in admin',
          url: `${siteConfig.url}/admin/orders/${order.id}`,
        }),
      };
    }
    default:
      return null;
  }
}
