/** Row shapes used across the app. They mirror the database tables in supabase/migrations. */

export type OrderStatus =
  | 'pending_payment'
  | 'awaiting_confirmation'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';
export type PaymentStatus = 'unpaid' | 'paid' | 'failed' | 'partially_refunded' | 'refunded';
export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'received' | 'refunded' | 'closed';
export type StaffRole = 'owner' | 'manager' | 'support' | 'fulfillment';

export interface ShippingAddress {
  recipient_name: string;
  phone: string;
  region: string;
  town: string;
  street_landmark: string;
  digital_address?: string | null;
}

export interface OrderRow {
  id: string;
  order_number: string;
  public_token: string;
  user_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  payment_method: 'paystack' | 'pay_on_delivery';
  fulfillment: 'delivery' | 'pickup';
  shipping_address: ShippingAddress | null;
  delivery_zone_id: string | null;
  pickup_location_id: string | null;
  subtotal_pesewas: number;
  discount_pesewas: number;
  shipping_pesewas: number;
  tax_pesewas: number;
  tax_inclusive: boolean;
  total_pesewas: number;
  currency: string;
  coupon_code: string | null;
  customer_note: string | null;
  reserved_until: string | null;
  needs_review: boolean;
  risk_flags: string[];
  placed_at: string;
  paid_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  variant_id: string | null;
  sku: string;
  product_name: string;
  variant_name: string | null;
  image_path: string | null;
  unit_price_pesewas: number;
  cost_pesewas: number | null;
  quantity: number;
  line_total_pesewas: number;
}

export interface PaymentRow {
  id: string;
  order_id: string;
  reference: string;
  provider_txn_id: string | null;
  amount_pesewas: number;
  currency: string;
  status: 'initialized' | 'success' | 'failed' | 'abandoned' | 'reversed';
  channel: string | null;
  gateway_response: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface RefundRow {
  id: string;
  order_id: string;
  payment_id: string;
  return_id: string | null;
  amount_pesewas: number;
  reason: string | null;
  status: 'pending' | 'processed' | 'failed';
  provider_refund_id: string | null;
  created_at: string;
}

export interface FulfillmentRow {
  id: string;
  order_id: string;
  status: 'pending' | 'packed' | 'dispatched' | 'delivered' | 'failed' | 'returned';
  carrier_name: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  tracking_ref: string | null;
  failure_reason: string | null;
  packed_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
}

export interface StatusHistoryRow {
  id: number;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_type: 'system' | 'customer' | 'staff';
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export interface ReturnRow {
  id: string;
  order_id: string;
  status: ReturnStatus;
  reason: string;
  resolution: 'refund' | 'exchange';
  customer_note: string | null;
  photo_paths: string[];
  staff_note: string | null;
  requested_at: string;
  resolved_at: string | null;
}

export interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
}

export interface StorefrontProduct {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  category_id: string | null;
  featured: boolean;
  created_at: string;
  min_price_pesewas: number;
  max_price_pesewas: number;
  min_compare_pesewas: number | null;
  in_stock: boolean;
  image_path: string | null;
  image_alt: string | null;
}

export interface ProductVariant {
  id: string;
  sku: string;
  name: string | null;
  option_values: Record<string, string>;
  price_pesewas: number;
  compare_at_pesewas: number | null;
  is_active: boolean;
  in_stock: boolean;
  low_stock: boolean;
}

export interface ProductImage {
  id: string;
  storage_path: string;
  alt_text: string | null;
  sort_order: number;
  variant_id: string | null;
}

export interface ProductDetail {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  description: string | null;
  size_guide: string | null;
  option_names: string[];
  seo_title: string | null;
  seo_description: string | null;
  category: { id: string; name: string; slug: string } | null;
  variants: ProductVariant[];
  images: ProductImage[];
}

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
}
