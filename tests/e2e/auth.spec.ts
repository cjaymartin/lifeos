import { test, expect } from '@playwright/test';

// These tests run WITHOUT the minted session cookie.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('auth gate', () => {
  test('unauthenticated page request redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('login page renders passkey and TOTP options', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /sign in with passkey/i })).toBeVisible();
    await expect(page.locator('#totp-input')).toBeVisible();
    await expect(page.getByRole('button', { name: /verify code/i })).toBeVisible();
  });

  test('unauthenticated API request is rejected', async ({ request }) => {
    const res = await request.get('/api/grocery', { maxRedirects: 0 });
    // Middleware redirects to /login before the route's own 401 fires.
    expect([301, 302, 303, 307, 308, 401]).toContain(res.status());
  });

  test('stack pages are gated too', async ({ page }) => {
    for (const path of ['/grocery', '/deliveries', '/tasks', '/settings/logins']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  });
});
