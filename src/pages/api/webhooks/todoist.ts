import { createHmac, timingSafeEqual } from 'crypto';
import type { APIRoute } from 'astro';
import { syncNow } from '@/lib/tasks/sync-loop';

/**
 * POST /api/webhooks/todoist — Todoist webhook receiver (the push half of
 * hybrid sync). Currently dormant: polling covers everything until this is
 * activated. To enable true real-time push later:
 *
 *   1. Expose LifeOS publicly over HTTPS (e.g. Cloudflare Tunnel → Traefik).
 *   2. Create an app at https://developer.todoist.com/appconsole.html,
 *      set the webhook callback URL to https://<public-host>/api/webhooks/todoist
 *      and subscribe to item:* events. Complete the OAuth flow once to
 *      activate deliveries (Todoist requires it even for personal use).
 *   3. Put the app's client secret in .env as TODOIST_WEBHOOK_SECRET.
 *
 * This route is in the middleware PUBLIC list (Todoist can't log in) and is
 * instead authenticated by the HMAC signature Todoist sends with every
 * delivery. Without TODOIST_WEBHOOK_SECRET set it answers 501 and does nothing.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret =
    (import.meta as any).env?.TODOIST_WEBHOOK_SECRET ?? process.env.TODOIST_WEBHOOK_SECRET ?? '';
  if (!secret.trim()) return new Response('Webhook not configured', { status: 501 });

  const raw = await request.text();
  const signature = request.headers.get('X-Todoist-Hmac-SHA256') ?? '';
  const expected = createHmac('sha256', secret.trim()).update(raw).digest('base64');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return new Response('Invalid signature', { status: 401 });
  }

  // The event payload itself is untrusted input — don't apply it directly.
  // It's only a doorbell: pull the truth through the normal sync path.
  void syncNow();
  return new Response('ok', { status: 200 });
};
