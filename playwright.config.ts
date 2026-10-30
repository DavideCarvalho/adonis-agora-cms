import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5610' },
  webServer: {
    command: 'node e2e/server.mjs',
    url: 'http://127.0.0.1:5610',
    reuseExistingServer: true,
  },
});
