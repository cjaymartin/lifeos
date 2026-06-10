import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { sandboxPath } from './helpers';

// NIM-10: a stack's AI conversation persists across reloads, and a clear control
// wipes both the UI and the persisted file. The agent is shimmed in the sandbox
// (exits 0, empty reply), so this verifies persistence without a real agent run.
test.describe.configure({ mode: 'serial' });

const HISTORY = 'src/content/grocery/.chat-history.json';
const MSG = `persist me ${Math.random().toString(36).slice(2, 8)}`;

async function openChat(page: import('@playwright/test').Page) {
  await page.goto('/grocery');
  await page.getByRole('button', { name: 'Open Groceries assistant' }).click();
  await expect(page.getByPlaceholder('Ask anything…')).toBeVisible();
}

test('a sent message persists to the stack content store and survives a reload', async ({ page }) => {
  await openChat(page);
  await page.getByPlaceholder('Ask anything…').fill(MSG);
  await page.getByRole('button', { name: 'Send' }).click();

  // The user bubble shows immediately…
  await expect(page.getByText(MSG, { exact: true })).toBeVisible();
  // …and the conversation is written locally (proof it's persisted, not just in React state).
  await expect.poll(() => existsSync(sandboxPath(HISTORY))).toBe(true);

  // Reload: a fresh page with no React state must restore the conversation.
  await page.reload();
  await page.getByRole('button', { name: 'Open Groceries assistant' }).click();
  await expect(page.getByText(MSG, { exact: true })).toBeVisible();
});

test('the clear control wipes the conversation and the persisted file', async ({ page }) => {
  await openChat(page);
  await expect(page.getByText(MSG, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Clear chat' }).click();

  await expect(page.getByText(MSG, { exact: true })).toHaveCount(0);
  await expect.poll(() => existsSync(sandboxPath(HISTORY))).toBe(false);

  // And it stays cleared across a reload.
  await page.reload();
  await page.getByRole('button', { name: 'Open Groceries assistant' }).click();
  await expect(page.getByText(MSG, { exact: true })).toHaveCount(0);
});
