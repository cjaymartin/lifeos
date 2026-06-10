import { describe, it, expect, beforeEach } from 'vitest';
import { makeSessionToken, verifyBearer, requireSessionOrToken } from '@/lib/auth';

const SECRET = 'test-secret-xyz';
const noCookies = { get: () => undefined };

beforeEach(() => { process.env.SESSION_SECRET = SECRET; });

describe('verifyBearer', () => {
  it('accepts a bearer token equal to the session token', () => {
    const token = makeSessionToken(SECRET);
    expect(verifyBearer(`Bearer ${token}`, SECRET)).toBe(true);
  });
  it('rejects a wrong/missing token', () => {
    expect(verifyBearer('Bearer nope', SECRET)).toBe(false);
    expect(verifyBearer(null, SECRET)).toBe(false);
    expect(verifyBearer('', SECRET)).toBe(false);
  });
});

describe('requireSessionOrToken', () => {
  it('passes with a valid bearer token and no cookie', () => {
    const token = makeSessionToken(SECRET);
    const req = new Request('http://x/api', { headers: { authorization: `Bearer ${token}` } });
    expect(requireSessionOrToken(noCookies, req)).toBeNull();
  });
  it('401s with neither cookie nor token', () => {
    const res = requireSessionOrToken(noCookies, new Request('http://x/api'));
    expect(res?.status).toBe(401);
  });
});
