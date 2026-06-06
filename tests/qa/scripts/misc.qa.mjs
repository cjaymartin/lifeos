// QA: cross-cutting checks — see tests/qa/cases/misc.md
import { startQA, expectVisible, BASE } from './qa-lib.mjs';

const qa = await startQA('misc');
const PAGES = ['/', '/tasks', '/grocery', '/deliveries', '/recipes', '/settings/logins', '/setup/passkey'];

await qa.check('MISC-1', 'every page has a non-default title', async (page) => {
  const failures = [];
  for (const path of PAGES) {
    await page.goto(BASE + path);
    const title = await page.title();
    if (!title || !title.includes('LifeOS')) failures.push(`${path}: "${title}"`);
  }
  if (failures.length) throw new Error(failures.join(' | '));
});

await qa.check('MISC-2', 'no horizontal overflow on any page at 390px', async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const failures = [];
  for (const path of PAGES) {
    await page.goto(BASE + path);
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 2) failures.push(`${path}: ${overflow}px`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  if (failures.length) throw new Error(failures.join(' | '));
});

await qa.check('MISC-3', 'no console/page errors on a full page sweep', async (page) => {
  const before = qa.consoleErrors.length;
  for (const path of PAGES) {
    await page.goto(BASE + path);
    await page.waitForTimeout(700);
  }
  const errs = qa.consoleErrors.slice(before);
  if (errs.length) throw new Error(errs.map((e) => `${e.url}: ${e.text}`).join(' | '));
});

await qa.check('MISC-4', 'static assets and favicon resolve', async (page) => {
  const failed = [];
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('/api/')) failed.push(`${res.status()} ${res.url()}`);
  });
  await page.goto(BASE + '/');
  await page.waitForTimeout(1500);
  if (failed.length) throw new Error(failed.join(' | '));
});

await qa.check('MISC-5', 'every page renders a sidebar (layout consistency)', async (page) => {
  const failures = [];
  for (const path of PAGES.filter((p) => p !== '/setup/passkey')) {
    await page.goto(BASE + path);
    const nav = await page.locator('a[href="/"]').count();
    if (nav === 0) failures.push(path);
  }
  if (failures.length) throw new Error(`no home link on: ${failures.join(', ')}`);
});

await qa.finish();
