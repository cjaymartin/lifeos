// QA: authentication & access control — see tests/qa/cases/auth.md
import { startQA, expectVisible, BASE } from './qa-lib.mjs';

const qa = await startQA('auth');
const anon = await qa.anonContext();
const anonPage = await anon.newPage();

await qa.check('AUTH-1', 'unauthenticated page request redirects to /login', async () => {
  await anonPage.goto(BASE + '/');
  if (!/\/login$/.test(anonPage.url())) throw new Error(`landed on ${anonPage.url()}`);
});

await qa.check('AUTH-2', 'every stack page is gated', async () => {
  for (const path of ['/tasks', '/grocery', '/deliveries', '/recipes', '/settings/logins', '/setup/passkey']) {
    await anonPage.goto(BASE + path);
    if (!/\/login$/.test(anonPage.url())) throw new Error(`${path} landed on ${anonPage.url()}`);
  }
});

await qa.check('AUTH-3', 'unauthenticated API requests are rejected', async () => {
  for (const path of ['/api/grocery', '/api/tasks', '/api/settings/accounts', '/api/refresh/status']) {
    const res = await anon.request.get(BASE + path, { maxRedirects: 0 });
    if (![301, 302, 303, 307, 308, 401].includes(res.status())) {
      throw new Error(`${path} → ${res.status()}`);
    }
  }
});

await qa.check('AUTH-4', 'login page renders passkey and TOTP options', async () => {
  await anonPage.goto(BASE + '/login');
  await expectVisible(anonPage.getByRole('button', { name: /sign in with passkey/i }));
  await expectVisible(anonPage.locator('#totp-input'));
  await expectVisible(anonPage.getByRole('button', { name: /verify code/i }));
});

await qa.check('AUTH-5', 'wrong TOTP code is rejected without a session', async () => {
  await anonPage.goto(BASE + '/login');
  await anonPage.locator('#totp-input').fill('000000');
  // Auto-submit at 6 digits or explicit verify — give it a moment either way
  await anonPage.getByRole('button', { name: /verify code/i }).click().catch(() => {});
  await anonPage.waitForTimeout(1500);
  if (!/\/login/.test(anonPage.url())) throw new Error(`left login: ${anonPage.url()}`);
  const cookies = await anon.cookies();
  if (cookies.some((c) => c.name === 'lifeos_session' && c.value)) throw new Error('session cookie was set');
});

await qa.check('AUTH-6', 'authed visit to /login redirects to dashboard', async (page) => {
  await page.goto(BASE + '/login');
  if (/\/login$/.test(page.url())) throw new Error('stayed on /login while authed');
});

await qa.check('AUTH-7', 'passkey setup page renders for an authed session', async (page) => {
  await page.goto(BASE + '/setup/passkey');
  await expectVisible(page.getByText(/passkey/i));
});

await qa.check('AUTH-8', 'todoist webhook is dormant without its secret (501)', async () => {
  const res = await qa.api('/api/webhooks/todoist', { method: 'POST', data: { evil: true } });
  if (res.status() !== 501) throw new Error(`expected 501, got ${res.status()}`);
});

await qa.check('AUTH-9', 'sidebar logout form clears the session', async () => {
  // Use a dedicated context so we don't kill the main QA session.
  // Astro's checkOrigin CSRF guard 403s POSTs without a same-origin Origin
  // header, so drive the real sidebar <form> like a user would.
  const ctx = await qa.browser.newContext({
    storageState: JSON.parse(JSON.stringify({ cookies: (await qa.context.cookies()), origins: [] })),
    baseURL: BASE,
  });
  const page2 = await ctx.newPage();
  await page2.goto(BASE + '/');
  await page2.locator('form[action="/api/auth/logout"] button').first().click();
  await page2.waitForURL(/\/login$/, { timeout: 5000 });
  await page2.goto(BASE + '/tasks');
  if (!/\/login$/.test(page2.url())) throw new Error(`still authed: ${page2.url()}`);
  await ctx.close();
});

await qa.check('AUTH-10', 'API POST without Origin header is CSRF-rejected (403)', async () => {
  // Deliberately bypass qa.api (which adds a same-origin Origin header) —
  // and use a throwaway context so a hypothetical success can't log out the
  // main QA session.
  const ctx = await qa.browser.newContext({
    storageState: { cookies: await qa.context.cookies(), origins: [] },
    baseURL: BASE,
  });
  const res = await ctx.request.post(BASE + '/api/auth/logout');
  await ctx.close();
  if (res.status() !== 403) throw new Error(`expected 403, got ${res.status()}`);
});

await anon.close();
await qa.finish();
