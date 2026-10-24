import { siteConfig } from '@/config/site';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: siteConfig.timeZone,
});
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: siteConfig.timeZone,
});

export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return '';
  return dateFmt.format(new Date(v));
}

export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return '';
  return dateTimeFmt.format(new Date(v));
}

export function timeAgo(v: string | Date): string {
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Awaiting payment',
  awaiting_confirmation: 'Awaiting confirmation',
  paid: 'Paid',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  unpaid: 'Unpaid',
  paid: 'Paid',
  failed: 'Failed',
  partially_refunded: 'Partly refunded',
  refunded: 'Refunded',
};

export const RETURN_STATUS_LABEL: Record<string, string> = {
  requested: 'Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  received: 'Received',
  refunded: 'Refunded',
  closed: 'Closed',
};

export const RISK_FLAG_LABEL: Record<string, string> = {
  velocity_phone: 'Many orders from one phone',
  high_value: 'High-value order',
  phone_mismatch: 'Delivery phone differs from contact phone',
  cod_repeat_cancel: 'Phone has cancelled pay-on-delivery orders before',
  amount_mismatch: 'Paid amount did not match the order',
  paid_after_cancel: 'Payment arrived after the order was cancelled',
  duplicate_payment: 'Paid twice: refund one payment',
  paid_unexpected_state: 'Payment arrived in an unexpected state',
  refund_due: 'Refund due',
};

export function formatAddress(a: any): string {
  if (!a) return '';
  return [a.street_landmark, a.town, a.region, a.digital_address].filter(Boolean).join(', ');
}
