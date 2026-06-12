import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// NIM-7 regression guard. `astro build` inlines `import.meta.env.X` literals
// into dist/, so reading a runtime secret from import.meta.env bakes a dev
// machine's real .env value into the build — defeating the test-server env
// scrub and letting the sandbox reach the real Todoist account. Runtime secrets
// must be read from process.env ONLY. This test fails if any of these files
// reintroduces an `import.meta.env` read of a secret-ish name.

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');

// Files that resolve runtime secrets/keys.
const GUARDED = [
  'src/features/tasks/ops/todoist.ts',
  'src/features/settings/ops/secrets.ts',
  'src/features/settings/ops/verify-runner.ts',
  'src/pages/api/webhooks/todoist.ts',
  'src/lib/auth.ts',
  'src/lib/totp.ts',
];

// import.meta(.env / as any).env reads of a secret/token/key/password name.
const BAKED_SECRET = /import\.meta[\s\S]{0,40}?env[?.]*\.?\s*\w*(TOKEN|SECRET|KEY|PASSWORD)/i;

describe('runtime secrets are never read from baked import.meta.env (NIM-7)', () => {
  for (const rel of GUARDED) {
    it(`${rel} reads secrets from process.env only`, () => {
      const src = readFileSync(join(repo, rel), 'utf-8');
      const offending = src
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => BAKED_SECRET.test(line));
      expect(
        offending,
        `found import.meta.env secret read(s):\n${offending.map(([n, l]) => `  ${rel}:${n}: ${l.trim()}`).join('\n')}`,
      ).toEqual([]);
    });
  }
});
