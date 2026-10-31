import { expect, test } from '@playwright/test';

/**
 * Structured fields, the Payload way: array and blocks rows are reordered by dragging their
 * handle, and the order left on screen is the order the API stores (the child table carries the
 * `_order` column). The handle also answers ArrowUp/ArrowDown so the order is reachable without a
 * pointer.
 */
test('array and blocks rows reorder by drag and the order is persisted', async ({
  page,
  request,
}) => {
  const title = `Sortable rows ${Date.now().toString(36)}`;
  const created = await request.post('/api/cms/collections/posts', {
    data: {
      title,
      sections: [
        { heading: 'first', note: 'a' },
        { heading: 'second', note: 'b' },
        { heading: 'third', note: 'c' },
      ],
      layout: [
        { type: 'hero', headline: 'Hero block' },
        { type: 'quote', quote: 'Quote block' },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { id: string }).id;

  await page.goto('/admin');
  await page.getByRole('navigation').getByRole('button', { name: 'Posts' }).click();
  await page
    .getByRole('row')
    .filter({ hasText: title })
    .getByRole('button', { name: 'Edit' })
    .click();

  // Both builders render a card per row with a drag handle.
  await expect(page.getByRole('button', { name: /^Reorder row \d$/ })).toHaveCount(3);
  await expect(page.getByRole('button', { name: /^Reorder block \d$/ })).toHaveCount(2);

  const headings = page.getByRole('textbox', { name: /^heading$/i });
  await expect(headings.nth(0)).toHaveValue('first');
  await expect(headings.nth(2)).toHaveValue('third');

  // Collapse hides the row body but keeps the row in place, with a summary in the header.
  await page.getByRole('button', { name: 'Collapse row 2' }).click();
  await expect(page.getByRole('textbox', { name: /^heading$/i })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Expand row 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand row 2' }).click();
  await expect(page.getByRole('textbox', { name: /^heading$/i })).toHaveCount(3);

  // Copy a row and paste it: a duplicate without the original id, appended at the end.
  await page.getByRole('button', { name: 'Copy' }).first().click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('_cmsClipboard')))
    .toContain('"field":"sections"');

  await page.getByRole('button', { name: 'Paste row' }).click();
  await expect(headings).toHaveCount(4);
  await expect(headings.nth(3)).toHaveValue('first');

  // Drag the third row onto the first position.
  const from = await page.getByRole('button', { name: 'Reorder row 3' }).boundingBox();
  const to = await page.getByRole('button', { name: 'Reorder row 1' }).boundingBox();
  if (!from || !to) throw new Error('drag handles are not laid out');

  await page.mouse.move(from.x + 4, from.y + 4);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y - 12, { steps: 6 });
  await page.mouse.move(to.x + 4, to.y - 4, { steps: 20 });
  await page.mouse.up();

  await expect(headings.nth(0)).toHaveValue('third');
  await expect(headings.nth(1)).toHaveValue('first');
  await expect(headings.nth(2)).toHaveValue('second');
  await expect(headings.nth(3)).toHaveValue('first');

  // Blocks use the same controller; the keyboard shortcut covers the no-pointer case.
  const blockHandle = page.getByRole('button', { name: 'Reorder block 2' });
  await blockHandle.focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByLabel('block 1 type')).toHaveValue('quote');
  await expect(page.getByLabel('block 2 type')).toHaveValue('hero');

  await page.getByRole('button', { name: 'Save' }).click();

  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/cms/collections/posts/${id}`);
        const post = (await response.json()) as {
          sections: { heading: string }[];
          layout: { type: string }[];
        };
        return {
          sections: post.sections.map((section) => section.heading),
          layout: post.layout.map((block) => block.type),
        };
      },
      { timeout: 15_000 },
    )
    .toEqual({ sections: ['third', 'first', 'second', 'first'], layout: ['quote', 'hero'] });
});
