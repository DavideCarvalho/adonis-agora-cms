import { expect, test } from '@playwright/test';

/**
 * Live preview marks what is editable: the page tags regions with `data-cms-field`, the admin
 * injects the bridge for same-origin frames, and a click in the page focuses the matching field.
 */
test('preview marks editable regions and a click focuses the field', async ({ page, request }) => {
  const title = `Preview ${Date.now().toString(36)}`;
  const created = await request.post('/api/cms/collections/posts', {
    data: { title, subtitle: 'Primeiro post', status: 'published' },
  });
  expect(created.status()).toBe(201);

  await page.goto('/admin');
  await page.getByRole('navigation').getByRole('button', { name: 'Posts' }).click();
  await page
    .getByRole('row')
    .filter({ hasText: title })
    .getByRole('button', { name: 'Edit' })
    .click();

  await page.getByRole('button', { name: 'Preview' }).click();

  const frame = page.frameLocator('iframe');
  const heading = frame.locator('h1[data-cms-field="title"]');
  await expect(heading).toBeVisible();

  // The injected bridge outlines the editable region under the pointer.
  await heading.hover();
  await expect(heading).toHaveCSS('outline-style', 'solid');

  await heading.click();
  await expect(page.getByRole('textbox', { name: /^title \*/i })).toBeFocused();
});

test('a collection that does not ask for it has no preview', async ({ page, request }) => {
  const created = await request.post('/api/cms/collections/authors', {
    data: { name: `No preview ${Date.now().toString(36)}` },
  });
  const { id } = (await created.json()) as { id: string };

  await page.goto(`/admin#/collections/authors/${id}`);
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview' })).toHaveCount(0);
});
