import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { toRestError } from '../../src/rest/errors.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const config = defineConfig({
  collections: [
    collection('posts', {
      access: { create: ({ user }) => Boolean(user), update: ({ user }) => Boolean(user) },
      fields: [fields.text('title', { required: true })],
    }),
  ],
});

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

describe('401 vs 403', () => {
  test('anonymous write maps to 401, authenticated denial to 403', async () => {
    kit = await createTestCms({ config });

    const anonymous = createCms({ config, client: kit.client, user: null });
    const error = await anonymous
      .collection('posts')
      .create({ title: 'x' })
      .catch((e: unknown) => e);
    expect(toRestError(error).status).toBe(401);

    const editor = createCms({ config, client: kit.client, user: { id: 'u1' } });
    const ok = await editor.collection('posts').create({ title: 'ok' });
    expect(ok.title).toBe('ok');
  });
});
