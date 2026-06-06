import { test, expect } from '@playwright/test';

test.describe('settings stack', () => {
  test('/settings redirects to the logins tab', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings\/logins$/);
    await expect(page.locator('h1', { hasText: 'Settings' })).toBeVisible();
  });

  test('account cards render', async ({ page }) => {
    await page.goto('/settings/logins');
    // The account ladder always includes Walmart and Todoist definitions
    await expect(page.getByText(/walmart/i).first()).toBeVisible();
    await expect(page.getByText(/todoist/i).first()).toBeVisible();
  });
});
