import { test, expect } from '@playwright/test';

// NIM-7 regression guard. Runtime secrets are read from process.env only (never
// the build-time import.meta.env that `astro build` inlines), and the test
// server scrubs the env — so the sandbox must show Todoist as "Not connected"
// even when the dev machine that ran the build has a real TODOIST_API_TOKEN in
// .env. If a secret read ever falls back to import.meta.env again, the baked
// token would reconnect the sandbox to the real account and this fails.
//
// Skipped under the fake-provider run (which deliberately reports connected).
test.skip(
  process.env.LIFEOS_FAKE_TASKS === '1',
  'fake provider intentionally reports connected',
);

test('Todoist is not connected in the isolated sandbox', async ({ page }) => {
  await page.goto('/tasks');
  await expect(page.getByText('Not connected')).toBeVisible();
  await expect(page.getByText("Todoist isn't connected yet")).toBeVisible();
  // Quick-add is gated on a real connection, so it must be absent.
  await expect(page.getByPlaceholder('Add a task…')).toHaveCount(0);
});
