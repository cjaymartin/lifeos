// Playwright test server — runs the built LifeOS server against a sandboxed
// copy of src/content so e2e tests can mutate data freely without touching
// the real working tree.
//
// How it works: every content path in the app is process.cwd()-relative
// ('src/content/...'), while the built server resolves its own assets
// module-relative. So chdir into a sandbox containing only a copy of
// src/content and the server reads/writes the copy.
//
// Env is scrubbed so no real provider (Todoist, encrypted secrets) is ever
// reachable from tests — the sync loop no-ops without a token.

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

// SESSION_SECRET must match the one baked into the build (.env at build time)
// so the storage-state cookie minted by tests/e2e/global-setup.ts verifies.
let secret = process.env.SESSION_SECRET ?? '';
if (!secret) {
  try {
    const env = readFileSync(join(repo, '.env'), 'utf-8');
    secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1]?.trim() ?? '';
  } catch {}
}
if (!secret) throw new Error('test-server: no SESSION_SECRET in env or .env');

const sandbox = join(repo, '.test-sandbox');
rmSync(sandbox, { recursive: true, force: true });
mkdirSync(join(sandbox, 'src'), { recursive: true });
cpSync(join(repo, 'src/content'), join(sandbox, 'src/content'), { recursive: true });

// Shim `claude` so no agent job can ever spawn a real (billable) agent from
// a test — the shim exits 0 immediately, so runners release locks normally.
const binDir = join(sandbox, 'bin');
mkdirSync(binDir, { recursive: true });
writeFileSync(
  join(binDir, 'claude'),
  '#!/bin/sh\necho "test-shim: claude spawn intercepted: $*" >&2\nexit 0\n',
  { mode: 0o755 },
);
process.env.PATH = `${binDir}:${process.env.PATH}`;

// Scrub anything that could reach a real provider or decrypt real secrets.
for (const key of Object.keys(process.env)) {
  if (/TODOIST|ANTHROPIC|OPENAI|GOOGLE|GMAIL|SECRET|TOKEN/i.test(key)) {
    delete process.env[key];
  }
}
process.env.SESSION_SECRET = secret;
process.env.HOST = '127.0.0.1';
process.env.PORT = process.env.LIFEOS_TEST_PORT ?? '4399';

process.chdir(sandbox);
await import(pathToFileURL(join(repo, 'dist/server/entry.mjs')).href);
