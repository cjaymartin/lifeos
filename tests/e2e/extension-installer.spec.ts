import { test, expect } from '@playwright/test';

// In the sandbox the extension isn't installed (no content script sets the
// detection marker), so both the sidebar prompt and the settings installer
// should surface the "not installed" path.
test.describe('browser extension installer', () => {
  test('sidebar shows "Download Extension" when the extension is not detected', async ({ page }) => {
    await page.goto('/grocery');
    // detectExtension resolves null after its poll window, then the item renders.
    await expect(page.getByRole('link', { name: 'Download Extension' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download Extension' })).toHaveAttribute(
      'href',
      '/settings/logins?tab=extension',
    );
  });

  test('settings → Browser Extension tab shows the installer card', async ({ page }) => {
    await page.goto('/settings/logins?tab=extension');
    await expect(page.getByText('LifeOS Browser Extension').first()).toBeVisible();
    await expect(page.getByText('Not installed')).toBeVisible();
    // The card's download button links to the packaging endpoint.
    await expect(page.locator('a[href="/api/extension/download"]')).toBeVisible();
  });
});
