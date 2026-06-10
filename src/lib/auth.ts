import { createHmac } from 'crypto';

/** The session cookie's name — owned here; no caller should hardcode it. */
export const SESSION_COOKIE = 'lifeos_session';

/**
 * Resolve the session secret. process.env ONLY — never import.meta.env, which
 * `astro build` inlines into dist/ and would bake a real secret into the build
 * (NIM-7). The container provides it at runtime via env_file; the test server
 * sets process.env.SESSION_SECRET to match the cookie it mints.
 */
export function getSessionSecret(): string {
  return process.env.SESSION_SECRET ?? '';
}

export function makeSessionToken(secret: string): string {
  return createHmac('sha256', secret).update('lifeos-session-v2').digest('hex');
}

export function verifySession(cookie: string | undefined, secret: string): boolean {
  if (!cookie) return false;
  return cookie === makeSessionToken(secret);
}

/** The only cookie-jar surface requireSession needs — satisfied by AstroCookies. */
interface CookieJar {
  get(name: string): { value: string } | undefined;
}

/**
 * Route guard: returns null when the request carries a valid session,
 * otherwise a ready-to-return 401 Response. Owns the cookie name and the
 * secret lookup so API routes never touch either.
 *
 *   const denied = requireSession(cookies);
 *   if (denied) return denied;
 */
export function requireSession(cookies: CookieJar): Response | null {
  const cookie = cookies.get(SESSION_COOKIE)?.value;
  if (verifySession(cookie, getSessionSecret())) return null;
  return new Response('Unauthorized', { status: 401 });
}

/** True when the request carries a valid session — for pages that redirect instead of 401. */
export function hasSession(cookies: CookieJar): boolean {
  return verifySession(cookies.get(SESSION_COOKIE)?.value, getSessionSecret());
}

/** Bearer token == the session token. Lets non-browser clients (the grocery
 *  browser extension, which can't send the httpOnly/SameSite-lax cookie
 *  cross-site) authenticate with `Authorization: Bearer <token>`. */
export function verifyBearer(authHeader: string | null, secret: string): boolean {
  if (!authHeader || !secret) return false;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return !!m && m[1].trim() === makeSessionToken(secret);
}

/**
 * Route guard accepting EITHER a valid session cookie OR a bearer token equal
 * to the session token. For ingest endpoints the extension posts to.
 */
export function requireSessionOrToken(cookies: CookieJar, request: Request): Response | null {
  const secret = getSessionSecret();
  if (verifySession(cookies.get(SESSION_COOKIE)?.value, secret)) return null;
  if (verifyBearer(request.headers.get('authorization'), secret)) return null;
  return new Response('Unauthorized', { status: 401 });
}

export function setSession(cookies: { set: Function }, secret: string) {
  cookies.set(SESSION_COOKIE, makeSessionToken(secret), {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });
}
