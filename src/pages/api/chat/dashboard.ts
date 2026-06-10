import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { runDashboardChat } from '@/lib/chat/dashboard-agent';

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

/**
 * POST /api/chat/dashboard — the cross-feature dashboard assistant. Same request
 * and response contract as /api/chat (ChatSidebar talks to both); the difference
 * is server-side hand-off across every feature (see lib/chat/dashboard-agent.ts).
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let body: { message?: string; history?: { role: string; content: string }[]; approved?: boolean };
  try { body = await request.json(); } catch {
    return new Response('Bad request', { status: 400 });
  }

  const { message, history = [], approved = false } = body;
  if (!message) return new Response('Missing message', { status: 400 });

  try {
    return json(await runDashboardChat({ message, history, approved }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return json({ reply: `Sorry, I couldn't process that. (${msg})` });
  }
};
