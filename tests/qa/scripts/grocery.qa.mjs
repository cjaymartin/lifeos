// QA: grocery stack — see tests/qa/cases/grocery.md
// All mutations land in the sandboxed content copy; agent jobs hit the claude
// shim. Safe to exercise everything except real retailer browser sessions.
import { startQA, expectVisible, readSandboxJson, sandboxPath, poll, BASE } from './qa-lib.mjs';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'fs';

const qa = await startQA('grocery');

await qa.check('GROC-1', 'renders list, quick-add, and staples section', async (page) => {
  await page.goto(BASE + '/grocery');
  await expectVisible(page.locator('h1', { hasText: 'Groceries' }));
  await expectVisible(page.getByPlaceholder(/add an item/i));
  await expectVisible(page.getByText(/staples/i).first());
});

await qa.check('GROC-2', 'agent-written carts.json renders without crashing SSR', async (page) => {
  // Regression for the 2026-06-06 bug: carts written by /build-carts without
  // an `unmatched` array crashed GroceryApp SSR and hung /grocery. Seed an
  // agent-shaped cart (no unmatched, no addedQty) directly into the sandbox.
  const cartsPath = sandboxPath('src/content/grocery/carts.json');
  const before = existsSync(cartsPath) ? readFileSync(cartsPath, 'utf-8') : null;
  writeFileSync(cartsPath, JSON.stringify({
    builtAt: '2026-06-06T14:27:30.000Z',
    carts: [{
      retailer: 'walmart',
      label: 'Walmart',
      items: [{ itemId: 'qa-regression', name: 'QA Regression Wipes', productId: '14898365', qty: 1 }],
    }],
  }, null, 2));
  try {
    await page.goto(BASE + '/grocery', { timeout: 10000 });
    await expectVisible(page.getByText('QA Regression Wipes').first());
  } finally {
    if (before === null) rmSync(cartsPath, { force: true });
    else writeFileSync(cartsPath, before);
  }
});

let added;
await qa.check('GROC-3', 'quick-add appends an item, heuristically categorized + persisted', async (page) => {
  added = `qa cheddar cheese ${Date.now()}`;
  await page.goto(BASE + '/grocery');
  const input = page.getByPlaceholder(/add an item/i);
  await input.fill(added);
  await input.press('Enter');
  await expectVisible(page.getByText(added).first());
  await poll(() => readSandboxJson('src/content/grocery/grocery.json').items.some((i) => i.name === added), true);
});

await qa.check('GROC-4', 'check-off toggles and persists', async (page) => {
  await page.goto(BASE + '/grocery');
  await page.getByRole('button', { name: `Check off ${added}` }).click();
  await poll(
    () => readSandboxJson('src/content/grocery/grocery.json').items.find((i) => i.name === added)?.checked,
    true,
  );
});

await qa.check('GROC-5', 'checked item can be deleted via API and disappears', async (page) => {
  const item = readSandboxJson('src/content/grocery/grocery.json').items.find((i) => i.name === added);
  if (!item) throw new Error('added item vanished');
  const res = await qa.api(`/api/grocery/items/${item.id}`, { method: 'DELETE' });
  if (!res.ok()) throw new Error(`DELETE → ${res.status()}`);
  await poll(() => readSandboxJson('src/content/grocery/grocery.json').items.some((i) => i.id === item.id), false);
});

await qa.check('GROC-6', 'item PATCH edits name/category', async () => {
  // add via API, then edit
  const res = await qa.api('/api/grocery', { method: 'POST', data: { names: [`qa patch target ${Date.now()}`] } });
  if (!res.ok()) throw new Error(`POST → ${res.status()}`);
  const items = readSandboxJson('src/content/grocery/grocery.json').items;
  const target = items.find((i) => i.name.startsWith('qa patch target'));
  if (!target) throw new Error('API add did not persist');
  const patch = await qa.api(`/api/grocery/items/${target.id}`, {
    method: 'PATCH',
    data: { name: 'qa patched name', category: 'Pantry' },
  });
  if (!patch.ok()) throw new Error(`PATCH → ${patch.status()}`);
  await poll(() => readSandboxJson('src/content/grocery/grocery.json').items.find((i) => i.id === target.id)?.name, 'qa patched name');
  await qa.api(`/api/grocery/items/${target.id}`, { method: 'DELETE' });
});

await qa.check('GROC-7', 'staples CRUD round-trips', async () => {
  const name = `qa staple ${Date.now()}`;
  const add = await qa.api('/api/grocery/staples', { method: 'POST', data: { name, category: 'Pantry' } });
  if (!add.ok()) throw new Error(`POST → ${add.status()}`);
  const staples = () => readSandboxJson('src/content/grocery/staples.json').staples;
  await poll(() => staples().some((s) => s.name === name), true);
  const s = staples().find((x) => x.name === name);
  const upd = await qa.api('/api/grocery/staples', { method: 'PATCH', data: { id: s.id, status: 'low' } });
  if (!upd.ok()) throw new Error(`PATCH → ${upd.status()}`);
  await poll(() => staples().find((x) => x.id === s.id)?.status, 'low');
  const del = await qa.api('/api/grocery/staples', { method: 'DELETE', data: { id: s.id } });
  if (!del.ok()) throw new Error(`DELETE → ${del.status()}`);
  await poll(() => staples().some((x) => x.id === s.id), false);
});

await qa.check('GROC-8', 'build-carts resolves product-mapped items instantly', async (page) => {
  // Add an item that exists in product-map.json → assembleCarts should match
  // it without queueing the agent.
  const pm = readSandboxJson('src/content/grocery/product-map.json');
  const known = Object.keys(pm)[0];
  if (!known) return; // no product memory in fixture
  await qa.api('/api/grocery', { method: 'POST', data: { names: [known] } });
  await page.goto(BASE + '/grocery');
  const build = page.getByRole('button', { name: /build cart/i }).first();
  await build.waitFor({ state: 'visible', timeout: 5000 });
  await build.click();
  await poll(
    () => {
      const carts = readSandboxJson('src/content/grocery/carts.json');
      return (carts.carts ?? []).some((c) => (c.items ?? []).some((m) => m.name?.toLowerCase().includes(known.toLowerCase().slice(0, 8))));
    },
    true,
    { timeout: 15000 },
  );
});

await qa.check('GROC-9', 'purchase-scan trigger handles the shimmed agent gracefully', async (page) => {
  await page.goto(BASE + '/grocery');
  const scanBtn = page.getByRole('button', { name: /scan/i }).first();
  if ((await scanBtn.count()) === 0) return; // button may live behind a menu
  const before = qa.consoleErrors.length;
  await scanBtn.click();
  await page.waitForTimeout(12000); // job-watch poll cycle
  const errs = qa.consoleErrors.slice(before);
  if (errs.length) throw new Error(errs.map((e) => e.text).join(' | '));
});

await qa.check('GROC-10', 'checkout clears matched items, restocks staples, drops the cart', async () => {
  const carts = readSandboxJson('src/content/grocery/carts.json');
  const cart = (carts.carts ?? []).find((c) => (c.items ?? []).length > 0);
  if (!cart) throw new Error('no built cart to check out (GROC-8 should have made one)');
  const itemIds = cart.items.map((m) => m.itemId);
  const res = await qa.api('/api/grocery/checkout', { method: 'POST', data: { retailer: cart.retailer } });
  if (!res.ok()) throw new Error(`checkout → ${res.status()}`);
  await poll(() => {
    const g = readSandboxJson('src/content/grocery/grocery.json');
    return g.items.some((i) => itemIds.includes(i.id));
  }, false);
  const purchases = readSandboxJson('src/content/grocery/purchases.json');
  const recorded = (purchases.purchases ?? purchases ?? []).length > 0;
  if (!recorded) throw new Error('no purchase records written');
});

await qa.check('GROC-11', 'product-map API edits round-trip', async () => {
  const res = await qa.api('/api/grocery/product-map', {
    method: 'POST',
    data: { name: 'qa product map entry', url: 'https://www.walmart.com/ip/QA-Product/12345678' },
  });
  if (!res.ok()) throw new Error(`POST → ${res.status()}`);
  const pm = readSandboxJson('src/content/grocery/product-map.json');
  const key = Object.keys(pm).find((k) => k.includes('qa product map'));
  if (!key) throw new Error('entry not persisted');
  const del = await qa.api('/api/grocery/product-map', { method: 'DELETE', data: { name: 'qa product map entry' } });
  if (!del.ok()) throw new Error(`DELETE → ${del.status()}`);
});

await qa.check('GROC-12', 'no console errors across the grocery flows above', async (page) => {
  const errs = qa.consoleErrors;
  if (errs.length) throw new Error(`${errs.length} console errors, first: ${errs[0].text}`);
});

// Runs AFTER GROC-12: a 500 response makes the browser log a console error, so
// this check must not count against the zero-console-errors assertion above.
await qa.check('GROC-13', 'island SSR crash terminates with a 500, never hangs', async (page) => {
  // NIM-5: an island throwing during streamed SSR used to send 200 + partial
  // body then hang forever. With streaming disabled the throw surfaces before
  // headers, so we get a fast, terminated 500 + the custom error page. The tight
  // timeout is the actual regression assertion — a hang would blow past it.
  const res = await page.goto(BASE + '/dev/ssr-crash?boom=1', { timeout: 8000 });
  if (res?.status() !== 500) throw new Error(`expected 500, got ${res?.status()}`);
  await expectVisible(page.getByText(/couldn't render/i));
  // And the inert form (no ?boom) still renders, proving the route is harmless.
  await page.goto(BASE + '/dev/ssr-crash', { timeout: 8000 });
  await expectVisible(page.getByTestId('crash-island-ok'));
});

await qa.finish();
