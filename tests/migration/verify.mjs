#!/usr/bin/env node
// Assertion run for the LifeOS data-integrity QA plan.
//
//   node tests/migration/verify.mjs [--skip-build]
//
// Reads tests/migration/baseline.json, starts the sandboxed authenticated
// server, reloads every page, and asserts that every expected data token still
// renders and every baseline API identity is still served. Writes verify
// screenshots and prints a PASS/FAIL table. Exit code is non-zero if anything
// failed. It has no notion of "should this pass" — it just checks the plan.

import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  MIGRATION_DIR, build, mintSession, startServer, launchBrowser,
  renderPage, apiGet, pageHasToken,
} from './lib.mjs';

const SHOTS = join(MIGRATION_DIR, 'screenshots', 'verify');
mkdirSync(SHOTS, { recursive: true });

const baseline = JSON.parse(readFileSync(join(MIGRATION_DIR, 'baseline.json'), 'utf-8'));
const results = [];
const record = (id, title, pass, detail) => results.push({ id, title, pass, detail });

async function main() {
  if (!process.argv.includes('--skip-build')) build();
  const storage = mintSession();
  const server = await startServer();
  const { context, close } = await launchBrowser(storage);
  try {
    await runChecks(server, context);
  } finally {
    await close().catch(() => {});
    server.stop();
  }
  report();
}

async function runChecks(server, context) {
  // ── page token checks ──────────────────────────────────────────────────────
  for (const [path, spec] of Object.entries(baseline.pages)) {
    const { page, status, finalURL, text } = await renderPage(context, server.baseURL, path);
    await page.screenshot({ path: join(SHOTS, `${spec.id}.png`), fullPage: true });
    await page.close();

    if (status !== 200 || /\/login(\?|$)/.test(finalURL)) {
      record(spec.id, spec.title, false, `page returned status ${status}, final URL ${finalURL}`);
      continue;
    }
    if (text.trim().length < 20) {
      record(spec.id, spec.title, false, `page rendered near-empty (${text.length} chars)`);
      continue;
    }
    const missing = (spec.mustContain ?? []).filter((tok) => !pageHasToken(text, tok));
    if (missing.length) {
      record(spec.id, spec.title, false, `missing ${missing.length} token(s): ${missing.map((m) => JSON.stringify(m)).join(', ')}`);
    } else {
      record(spec.id, spec.title, true, `${(spec.mustContain ?? []).length} token(s) present`);
    }
  }

  // ── API identity checks ────────────────────────────────────────────────────
  const includesAll = (haystack, needles) => needles.filter((n) => !haystack.includes(n));
  const namesOf = (arr, key) => (Array.isArray(arr) ? arr.map((x) => x?.[key]) : []);

  try {
    const g = await apiGet(server.baseURL, '/api/grocery');
    const liveItems = namesOf(g.items, 'name');
    const liveStaples = namesOf(g.staples, 'name');
    const mi = includesAll(liveItems, baseline.api['/api/grocery'].itemNames);
    const ms = includesAll(liveStaples, baseline.api['/api/grocery'].stapleNames);
    const lost = [...mi.map((x) => `item:${x}`), ...ms.map((x) => `staple:${x}`)];
    record('API-GROC', 'GET /api/grocery identities', lost.length === 0,
      lost.length ? `lost: ${lost.join(', ')}` : `${liveItems.length} items, ${liveStaples.length} staples intact`);
  } catch (e) { record('API-GROC', 'GET /api/grocery identities', false, String(e)); }

  try {
    const t = await apiGet(server.baseURL, '/api/tasks');
    const live = namesOf(t.tasks ?? t, 'content');
    const lost = includesAll(live, baseline.api['/api/tasks'].contents);
    record('API-TASK', 'GET /api/tasks identities', lost.length === 0,
      lost.length ? `lost: ${lost.join(', ')}` : `${live.length} task contents intact`);
  } catch (e) { record('API-TASK', 'GET /api/tasks identities', false, String(e)); }

  try {
    const c = await apiGet(server.baseURL, '/api/tasks/completed');
    const live = namesOf(c.completed ?? c, 'content');
    const lost = includesAll(live, baseline.api['/api/tasks/completed'].contents);
    record('API-DONE', 'GET /api/tasks/completed identities', lost.length === 0,
      lost.length ? `lost: ${lost.join(', ')}` : `${live.length} completed contents intact`);
  } catch (e) { record('API-DONE', 'GET /api/tasks/completed identities', false, String(e)); }
}

function report() {
  // ── report ─────────────────────────────────────────────────────────────────
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  const lines = ['', '── verify results ──'];
  for (const r of results) lines.push(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(22)} ${r.detail}`);
  lines.push('', `${pass} passed, ${fail} failed`);
  const out = lines.join('\n');
  console.log(out);
  writeFileSync(join(MIGRATION_DIR, 'verify-results.json'),
    JSON.stringify({ ranAt: new Date().toISOString(), pass, fail, results }, null, 2) + '\n');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
