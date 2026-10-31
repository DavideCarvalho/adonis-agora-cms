import { expect, test } from '@playwright/test';

// 1×1 transparent PNG — enough for an `image/*` upload without a fixture file.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * `upload` fields take a dropped file, not just a relation id. The drop is dispatched with a real
 * `DataTransfer` so the component's `onDrop` path runs, then the value is saved and read back.
 */
test('upload field takes a dropped file and stores the asset', async ({ page, request }) => {
  const title = `Upload ${Date.now().toString(36)}`;
  const created = await request.post('/api/cms/collections/posts', { data: { title } });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { id: string }).id;

  await page.goto('/admin');
  await page.getByRole('button', { name: 'Posts' }).click();
  await page
    .getByRole('row')
    .filter({ hasText: title })
    .getByRole('button', { name: 'Edit' })
    .click();

  const dropzone = page.getByRole('button', { name: 'Upload banner' });
  await expect(dropzone).toBeVisible();

  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'banner.png', { type: 'image/png' }));
    document
      .querySelector('.upload-drop')
      ?.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
  }, PNG.toString('base64'));

  // The card replaces the dropzone once the endpoint returns the stored asset.
  await expect(page.getByText('banner.png')).toBeVisible();
  await expect(page.getByText(/image\/png/)).toBeVisible();

  // Stored through @adonisjs/drive, and Drive serves it back.
  const src = await page.locator('.upload-card__thumb img').getAttribute('src');
  expect(src).toMatch(/\/files\/cms\//);
  const served = await request.get(new URL(src ?? '', 'http://127.0.0.1:5611').pathname);
  expect(served.status()).toBe(200);

  await page.getByRole('button', { name: 'Save' }).click();

  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/cms/collections/posts/${id}`);
        const doc = (await response.json()) as { banner?: unknown };
        return typeof doc.banner === 'string' && doc.banner.length > 0;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});
