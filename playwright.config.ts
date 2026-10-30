import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // The specs share one database and the admin's visual editor; one worker keeps the order
  // deterministic (the docs they create are unique, but the list views overlap).
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5611' },
  webServer: {
    command: 'node ace.js serve --no-watch',
    cwd: 'examples/blog',
    url: 'http://127.0.0.1:5611/admin',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
