import type { APIRoute } from 'astro';
import { requireSessionOrToken, getSessionSecret, makeSessionToken } from '@/lib/auth';

/** GET /api/grocery/ingest-token — returns the bearer token (== the session
 *  token) for the grocery browser extension. Accepts the session cookie (so a
 *  logged-in user can read it in a tab the first time) OR the bearer token
 *  itself (so the extension can re-validate connectivity). It grants no more
 *  than the session the caller already holds. */
export const GET: APIRoute = async ({ cookies, request }) => {
  const denied = requireSessionOrToken(cookies, request);
  if (denied) return denied;
  const token = makeSessionToken(getSessionSecret());
  return new Response(JSON.stringify({ token }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
