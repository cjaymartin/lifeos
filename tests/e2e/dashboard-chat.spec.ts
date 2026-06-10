import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { sandboxPath } from './helpers';

// The dashboard (/) gets a cross-feature assistant that routes a question to the
// relevant feature(s) and synthesizes a reply. The agent is shimmed in the
// sandbox (exits 0, empty reply), so this verifies the assistant mounts, the
// hand-off route runs without crashing, and the conversation persists under the
// dashboard's own content dir — without a real/billable agent run.
test.describe.configure({ mode: 'serial' });

const HISTORY = 'src/content/dashboard/.chat-history.json';
const MSG = `dash ask ${Math.random().toString(36).slice(2, 8)} grocery list`;

async function openChat(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Dashboard assistant' }).click();
  await expect(page.getByPlaceholder('Ask anything…')).toBeVisible();
}

test('the dashboard assistant answers a cross-feature question and persists it', async ({ page }) => {
  await openChat(page);
  await page.getByPlaceholder('Ask anything…').fill(MSG);
  await page.getByRole('button', { name: 'Send' }).click();

  // The user bubble shows immediately…
  await expect(page.getByText(MSG, { exact: true })).toBeVisible();
  // …and the hand-off route ran end-to-end, persisting under the dashboard's content dir.
  await expect.poll(() => existsSync(sandboxPath(HISTORY))).toBe(true);

  // Reload: a fresh page with no React state must restore the conversation.
  await page.reload();
  await page.getByRole('button', { name: 'Open Dashboard assistant' }).click();
  await expect(page.getByText(MSG, { exact: true })).toBeVisible();
});

test('the clear control wipes the dashboard conversation and its file', async ({ page }) => {
  await openChat(page);
  await expect(page.getByText(MSG, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Clear chat' }).click();

  await expect(page.getByText(MSG, { exact: true })).toHaveCount(0);
  await expect.poll(() => existsSync(sandboxPath(HISTORY))).toBe(false);
});
