// QA: settings stack — see tests/qa/cases/settings.md
// `relogin` launches a real headed browser against the retailer — manual-only,
// never triggered here. `verify` runs the shimmed claude — safe.
import { startQA, expectVisible, readSandboxJson, BASE } from './qa-lib.mjs';

const qa = await startQA('settings');

await qa.check('SET-1', '/settings redirects to the logins tab', async (page) => {
  await page.goto(BASE + '/settings');
  if (!/\/settings\/logins$/.test(page.url())) throw new Error(`landed on ${page.url()}`);
  await expectVisible(page.locator('h1', { hasText: 'Settings' }));
});

await qa.check('SET-2', 'account cards render with status from status.json', async (page) => {
  await page.goto(BASE + '/settings/logins');
  const status = readSandboxJson('src/content/settings/status.json');
  for (const name of ['walmart', 'amazon', 'todoist']) {
    await expectVisible(page.getByText(new RegExp(name, 'i')).first());
  }
  // A failed account should show some failure indication
  const failed = Object.entries(status.accounts ?? status).find(([, v]) => v?.status === 'failed');
  if (failed) {
    await expectVisible(page.getByText(/failed|error|attention/i).first());
  }
});

await qa.check('SET-3', 'verify trigger returns 202 and the shimmed probe lands in failed', async (page) => {
  await page.goto(BASE + '/settings/logins');
  const res = await qa.api('/api/settings/verify', {
    method: 'POST',
    data: { accountId: 'todoist' },
    headers: { origin: BASE },
  });
  if (![200, 202].includes(res.status())) throw new Error(`verify → ${res.status()}`);
  // shim exits 0 with no PROBE_OK → runner should record a failure, not hang
  await page.waitForTimeout(8000);
  const status = readSandboxJson('src/content/settings/status.json');
  const acct = (status.accounts ?? status).todoist;
  if (!acct) throw new Error('no todoist entry in status.json');
  if (acct.status === 'verifying' || acct.status === 'running') throw new Error(`verify stuck in ${acct.status}`);
});

await qa.check('SET-4', 'invalid todoist token is rejected with 422', async () => {
  const res = await qa.api('/api/settings/token', {
    method: 'POST',
    data: { accountId: 'todoist', token: 'qa-invalid-token' },
    headers: { origin: BASE },
  });
  if (res.status() !== 422) throw new Error(`expected 422, got ${res.status()}`);
});

await qa.check('SET-5', 'cookie import endpoint validates its payload', async () => {
  const bad = await qa.api('/api/settings/cookies', {
    method: 'POST',
    data: { accountId: 'walmart' }, // missing cookies array
    headers: { origin: BASE },
  });
  if (bad.status() >= 500) throw new Error(`malformed payload → ${bad.status()} (server error)`);
});

await qa.check('SET-6', 'credentials endpoint stores and deletes secrets', async () => {
  const put = await qa.api('/api/settings/credentials', {
    method: 'POST',
    data: { accountId: 'walmart', username: 'qa@example.com', password: 'qa-password' },
    headers: { origin: BASE },
  });
  if (!put.ok()) throw new Error(`POST → ${put.status()}`);
  const del = await qa.api('/api/settings/credentials', {
    method: 'DELETE',
    data: { accountId: 'walmart' },
    headers: { origin: BASE },
  });
  if (!del.ok()) throw new Error(`DELETE → ${del.status()}`);
});

await qa.check('SET-7', 'no console errors on settings page', async (page) => {
  const before = qa.consoleErrors.length;
  await page.goto(BASE + '/settings/logins');
  await page.waitForTimeout(1500);
  const errs = qa.consoleErrors.slice(before);
  if (errs.length) throw new Error(errs.map((e) => e.text).join(' | '));
});

await qa.finish();
