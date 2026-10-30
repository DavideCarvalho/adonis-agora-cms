import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
});
await page.goto(
  'http://127.0.0.1:5611/admin#/collections/pages/c40ef26a-d552-4d17-9213-5e6fa9133a3c',
);
await page.getByRole('button', { name: 'Preview' }).click();
const frame = page.frameLocator('iframe');
const block = frame.locator('[data-cms-block="layout[1]"]');
await block.waitFor({ timeout: 15000 });
await block.hover();
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/opencode/visual-toolbar.png' });
console.log('bars', await frame.locator('.cms-block-bar').count());
await browser.close();
