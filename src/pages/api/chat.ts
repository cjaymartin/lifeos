import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { runStackChat } from '@/lib/chat/stack-agent';

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let body: {
    message?: string; stackId?: string; stackLabel?: string;
    currentPath?: string; pageTitle?: string;
    history?: { role: string; content: string }[];
    approved?: boolean;
  };
  try { body = await request.json(); } catch {
    return new Response('Bad request', { status: 400 });
  }

  const { message, stackId, stackLabel, currentPath, pageTitle, history = [], approved = false } = body;
  if (!message) return new Response('Missing message', { status: 400 });
  if (!stackId)  return new Response('Missing stackId', { status: 400 });
  if (!stackLabel) return new Response('Missing stackLabel', { status: 400 });

  try {
    // The client echoes the current message as the last history entry too — drop it.
    const result = await runStackChat({
      stackId, stackLabel, message, currentPath, pageTitle, approved,
      history: history.slice(0, -1),
    });

    if (!approved && result.proposal) {
      return json({ type: 'proposal', reply: result.reply, rawReply: result.rawReply, proposal: result.proposal });
    }
    return json({ reply: result.reply });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return json({ reply: `Sorry, I couldn't process that. (${msg})` });
  }
};
