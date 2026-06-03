import { defineMiddleware } from 'astro:middleware';
import { verifySession } from '@/lib/auth';

const PUBLIC = ['/login', '/api/auth/totp', '/api/auth/passkey/challenge', '/api/auth/passkey/verify'];

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return next();

  const secret = import.meta.env.SESSION_SECRET ?? '';
  const cookie = context.cookies.get('lifeos_session')?.value;

  if (!verifySession(cookie, secret)) {
    return context.redirect('/login');
  }

  return next();
});
