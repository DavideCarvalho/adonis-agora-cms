import { expect, test } from '@playwright/test';

/*
 * The official AdonisJS libraries for real, in a booted app: session login through @adonisjs/auth,
 * a private S3 bucket through @adonisjs/drive, and Redis with a separate worker through
 * @adonisjs/queue. `pnpm test:official` starts what these need.
 */
test.skip(!process.env.CMS_OFFICIAL, 'needs `pnpm test:official`');

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}`;
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('@adonisjs/auth: a session is the CMS user, and anonymous is not', async ({
  page,
  request,
}) => {
  expect((await request.get('/api/cms/schema').then((r) => r.json())).user).toBeNull();

  await page.request.post('/dev-login', { data: { name: 'ana' } });
  const schema = await page.request.get('/api/cms/schema').then((r) => r.json());
  expect(schema.user).toMatchObject({ id: 'ana' });

  const title = unique('Session draft');
  await page.goto('/admin#/new/notes');
  await page.getByRole('textbox', { name: /^title \*/i }).fill(title);
  await page.keyboard.press('Control+s');
  await expect(page).toHaveURL(/collections\/notes\/.+/);
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();

  // Drafts stay out of reach without the session.
  const anonymous = await request.get('/api/cms/collections/notes', {
    params: { 'where[title][equals]': title },
  });
  expect((await anonymous.json()).totalDocs).toBe(0);
});

test('@adonisjs/drive: a private S3 upload comes back through a signed URL', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/cms/collections/posts', {
    data: { title: unique('S3') },
  });
  const { id } = await created.json();

  await page.goto(`/admin#/collections/posts/${id}`);
  await page.locator('.field:has(.upload-drop) input[type="file"]').setInputFiles({
    name: 'banner.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG, 'base64'),
  });
  const image = page.locator('.upload-card__thumb img');
  await expect(image).toHaveCount(1);

  const src = (await image.getAttribute('src')) ?? '';
  expect(src).toContain('X-Amz-Signature');
  expect((await request.get(src)).status()).toBe(200);
  // The bucket is private: the same object without the signature is refused.
  expect((await request.get(src.split('?')[0] as string)).status()).toBe(403);
});

test('@adonisjs/queue: the webhook is delivered by the separate worker', async ({ request }) => {
  const created = await request.post('/api/cms/collections/notes', {
    data: { title: unique('Queue') },
  });
  const { id } = await created.json();

  await expect
    .poll(
      async () => {
        const last = await (await request.get('/webhook-sink')).json();
        return last?.body?.documentId;
      },
      { timeout: 10_000 },
    )
    .toBe(id);
});
