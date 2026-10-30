import { expect, test } from '@playwright/test';

test('admin renders the schema-driven list and edit form', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Posts' })).toBeVisible();
  await page.getByRole('button', { name: 'Posts' }).click();

  await expect(page.getByRole('cell', { name: 'Hello world' })).toBeVisible();
  await expect(page.getByText('Published')).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('title')).toHaveValue('Hello world');
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
});
