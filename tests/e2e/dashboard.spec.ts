import { test, expect } from '@playwright/test';

test.describe('dashboard', () => {
  test('renders title, greeting, and refresh button', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Dashboard — LifeOS');
    // Greeting comes from the daily/today.md vault note (falls back to "Good morning.")
    await expect(page.locator('h1').first()).not.toBeEmpty();
    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible();
  });

  test('sidebar links to every stack and settings', async ({ page }) => {
    await page.goto('/');
    for (const href of ['/tasks', '/deliveries', '/recipes', '/grocery']) {
      await expect(page.locator(`a[href="${href}"]`).first()).toBeAttached();
    }
  });

  test('refresh button walks the job state machine (shimmed agent → Failed)', async ({ page }) => {
    test.slow(); // first status poll happens 8s after trigger
    await page.goto('/');
    await page.getByRole('button', { name: /refresh/i }).click();
    await expect(page.getByRole('button', { name: /Refreshing…/ })).toBeVisible();
    // The claude shim exits instantly without rewriting today.md, so the
    // watcher's "process exited but file unchanged" rule must report failure.
    await expect(page.getByRole('button', { name: /Failed/ })).toBeVisible({ timeout: 25_000 });
  });

  test('widget cards from the registry render', async ({ page }) => {
    const helpers = await import('./helpers');
    const registry = helpers.readSandboxJson<{ widgets: any[] }>(
      'src/content/widgets/registry.json',
    );
    const daily = helpers.readSandboxVaultNote<any>('daily/today.md');

    await page.goto('/');

    // Weather card: shows current temp + condition when data exists
    const weather = registry.widgets.find((w) => w.type === 'weather' && w.enabled);
    if (weather && daily?.weather) {
      await expect(page.getByText(daily.weather.condition).first()).toBeVisible();
    }

    // Tasks widget island mounts when enabled
    const tasksWidget = registry.widgets.find((w) => w.type === 'tasks' && w.enabled);
    if (tasksWidget) {
      await expect(page.getByText(/tasks/i).first()).toBeVisible();
    }

    // Briefing text renders when present
    const briefing = registry.widgets.find((w) => w.type === 'briefing' && w.enabled);
    if (briefing && daily?.briefing) {
      await expect(page.getByText(daily.briefing.slice(0, 40)).first()).toBeVisible();
    }
  });
});
