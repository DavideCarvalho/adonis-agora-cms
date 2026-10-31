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
  await page
    .locator('.palette-dialog__item')
    .filter({ hasText: title })
    .filter({ hasText: 'Note' })
    .click();
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
      { timeout: Number(process.env.E2E_SCHEDULE_TIMEOUT ?? 8000) },
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
  await expect(
    page.getByRole('navigation').getByRole('button', { name: 'Redirects' }),
  ).toBeVisible();
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

test('the panel opens on a dashboard, with what an extension adds', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Hello from a widget')).toBeVisible();
  await page.getByRole('button', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Custom report' })).toBeVisible();
});

test('rich text holds a block and a link to a document', async ({ page, request }) => {
  const title = unique('Rich');
  const created = await request.post('/api/cms/collections/posts', { data: { title } });
  const { id } = (await created.json()) as { id: string };

  await page.goto(`/admin#/collections/posts/${id}`);
  await page.locator('.rich-text__body').click();
  await page.getByTitle('Insert a block: Callout').click();
  await page.locator('.rich-block').getByRole('textbox').fill('Inside the text');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect
    .poll(async () => {
      const doc = (await (await request.get(`/api/cms/collections/posts/${id}`)).json()) as {
        body?: unknown;
      };
      return JSON.stringify(doc.body);
    })
    .toContain('Inside the text');

  // It comes back as a block, not as text.
  await page.reload();
  await expect(page.locator('.rich-block').getByRole('textbox')).toHaveValue('Inside the text');

  const other = await request.post('/api/cms/collections/posts', {
    data: { title: `${title} link` },
  });
  await page.goto(`/admin#/collections/posts/${((await other.json()) as { id: string }).id}`);
  await page.locator('.rich-text__body').click();
  await page.keyboard.type('link me');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByLabel('Link to a document').selectOption({ index: 1 });
  await expect(page.locator('.rich-text__body a[href^="cms:"]')).toHaveCount(1);
});

test('plugins: search stays in step, forms check answers, pages nest', async ({ request }) => {
  const stamp = Date.now().toString(36);
  const note = (await (
    await request.post('/api/cms/collections/notes', { data: { title: `Findable ${stamp}` } })
  ).json()) as { id: string };
  const search = () =>
    request
      .get('/api/cms/collections/search', {
        params: { 'where[text][iContains]': `findable ${stamp}` },
      })
      .then((r) => r.json()) as Promise<{ totalDocs: number }>;
  await expect.poll(async () => (await search()).totalDocs).toBe(1);
  await request.delete(`/api/cms/collections/notes/${note.id}?force=true`);
  await expect.poll(async () => (await search()).totalDocs).toBe(0);

  const form = (await (
    await request.post('/api/cms/collections/forms', {
      data: {
        title: `Contact ${stamp}`,
        fields: [{ name: 'email', type: 'email', required: true }],
      },
    })
  ).json()) as { id: string };
  const missing = await request.post('/api/cms/collections/form_submissions', {
    data: { form: form.id, answers: {} },
  });
  expect(missing.status()).toBe(422);
  const ok = await request.post('/api/cms/collections/form_submissions', {
    data: { form: form.id, answers: { email: 'a@b.co', injected: 'no' } },
  });
  expect(ok.status()).toBe(201);
  expect(((await ok.json()) as { answers: unknown }).answers).toEqual({ email: 'a@b.co' });
  // Anyone can answer; only a user can read the answers.
  const read = await request.get('/api/cms/collections/form_submissions');
  expect(((await read.json()) as { totalDocs: number }).totalDocs).toBe(0);

  const parent = (await (
    await request.post('/api/cms/collections/pages', {
      data: { title: `Parent ${stamp}`, slug: `parent-${stamp}` },
    })
  ).json()) as { id: string };
  const child = (await (
    await request.post('/api/cms/collections/pages', {
      data: { title: `Child ${stamp}`, slug: `child-${stamp}`, parent: parent.id },
    })
  ).json()) as { id: string; breadcrumbs: { title: string }[] };
  expect(child.breadcrumbs.map((crumb) => crumb.title)).toEqual([`Parent ${stamp}`]);
  const cycle = await request.patch(`/api/cms/collections/pages/${parent.id}`, {
    data: { parent: child.id },
  });
  expect(cycle.status()).toBe(422);
});

test('saved filters come back after a reload, and can be deleted', async ({ page }) => {
  await page.goto('/admin#/collections/notes');
  const kind = page.getByRole('combobox', { name: 'Kind' });
  await kind.selectOption('link');
  page.once('dialog', (dialog) => void dialog.accept('Only links'));
  await page.getByRole('button', { name: 'Save these filters' }).click();

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Kind' })).toHaveValue('');
  await page.getByRole('combobox', { name: 'Saved filters' }).selectOption('Only links');
  await expect(page.getByRole('combobox', { name: 'Kind' })).toHaveValue('link');

  await page.getByRole('button', { name: 'Delete these saved filters' }).click();
  await expect(page.getByRole('combobox', { name: 'Saved filters' })).toHaveCount(0);
});

test('media: the library browses by folder, and a click sets the focal point', async ({
  page,
  request,
}) => {
  const pixel =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==';
  const folder = unique('folder');
  const inFolder = `${unique('in').replace(' ', '-')}.png`;
  const outside = `${unique('out').replace(' ', '-')}.png`;
  const created = await request.post('/api/cms/collections/media', {
    data: { filename: inFolder, url: pixel, mime: 'image/png', folder },
  });
  const { id } = (await created.json()) as { id: string };
  await request.post('/api/cms/collections/media', {
    data: { filename: outside, url: pixel, mime: 'image/png' },
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/admin#/collections/media/${id}`);
  const image = page.getByRole('button', { name: 'Focal point' });
  await image.locator('img').evaluate((node) => {
    (node as HTMLImageElement).style.width = '200px';
  });
  const box = await image.boundingBox();
  await page.mouse.click(
    (box?.x ?? 0) + (box?.width ?? 0) / 4,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );
  await page.getByRole('button', { name: 'Save' }).click();
  await expect
    .poll(async () => {
      const doc = (await (await request.get(`/api/cms/collections/media/${id}`)).json()) as {
        focalPoint?: { x: number; y: number };
      };
      return doc.focalPoint;
    })
    .toMatchObject({ x: expect.closeTo(0.25, 1), y: expect.closeTo(0.5, 1) });

  const post = await request.post('/api/cms/collections/posts', {
    data: { title: unique('Folders') },
  });
  await page.goto(`/admin#/collections/posts/${((await post.json()) as { id: string }).id}`);
  await page.getByRole('button', { name: 'Pick existing' }).click();
  await page.getByRole('combobox', { name: 'Folder' }).selectOption(folder);
  await expect(page.locator('.library__item').filter({ hasText: inFolder })).toBeVisible();
  await expect(page.locator('.library__item')).toHaveCount(1);
  await expect(page.locator('.library__thumb img')).toHaveCSS(
    'object-position',
    /^2\d(\.\d+)?% [45]\d(\.\d+)?%$/,
  );
});

test('a relation to many keeps every pick', async ({ page, context }) => {
  await signIn(context);
  const request = context.request;
  const titles = [unique('First'), `${unique('Second')}x`];
  const ids: string[] = [];
  for (const title of titles) {
    const post = await request.post('/api/cms/collections/posts', { data: { title } });
    ids.push(((await post.json()) as { id: string }).id);
  }
  const note = await request.post('/api/cms/collections/notes', {
    data: { title: unique('Many') },
  });
  const { id } = (await note.json()) as { id: string };

  await page.goto(`/admin#/collections/notes/${id}`);
  await page.getByRole('tab', { name: 'Details' }).click();
  const related = page
    .locator('.field, [class*="field"]')
    .filter({ has: page.locator('[id="related"]') });
  for (const title of titles) {
    await related.getByRole('searchbox').fill(title);
    await related.getByRole('checkbox', { name: title }).check();
  }
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect
    .poll(async () => {
      const doc = (await (
        await request.get(`/api/cms/collections/notes/${id}?draft=true&depth=0`)
      ).json()) as { related?: string[] };
      return [...(doc.related ?? [])].sort();
    })
    .toEqual([...ids].sort());
});
