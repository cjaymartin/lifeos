// Browser client for per-stack chat persistence (NIM-10). Thin typed wrapper
// over apiCall so the ChatSidebar never constructs URLs or worries about CSRF.
import { apiCall } from './stack-client';
import type { ChatMessage } from '@/lib/chat-history';

export const chatHistory = {
  load: (stackId: string) =>
    apiCall<{ messages: ChatMessage[] }>(`/api/chat/history?stackId=${encodeURIComponent(stackId)}`)
      .then((r) => r?.messages ?? []),

  save: (stackId: string, messages: ChatMessage[]) =>
    apiCall('/api/chat/history', { method: 'PUT', body: { stackId, messages } }),

  clear: (stackId: string) =>
    apiCall(`/api/chat/history?stackId=${encodeURIComponent(stackId)}`, { method: 'DELETE' }),
};
