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

  test('observed-cart ingest reconciles the cart (auto-fill)', async ({ page }) => {
    writeSandboxJson('src/content/grocery/carts.json', {
      builtAt: '2026-06-09T00:00:00.000Z',
      carts: [{
        retailer: 'walmart',
        label: 'Walmart',
        unmatched: [],
        items: [
          { itemId: 'obs-a', name: 'Obs Apples', product: 'Apples', price: '$3.00', productId: 'PA', qty: 1, source: 'reorder' },
          { itemId: 'obs-b', name: 'Obs Bread', product: 'Bread', price: '$2.00', productId: 'PB', qty: 1, source: 'reorder' },
        ],
      }],
    });

    await page.goto('/grocery');
    await expect(page.getByText('Built carts')).toBeVisible();

    // The bookmarklet posts what's really in the Walmart cart — only Apples (PA)
    const resp = await page.request.post('/api/grocery/carts/observed', {
      data: { retailer: 'walmart', items: [{ productId: 'PA' }] },
    });
    expect(resp.ok()).toBeTruthy();
    expect((await resp.json()).inCart).toBe(1);

    // Apples marked in-cart, Bread reset to pending
    await expect
      .poll(() => {
        const c = readSandboxJson<{ carts: any[] }>('src/content/grocery/carts.json');
        const items = c.carts[0].items;
        return [
          items.find((i) => i.itemId === 'obs-a').addedQty ?? null,
          items.find((i) => i.itemId === 'obs-b').addedQty ?? null,
        ];
      })
      .toEqual([1, null]);

    // UI reflects the observation after a reload
    await page.reload();
    await expect(page.getByText('in cart')).toBeVisible();
  });

  test('one-click pin from a cart line locks the exact product', async ({ page }) => {
    writeSandboxJson('src/content/grocery/carts.json', {
      builtAt: '2026-06-09T00:00:00.000Z',
      carts: [{
        retailer: 'walmart',
        label: 'Walmart',
        unmatched: [],
        items: [{ itemId: 'pin-1', name: 'Pin Cereal', product: 'GV Cereal', price: '$3.00', productId: 'PC1', productUrl: 'https://www.walmart.com/ip/PC1', qty: 1, source: 'reorder' }],
      }],
    });

    await page.goto('/grocery');
    await expect(page.getByText('Built carts')).toBeVisible();

    await page.getByRole('button', { name: /Always use/ }).click();

    await expect
      .poll(() => {
        const m = readSandboxJson<Record<string, any>>('src/content/grocery/product-map.json');
        return m['pin cereal'] ?? null;
      })
      .toMatchObject({ productId: 'PC1', pinned: true });
  });

  test('the item settings menu renders visibly (portal, not clipped)', async ({ page }) => {
    const name = `e2e gearcheck ${Date.now()}`;
    await page.goto('/grocery');
    const input = page.getByPlaceholder(/add an item/i);
    await input.fill(name);
    await input.press('Enter');
    await expect(page.getByText(name).first()).toBeVisible();

    // Open the cog — the menu is portalled to <body>, so it must be visible even
    // though the category accordion has overflow-hidden.
    await page.getByRole('button', { name: `Settings for ${name}` }).click();
    await expect(page.getByText('Always buy from')).toBeVisible();
  });

  test('changing a cart line product via URL swaps and pins it', async ({ page }) => {
    writeSandboxJson('src/content/grocery/carts.json', {
      builtAt: '2026-06-10T00:00:00.000Z',
      carts: [{
        retailer: 'walmart',
        label: 'Walmart',
        unmatched: [],
        items: [{ itemId: 'chg-1', name: 'Chg Coffee', product: 'Wrong Coffee', price: '$5.00', productId: 'WRONG1', productUrl: 'https://www.walmart.com/ip/WRONG1', qty: 1, source: 'reorder' }],
      }],
    });

    await page.goto('/grocery');
    await expect(page.getByText('Built carts')).toBeVisible();

    await page.getByRole('button', { name: 'Change product for Chg Coffee' }).click();
    await page.getByPlaceholder(/walmart\.com\/ip/i).fill('https://www.walmart.com/ip/Right-Coffee/445566');
    await page.getByRole('button', { name: 'Set product' }).click();

    await expect
      .poll(() => {
        const m = readSandboxJson<Record<string, any>>('src/content/grocery/product-map.json');
        return m['chg coffee'] ?? null;
      })
      .toMatchObject({ productId: '445566', pinned: true });
  });

  test('an out-of-stock line offers a substitute that gets applied', async ({ page }) => {
    writeSandboxJson('src/content/grocery/carts.json', {
      builtAt: '2026-06-09T00:00:00.000Z',
      carts: [{
        retailer: 'walmart',
        label: 'Walmart',
        unmatched: [],
        items: [{
          itemId: 'oos-1', name: 'Oos Dragonfruit', productId: 'OOS1', product: 'Fresh Dragonfruit', price: '$7.00', qty: 1,
          status: 'out_of_stock',
          alternatives: [{ productId: 'ALT9', product: 'Frozen Dragonfruit', size: '10 oz', price: '$6.00', productUrl: 'https://www.walmart.com/ip/ALT9' }],
        }],
      }],
    });

    await page.goto('/grocery');
    await expect(page.getByText('Built carts')).toBeVisible();
    await expect(page.getByText('out of stock')).toBeVisible();

    await page.getByRole('button', { name: /Frozen Dragonfruit/ }).click();

    await expect
      .poll(() => {
        const c = readSandboxJson<{ carts: any[] }>('src/content/grocery/carts.json');
        const line = c.carts[0].items[0];
        return [line.productId, line.status, line.substituted];
      })
      .toEqual(['ALT9', 'ok', true]);
  });
});
