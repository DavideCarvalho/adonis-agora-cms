import { expect, test } from '@playwright/test';

async function createPost(request: import('@playwright/test').APIRequestContext, prefix: string) {
  const authors = (await (await request.get('/api/cms/collections/authors')).json()) as {
    docs: { id: string }[];
  };
  const title = `${prefix} ${Date.now().toString(36)}`;
  const created = await request.post('/api/cms/collections/posts', {
    data: { title, author: authors.docs[0]?.id, status: 'published' },
  });
  expect(created.status()).toBe(201);
  return { id: ((await created.json()) as { id: string }).id, title };
}

test('saving stays on the document and clears the unsaved marker', async ({ page, request }) => {
  const { id, title } = await createPost(request, 'Stay');
  await page.goto(`/admin#/collections/posts/${id}`);

  const save = page.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();

  const input = page.getByRole('textbox', { name: /^title \*/i });
  await input.fill(`${title} edited`);
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByText('Unsaved changes')).toHaveCount(0);
  await expect(input).toHaveValue(`${title} edited`);
  expect(page.url()).toContain(id);
});

test('leaving with unsaved changes asks first', async ({ page, request }) => {
  const { id, title } = await createPost(request, 'Guard');
  await page.goto(`/admin#/collections/posts/${id}`);

  await page.getByRole('textbox', { name: /^title \*/i }).fill(`${title} x`);
  await page.getByRole('button', { name: 'back' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(page.url()).toContain(id);

  await page.getByRole('button', { name: 'back' }).click();
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('searchbox')).toBeVisible();
});

test('restoring a version replaces what the form shows', async ({ page, request }) => {
  const { id, title } = await createPost(request, 'Restore');
  await request.patch(`/api/cms/collections/posts/${id}`, { data: { title: `${title} two` } });
  await page.goto(`/admin#/collections/posts/${id}`);

  const input = page.getByRole('textbox', { name: /^title \*/i });
  await expect(input).toHaveValue(`${title} two`);

  await page.getByRole('button', { name: 'History' }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).last().click();
  await expect(input).toHaveValue(title);
});

test('the list searches, and rows can be deleted in bulk', async ({ page, request }) => {
  const first = await createPost(request, 'Bulk');
  await createPost(request, `Bulk ${first.title.split(' ')[1]}`);
  await page.goto('/admin#/collections/posts');

  await page.getByRole('searchbox').fill(first.title.split(' ')[1] as string);
  const rows = page.getByRole('row').filter({ hasText: first.title.split(' ')[1] as string });
  await expect(page.getByRole('row')).toHaveCount(3);

  await page.getByRole('checkbox', { name: 'Select all' }).check();
  await page.getByRole('status').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(rows).toHaveCount(0);
});

test('duplicate opens an independent copy', async ({ page, request }) => {
  const { id, title } = await createPost(request, 'Dup');
  await page.goto(`/admin#/collections/posts/${id}`);
  await page.getByRole('button', { name: 'Duplicate' }).click();

  await expect(page.getByRole('textbox', { name: /^title \*/i })).toHaveValue(`${title} (copy)`);
  expect(page.url()).not.toContain(id);
});
