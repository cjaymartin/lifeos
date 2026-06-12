import { test, expect } from '@playwright/test';

// NIM-5 regression. A React island that throws during SSR used to send a 200 +
// partial body and then hang forever (headers already flushed, stream never
// completes). With `experimentalDisableStreaming` (astro.config.mjs) the page is
// rendered fully before headers go out, so the throw becomes a terminated 500 +
// the custom 500.astro page instead of an infinite hang.
test.describe('SSR island crash handling', () => {
  test('a throwing island returns a 500 error page, not a hang', async ({ page }) => {
    // A real hang would exceed this and fail the test rather than spin forever.
    const res = await page.goto('/dev/ssr-crash?boom=1', { timeout: 10_000 });
    expect(res?.status()).toBe(500);
    await expect(page.getByText(/couldn't render/i)).toBeVisible();
  });

  test('the same route renders normally without the crash flag', async ({ page }) => {
    const res = await page.goto('/dev/ssr-crash', { timeout: 10_000 });
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId('crash-island-ok')).toBeVisible();
  });
});
