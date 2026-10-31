import { type BrowserContext, expect, test } from '@playwright/test';

const signIn = (context: BrowserContext, name = 'editor') =>
  context.addCookies([{ name: 'cms_demo_user', value: name, domain: '127.0.0.1', path: '/' }]);

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}`;

test('signed in, a new document starts as a draft and stays reachable', async ({
  page,
  context,
  request,
}) => {
  await signIn(context);
  const title = unique('Draft');

  await page.goto('/admin#/new/notes');
  await page.getByRole('textbox', { name: /^title \*/i }).fill(title);
  await page.keyboard.press('Control+s');

  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/collections\/notes\//);

  // The public API does not see it.
  const anonymous = await request.get('/api/cms/collections/notes', {
    params: { 'where[title][equals]': title },
  });
  expect(((await anonymous.json()) as { totalDocs: number }).totalDocs).toBe(0);

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('button', { name: 'Unpublish' })).toBeVisible();

  await page.getByRole('button', { name: 'Unpublish' }).click();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();

  await page.goto('/admin#/collections/notes');
  await page.getByLabel('Status').selectOption('draft');
  await expect(page.getByRole('row').filter({ hasText: title })).toBeVisible();
  await page.getByLabel('Status').selectOption('published');
  await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0);
});

test('anonymous, unpublish is not offered because the draft could not be read back', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/cms/collections/notes', {
    data: { title: unique('Anon') },
  });
  const { id } = (await created.json()) as { id: string };

  await page.goto(`/admin#/collections/notes/${id}`);
  await expect(page.getByRole('textbox', { name: /^title \*/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unpublish' })).toHaveCount(0);
});

test('a draft autosaves, tabs and visibleWhen shape the form', async ({ page, context }) => {
  await signIn(context);
  await page.goto('/admin#/new/notes');
  await page.getByRole('textbox', { name: /^title \*/i }).fill(unique('Auto'));
  await page.keyboard.press('Control+s');
  await expect(page).toHaveURL(/collections\/notes\//);

  const input = page.getByRole('textbox', { name: /^title \*/i });
  await input.fill(unique('Autosaved'));
  await expect(page.getByText('Autosaved', { exact: true })).toBeVisible({ timeout: 5000 });

  await page.getByRole('tab', { name: 'Details' }).click();
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /^href/i })).toHaveCount(0);
  await page.getByLabel('Kind').selectOption('link');
  await expect(page.getByRole('textbox', { name: /^href/i })).toBeVisible();
});

test('a second editor sees the lock and cannot save', async ({ page, context, browser }) => {
  await signIn(context, 'alice');
  await page.goto('/admin#/new/notes');
  await page.getByRole('textbox', { name: /^title \*/i }).fill(unique('Lock'));
  await page.keyboard.press('Control+s');
  await expect(page).toHaveURL(/collections\/notes\/.+/);
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await page.waitForTimeout(400);

  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:5611' });
  await signIn(other, 'bob');
  const second = await other.newPage();
  await second.goto(page.url());
  await expect(second.getByText('Being edited by alice.')).toBeVisible();
  await expect(second.getByRole('button', { name: 'Save' })).toBeDisabled();
  await other.close();
});

test('history compares a version with the form', async ({ page, context, request }) => {
  await signIn(context);
  const title = unique('Compare');
  const created = await request.post('/api/cms/collections/notes', { data: { title } });
  const { id } = (await created.json()) as { id: string };
  await request.patch(`/api/cms/collections/notes/${id}`, { data: { title: `${title} v2` } });

  await page.goto(`/admin#/collections/notes/${id}`);
  await page.getByRole('button', { name: 'History' }).click();
  await page.getByRole('button', { name: 'Compare' }).last().click();
  await expect(page.locator('.diff del')).toHaveText(title);
  await expect(page.locator('.diff ins')).toHaveText(`${title} v2`);
});

test('anonymous cannot read a version snapshot', async ({ request }) => {
  const created = await request.post('/api/cms/collections/notes', {
    data: { title: unique('Secret') },
  });
  const { id } = (await created.json()) as { id: string };
  const response = await request.get(`/api/cms/collections/notes/${id}/versions/1?snapshot=true`);
  expect(response.status()).toBe(403);
});

test('globals open and save', async ({ page, request }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Site settings' }).click();
  const name = unique('Site');
  await page.getByRole('textbox', { name: /^site name/i }).fill(name);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const stored = (await (await request.get('/api/cms/globals/site')).json()) as {
    siteName: string;
  };
  expect(stored.siteName).toBe(name);
});

test('ctrl+k jumps to a document, and the list filters and picks columns', async ({
  page,
  request,
}) => {
  const title = unique('Palette');
  const created = await request.post('/api/cms/collections/notes', { data: { title } });
  const { id } = (await created.json()) as { id: string };

  await page.goto('/admin');
  await expect(page.locator('.brand')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: /search documents/i }).fill(title);
  await page.locator('.palette-dialog__item').filter({ hasText: title }).click();
  await expect(page).toHaveURL(new RegExp(id));

  await page.goto('/admin#/collections/notes');
  await page.locator('.menu summary').click();
  await page.locator('.menu__body').getByLabel('Href').check();
  await expect(page.getByRole('columnheader', { name: 'Href' })).toBeVisible();
  await page.locator('.menu__body').getByLabel('Href').uncheck();
  await page.locator('.menu summary').click();

  await page.locator('select[aria-label="Kind"]').selectOption('link');
  await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0);
});

test('a scheduled publish goes live on its own', async ({ page, context, request }) => {
  await signIn(context);
  await page.goto('/admin#/new/notes');
  const title = unique('Scheduled');
  await page.getByRole('textbox', { name: /^title \*/i }).fill(title);
  await page.keyboard.press('Control+s');
  await expect(page).toHaveURL(/collections\/notes\/.+/);
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();

  await page.locator('.menu summary', { hasText: 'Schedule' }).click();
  await page.getByLabel('Publish on').fill('2020-01-01T10:00');
  await page.locator('.menu__body').getByRole('button', { name: 'Schedule' }).click();

  await expect
    .poll(
      async () => {
        const response = await request.get('/api/cms/collections/notes', {
          params: { 'where[title][equals]': title },
        });
        return ((await response.json()) as { totalDocs: number }).totalDocs;
      },
      { timeout: 8000 },
    )
    .toBe(1);
});

test('a write reaches the webhook, signed', async ({ request }) => {
  const created = await request.post('/api/cms/collections/notes', {
    data: { title: unique('Hook') },
  });
  const { id } = (await created.json()) as { id: string };

  await expect
    .poll(
      async () => {
        const last = (await (await request.get('/webhook-sink')).json()) as {
          signature?: string;
          body?: { event?: string; documentId?: string };
        } | null;
        return `${last?.body?.event}:${last?.body?.documentId}:${last?.signature?.slice(0, 7)}`;
      },
      { timeout: 5000 },
    )
    .toBe(`notes.create:${id}:sha256=`);
});

test('csv imports into the collection, plugins add fields and collections', async ({
  page,
  request,
}) => {
  const title = unique('Csv "quoted", row');
  await page.goto('/admin#/collections/notes');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'notes.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`title,kind\n"${title.replace(/"/g, '""')}",link\n`),
  });
  await expect(page.getByText('1 imported')).toBeVisible();
  const found = await request.get('/api/cms/collections/notes', {
    params: { 'where[kind][equals]': 'link', limit: '200' },
  });
  const docs = ((await found.json()) as { docs: { title: string }[] }).docs;
  expect(docs.some((doc) => doc.title === title)).toBe(true);

  await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'Redirects' })).toBeVisible();
  const created = await request.post('/api/cms/collections/notes', {
    data: { title: unique('Seo'), seo: { metaTitle: 'Meta' } },
  });
  expect(((await created.json()) as { seo: { metaTitle: string } }).seo.metaTitle).toBe('Meta');
});

test('the media library picks an existing asset', async ({ page, request }) => {
  const filename = `${unique('asset').replace(' ', '-')}.pdf`;
  const media = await request.post('/api/cms/collections/media', {
    data: { filename, url: `/uploads/${filename}`, mime: 'application/pdf' },
  });
  const assetId = ((await media.json()) as { id: string }).id;
  const post = await request.post('/api/cms/collections/posts', {
    data: { title: unique('Media') },
  });
  const { id } = (await post.json()) as { id: string };

  await page.goto(`/admin#/collections/posts/${id}`);
  await page.getByRole('button', { name: 'Pick existing' }).click();
  await page.getByRole('dialog').getByRole('searchbox').fill(filename);
  await page.locator('.library__item').filter({ hasText: filename }).click();
  await expect(page.locator('.upload-card')).toContainText(filename);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect
    .poll(async () => {
      const doc = (await (await request.get(`/api/cms/collections/posts/${id}`)).json()) as {
        banner?: unknown;
      };
      return typeof doc.banner === 'string' ? doc.banner : (doc.banner as { id?: string })?.id;
    })
    .toBe(assetId);
});

test('editing a published document keeps what is live until publishing', async ({
  page,
  context,
  request,
}) => {
  await signIn(context);
  const live = unique('Live');
  const created = await request.post('/api/cms/collections/notes', { data: { title: live } });
  const { id } = (await created.json()) as { id: string };
  const publicTitle = async () =>
    ((await (await request.get(`/api/cms/collections/notes/${id}`)).json()) as { title: string })
      .title;

  await page.goto(`/admin#/collections/notes/${id}`);
  const input = page.getByRole('textbox', { name: /^title \*/i });
  await input.fill(`${live} edited`);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Published, with unpublished changes')).toBeVisible();
  expect(await publicTitle()).toBe(live);

  // Discarding goes back to what is live.
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(input).toHaveValue(live);

  await input.fill(`${live} final`);
  await page.getByRole('button', { name: 'Publish changes' }).click();
  await expect.poll(publicTitle).toBe(`${live} final`);
  await expect(page.getByText('Published, with unpublished changes')).toHaveCount(0);
});

test('bulk edit sets a field on every selected row', async ({ page, request }) => {
  const stamp = Date.now().toString(36);
  const ids: string[] = [];
  for (const n of [1, 2]) {
    const created = await request.post('/api/cms/collections/notes', {
      data: { title: `Bulk edit ${stamp} ${n}` },
    });
    ids.push(((await created.json()) as { id: string }).id);
  }

  await page.goto('/admin#/collections/notes');
  await page.getByRole('searchbox').fill(stamp);
  await expect(page.getByRole('row')).toHaveCount(3);
  await page.getByRole('checkbox', { name: 'Select all' }).check();
  await page.getByRole('status').getByRole('button', { name: 'Edit' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Field').selectOption('kind');
  await dialog.locator('#cms-bulk-value').selectOption('link');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('2 updated')).toBeVisible();

  for (const id of ids) {
    const doc = (await (await request.get(`/api/cms/collections/notes/${id}`)).json()) as {
      kind: string;
    };
    expect(doc.kind).toBe('link');
  }
});

test('list filters by relation and by date; point and join fields work', async ({
  page,
  request,
}) => {
  const stamp = Date.now().toString(36);
  const author = (await (
    await request.post('/api/cms/collections/authors', { data: { name: `Author ${stamp}` } })
  ).json()) as { id: string };
  const mine = `Joined ${stamp}`;
  await request.post('/api/cms/collections/posts', { data: { title: mine, author: author.id } });
  await request.post('/api/cms/collections/posts', { data: { title: `Other ${stamp}` } });

  await page.goto('/admin#/collections/posts');
  await page.getByRole('searchbox').fill(stamp);
  await expect(page.getByRole('row')).toHaveCount(3);
  await page.locator('select[aria-label="Author"]').selectOption(author.id);
  await expect(page.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('row').filter({ hasText: mine })).toBeVisible();

  // The join shows on the author, and leads back to the post.
  await page.goto(`/admin#/collections/authors/${author.id}`);
  await page.getByRole('link', { name: mine }).click();
  await expect(page.getByRole('textbox', { name: /^title \*/i })).toHaveValue(mine);

  const dated = (await (
    await request.post('/api/cms/collections/notes', {
      data: { title: `Dated ${stamp}`, dueOn: '2030-05-10', location: [-46.63, -23.55] },
    })
  ).json()) as { id: string; location: number[] };
  expect(dated.location).toEqual([-46.63, -23.55]);

  await page.goto('/admin#/collections/notes');
  await page.getByRole('searchbox').fill(stamp);
  await expect(page.getByRole('row')).toHaveCount(2);
  await page.locator('input[aria-label="Due on From"]').fill('2031-01-01');
  await expect(page.getByRole('row').filter({ hasText: `Dated ${stamp}` })).toHaveCount(0);
  await page.locator('input[aria-label="Due on From"]').fill('2030-01-01');
  await expect(page.getByRole('row').filter({ hasText: `Dated ${stamp}` })).toHaveCount(1);

  await page.goto(`/admin#/collections/notes/${dated.id}`);
  await page.getByRole('tab', { name: 'Details' }).click();
  await expect(page.getByLabel('Location Longitude')).toHaveValue('-46.63');
  await expect(page.getByLabel('Location Latitude')).toHaveValue('-23.55');
});
