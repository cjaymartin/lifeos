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
  },
});
