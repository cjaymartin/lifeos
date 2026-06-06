// Typed client for the Grocery stack — the only place that knows the grocery
// API routes' URLs and payload shapes. Components call named operations.
import { apiCall } from '@/lib/client/stack-client';
import type { GroceryState, GroceryItem, Retailer } from '@/lib/grocery-types';

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

  /* checkout */
  checkout: (body: { retailer?: Retailer; itemIds?: string[] }) =>
    apiCall('/api/grocery/checkout', { method: 'POST', body }),

  /* agent jobs */
  buildCarts: (itemIds?: string[]) =>
    apiCall<{ instant?: number; queued?: number }>('/api/grocery/build-carts', {
      method: 'POST',
      body: itemIds?.length ? { itemIds } : undefined,
    }) as Promise<{ instant?: number; queued?: number }>,
  triggerJob: (kind: 'build-carts' | 'purchase-scan') =>
    apiCall(`/api/grocery/${kind}`, { method: 'POST' }),
};
