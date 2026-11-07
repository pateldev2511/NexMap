import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests for the critical canvas flows that unit tests can't
 * cover (real DOM, gestures, persistence). Runs against the Vite dev server, where
 * the service worker is never registered; production-build checks such as offline
 * use live in e2e-preview/ (`npm run e2e:preview`).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // CI: annotations in the PR plus an HTML report (uploaded by the workflow, with
  // traces of every failing test) so a red run can be inspected.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
