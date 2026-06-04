// E2E test: Deliveries refresh button — mints a session cookie, clicks Refresh,
// and waits for the sync to finish. Run: node scripts/test-deliveries-refresh.mjs
import { chromium } from 'playwright';
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';

const BASE = process.env.TEST_BASE_URL ?? 'https://lifeos.localhost';

// Mint the session cookie the same way src/lib/auth.ts does
const env = readFileSync(new URL('../.env', import.meta.url), 'utf-8');
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1]?.trim();
if (!secret) { console.error('FAIL: SESSION_SECRET not found in .env'); process.exit(1); }
const token = createHmac('sha256', secret).update('lifeos-session-v2').digest('hex');

const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
await ctx.addCookies([{
  name: 'lifeos_session', value: token,
  domain: new URL(BASE).hostname, path: '/',
}]);
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });

const fail = async (msg) => {
  await page.screenshot({ path: '/tmp/deliveries-fail.png', fullPage: true });
  console.error(`FAIL: ${msg} (screenshot: /tmp/deliveries-fail.png)`);
  await browser.close();
  process.exit(1);
};

console.log(`1. Loading ${BASE}/deliveries …`);
await page.goto(`${BASE}/deliveries`, { waitUntil: 'networkidle', timeout: 30_000 });
if (page.url().includes('/login')) await fail('redirected to /login — session cookie not accepted');

const heading = page.locator('h1', { hasText: 'Deliveries' });
if (!(await heading.isVisible().catch(() => false))) await fail('Deliveries heading not visible');
console.log('   page loaded ✓');

const button = page.locator('button', { hasText: /Refresh|Scanning/ });
if (!(await button.isVisible().catch(() => false))) await fail('Refresh button not found');

console.log('2. Clicking Refresh …');
await button.click();
await page.waitForTimeout(2_000);

const text = (await button.textContent())?.trim() ?? '';
console.log(`   button state: "${text}"`);
if (text === 'Failed') await fail('button showed Failed immediately after click');

// Wait for the sync to finish — Gmail scan can take a few minutes
console.log('3. Waiting for sync to complete (up to 5 min) …');
const start = Date.now();
let result = 'timeout';
while (Date.now() - start < 5 * 60_000) {
  const t = (await button.textContent().catch(() => ''))?.trim() ?? '';
  if (t === 'Done') { result = 'done'; break; }
  if (t === 'Failed') { result = 'failed'; break; }
  // success path reloads the page — button returns to idle with data rendered
  if (t === 'Refresh') { result = 'reloaded'; break; }
  await page.waitForTimeout(3_000);
}
console.log(`   result: ${result} after ${Math.round((Date.now() - start) / 1000)}s`);
if (result === 'failed' || result === 'timeout') await fail(`refresh ended in "${result}"`);

// After reload, verify the page shows synced state
await page.waitForTimeout(2_000);
const synced = await page.locator('text=/Last synced/').isVisible().catch(() => false);
const empty = await page.locator('text=/No upcoming deliveries/').isVisible().catch(() => false);
const groups = await page.locator('h2').count();
console.log(`4. Post-sync: lastSynced=${synced} emptyState=${empty} statusGroups=${groups}`);
if (!synced) await fail('no "Last synced" timestamp after refresh — deliveries.json not written?');

await page.screenshot({ path: '/tmp/deliveries-ok.png', fullPage: true });
console.log('PASS — refresh completed and page shows synced data (screenshot: /tmp/deliveries-ok.png)');
await browser.close();
