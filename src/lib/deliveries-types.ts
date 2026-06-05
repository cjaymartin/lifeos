// Browser-safe types and constants for the Deliveries stack.
// Server-only helpers (file paths, loaders) live in src/lib/deliveries.ts.

export type DeliveryStatus = 'ordered' | 'shipped' | 'out-for-delivery' | 'delivered';
export type DeliveryCategory = 'package' | 'food' | 'pharmacy';

export interface Delivery {
  /** Stable id — tracking number, order id, or vendor+item slug */
  id: string;
  vendor: string;
  item: string;
  category: DeliveryCategory;
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  status: DeliveryStatus;
  /** Expected arrival, YYYY-MM-DD (may be absent if unknown) */
  eta?: string;
  /** Human window like "by 9 PM" or "8 AM – 12 PM" */
  etaWindow?: string;
  /** Set when status is delivered, YYYY-MM-DD */
  deliveredAt?: string;
  emailThreadId?: string;
  emailUrl?: string;
}

export interface DeliveriesData {
  /** ISO timestamp of the last successful Gmail sync */
  lastSynced: string;
  deliveries: Delivery[];
  /** Dismissed deliveries still present in deliveries.json — restorable from the UI */
  dismissed?: Delivery[];
}

export const STATUS_ORDER: DeliveryStatus[] = ['out-for-delivery', 'shipped', 'ordered', 'delivered'];

export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  'out-for-delivery': 'Out for delivery',
  shipped: 'Shipped',
  ordered: 'Ordered',
  delivered: 'Delivered',
};
