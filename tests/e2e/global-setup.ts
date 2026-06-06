// Mints a real session cookie through the auth module's own interface —
// no auth bypass exists in production code. The token is the same HMAC the
// login routes set, computed from the SESSION_SECRET the build was made with.
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeSessionToken } from '../../src/lib/auth';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');

export default function globalSetup() {
  let secret = process.env.SESSION_SECRET ?? '';
  if (!secret) {
    try {
      const env = readFileSync(join(repo, '.env'), 'utf-8');
      secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1]?.trim() ?? '';
    } catch {}
  }
  if (!secret) throw new Error('global-setup: no SESSION_SECRET in env or .env');

  const state = {
    cookies: [
      {
        name: 'lifeos_session',
        value: makeSessionToken(secret),
        domain: '127.0.0.1',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };

  const authDir = join(repo, 'tests/e2e/.auth');
  mkdirSync(authDir, { recursive: true });
  writeFileSync(join(authDir, 'state.json'), JSON.stringify(state, null, 2));
}
