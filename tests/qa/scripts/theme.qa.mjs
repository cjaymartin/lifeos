// QA: theme toggle & visual hygiene — see tests/qa/cases/theme.md
import { startQA, BASE } from './qa-lib.mjs';

const qa = await startQA('theme');

await qa.check('THEME-1', 'theme toggle switches and persists across pages', async (page) => {
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: /light mode/i }).first().click();
  await page.waitForTimeout(300);
  const isLight = await page.evaluate(() => document.documentElement.classList.contains('light'));
  if (!isLight) throw new Error('html did not get .light class');
  await page.goto(BASE + '/tasks');
  const stillLight = await page.evaluate(() => document.documentElement.classList.contains('light'));
  if (!stillLight) throw new Error('theme reset on navigation');
});

await qa.check('THEME-2', 'light mode: no hydration/page errors across pages', async (page) => {
  // Fixed NIM-9 / #4: Sidebar seeds useState('dark') to match SSR and adopts
  // the stored theme in a post-mount effect, so first client render agrees with
  // the SSR markup → no React #418. Unit-covered in sidebar-theme-hydration.test.tsx.
  const before = qa.consoleErrors.length;
  for (const p of ['/tasks', '/grocery', '/deliveries', '/recipes']) {
    await page.goto(BASE + p);
    await page.waitForTimeout(700);
  }
  const errs = qa.consoleErrors.slice(before);
  if (errs.length) throw new Error(`${errs.length} errors, first: ${errs[0].text.slice(0, 120)}`);
});

await qa.check('THEME-3', 'toggle back to dark restores cleanly', async (page) => {
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: /dark mode/i }).first().click();
  await page.waitForTimeout(300);
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  if (!isDark) throw new Error('html did not get .dark class back');
});

await qa.finish();
