/**
 * The database raises short error codes ("insufficient_stock:SKU", "invalid_coupon", ...).
 * This turns them into messages a customer or staff member can act on.
 */
const MESSAGES: Record<string, string> = {
  empty_cart: 'Your cart is empty.',
  cart_not_found: 'We could not find your cart. Please add your items again.',
  unavailable_item: 'One of the items in your cart is no longer available. Please review your cart.',
  insufficient_stock: 'One of your items just sold out or has less stock than you asked for. Please review your cart.',
  no_delivery_zone: 'We do not deliver to that region yet.',
  no_pickup_location: 'That pickup location is not available.',
  invalid_coupon: 'That coupon code is not valid for this order.',
  coupon_already_used: 'You have already used that coupon.',
  cod_amount_too_high: 'This order is too large for pay on delivery. Please pay online.',
  cod_region_not_allowed: 'Pay on delivery is not available in your region. Please pay online.',
  invalid_payment_method: 'Choose a payment method.',
  order_not_payable: 'This order can no longer be paid. Please place a new order.',
  reservation_expired: 'Your stock hold expired. Please place the order again.',
  not_your_order: 'That order does not belong to this account.',
  order_not_delivered: 'Returns can only be requested once an order has been delivered.',
  return_window_closed: 'The return window for this order has closed.',
  no_items: 'Choose at least one item to return.',
  item_not_in_order: 'One of the selected items is not part of this order.',
  invalid_quantity: 'Enter a valid quantity.',
  return_quantity_too_high: 'You are returning more units than you bought.',
  stock_adjustment_not_allowed: 'Stock cannot go below the amount already reserved for unpaid orders.',
  negative_stock: 'Stock cannot be negative.',
  order_needs_review: 'This order is flagged for review. Clear the flag (with a note) before shipping it.',
  order_not_found: 'Order not found.',
  return_not_found: 'Return not found.',
  refund_not_found: 'Refund not found.',
  payment_not_refundable: 'This payment cannot be refunded.',
  refund_exceeds_payment: 'The refund is larger than what is left on the payment.',
  invalid_transition: 'That status change is not allowed for this order.',
  invalid_return_transition: 'That status change is not allowed for this return.',
};

export function dbErrorCode(message: string): string {
  return message.split(':')[0]?.trim() ?? '';
}

export function friendlyDbError(message: string | undefined | null, fallback = 'Something went wrong. Please try again.'): string {
  if (!message) return fallback;
  return MESSAGES[dbErrorCode(message)] ?? fallback;
}

/** True when the message is one of our known business-rule codes (as opposed to an infrastructure fault). */
export function isKnownDbError(message: string | undefined | null): boolean {
  return !!message && dbErrorCode(message) in MESSAGES;
}

/** The part after the first colon, e.g. the SKU in "insufficient_stock:TEE-BLK-M". */
export function dbErrorDetail(message: string): string {
  const i = message.indexOf(':');
  return i === -1 ? '' : message.slice(i + 1).trim();
}
