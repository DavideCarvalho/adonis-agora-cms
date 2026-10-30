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

  // Selecting a block fills the inspector with its fields; the nested array renders real rows.
  await page.getByRole('button', { name: '#2 features' }).click();
  await expect(page.getByRole('textbox', { name: /^title$/ }).nth(0)).toHaveValue('Nested one');
  await expect(page.getByRole('textbox', { name: /^title$/ }).nth(1)).toHaveValue('Nested two');

  // A page with blocks opens in the visual editor: the page is already on screen, no Preview click.
  const frame = page.frameLocator('iframe');
  const heading = frame.locator('[data-cms-field="layout[0].heading"]');
  await expect(heading).toBeVisible();
  await heading.click();

  await expect(page.getByRole('textbox', { name: /^heading \*/ })).toBeFocused();
});

/**
 * Visual editing in the preview: each block has a hover toolbar, and its actions mutate the same
 * form the editor sees on the left (delete removes the row, drag reorders it) before saving.
 */
test('preview toolbar deletes and reorders blocks', async ({ page, request }) => {
  const title = `Visual ${Date.now().toString(36)}`;
  const created = await request.post('/api/cms/collections/pages', {
    data: {
      title,
      visibility: 'public',
      layout: [
        { type: 'hero', heading: 'First', subheading: 'one' },
        { type: 'quote', quote: 'Second', attribution: 'two' },
        { type: 'cta', heading: 'Third', text: 'three' },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { id: string }).id;

  await page.goto('/admin');
  await page.getByRole('button', { name: 'Pages' }).click();
  await page
    .getByRole('row')
    .filter({ hasText: title })
    .getByRole('button', { name: 'Edit' })
    .click();

  const frame = page.frameLocator('iframe');
  const first = frame.locator('[data-cms-block="layout[0]"]');
  await first.waitFor();

  // Delete the middle block from the page itself; the palette mirrors the page order.
  const pageBlocks = page.locator('.palette__item--row');
  await expect(pageBlocks).toHaveCount(3);

  const second = frame.locator('[data-cms-block="layout[1]"]');
  await second.hover();
  // The toolbar lives in an overlay outside the page's React tree, positioned over the hovered
  // block (injecting it inside the block made React drop it on every re-render).
  const frameOverlay = frame.locator('#cms-preview-overlay');
  await frameOverlay.locator('button[data-act="delete"]').click();

  await expect(pageBlocks).toHaveCount(2);
  await expect(pageBlocks.nth(0)).toContainText('hero');
  await expect(pageBlocks.nth(1)).toContainText('cta');

  // Drag the first block below the last one.
  const hero = frame.locator('[data-cms-block="layout[0]"]');
  await hero.hover();
  const handle = frame.locator('#cms-preview-overlay button[data-act="drag"]');
  const from = await handle.boundingBox();
  // The bridge renumbers the blocks after the delete, so the remaining blocks are 0 and 1.
  const target = frame.locator('[data-cms-block="layout[1]"]');
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('block handles are not laid out');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(pageBlocks.nth(0)).toContainText('cta');
  await expect(pageBlocks.nth(1)).toContainText('hero');

  await page.getByRole('button', { name: 'Save' }).click();

  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/cms/collections/pages/${id}`);
        const doc = (await response.json()) as { layout: { type: string }[] };
        return doc.layout.map((block) => block.type);
      },
      { timeout: 15_000 },
    )
    .toEqual(['cta', 'hero']);
});

/**
 * The palette is how a page is assembled: clicking appends a block, dragging drops it where the
 * cursor is. Both land in the same form the Save sends.
 */
test('palette adds blocks by click and by drag', async ({ page, request }) => {
  const title = `Palette ${Date.now().toString(36)}`;
  const created = await request.post('/api/cms/collections/pages', {
    data: { title, visibility: 'public', layout: [{ type: 'hero', heading: 'Start' }] },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { id: string }).id;

  await page.goto('/admin');
  await page.getByRole('button', { name: 'Pages' }).click();
  await page
    .getByRole('row')
    .filter({ hasText: title })
    .getByRole('button', { name: 'Edit' })
    .click();

  const pageBlocks = page.locator('.palette__item--row');
  await expect(pageBlocks).toHaveCount(1);

  // Click appends.
  await page.locator('.palette__item').filter({ hasText: 'quote' }).first().click();
  await expect(pageBlocks).toHaveCount(2);
  await expect(pageBlocks.nth(1)).toContainText('quote');

  // Drag drops after the block under the cursor.
  const frame = page.frameLocator('iframe');
  const firstBlock = frame.locator('[data-cms-block="layout[0]"]');
  await firstBlock.waitFor();
  await page.locator('.palette__item').filter({ hasText: 'text' }).first().dragTo(firstBlock);

  await expect(pageBlocks).toHaveCount(3);
  await expect(pageBlocks.nth(1)).toContainText('text');

  await page.getByRole('button', { name: 'Save' }).click();

  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/cms/collections/pages/${id}`);
        const doc = (await response.json()) as { layout: { type: string }[] };
        return doc.layout.map((block) => block.type);
      },
      { timeout: 15_000 },
    )
    .toEqual(['hero', 'text', 'quote']);
});

/** The preview's own menus: a right-click palette and the "+" insert, both dismissing on outside click. */
test('preview block menu acts on the page and closes on outside click', async ({
  page,
  request,
}) => {
  const title = `Menu ${Date.now().toString(36)}`;
  const created = await request.post('/api/cms/collections/pages', {
    data: {
      title,
      visibility: 'public',
      layout: [
        { type: 'hero', heading: 'One' },
        { type: 'quote', quote: 'Two' },
        { type: 'cta', heading: 'Three' },
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

  const frame = page.frameLocator('iframe');
  const blocks = frame.locator('[data-cms-block]');
  await expect(blocks).toHaveCount(3);

  const second = frame.locator('[data-cms-block="layout[1]"]');
  await second.click({ button: 'right' });
  await expect(page.getByRole('menuitem')).toHaveCount(5);

  // Outside click dismisses.
  await page.mouse.click(page.viewportSize()!.width - 40, 20);
  await expect(page.getByRole('menuitem')).toHaveCount(0);

  // Delete from the menu removes the row. (The page re-rendering from the posted data needs the
  // site to call `useLivePreviewData`, which the string renderer in this example does not.)
  await second.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Excluir' }).click();
  await expect(page.locator('.palette__item--row')).toHaveCount(2);
});
