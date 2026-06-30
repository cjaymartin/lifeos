// Shared harness for the Obsidian-migration green-green test.
//
// Both spider.mjs (baseline capture) and verify.mjs (assertion run) use this to:
//   - start the sandboxed LifeOS test server (scripts/test-server.mjs) on a port
//   - mint + load the same authenticated session the e2e suite uses
//   - drive a headless Chromium with that session
//   - normalise text and match "data tokens" tolerantly
//
// Nothing here knows whether it is running pre- or post-migration. It only
// starts the built app, looks at what the pages render, and reports facts.

import { spawn, execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, '../..');
export const MIGRATION_DIR = here;

/** Collapse whitespace + lowercase so token matching ignores layout/markup. */
export function norm(s) {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Does the page text contain this data token?
 * Tolerant by design: exact normalised substring first, then a fallback that
 * requires every "significant" word (>=3 chars, alphanumeric) of the token to
 * appear somewhere in the page. This survives minor punctuation/parenthetical
 * reformatting (a "minor data change") while still failing when the item's
 * identity words vanish (real data loss).
 */
export function pageHasToken(pageText, token) {
  const np = norm(pageText);
  const nt = norm(token);
  if (!nt) return false;
  if (np.includes(nt)) return true;
  const words = nt.match(/[a-z0-9]{3,}/g) ?? [];
  if (words.length === 0) return false;
  return words.every((w) => np.includes(w));
}

/** Build the app once (callers can skip if a fresh dist already exists). */
export function build() {
  execSync('npm run build', { cwd: REPO, stdio: 'inherit' });
}

/** Mint the e2e session cookie and return the Playwright storageState path. */
export function mintSession() {
  execSync('node tests/qa/scripts/mint-session.ts', { cwd: REPO, stdio: 'inherit' });
  return join(REPO, 'tests/e2e/.auth/state.json');
}

/** Read the minted cookie as a "name=value" header for raw fetch() calls. */
export function cookieHeader() {
  const s = JSON.parse(readFileSync(join(REPO, 'tests/e2e/.auth/state.json'), 'utf-8'));
  return s.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Spawn the sandboxed test server and resolve once /login answers.
 * Returns { port, baseURL, stop() }. The server copies src/content (and, after
 * the migration, the vault) into a throwaway sandbox, so this never mutates real
 * data and never spawns a real agent (claude is shimmed).
 */
export async function startServer(port = process.env.MIGRATION_PORT ?? String(4600 + (process.pid % 300))) {
  const baseURL = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['scripts/test-server.mjs'], {
    cwd: REPO,
    env: { ...process.env, LIFEOS_TEST_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));

  const deadline = Date.now() + 30_000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/login`);
      if (res.ok) { up = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!up) {
    server.kill();
    throw new Error(`test server failed to start:\n${log.slice(-2000)}`);
  }
  return {
    port: String(port),
    baseURL,
    log: () => log,
    stop: () => server.kill(),
  };
}

/** Launch Chromium with the authenticated storage state. */
export async function launchBrowser(storageStatePath) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: storageStatePath,
    viewport: { width: 1366, height: 1000 },
  });
  return {
    browser,
    context,
    close: async () => { await context.close(); await browser.close(); },
  };
}

/**
 * Visit a route, let client islands hydrate, and return the rendered text.
 * We wait for networkidle then a short settle so React-hydrated lists (grocery,
 * tasks, deliveries) have populated before we read innerText / screenshot.
 */
export async function renderPage(context, baseURL, path) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  // Some pages hold an SSE stream open (tasks live updates), so networkidle
  // never fires — wait for DOM + a fixed settle for React islands to hydrate.
  const resp = await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(2500);
  const status = resp ? resp.status() : 0;
  const finalURL = page.url();
  const text = await page.evaluate(() => document.body?.innerText ?? '');
  return { page, status, finalURL, text, consoleErrors };
}

/** Fetch JSON from an authenticated API route. */
export async function apiGet(baseURL, path) {
  const res = await fetch(`${baseURL}${path}`, { headers: { Cookie: cookieHeader() } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}
