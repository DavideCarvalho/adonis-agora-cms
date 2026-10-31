import { expect, test } from '@playwright/test';

test('admin drives the CMS REST API end to end', async ({ page, request }) => {
  const authors = await request.get('/api/cms/collections/authors');
  const authorsBody = (await authors.json()) as { docs: { id: string; name: string }[] };

  let authorId = authorsBody.docs[0]?.id;
  if (!authorId) {
    const created = await request.post('/api/cms/collections/authors', {
      data: { name: 'Davi Carvalho' },
    });
    expect(created.status()).toBe(201);
    authorId = ((await created.json()) as { id: string }).id;
  }

  // Each run owns its document: the specs share one database and run in parallel workers.
  const title = `Hello world ${Date.now().toString(36)}`;

  const created = await request.post('/api/cms/collections/posts', {
    data: {
      title,
      subtitle: { 'pt-BR': 'Primeiro post', en: 'First post' },
      body: {
        tiptap: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello body' }] }],
        },
      },
      author: authorId,
      status: 'published',
    },
  });
  expect(created.status()).toBe(201);

  await page.goto('/admin');

  await page.getByRole('navigation').getByRole('button', { name: 'Posts' }).click();

  // Other specs create posts in the same collection, so every table interaction is scoped to
  // this row instead of matching the first Edit/Delete button on the page.
  const helloRow = page.getByRole('row').filter({ hasText: title });
  await expect(helloRow).toBeVisible();
  await expect(helloRow.locator('.badge')).toHaveText(/published/i);

  await helloRow.getByRole('button', { name: 'Edit' }).click();

  await expect(page.getByRole('textbox', { name: /^title \*/i })).toHaveValue(title);

  // Localized field follows the locale switcher instead of rendering the raw map.
  await expect(page.getByRole('textbox', { name: /^subtitle/i })).toHaveValue('Primeiro post');
  await page.getByLabel('locale').selectOption('en');
  await expect(page.getByRole('textbox', { name: /^subtitle/i })).toHaveValue('First post');

  // Rich text renders a real editor, not a textarea.
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.locator('.ProseMirror')).toContainText('Hello body');

  // Version history uses the REST versions endpoint.
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText(/^v\d+$/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Current|Restore/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  // Relation picker loads real options.
  await expect(page.getByLabel('author')).toHaveValue(authorId);
  await expect(
    page.getByLabel('author').locator('option', { hasText: 'Davi Carvalho' }),
  ).toHaveCount(1);

  // Back to the list: soft delete, trash view and restore.
  await page.getByRole('button', { name: 'back' }).click();
  await expect(helloRow).toBeVisible();

  await helloRow.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('cell', { name: title })).toHaveCount(0);

  await page.getByLabel('Show deleted').check();
  await helloRow.getByRole('button', { name: 'Restore' }).click();

  await page.getByLabel('Show deleted').uncheck();
  await expect(helloRow).toBeVisible();
});
