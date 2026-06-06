#!/usr/bin/env node
// QA runner — builds the app (unless --skip-build), starts the sandboxed test
// server, executes every area script under tests/qa/scripts/*.qa.mjs, then
// stamps "Last pass" dates into tests/qa/cases/*.md and rewrites RESULTS.md.
//
//   node tests/qa/run.mjs [--skip-build] [--area grocery,tasks]
//
// Mutations only ever touch .test-sandbox/ — agent jobs hit the claude shim.
// Runtime secrets are read from process.env only (never the build-time
// import.meta.env), so test-server.mjs's env scrub keeps the sandbox off the
// real Todoist account even on a dev machine (NIM-7). The opt-in
// `tasks-mutations` area exercises add/complete/edit/delete against an
// in-memory fake backend; it's only selected via --area and flips the server
// to LIFEOS_FAKE_TASKS=1.
import { spawn, execSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const PORT = process.env.QA_PORT ?? '4499';
const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const areaArg = args.find((a) => a.startsWith('--area'));
const only = areaArg ? (areaArg.split('=')[1] ?? args[args.indexOf(areaArg) + 1]).split(',') : null;

// Areas run in this order — auth first (cheap), theme last (it toggles
// global state and restores it).
const ORDER = ['auth', 'dashboard', 'tasks', 'tasks-mutations', 'grocery', 'deliveries', 'recipes', 'settings', 'chat', 'api', 'misc', 'theme'];
// Opt-in areas run only when explicitly named via --area — tasks-mutations
// flips the whole server to the fake task provider (LIFEOS_FAKE_TASKS=1).
const OPT_IN = new Set(['tasks-mutations']);
const areas = ORDER.filter(
  (a) => existsSync(join(here, 'scripts', `${a}.qa.mjs`)) && (only ? only.includes(a) : !OPT_IN.has(a)),
);
const fakeTasks = areas.includes('tasks-mutations');

if (!skipBuild) {
  console.log('building…');
  execSync('npm run build', { cwd: repo, stdio: 'inherit' });
}
execSync('node tests/qa/scripts/mint-session.ts', { cwd: repo, stdio: 'inherit' });

console.log(`starting test server on :${PORT}…`);
const server = spawn('node', ['scripts/test-server.mjs'], {
  cwd: repo,
  env: { ...process.env, LIFEOS_TEST_PORT: PORT, ...(fakeTasks ? { LIFEOS_FAKE_TASKS: '1' } : {}) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

// wait for /login to come up
const deadline = Date.now() + 30_000;
let up = false;
while (Date.now() < deadline) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/login`);
    if (res.ok) { up = true; break; }
  } catch {}
  await new Promise((r) => setTimeout(r, 300));
}
if (!up) {
  server.kill();
  console.error('test server failed to start:\n' + serverLog.slice(-2000));
  process.exit(1);
}

const all = [];
for (const area of areas) {
  console.log(`\n── ${area} ──`);
  await new Promise((resolve) => {
    const p = spawn('node', [join(here, 'scripts', `${area}.qa.mjs`)], {
      cwd: repo,
      env: { ...process.env, QA_PORT: PORT },
      stdio: 'inherit',
    });
    p.on('exit', resolve);
  });
  const artifact = join(here, '.artifacts', `results-${area}.json`);
  if (existsSync(artifact)) all.push(JSON.parse(readFileSync(artifact, 'utf-8')));
}
server.kill();

// ── stamp cases/*.md and write RESULTS.md ──────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const byId = new Map();
for (const a of all) for (const r of a.results) byId.set(r.id, r);

const casesDir = join(here, 'cases');
for (const f of readdirSync(casesDir).filter((f) => f.endsWith('.md'))) {
  const path = join(casesDir, f);
  let md = readFileSync(path, 'utf-8');
  md = md.replace(/^### (\S+) — (.+)$([\s\S]*?)^(Last pass: .*?· Status: )(\S+)(.*)$/gm, (m, id, title, mid, prefix, status, rest) => {
    const r = byId.get(id);
    if (!r) return m; // manual case or area not run — leave untouched
    const newStatus = r.pass ? 'pass' : 'FAIL';
    const date = r.pass ? `Last pass: ${today} ` : `Last pass: ${m.match(/Last pass: (\S+)/)?.[1] ?? 'never'} `;
    return `### ${id} — ${title}${mid}${date}· Status: ${newStatus}${rest}`;
  });
  writeFileSync(path, md);
}

const lines = [
  `# QA results — ${new Date().toISOString()}`,
  '',
  '| Area | Passed | Failed | Console errors |',
  '|---|---|---|---|',
];
let totalPass = 0, totalFail = 0;
for (const a of all) {
  const pass = a.results.filter((r) => r.pass).length;
  const fail = a.results.length - pass;
  totalPass += pass; totalFail += fail;
  lines.push(`| ${a.area} | ${pass} | ${fail} | ${a.consoleErrors.length} |`);
}
lines.push('', `**Total: ${totalPass} passed, ${totalFail} failed.**`, '');
for (const a of all) {
  for (const r of a.results.filter((r) => !r.pass)) {
    lines.push(`- FAIL \`${r.id}\` ${r.title} — ${r.error}`);
  }
}
writeFileSync(join(here, 'RESULTS.md'), lines.join('\n') + '\n');
console.log(`\n${totalPass} passed, ${totalFail} failed → tests/qa/RESULTS.md`);
process.exit(totalFail > 0 ? 1 : 0);
