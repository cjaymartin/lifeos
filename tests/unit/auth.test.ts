import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeSessionToken,
  verifySession,
  requireSession,
  SESSION_COOKIE,
} from '@/lib/auth';

const SECRET = 'unit-test-secret';

/** Minimal stand-in for AstroCookies — the only part of the interface requireSession may know. */
function fakeCookies(value?: string) {
  return {
    get: (name: string) =>
      name === SESSION_COOKIE && value !== undefined ? { value } : undefined,
  };
}

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

describe('makeSessionToken / verifySession', () => {
  it('round-trips a token made with the same secret', () => {
    expect(verifySession(makeSessionToken(SECRET), SECRET)).toBe(true);
  });

  it('rejects a token made with a different secret', () => {
    expect(verifySession(makeSessionToken('other'), SECRET)).toBe(false);
  });

  it('rejects a missing cookie', () => {
    expect(verifySession(undefined, SECRET)).toBe(false);
  });
});

describe('requireSession', () => {
  it('returns null (allow) for a valid session cookie', () => {
    const denied = requireSession(fakeCookies(makeSessionToken(SECRET)));
    expect(denied).toBeNull();
  });

  it('returns a 401 Response when the cookie is missing', () => {
    const denied = requireSession(fakeCookies());
    expect(denied).toBeInstanceOf(Response);
    expect(denied!.status).toBe(401);
  });

  it('returns a 401 Response when the cookie is wrong', () => {
    const denied = requireSession(fakeCookies('forged-token'));
    expect(denied!.status).toBe(401);
  });

  it('exposes the cookie name so no caller hardcodes the string', () => {
    expect(SESSION_COOKIE).toBe('lifeos_session');
  });
});
