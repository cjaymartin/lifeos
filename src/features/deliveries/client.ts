// Typed client for the Deliveries stack — the only place that knows the
// deliveries API routes' URLs and payload shapes.
import { apiCall } from '@/lib/client/stack-client';

export const deliveriesClient = {
  dismiss: (id: string) => apiCall('/api/deliveries/dismiss', { method: 'POST', body: { id } }),
  restore: (id: string) => apiCall('/api/deliveries/restore', { method: 'POST', body: { id } }),
};
