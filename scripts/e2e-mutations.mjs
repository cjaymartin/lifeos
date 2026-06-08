// Runs the task-mutation e2e spec against the in-memory fake provider (NIM-7).
//
// Separate invocation because it needs LIFEOS_FAKE_TASKS=1, which flips the
// sandbox from "Not connected" to a connected fake backend — the opposite of
// what every other e2e spec expects. The flag survives test-server.mjs's env
// scrub (no secret-ish name) and selects the fake provider at runtime.
//
//   node scripts/e2e-mutations.mjs [--skip-build]
import { spawnSync } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const skipBuild = process.argv.includes('--skip-build');
const env = { ...process.env, LIFEOS_FAKE_TASKS: '1' };

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: repo, env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!skipBuild) run('npx', ['astro', 'build']);
run('npx', ['playwright', 'test', 'tasks-mutations.spec.ts']);
