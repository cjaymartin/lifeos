// QA: stack chat sidebar — see tests/qa/cases/chat.md
// The chat agent is the shimmed claude (exits 0, no output) — these checks
// verify the UI fails gracefully, not that chat produces answers.
import { startQA, expectVisible, BASE } from './qa-lib.mjs';

const qa = await startQA('chat');

await qa.check('CHAT-1', 'chat mount is present on stack pages', async (page) => {
  await page.goto(BASE + '/grocery');
  const toggle = page.getByRole('button', { name: /chat|assistant/i }).first();
  if ((await toggle.count()) === 0) {
    // Maybe always-open sidebar — look for an input instead
    const input = page.getByPlaceholder(/ask|message|chat/i).first();
    if ((await input.count()) === 0) throw new Error('no chat affordance on /grocery');
  }
});

await qa.check('CHAT-2', 'sending a message with a shimmed agent shows an error state, not a hang', async (page) => {
  await page.goto(BASE + '/grocery');
  const toggle = page.getByRole('button', { name: /chat|assistant/i }).first();
  if ((await toggle.count()) > 0) await toggle.click();
  const input = page.getByPlaceholder(/ask|message|chat/i).first();
  if ((await input.count()) === 0) throw new Error('no chat input after opening sidebar');
  await input.fill('qa: what is on my grocery list?');
  await input.press('Enter');
  // Shim returns no JSON → /api/chat should error; UI must show something
  // and re-enable the input rather than spin forever.
  await page.waitForTimeout(10000);
  const spinning = await page.locator('[class*="animate-spin"]').count();
  const errorShown = await page.getByText(/error|failed|something went wrong|try again/i).count();
  if (spinning > 0 && errorShown === 0) throw new Error('chat still spinning with no error after 10s');
});

await qa.check('CHAT-3', '/api/chat rejects an unknown stack id', async () => {
  const res = await qa.api('/api/chat', {
    method: 'POST',
    data: { stackId: 'not-a-real-stack', messages: [{ role: 'user', content: 'hi' }] },
    headers: { origin: BASE },
  });
  if (res.status() >= 500) throw new Error(`unknown stack → ${res.status()} (server error)`);
  if (res.ok()) {
    // acceptable only if the response is an explicit error payload
    const body = await res.text();
    if (!/error|unknown/i.test(body)) throw new Error('unknown stackId accepted silently');
  }
});

await qa.check('CHAT-4', 'no page errors from the chat sidebar', async () => {
  const errs = qa.consoleErrors.filter((e) => e.text.startsWith('pageerror'));
  if (errs.length) throw new Error(errs.map((e) => e.text).join(' | '));
});

await qa.finish();
