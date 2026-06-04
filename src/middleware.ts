import { defineMiddleware } from 'astro:middleware';
import { verifySession } from '@/lib/auth';
import { ensureSyncLoop } from '@/lib/tasks/sync-loop';

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

  const secret = import.meta.env.SESSION_SECRET ?? '';
  const cookie = context.cookies.get('lifeos_session')?.value;

  if (!verifySession(cookie, secret)) {
    return context.redirect('/login');
  }

  return next();
});
