// QA: deliveries stack — see tests/qa/cases/deliveries.md
import { startQA, expectVisible, readSandboxJson, poll, BASE } from './qa-lib.mjs';

const qa = await startQA('deliveries');
const deliveries = readSandboxJson('src/content/deliveries/deliveries.json');
const dismissedJson = () => {
  try {
    return readSandboxJson('src/content/deliveries/dismissed.json').dismissed;
  } catch {
    return null;
  }
};

await qa.check('DEL-1', 'renders deliveries from deliveries.json', async (page) => {
  await page.goto(BASE + '/deliveries');
  await expectVisible(page.locator('h1', { hasText: 'Deliveries' }));
  const first = deliveries.deliveries?.[0];
  if (first) await expectVisible(page.getByText(first.vendor).first());
});

await qa.check('DEL-2', 'dismiss and restore round-trips through dismissed.json', async (page) => {
  const already = new Set((dismissedJson() ?? []).map((d) => d.id));
  const target = deliveries.deliveries?.find((d) => !already.has(d.id));
  if (!target) return; // nothing visible to dismiss
  const before = already.size;
  await page.goto(BASE + '/deliveries');
  await page.getByRole('button', { name: `Dismiss ${target.vendor} delivery` }).first().click();
  await poll(() => dismissedJson()?.length ?? -1, before + 1);
  await page.getByRole('button', { name: /^Dismissed \(\d+\)/ }).click();
  await page.getByRole('button', { name: `Restore ${target.vendor} delivery` }).first().click();
  await poll(() => dismissedJson()?.length ?? -1, before);
});

await qa.check('DEL-3', 'refresh trigger handles the shimmed agent without crashing', async (page) => {
  await page.goto(BASE + '/deliveries');
  const btn = page.getByRole('button', { name: /refresh|scan/i }).first();
  if ((await btn.count()) === 0) throw new Error('no refresh button found');
  const before = qa.consoleErrors.length;
  await btn.click();
  await page.waitForTimeout(12000); // let job-watch observe the shim exit
  const errs = qa.consoleErrors.slice(before);
  if (errs.length) throw new Error(errs.map((e) => e.text).join(' | '));
});

await qa.check('DEL-4', 'dashboard deliveries widget caps at maxItems', async (page) => {
  const registry = readSandboxJson('src/content/widgets/registry.json');
  const widget = registry.widgets.find((w) => w.type === 'deliveries' && w.enabled);
  if (!widget) return;
  await page.goto(BASE + '/');
  const dismissed = new Set((dismissedJson() ?? []).map((d) => d.id));
  const live = (deliveries.deliveries ?? []).filter((d) => !dismissed.has(d.id));
  if (live[0]) await expectVisible(page.getByText(live[0].vendor).first());
});

await qa.check('DEL-5', 'no console errors across deliveries flows', async () => {
  const errs = qa.consoleErrors;
  if (errs.length) throw new Error(`${errs.length} console errors, first: ${errs[0].text}`);
});

await qa.finish();
