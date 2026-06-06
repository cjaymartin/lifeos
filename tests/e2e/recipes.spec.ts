import { test, expect } from '@playwright/test';

test.describe('recipes stack', () => {
  test('lists saved recipes', async ({ page }) => {
    await page.goto('/recipes');
    await expect(page).toHaveTitle(/Recipes.*LifeOS/);
    // Two recipes exist as content fixtures
    await expect(page.getByText(/protein creami/i).first()).toBeVisible();
  });
});
