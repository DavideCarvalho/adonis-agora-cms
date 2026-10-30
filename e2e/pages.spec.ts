import { expect, test } from '@playwright/test';

/**
 * The `pages` model: a page is a document whose `layout` is a list of blocks, the site maps each
 * block slug to a component, and access is decided per document (Payload's `doc` argument).
 */
test('pages render through the block map and access is per document', async ({ request }) => {
  const stamp = Date.now().toString(36);
  const title = `Landing ${stamp}`;

  const created = await request.post('/api/cms/collections/pages', {
    data: {
      title,
      visibility: 'public',
      layout: [
        { type: 'hero', heading: 'Editable heading', subheading: 'And a subheading' },
        {
          type: 'text',
          body: {
            tiptap: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body copy' }] }],
            },
          },
        },
        {
          type: 'features',
          heading: 'Highlights',
          items: [{ title: 'First', text: 'One' }],
        },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const page = (await created.json()) as { id: string; slug: string };

  // The frontend map renders each block and marks the field it came from.
  const html = await request.get(`/p/${page.slug}`);
  expect(html.status()).toBe(200);
  const body = await html.text();
  expect(body).toContain('Editable heading');
  expect(body).toContain('Body copy');
  expect(body).toContain('Highlights');
  expect(body).toContain('data-cms-field="layout[0].heading"');
  expect(body).toContain('data-cms-field="layout[2].items[0].title"');

  // Access is per document: private pages are invisible by id, locked pages reject updates.
  const privatePage = await request.post('/api/cms/collections/pages', {
    data: { title: `Secret ${stamp}`, visibility: 'private' },
  });
  expect(privatePage.status()).toBe(201);
  const privateId = ((await privatePage.json()) as { id: string }).id;

  const privateRead = await request.get(`/api/cms/collections/pages/${privateId}`);
  expect(privateRead.status()).toBe(404);

  const lockedPage = await request.post('/api/cms/collections/pages', {
    data: { title: `Locked ${stamp}`, visibility: 'locked' },
  });
  expect(lockedPage.status()).toBe(201);
  const lockedId = ((await lockedPage.json()) as { id: string }).id;

  const lockedUpdate = await request.patch(`/api/cms/collections/pages/${lockedId}`, {
    data: { title: 'Changed' },
  });
  // The route is open, so a denied write reads as unauthorized rather than forbidden.
  expect(lockedUpdate.status()).toBe(401);
  expect(((await lockedUpdate.json()) as { error: { code: string } }).error.code).toBe(
    'CMS_UNAUTHORIZED',
  );

  const publicRead = await request.get(`/api/cms/collections/pages/${page.id}`);
  expect(publicRead.status()).toBe(200);
});

test('live preview jumps from a block region to its field', async ({ page, request }) => {
  const title = `Preview page ${Date.now().toString(36)}`;
  const created = await request.post('/api/cms/collections/pages', {
    data: {
      title,
      visibility: 'public',
      layout: [
        { type: 'hero', heading: 'Click me', subheading: 'Sub' },
        {
          type: 'features',
          heading: 'Blocks',
          items: [
            { title: 'Nested one', text: 'First' },
            { title: 'Nested two', text: 'Second' },
          ],
        },
      ],
    },
  });
  expect(created.status()).toBe(201);

  await page.goto('/admin');
  await page.getByRole('button', { name: 'Pages' }).click();
  await page
    .getByRole('row')
    .filter({ hasText: title })
    .getByRole('button', { name: 'Edit' })
    .click();

  // A block that contains an array renders the array builder, not a scalar fallback.
  await expect(page.getByRole('textbox', { name: /^title$/ }).nth(0)).toHaveValue('Nested one');
  await expect(page.getByRole('textbox', { name: /^title$/ }).nth(1)).toHaveValue('Nested two');

  await page.getByRole('button', { name: 'Preview' }).click();

  const frame = page.frameLocator('iframe');
  const heading = frame.locator('[data-cms-field="layout[0].heading"]');
  await expect(heading).toBeVisible();
  await heading.click();

  await expect(page.getByRole('textbox', { name: /^heading \*/ })).toBeFocused();
});
