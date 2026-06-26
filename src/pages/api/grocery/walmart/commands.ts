import type { APIRoute } from 'astro';
import { requireSessionOrToken } from '@/lib/auth';
import { claimPending } from '@/features/grocery/walmart-queue';

/** How long the poll holds open waiting for a command before returning empty.
 *  Kept under the front door's wait budget so an in-flight command still lands.
 *  Each claim attempt refreshes the extension's presence timestamp. */
const LONGPOLL_MS = 20_000;
const POLL_MS = 600;

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET /api/grocery/walmart/commands — the browser extension long-polls this
 *  with its bearer token. Returns (and claims) any pending commands; if none
 *  arrive within the window, returns an empty list so the extension re-polls.
 *  Polling here is what marks the extension "present" to the front door. */
export const GET: APIRoute = async ({ cookies, request }) => {
  const denied = requireSessionOrToken(cookies, request);
  if (denied) return denied;

  const deadline = Date.now() + LONGPOLL_MS;
  for (;;) {
    // Client gone (extension worker killed / poll aborted) — stop before
    // claiming into a dead connection; the command stays pending for the
    // next poll. Claimed-but-undelivered commands are reclaimed after a window.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const commands = await claimPending();
    if (commands.length) return json({ commands });
    if (Date.now() >= deadline) return json({ commands: [] });
    await sleep(POLL_MS);
  }
};
