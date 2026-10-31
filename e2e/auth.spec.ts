import { type APIRequestContext, expect, test } from '@playwright/test';

/* The CMS's own login, from an empty database. `pnpm test:auth` starts what it needs. */
test.skip(!process.env.CMS_AUTH_E2E, 'needs `pnpm test:auth`');
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin@example.test', password: 'correct-horse-1' };
const EDITOR = { email: 'editor@example.test', password: 'battery-staple-1' };

const login = (request: APIRequestContext, user: { email: string; password: string }) =>
  request.post('/api/cms/auth/login', { data: user });

test('the panel asks for the first user, who becomes the admin', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Create the first user' })).toBeVisible();
  await page.getByLabel('E-mail').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('navigation').getByRole('button', { name: 'Users' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('a second first user is refused, and so is a wrong password', async ({ request }) => {
  const second = await request.post('/api/cms/auth/first-user', {
    data: { email: 'intruder@example.test', password: 'long-enough-1' },
  });
  expect(second.status()).toBe(403);
  expect((await login(request, { ...ADMIN, password: 'wrong-password' })).status()).toBe(401);
  expect((await login(request, { email: 'nobody@example.test', password: 'x' })).status()).toBe(
    401,
  );
});

test('the login screen signs in, and no answer carries a password', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('E-mail').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Users' })).toBeVisible();

  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === 'cms_session')?.httpOnly).toBe(true);

  const users = await (await page.request.get('/api/cms/collections/users')).text();
  expect(users).toContain(ADMIN.email);
  expect(users).not.toMatch(/scrypt|password/i);
});

test('an editor cannot make themselves an admin, or set another password', async ({
  playwright,
  baseURL,
}) => {
  const admin = await playwright.request.newContext({ baseURL: baseURL as string });
  expect((await login(admin, ADMIN)).status()).toBe(200);
  const created = await admin.post('/api/cms/collections/users', {
    data: { email: EDITOR.email, role: 'editor' },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const adminId = (await admin.get('/api/cms/schema').then((r) => r.json())).user.id;
  expect(
    (
      await admin.post('/api/cms/auth/password', {
        data: { userId: id, password: EDITOR.password },
      })
    ).status(),
  ).toBe(200);

  const editor = await playwright.request.newContext({ baseURL: baseURL as string });
  expect((await login(editor, EDITOR)).status()).toBe(200);
  await editor.patch(`/api/cms/collections/users/${id}`, { data: { role: 'admin', name: 'Eve' } });
  const after = await admin.get(`/api/cms/collections/users/${id}`).then((r) => r.json());
  expect(after).toMatchObject({ role: 'editor', name: 'Eve' });

  const takeover = await editor.post('/api/cms/auth/password', {
    data: { userId: adminId, password: 'taken-over-1' },
  });
  expect(takeover.status()).toBe(403);
  expect(
    (
      await editor.post('/api/cms/collections/users', { data: { email: 'x@example.test' } })
    ).status(),
  ).toBe(403);
});

test('an admin sets a password from the user page', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('E-mail').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Users' }).click();
  await page.getByRole('row').filter({ hasText: EDITOR.email }).click();

  await page.getByRole('button', { name: 'Set password' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New password').fill(EDITOR.password);
  await dialog.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByText('Password changed')).toBeVisible();
  await page.getByRole('button', { name: 'back' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
});

test('a reset e-mail goes out through @adonisjs/mail and works once', async ({ page, request }) => {
  const mailpit = process.env.MAILPIT_URL as string;
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  await page.getByLabel('E-mail').fill(EDITOR.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/link is on its way/)).toBeVisible();

  const link = await expect
    .poll(async () => {
      const inbox = await (await request.get(`${mailpit}/api/v1/messages`)).json();
      return inbox.messages?.length ?? 0;
    })
    .toBe(1)
    .then(async () => {
      const inbox = await (await request.get(`${mailpit}/api/v1/messages`)).json();
      const message = await (
        await request.get(`${mailpit}/api/v1/message/${inbox.messages[0].ID}`)
      ).json();
      return /\/admin#\/reset\/\S+/.exec(message.Text)?.[0] as string;
    });
  expect(link).toBeTruthy();

  await page.goto(link);
  await page.reload();
  await page.getByLabel('New password').fill('a-brand-new-one-1');
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Users' })).toBeVisible();

  const token = link.split('/reset/')[1];
  const again = await request.post('/api/cms/auth/reset', {
    data: { token, password: 'second-use-of-link' },
  });
  expect(again.status()).toBe(400);
  expect((await login(request, { ...EDITOR, password: EDITOR.password })).status()).toBe(401);
  expect(
    (await login(request, { email: EDITOR.email, password: 'a-brand-new-one-1' })).status(),
  ).toBe(200);
});
