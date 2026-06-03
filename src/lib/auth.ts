import { createHmac } from 'crypto';

export function makeSessionToken(secret: string): string {
  return createHmac('sha256', secret).update('lifeos-session-v2').digest('hex');
}

export function verifySession(cookie: string | undefined, secret: string): boolean {
  if (!cookie) return false;
  return cookie === makeSessionToken(secret);
}

export function setSession(cookies: { set: Function }, secret: string) {
  cookies.set('lifeos_session', makeSessionToken(secret), {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });
}
