import { test, expect } from '@playwright/test';
import { readSandboxJson, writeSandboxJson } from './helpers';

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

  test('cart reconciliation records which lines actually landed', async ({ page }) => {
    // Seed a built cart with both lines marked added, so the card offers "Edit"
    // (the reconcile panel) without any external add-to-cart navigation.
    writeSandboxJson('src/content/grocery/carts.json', {
      builtAt: '2026-06-09T00:00:00.000Z',
      carts: [{
        retailer: 'walmart',
        label: 'Walmart',
        unmatched: [],
        items: [
          { itemId: 'recon-a', name: 'Recon Apples', product: 'Apples', price: '$3.00', productId: 'A1', qty: 1, addedQty: 1, confidence: 'high', source: 'reorder' },
          { itemId: 'recon-b', name: 'Recon Bananas', product: 'Bananas', price: '$2.00', productId: 'B2', qty: 1, addedQty: 1, confidence: 'high', source: 'reorder' },
        ],
      }],
    });

    await page.goto('/grocery');
    await expect(page.getByText('Built carts')).toBeVisible();
    // Estimated total sums the matched line prices
    await expect(page.getByText(/Est\. \$5\.00 · before tax/i)).toBeVisible();

    // Open reconcile, uncheck the bananas (didn't land), confirm
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByText(/Which items made it into your Walmart cart/i)).toBeVisible();
    await page.getByRole('button', { name: 'Recon Bananas', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm cart' }).click();

    // Apples stay in-cart (addedQty=1); bananas reset to pending (cleared)
    await expect
      .poll(() => {
        const c = readSandboxJson<{ carts: any[] }>('src/content/grocery/carts.json');
        const items = c.carts[0].items;
        return [
          items.find((i) => i.itemId === 'recon-a')?.addedQty ?? null,
          items.find((i) => i.itemId === 'recon-b')?.addedQty ?? null,
        ];
      })
      .toEqual([1, null]);
  });
});
