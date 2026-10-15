const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:18767', browserName: 'chromium', headless: true, serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node tests/server.cjs', url: 'http://127.0.0.1:18767', reuseExistingServer: false }
});
