// QA: recipes stack — see tests/qa/cases/recipes.md
import { startQA, expectVisible, BASE } from './qa-lib.mjs';
import { readdirSync, readFileSync } from 'fs';
import { sandboxPath } from './qa-lib.mjs';

const qa = await startQA('recipes');
const slugs = readdirSync(sandboxPath('src/content/recipes'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''));

await qa.check('REC-1', 'lists every saved recipe', async (page) => {
  await page.goto(BASE + '/recipes');
  if (!/Recipes.*LifeOS/.test(await page.title())) throw new Error(`title: ${await page.title()}`);
  for (const slug of slugs) {
    const md = readFileSync(sandboxPath(`src/content/recipes/${slug}.md`), 'utf-8');
    const title = md.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? slug;
    await expectVisible(page.getByText(title).first());
  }
});

await qa.check('REC-2', 'search filters the list', async (page) => {
  if (slugs.length < 2) return;
  await page.goto(BASE + '/recipes');
  const search = page.getByPlaceholder(/search/i).first();
  if ((await search.count()) === 0) throw new Error('no search input on /recipes');
  await search.fill('chocolate');
  await page.waitForTimeout(500);
  // Cards are hidden via display:none — assert visibility, not attachment
  if (!(await page.getByText(/chocolate/i).first().isVisible())) {
    throw new Error('search hid the matching recipe');
  }
  const brownVisible = await page
    .getByText(/brown sugar/i)
    .evaluateAll((els) => els.some((el) => el.offsetParent !== null));
  if (brownVisible) throw new Error('search did not hide the non-matching recipe');
});

await qa.check('REC-3', 'every recipe detail page renders', async (page) => {
  for (const slug of slugs) {
    await page.goto(`${BASE}/recipes/${slug}`, { timeout: 10000 });
    if (!page.url().includes(slug)) throw new Error(`${slug} redirected to ${page.url()}`);
    await expectVisible(page.locator('h1').first());
  }
});

await qa.check('REC-4', 'missing slug redirects back to /recipes', async (page) => {
  await page.goto(`${BASE}/recipes/does-not-exist-${Date.now()}`);
  if (!/\/recipes\/?$/.test(page.url())) throw new Error(`landed on ${page.url()}`);
});

await qa.check('REC-5', 'recipe chat surfaces shimmed-agent failure gracefully', async (page) => {
  await page.goto(BASE + '/recipes');
  const chatInput = page.getByPlaceholder(/recipe|ask|paste/i).first();
  if ((await chatInput.count()) === 0) return; // chat may live elsewhere
  const before = qa.consoleErrors.length;
  await chatInput.fill('qa: save a test recipe');
  await chatInput.press('Enter');
  await page.waitForTimeout(8000);
  const errs = qa.consoleErrors.slice(before);
  if (errs.length) throw new Error(errs.map((e) => e.text).join(' | '));
});

await qa.check('REC-6', 'no console errors across recipes pages', async () => {
  const errs = qa.consoleErrors;
  if (errs.length) throw new Error(`${errs.length} console errors, first: ${errs[0].text}`);
});

await qa.finish();
