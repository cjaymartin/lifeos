// Typed client for the Grocery stack — the only place that knows the grocery
// API routes' URLs and payload shapes. Components call named operations.
import { apiCall } from '@/lib/client/stack-client';
import type { GroceryState, GroceryItem, Retailer, WalmartOpResult } from '@/features/grocery/types';

/** On-demand Walmart cart ops (ADR 0001) — routed through the extension when
 *  present, the local session otherwise. Each call hits the single front door. */
const walmartOp = (op: string, body: Record<string, unknown> = {}) =>
  apiCall<WalmartOpResult>('/api/grocery/walmart/command', { method: 'POST', body: { op, ...body } }) as Promise<WalmartOpResult>;

export const groceryClient = {
  state: () => apiCall<GroceryState>('/api/grocery') as Promise<GroceryState>,

  /* items */
  addItem: (name: string) =>
    apiCall<{ added: GroceryItem[]; categorizing: boolean }>('/api/grocery', {
      method: 'POST',
      body: { name },
    }) as Promise<{ added: GroceryItem[]; categorizing: boolean }>,
  patchItem: (id: string, patch: Record<string, unknown>) =>
    apiCall(`/api/grocery/items/${id}`, { method: 'PATCH', body: patch }),
  deleteItem: (id: string) => apiCall(`/api/grocery/items/${id}`, { method: 'DELETE' }),

  /* staples */
  addStaple: (name: string) => apiCall('/api/grocery/staples', { method: 'POST', body: { name } }),
  patchStaple: (id: string, patch: Record<string, unknown>) =>
    apiCall('/api/grocery/staples', { method: 'PATCH', body: { id, ...patch } }),
  deleteStaple: (id: string) => apiCall('/api/grocery/staples', { method: 'DELETE', body: { id } }),

  /* product pins */
  pinProduct: (name: string, url: string) =>
    apiCall('/api/grocery/product-map', { method: 'POST', body: { name, url } }),
  /** One-click pin of an exact product (from a built cart line). */
  pinProductById: (name: string, ref: { retailer: Retailer; productId: string; product?: string; productUrl?: string }) =>
    apiCall('/api/grocery/product-map', { method: 'POST', body: { name, ...ref } }),
  clearPin: (name: string) => apiCall('/api/grocery/product-map', { method: 'DELETE', body: { name } }),

  /* carts */
  removeCartItem: (retailer: Retailer, itemId: string) =>
    apiCall('/api/grocery/carts', { method: 'PATCH', body: { retailer, itemId } }),
  dismissCart: (retailer: Retailer) =>
    apiCall('/api/grocery/carts', { method: 'DELETE', body: { retailer } }),
  setCartAdded: (retailer: Retailer, added: boolean) =>
    apiCall('/api/grocery/carts', {
      method: 'POST',
      body: { retailer, action: added ? 'mark-added' : 'reset-added' },
    }),
  /** Per-line reconciliation: the itemIds that actually landed in the retailer
   *  cart (the rest are reset to pending). */
  reconcileCart: (retailer: Retailer, addedItemIds: string[]) =>
    apiCall<{ ok: boolean; inCart: number }>('/api/grocery/carts', {
      method: 'POST',
      body: { retailer, addedItemIds },
    }),
  /** Ingest the real retailer cart observed in the user's own session
   *  (bookmarklet/extension) → reconcile per line. */
  observeCart: (retailer: Retailer, items: { productId: string; qty?: number; product?: string; price?: string }[]) =>
    apiCall<{ ok: boolean; inCart: number; unknown: string[] }>('/api/grocery/carts/observed', {
      method: 'POST',
      body: { retailer, items },
    }),

  /* out-of-stock substitution */
  acceptSubstitute: (retailer: Retailer, itemId: string, productId: string) =>
    apiCall('/api/grocery/substitute', { method: 'POST', body: { retailer, itemId, productId } }),
  /** Replace a cart line's product from a pasted product URL ("wrong product?"). */
  changeCartProduct: (retailer: Retailer, itemId: string, url: string) =>
    apiCall('/api/grocery/carts/change', { method: 'POST', body: { retailer, itemId, url } }),

  /* checkout */
  checkout: (body: { retailer?: Retailer; itemIds?: string[] }) =>
    apiCall('/api/grocery/checkout', { method: 'POST', body }),

  /* on-demand Walmart cart control */
  walmart: {
    getCart: () => walmartOp('get-cart'),
    getHistory: () => walmartOp('get-history'),
    getDeliveries: () => walmartOp('get-deliveries'),
    addItem: (productId: string, qty?: number) => walmartOp('add-item', { productId, qty }),
    /** Add many products in one navigation (one affiliate deep link). */
    addItems: (items: { productId: string; qty?: number }[]) => walmartOp('add-item', { items }),
    removeItem: (productId: string) => walmartOp('remove-item', { productId }),
    /** Capture a live-cart product onto the grocery list as already-in-cart,
     *  optionally as a staple. Not a channel op — a plain grocery mutation. */
    adopt: (
      line: { productId: string; product?: string; productUrl?: string; price?: string; qty?: number },
      asStaple = false,
    ) =>
      apiCall<{ ok: boolean; itemId: string }>('/api/grocery/walmart/adopt', {
        method: 'POST',
        body: { ...line, asStaple },
      }) as Promise<{ ok: boolean; itemId: string }>,
  },

  /* agent jobs */
  buildCarts: (itemIds?: string[]) =>
    apiCall<{ instant?: number; queued?: number }>('/api/grocery/build-carts', {
      method: 'POST',
      body: itemIds?.length ? { itemIds } : undefined,
    }) as Promise<{ instant?: number; queued?: number }>,
  triggerJob: (kind: 'build-carts' | 'purchase-scan') =>
    apiCall(`/api/grocery/${kind}`, { method: 'POST' }),
};
