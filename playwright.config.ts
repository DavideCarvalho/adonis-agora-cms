import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // The specs share one database and the admin's visual editor; one worker keeps the order
  // deterministic (the docs they create are unique, but the list views overlap).
  workers: 1,
  use: { baseURL: process.env.CMS_BASE_URL ?? 'http://127.0.0.1:5611' },
  webServer: process.env.CMS_BASE_URL
    ? undefined
    : {
        command: 'node ace.js serve --no-watch',
        cwd: 'examples/blog',
        // The example's `.env` is not committed, so a clean checkout (CI) gets its values here.
        env: {
          HOST: '127.0.0.1',
          PORT: '5611',
          APP_KEY: 'e2e-only-key-not-a-secret-0123456789',
          NODE_ENV: 'development',
        },
        url: 'http://127.0.0.1:5611/admin',
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
