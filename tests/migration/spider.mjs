#!/usr/bin/env node
// Baseline capture for the Obsidian-migration green-green test.
//
//   node tests/migration/spider.mjs
//
// Builds the app, starts the sandboxed authenticated server, spiders every
// page, screenshots each, and derives a set of durable "data tokens" per page
// (item names, task contents, delivery items, recipe titles, …) plus
// API-level identity sets. Writes:
//   tests/migration/baseline.json        — machine-checkable expectations
//   tests/migration/PLAN.md              — human QA test plan
//   tests/migration/screenshots/baseline/*.png
//
// Tokens are SELF-CALIBRATED: a candidate from the data is only recorded as an
// expectation if it actually renders right now. That guarantees the baseline is
// green against the current tree, and makes any later disappearance a real
// regression (data loss), while staying blind to layout and volatile fields.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  REPO, MIGRATION_DIR, build, mintSession, startServer, launchBrowser,
  renderPage, apiGet, pageHasToken,
} from './lib.mjs';

const SHOTS = join(MIGRATION_DIR, 'screenshots', 'baseline');
mkdirSync(SHOTS, { recursive: true });

// ── routes we visit & screenshot ────────────────────────────────────────────
const ROUTES = [
  { id: 'DASH', path: '/', title: 'Dashboard' },
  { id: 'TASK', path: '/tasks', title: 'Tasks' },
  { id: 'GROC', path: '/grocery', title: 'Grocery' },
  { id: 'DELIV', path: '/deliveries', title: 'Deliveries' },
  { id: 'REC', path: '/recipes', title: 'Recipes index' },
  { id: 'SET', path: '/settings', title: 'Settings' },
  { id: 'SETL', path: '/settings/logins', title: 'Settings · Logins' },
];

function readJson(rel) {
  const p = join(REPO, rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null;
}
function names(arr, key) {
  return Array.isArray(arr) ? arr.map((x) => x?.[key]).filter((s) => typeof s === 'string' && s.trim()) : [];
}
const uniq = (a) => [...new Set(a)];

async function main() {
  if (!process.argv.includes('--skip-build')) build();
  const storage = mintSession();
  const server = await startServer();
  const { context, close } = await launchBrowser(storage);
  try {
    await capturePages(server, context);
  } finally {
    await close().catch(() => {});
    server.stop();
  }
}

async function capturePages(server, context) {

  // ── gather candidate data tokens from the app's own contract / source ──────
  // Retry: the first SSR hit after server start can lose a race while the route
  // is still compiling. Fail loudly if the data never arrives — a silently empty
  // baseline would make the whole green-green test meaningless.
  const apiGetRetry = async (path) => {
    let lastErr;
    for (let i = 0; i < 5; i++) {
      try { return await apiGet(server.baseURL, path); }
      catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 1000)); }
    }
    throw new Error(`gave up on ${path}: ${lastErr}`);
  };

  const grocery = await apiGetRetry('/api/grocery');
  const groceryItems = uniq(names(grocery.items, 'name'));
  const groceryStaples = uniq(names(grocery.staples, 'name'));
  if (groceryItems.length + groceryStaples.length === 0) throw new Error('grocery API returned no items/staples');

  const tasks = await apiGetRetry('/api/tasks');
  const taskContents = uniq(names(tasks.tasks ?? tasks, 'content'));
  const completed = await apiGetRetry('/api/tasks/completed');
  const completedContents = uniq(names(completed.completed ?? completed, 'content'));

  const deliveriesData = readJson('src/content/deliveries/deliveries.json') ?? {};
  const deliveryItems = uniq(names(deliveriesData.deliveries, 'item'));
  const deliveryVendors = uniq(names(deliveriesData.deliveries, 'vendor'));

  const today = readJson('src/content/daily/today.json') ?? {};
  const dashCandidates = uniq([
    ...(today.items ?? []),
    ...((today.tasks && today.tasks.items) ?? []),
    today.water?.vendor,
    today.water?.product,
  ].filter((s) => typeof s === 'string' && s.trim()));

  // recipes: titles + slugs + a few body lines per recipe
  const recipeFiles = (await import('fs')).readdirSync(join(REPO, 'src/content/recipes')).filter((f) => f.endsWith('.md'));
  const recipes = recipeFiles.map((f) => {
    const raw = readFileSync(join(REPO, 'src/content/recipes', f), 'utf-8');
    const title = raw.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? f;
    const slug = raw.match(/^slug:\s*"?(.+?)"?\s*$/m)?.[1] ?? f.replace(/\.md$/, '');
    // candidate body lines: non-empty, non-heading, reasonably wordy
    const body = raw.replace(/^---[\s\S]*?---/, '');
    const lines = uniq(
      body.split('\n').map((l) => l.replace(/^[-*\d.>\s]+/, '').trim())
        .filter((l) => l.length >= 8 && /[a-z]{3,}/i.test(l)),
    ).slice(0, 12);
    return { title, slug, lines };
  });
  const recipeTitles = recipes.map((r) => r.title);

  // ── self-calibrate per page: keep only candidates that actually render ─────
  const baseline = { capturedAt: new Date().toISOString(), pages: {}, api: {} };
  const planSections = [];

  async function capture(route, candidates, note) {
    const { page, status, finalURL, text, consoleErrors } = await renderPage(context, server.baseURL, route.path);
    await page.screenshot({ path: join(SHOTS, `${route.id}.png`), fullPage: true });
    const present = candidates.filter((t) => pageHasToken(text, t));
    const absent = candidates.filter((t) => !pageHasToken(text, t));
    baseline.pages[route.path] = {
      id: route.id, title: route.title, status, finalURL,
      mustContain: present, charCount: text.length, consoleErrors,
    };
    planSections.push({ route, present, absent, note, status, charCount: text.length });
    await page.close();
    console.log(`  ${route.id} ${route.path} → status ${status}, ${present.length}/${candidates.length} tokens render, ${text.length} chars`);
  }

  console.log('capturing pages…');
  await capture(ROUTES[0], dashCandidates, 'Dashboard widgets (daily briefing items, task names, water vendor/product).');
  await capture(ROUTES[1], uniq([...taskContents, ...completedContents]), 'Task list contents (active + completed).');
  await capture(ROUTES[2], uniq([...groceryItems, ...groceryStaples]), 'Grocery list item names + staple names.');
  await capture(ROUTES[3], uniq([...deliveryItems, ...deliveryVendors]), 'Delivery item descriptions + vendors.');
  await capture(ROUTES[4], recipeTitles, 'Recipe card titles.');
  await capture(ROUTES[5], [], 'Settings page renders (structural screenshot only).');
  await capture(ROUTES[6], [], 'Logins page renders (structural screenshot only).');

  // per-recipe detail pages
  for (const r of recipes) {
    const route = { id: `REC-${r.slug}`, path: `/recipes/${r.slug}`, title: `Recipe · ${r.title}` };
    await capture(route, uniq([r.title, ...r.lines]), `Recipe detail for "${r.title}" — title + ingredient/step lines.`);
  }

  // ── API-level identity sets (page-independent data-loss guard) ─────────────
  baseline.api = {
    '/api/grocery': { itemNames: groceryItems, stapleNames: groceryStaples },
    '/api/tasks': { contents: taskContents },
    '/api/tasks/completed': { contents: completedContents },
  };

  writeFileSync(join(MIGRATION_DIR, 'baseline.json'), JSON.stringify(baseline, null, 2) + '\n');
  writeFileSync(join(MIGRATION_DIR, 'PLAN.md'), renderPlan(baseline, planSections, recipes));
  console.log('\nbaseline.json + PLAN.md written.');
}

// ── QA plan document ────────────────────────────────────────────────────────
function renderPlan(baseline, sections, recipes) {
  const L = [];
  L.push('# LifeOS — Data-Integrity QA Test Plan');
  L.push('');
  L.push(`_Generated ${baseline.capturedAt} by tests/migration/spider.mjs._`);
  L.push('');
  L.push('## Purpose');
  L.push('');
  L.push('Verify that every piece of **user data** the dashboard renders today is');
  L.push('still rendered after a backend change. The plan asserts on durable item');
  L.push('**identities** (names, contents, titles) — not on counts, ordering,');
  L.push('timestamps, weather, or layout — so it tolerates minor data churn but');
  L.push('fails loudly on real data loss.');
  L.push('');
  L.push('## How to run');
  L.push('');
  L.push('```bash');
  L.push('source ~/.nvm/nvm.sh && nvm use default   # node/npm on PATH');
  L.push('node tests/migration/verify.mjs           # builds, serves, checks, exits non-zero on any FAIL');
  L.push('```');
  L.push('');
  L.push('`verify.mjs` starts the sandboxed authenticated server (no real agents,');
  L.push('no real data mutated), reloads every page below, and asserts each');
  L.push('expected token still renders, plus that API identity sets are intact.');
  L.push('Screenshots from the run land in `tests/migration/screenshots/verify/`');
  L.push('next to the baseline shots for visual diffing.');
  L.push('');
  L.push('## Pass criteria');
  L.push('');
  L.push('- **PASS**: every listed expected token is present on its page, and every');
  L.push('  baseline API identity is still served. Extra/new items are allowed.');
  L.push('- **FAIL**: any expected token missing, any baseline API identity gone,');
  L.push('  any page that returned a non-200 / redirected to /login, or a page');
  L.push('  whose rendered text collapses to near-empty.');
  L.push('');
  L.push('---');
  L.push('');
  L.push('## Page cases');
  L.push('');
  for (const s of sections) {
    const r = s.route;
    L.push(`### ${r.id} — ${r.title}`);
    L.push('');
    L.push(`- **Route:** \`${r.path}\``);
    L.push(`- **Baseline status:** ${s.status}, ${s.charCount} chars rendered`);
    L.push(`- **Screenshot:** \`screenshots/baseline/${r.id}.png\``);
    if (s.note) L.push(`- **What it covers:** ${s.note}`);
    L.push('- **Steps:** load the route in the authenticated session; let islands hydrate; read the rendered text.');
    if (s.present.length) {
      L.push(`- **Expected tokens (must all be present, ${s.present.length}):**`);
      for (const t of s.present) L.push(`  - \`${t}\``);
    } else {
      L.push('- **Expected:** page renders with non-trivial content (structural check only — no data tokens asserted).');
    }
    if (s.absent.length) {
      L.push(`- **Not asserted** (candidate data not visible on this view at baseline, ${s.absent.length}): ` +
        s.absent.slice(0, 8).map((t) => `\`${t}\``).join(', ') + (s.absent.length > 8 ? ', …' : ''));
    }
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push('## API data-integrity cases');
  L.push('');
  L.push('These hit the JSON the pages are built from, independent of rendering.');
  L.push('Every identity below must still be served (set inclusion; order-free).');
  L.push('');
  const g = baseline.api['/api/grocery'];
  L.push(`### API-GROC — \`GET /api/grocery\``);
  L.push(`- **Item names intact (${g.itemNames.length}):** must include every one of:`);
  for (const n of g.itemNames) L.push(`  - \`${n}\``);
  if (g.stapleNames.length) {
    L.push(`- **Staple names intact (${g.stapleNames.length}):**`);
    for (const n of g.stapleNames) L.push(`  - \`${n}\``);
  }
  L.push('');
  const t = baseline.api['/api/tasks'];
  L.push(`### API-TASK — \`GET /api/tasks\``);
  L.push(`- **Task contents intact (${t.contents.length}):**`);
  for (const n of t.contents) L.push(`  - \`${n}\``);
  L.push('');
  const c = baseline.api['/api/tasks/completed'];
  L.push(`### API-DONE — \`GET /api/tasks/completed\``);
  L.push(`- **Completed task contents intact (${c.contents.length}):**`);
  for (const n of c.contents) L.push(`  - \`${n}\``);
  L.push('');
  return L.join('\n') + '\n';
}

main().catch((e) => { console.error(e); process.exit(1); });
