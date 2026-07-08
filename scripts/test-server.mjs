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
// reachable from tests — the sync loop no-ops without a token. Runtime secrets
// are read from process.env only (never the build-time import.meta.env that
// `astro build` inlines), so this scrub is now actually effective even on a dev
// machine with a populated .env (NIM-7). To exercise task mutations against an
// in-memory fake backend instead, the parent sets LIFEOS_FAKE_TASKS=1 — it
// survives the scrub below (no secret-ish name) and flips getProvider() to the
// fake. The default (unset) run shows Todoist as "Not connected".

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, globSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
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

// Overlay committed e2e fixtures for content that's gitignored (local-first
// runtime data — tasks/meta.json, etc. — never lives in the repo, so a fresh CI
// checkout has none of it). fill-if-missing: only seed a file the sandbox lacks,
// so a dev machine with real content keeps exercising that, while CI gets a
// deterministic fixture instead of crashing on the empty tree.
const fixtures = join(repo, 'tests/e2e/fixtures/content');
if (existsSync(fixtures)) {
  cpSync(fixtures, join(sandbox, 'src/content'), { recursive: true, force: false, errorOnExist: false });
}

// Copy the Obsidian vault (human Markdown content) into the sandbox and point
// LIFEOS_VAULT_DIR at the copy, so tests read/write a throwaway vault and never
// touch the real one. The .obsidian config dir is skipped — the app never reads
// it and it carries plugin bundles we don't want in the sandbox.
const realVault = process.env.LIFEOS_VAULT_DIR || join(homedir(), 'obsidian', 'lifeos');
const sandboxVault = join(sandbox, 'vault');
if (existsSync(realVault)) {
  cpSync(realVault, sandboxVault, {
    recursive: true,
    filter: (src) => !src.split(/[\\/]/).includes('.obsidian'),
  });
}
mkdirSync(sandboxVault, { recursive: true });

// Scrub job dot-files copied from the real tree — a fresh lock left by a real
// agent run would make every job read as already-running inside tests.
for (const f of globSync(join(sandbox, 'src/content/**/.*'))) {
  if (/\.(refresh|build|scan|categorize|probe)-|-lock$|-log$|\.job-/.test(f)) {
    rmSync(f, { force: true, recursive: true });
  }
}

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
process.env.LIFEOS_VAULT_DIR = sandboxVault;
process.env.HOST = '127.0.0.1';
process.env.PORT = process.env.LIFEOS_TEST_PORT ?? '4399';

process.chdir(sandbox);
await import(pathToFileURL(join(repo, 'dist/server/entry.mjs')).href);
