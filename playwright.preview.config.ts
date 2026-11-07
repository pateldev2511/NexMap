import { defineConfig, devices } from '@playwright/test';

/**
 * Production-build browser checks (`npm run e2e:preview`): behaviour that only
 * exists in a real build, such as the offline service worker, which the dev-server
 * suite in e2e/ can't exercise. Specs serve their own copy of `dist/` (see
 * e2e-preview/host.ts), so the build is made once up front.
 */
export default defineConfig({
  testDir: './e2e-preview',
  globalSetup: './e2e-preview/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-preview' }]]
    : 'list',
  outputDir: 'test-results-preview',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
