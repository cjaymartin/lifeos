import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.LIFEOS_TEST_PORT ?? '4399';
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false, // single shared content sandbox — keep ordering deterministic
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    storageState: 'tests/e2e/.auth/state.json',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/test-server.mjs',
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 30_000,
    // Cap the Walmart front-door's wait for the extension so channel tests
    // resolve in seconds, and so a mishap fails fast instead of ever reaching
    // the Playwright fallback (which would launch a real browser in a test).
    env: { LIFEOS_WM_WAIT_MS: '8000', LIFEOS_WM_PRESENCE_MS: '45000' },
  },
});
