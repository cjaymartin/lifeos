// Shared QA harness — drives the sandboxed test server (scripts/test-server.mjs)
// with Playwright, capturing per-check results, console errors, and screenshots.
//
// Usage from an area script:
//   const qa = await startQA('dashboard');
//   await qa.check('DASH-1', 'renders title', async (page) => { ... });
//   await qa.finish();   // writes tests/qa/.artifacts/results-<area>.json
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as yamlLoad } from 'js-yaml';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = process.env.QA_PORT ?? '4499';
export const BASE = `http://127.0.0.1:${PORT}`;
const ARTIFACTS = join(repo, 'tests/qa/.artifacts');

export function sandboxPath(...parts) {
  return join(repo, '.test-sandbox', ...parts);
}
export function readSandboxJson(relative) {
  return JSON.parse(readFileSync(sandboxPath(relative), 'utf-8'));
}
export function sandboxVaultPath(...parts) {
  return join(repo, '.test-sandbox', 'vault', ...parts);
}
/** Read a single sandbox-vault note's frontmatter (empty object if missing). */
export function readSandboxVaultNote(relativePath) {
  try {
    const raw = readFileSync(sandboxVaultPath(relativePath), 'utf-8');
    const m = raw.match(/^---\n([\s\S]*?)\n---/);
    return m ? yamlLoad(m[1]) : {};
  } catch {
    return {};
  }
}
/** Read every visible *.md note's frontmatter from a sandbox-vault directory. */
export function readSandboxVaultNotes(relativeDir) {
  const dir = sandboxVaultPath(relativeDir);
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('.'));
  } catch {
    return [];
  }
  return files.map((f) => {
    const raw = readFileSync(join(dir, f), 'utf-8');
    const m = raw.match(/^---\n([\s\S]*?)\n---/);
    return m ? yamlLoad(m[1]) : {};
  });
}

/** Wait for a locator to be visible (plain-Playwright, no test runner). */
export async function expectVisible(locator, timeout = 5000) {
  await locator.first().waitFor({ state: 'visible', timeout });
}

/** Poll fn() until it equals expected (deep-ish via JSON) or time out. */
export async function poll(fn, expected, { timeout = 5000, interval = 150 } = {}) {
  const want = JSON.stringify(expected);
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (JSON.stringify(last) === want) return last;
    } catch (err) {
      last = `threw: ${err.message}`;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`poll timed out: wanted ${want}, last ${JSON.stringify(last)}`);
}

export async function startQA(area) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const storageState = JSON.parse(
    readFileSync(join(repo, 'tests/e2e/.auth/state.json'), 'utf-8'),
  );
  // The minted cookie is scoped to 127.0.0.1 — works for any port.
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState, baseURL: BASE });
  const results = [];
  const consoleErrors = [];

  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push({ url: page.url(), text: msg.text() });
  });
  page.on('pageerror', (err) => consoleErrors.push({ url: page.url(), text: `pageerror: ${err.message}` }));

  async function check(id, title, fn) {
    const started = Date.now();
    try {
      await fn(page, context);
      results.push({ id, title, pass: true, ms: Date.now() - started });
      console.log(`  PASS ${id} ${title}`);
    } catch (err) {
      const shot = join(ARTIFACTS, `${id}.png`);
      try { await page.screenshot({ path: shot, fullPage: true }); } catch {}
      results.push({ id, title, pass: false, ms: Date.now() - started, error: String(err?.message ?? err).slice(0, 500), screenshot: shot });
      console.log(`  FAIL ${id} ${title}\n       ${String(err?.message ?? err).split('\n')[0]}`);
    }
  }

  async function api(path, init = {}) {
    // context.request shares the session cookie. Always send a same-origin
    // Origin header — Astro's checkOrigin CSRF guard 403s form-ish/body-less
    // mutations without one (a browser would always send it).
    const headers = { origin: BASE, ...(init.headers ?? {}) };
    const res = await context.request.fetch(BASE + path, { ...init, headers });
    return res;
  }

  async function finish() {
    await browser.close();
    const out = { area, ranAt: new Date().toISOString(), results, consoleErrors };
    writeFileSync(join(ARTIFACTS, `results-${area}.json`), JSON.stringify(out, null, 2));
    const fails = results.filter((r) => !r.pass);
    console.log(`${area}: ${results.length - fails.length}/${results.length} passed, ${consoleErrors.length} console errors`);
    return out;
  }

  /** A second context WITHOUT the session cookie, for auth-gate checks. */
  async function anonContext() {
    return browser.newContext({ baseURL: BASE });
  }

  return { browser, context, page, check, api, finish, anonContext, consoleErrors, results };
}
