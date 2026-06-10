import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { loadChatHistory, saveChatHistory, clearChatHistory, isChatMessage } from '@/lib/chat-history';
import type { ChatMessage } from '@/lib/chat-history';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// A stackId only ever names a content subfolder — letters, digits, dash, underscore.
// Anything else (slashes, dots) could escape src/content/ and is refused.
const VALID_STACK = /^[a-z0-9_-]+$/i;
const badStack = (id: unknown): id is string => typeof id !== 'string' || !VALID_STACK.test(id);

/** GET /api/chat/history?stackId=<id> — restore a stack's saved conversation. */
export const GET: APIRoute = async ({ cookies, url }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const stackId = url.searchParams.get('stackId');
  if (badStack(stackId)) return new Response('Bad request', { status: 400 });

  return json({ messages: await loadChatHistory(stackId) });
};

/** PUT /api/chat/history — persist a stack's conversation. Body: { stackId, messages }. */
export const PUT: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let body: { stackId?: string; messages?: unknown };
  try { body = await request.json(); } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (badStack(body.stackId)) return new Response('Bad request', { status: 400 });
  if (!Array.isArray(body.messages) || !body.messages.every(isChatMessage))
    return new Response('Bad request', { status: 400 });

  await saveChatHistory(body.stackId, body.messages as ChatMessage[]);
  return json({ ok: true });
};

/** DELETE /api/chat/history?stackId=<id> — clear a stack's conversation. */
export const DELETE: APIRoute = async ({ cookies, url }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const stackId = url.searchParams.get('stackId');
  if (badStack(stackId)) return new Response('Bad request', { status: 400 });

  await clearChatHistory(stackId);
  return json({ ok: true });
};
