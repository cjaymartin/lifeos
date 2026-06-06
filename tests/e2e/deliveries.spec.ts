import { test, expect } from '@playwright/test';
import { readSandboxJson } from './helpers';

test.describe('deliveries stack', () => {
  test('renders deliveries from deliveries.json', async ({ page }) => {
    const data = readSandboxJson<{ deliveries: any[] }>('src/content/deliveries/deliveries.json');
    await page.goto('/deliveries');
    await expect(page.locator('h1', { hasText: 'Deliveries' })).toBeVisible();

    const first = data.deliveries?.[0];
    if (first) {
      await expect(page.getByText(first.vendor).first()).toBeVisible();
    }
  });

  test('dismiss and restore a delivery round-trips', async ({ page }) => {
    // The server's write isn't atomic, so a poll can catch the file mid-write —
    // treat an unparseable read as "not yet" rather than failing the poll.
    const dismissedJson = () => {
      try {
        return readSandboxJson<{ dismissed: { id: string }[] }>(
          'src/content/deliveries/dismissed.json',
        ).dismissed;
      } catch {
        return null;
      }
    };
    const data = readSandboxJson<{ deliveries: any[] }>('src/content/deliveries/deliveries.json');
    const already = new Set((dismissedJson() ?? []).map((d) => d.id));
    const target = data.deliveries?.find((d) => !already.has(d.id));
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
