// QA: dashboard composition & widgets — see tests/qa/cases/dashboard.md
import { startQA, expectVisible, readSandboxJson, BASE } from './qa-lib.mjs';

const qa = await startQA('dashboard');
const registry = readSandboxJson('src/content/widgets/registry.json');
const daily = readSandboxJson('src/content/daily/today.json');

await qa.check('DASH-1', 'renders title, greeting, and refresh button', async (page) => {
  await page.goto(BASE + '/');
  if ((await page.title()) !== 'Dashboard — LifeOS') throw new Error(`title: ${await page.title()}`);
  const h1 = (await page.locator('h1').first().textContent())?.trim();
  if (!h1) throw new Error('empty greeting h1');
  await expectVisible(page.getByRole('button', { name: /refresh/i }));
});

await qa.check('DASH-2', 'sidebar links to every stack and settings', async (page) => {
  await page.goto(BASE + '/');
  for (const href of ['/tasks', '/deliveries', '/recipes', '/grocery', '/settings/logins']) {
    const n = await page.locator(`a[href="${href}"]`).count();
    if (n === 0) throw new Error(`no link to ${href}`);
  }
});

await qa.check('DASH-3', 'sidebar navigation actually navigates', async (page) => {
  for (const [href, titleRe] of [
    ['/tasks', /Tasks/],
    ['/grocery', /Groceries|Grocery/],
    ['/deliveries', /Deliveries/],
    ['/recipes', /Recipes/],
  ]) {
    await page.goto(BASE + '/');
    await page.locator(`a[href="${href}"]`).first().click();
    await page.waitForURL('**' + href, { timeout: 5000 });
    if (!titleRe.test(await page.title())) throw new Error(`${href} title: ${await page.title()}`);
  }
});

await qa.check('DASH-4', 'enabled has-data widgets render their data', async (page) => {
  await page.goto(BASE + '/');
  const weather = registry.widgets.find((w) => w.type === 'weather' && w.enabled);
  if (weather && daily?.weather) {
    await expectVisible(page.getByText(daily.weather.condition).first());
  }
  const briefing = registry.widgets.find((w) => w.type === 'briefing' && w.enabled);
  if (briefing && daily?.briefing) {
    await expectVisible(page.getByText(daily.briefing.slice(0, 40)).first());
  }
  const tasksWidget = registry.widgets.find((w) => w.type === 'tasks' && w.enabled);
  if (tasksWidget) await expectVisible(page.getByText(/tasks/i).first());
});

await qa.check('DASH-5', 'conditional widgets respect displayCondition', async (page) => {
  await page.goto(BASE + '/');
  // calendar: has-events — hidden when today.json has no events
  const cal = registry.widgets.find((w) => w.type === 'calendar' && w.enabled);
  const events = daily?.calendar?.events ?? daily?.events ?? [];
  if (cal && events.length === 0) {
    const visible = await page.getByText(/no events|today's schedule/i).count();
    // widget should be absent entirely, not "empty"
    const headers = await page.locator('text=' + (cal.label ?? 'Today')).count();
    if (visible > 0 && headers > 0) throw new Error('calendar widget rendered despite no events');
  }
  // deliveries: has-deliveries
  const del = registry.widgets.find((w) => w.type === 'deliveries' && w.enabled);
  const deliveries = readSandboxJson('src/content/deliveries/deliveries.json');
  const dismissed = readSandboxJson('src/content/deliveries/dismissed.json');
  const dismissedIds = new Set((dismissed.dismissed ?? []).map((d) => d.id));
  const liveCount = (deliveries.deliveries ?? []).filter((d) => !dismissedIds.has(d.id)).length;
  if (del && liveCount > 0) {
    await expectVisible(page.getByText(/deliveries/i).first());
  }
});

await qa.check('DASH-6', 'no console or page errors on dashboard load', async (page) => {
  const before = qa.consoleErrors.length;
  await page.goto(BASE + '/');
  // networkidle never fires here — the tasks island keeps an SSE stream open.
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
  const errs = qa.consoleErrors.slice(before);
  if (errs.length) throw new Error(`console errors: ${errs.map((e) => e.text).join(' | ')}`);
});

await qa.check('DASH-7', 'refresh button walks the shimmed job to Failed', async (page) => {
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: /refresh/i }).click();
  await expectVisible(page.getByRole('button', { name: /Refreshing…/ }), 5000);
  await expectVisible(page.getByRole('button', { name: /Failed/ }), 25000);
});

await qa.check('DASH-8', 'mobile viewport: dashboard usable at 390px', async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '/');
  const h1 = (await page.locator('h1').first().textContent())?.trim();
  if (!h1) throw new Error('empty greeting on mobile');
  // No horizontal overflow
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 2) throw new Error(`horizontal overflow: ${overflow}px`);
  await page.setViewportSize({ width: 1280, height: 720 });
});

await qa.finish();
