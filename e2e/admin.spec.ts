import { expect, test } from '@playwright/test';

test('admin serves from the Adonis app and drives the CMS REST API', async ({ page, request }) => {
  const list = await request.get('/api/cms/collections/posts');
  const body = (await list.json()) as { totalDocs: number };

  if (body.totalDocs === 0) {
    const created = await request.post('/api/cms/collections/posts', {
      data: { title: 'Hello world', status: 'published' },
    });
    expect(created.status()).toBe(201);
  }

  await page.goto('/admin');

  await expect(page.getByRole('button', { name: 'Posts' })).toBeVisible();
  await page.getByRole('button', { name: 'Posts' }).click();

  await expect(page.getByRole('cell', { name: 'Hello world' })).toBeVisible();
  await expect(page.getByText(/published/i).first()).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('title')).toHaveValue('Hello world');
});
