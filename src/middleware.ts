import { defineMiddleware } from 'astro:middleware';
import { hasSession, verifyBearer, getSessionSecret } from '@/lib/auth';
import { ensureSyncLoop } from '@/features/tasks/ops/sync-loop';

const PUBLIC = [
  '/login',
  '/api/auth/totp',
  '/api/auth/passkey/challenge',
  '/api/auth/passkey/verify',
  // Authenticated by HMAC signature, not session — see the route
  '/api/webhooks/todoist',
];

export const onRequest = defineMiddleware(async (context, next) => {
  // Lazy-start the background Todoist sync loop (no-op if unconfigured/running)
  ensureSyncLoop();

  const { pathname } = context.url;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return next();

  // A valid session cookie (browser) OR bearer token (the grocery extension and
  // the walmart CLI, which can't carry the httpOnly/SameSite cookie cross-site)
  // is authenticated. Routes still run their own requireSession/…OrToken guard.
  if (hasSession(context.cookies)) return next();
  if (verifyBearer(context.request.headers.get('authorization'), getSessionSecret())) return next();

  return context.redirect('/login');
});
