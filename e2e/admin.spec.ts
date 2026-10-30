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

  const posts = await request.get('/api/cms/collections/posts');
  const postsBody = (await posts.json()) as { totalDocs: number };

  if (postsBody.totalDocs === 0) {
    const created = await request.post('/api/cms/collections/posts', {
      data: {
        title: 'Hello world',
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
  }

  await page.goto('/admin');

  await page.getByRole('button', { name: 'Posts' }).click();
  await expect(page.getByRole('cell', { name: 'Hello world' })).toBeVisible();
  await expect(page.getByText(/published/i).first()).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).click();

  await expect(page.getByRole('textbox', { name: /^title\*/ })).toHaveValue('Hello world');

  // Localized field follows the locale switcher instead of rendering the raw map.
  await expect(page.getByRole('textbox', { name: /^subtitle/ })).toHaveValue('Primeiro post');
  await page.getByLabel('locale').selectOption('en');
  await expect(page.getByRole('textbox', { name: /^subtitle/ })).toHaveValue('First post');

  // Rich text renders a real editor, not a textarea.
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.locator('.ProseMirror')).toContainText('Hello body');

  // Version history uses the REST versions endpoint.
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText(/#\d+/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Current|Restore/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  // Relation picker loads real options.
  await expect(page.getByLabel('author')).toHaveValue(authorId);
  await expect(
    page.getByLabel('author').locator('option', { hasText: 'Davi Carvalho' }),
  ).toHaveCount(1);
});
