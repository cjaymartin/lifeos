import { test, expect } from '@playwright/test';
import { readSandboxJson } from './helpers';

test.describe('grocery stack', () => {
  test('renders the list from grocery.json', async ({ page }) => {
    const grocery = readSandboxJson<{ items: any[] }>('src/content/grocery/grocery.json');
    await page.goto('/grocery');
    await expect(page.locator('h1', { hasText: 'Groceries' })).toBeVisible();
    await expect(page.getByPlaceholder(/add an item/i)).toBeVisible();

    const unchecked = grocery.items.find((i) => !i.checked);
    if (unchecked) {
      await expect(page.getByText(unchecked.name).first()).toBeVisible();
    }
  });

  test('quick-add appends an item and persists it', async ({ page }) => {
    const name = `e2e cheddar cheese ${Date.now()}`;
    await page.goto('/grocery');
    const input = page.getByPlaceholder(/add an item/i);
    await input.fill(name);
    await input.press('Enter');

    await expect(page.getByText(name).first()).toBeVisible();

    // Persisted to the (sandboxed) content store, not just optimistic state
    await expect
      .poll(() => {
        const grocery = readSandboxJson<{ items: any[] }>('src/content/grocery/grocery.json');
        return grocery.items.some((i) => i.name === name);
      })
      .toBe(true);
  });

  test('checking an item toggles it', async ({ page }) => {
    const grocery = readSandboxJson<{ items: any[] }>('src/content/grocery/grocery.json');
    const target = grocery.items.find((i) => !i.checked && !i.staple);
    test.skip(!target, 'no unchecked non-staple item in fixture data');

    await page.goto('/grocery');
    await page.getByRole('button', { name: `Check off ${target!.name}` }).click();

    await expect
      .poll(() => {
        const after = readSandboxJson<{ items: any[] }>('src/content/grocery/grocery.json');
        return after.items.find((i) => i.id === target!.id)?.checked;
      })
      .toBe(true);
  });

  test('staples section is reachable', async ({ page }) => {
    await page.goto('/grocery');
    await expect(page.getByText(/staples/i).first()).toBeVisible();
  });
});
