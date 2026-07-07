import { test, expect } from '@playwright/test';
import { readSandboxJson, readSandboxVaultNotes } from './helpers';

/** Dismissed delivery ids from the machine store (empty if none/unreadable). */
function dismissedIds(): Set<string> {
  try {
    return new Set(
      readSandboxJson<{ dismissed: { id: string }[] }>(
        'src/content/deliveries/dismissed.json',
      ).dismissed.map((d) => d.id),
    );
  } catch {
    return new Set();
  }
}

test.describe('deliveries stack', () => {
  test('renders deliveries from the vault', async ({ page }) => {
    // Deliveries are now one Markdown note per delivery in the vault; the page
    // hides dismissed ones (loadDeliveries filters them), so assert against the
    // first non-dismissed note.
    const deliveries = readSandboxVaultNotes<any>('deliveries');
    const dismissed = dismissedIds();
    const visible = deliveries.find((d) => !dismissed.has(d.id));

    await page.goto('/deliveries');
    await expect(page.locator('h1', { hasText: 'Deliveries' })).toBeVisible();

    if (visible) {
      await expect(page.getByText(visible.vendor).first()).toBeVisible();
    }
  });

  test('dismiss and restore a delivery round-trips', async ({ page }) => {
    // The server's write is now atomic (temp + rename, NIM-6 / #7), so a poll
    // can no longer catch the file mid-write. We keep treating an unparseable
    // read as "not yet" as belt-and-suspenders against any future regression.
    const dismissedJson = () => {
      try {
        return readSandboxJson<{ dismissed: { id: string }[] }>(
          'src/content/deliveries/dismissed.json',
        ).dismissed;
      } catch {
        return null;
      }
    };
    const deliveries = readSandboxVaultNotes<any>('deliveries');
    const already = new Set((dismissedJson() ?? []).map((d) => d.id));
    const target = deliveries.find((d) => !already.has(d.id));
    test.skip(!target, 'no visible deliveries in fixture data');
    const before = already.size;

    await page.goto('/deliveries');
    await page.getByRole('button', { name: `Dismiss ${target!.vendor} delivery` }).first().click();

    await expect.poll(() => dismissedJson()?.length ?? -1).toBe(before + 1);

    // Restore it — the dismissed section is collapsed behind a toggle
    await page.getByRole('button', { name: /^Dismissed \(\d+\)/ }).click();
    await page.getByRole('button', { name: `Restore ${target!.vendor} delivery` }).first().click();
    await expect.poll(() => dismissedJson()?.length ?? -1).toBe(before);
  });
});
