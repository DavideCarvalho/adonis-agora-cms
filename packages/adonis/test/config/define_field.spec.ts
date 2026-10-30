import { afterEach, describe, expect, test } from 'vitest';
import { validateConfig } from '../../src/config/validate.js';
import { collection, defineConfig, defineField, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { compileSchema } from '../../src/schema/compile.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const color = defineField({
  type: 'color',
  column: { type: 'string', length: 9 },
  component: 'color',
});

const config = defineConfig({
  collections: [
    collection('posts', {
      fields: [fields.text('title', { required: true }), color('accent', { required: true })],
    }),
  ],
});

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

describe('defineField', () => {
  test('compiles a custom type into a column carrying plain-data metadata', () => {
    const spec = compileSchema(config, { engine: 'sqlite' });
    const table = spec.tables.find((item) => item.name === 'cms_posts');

    const accent = table?.columns.find((column) => column.name === 'accent');
    expect(accent).toMatchObject({ type: 'string', length: 9, nullable: false });
    expect(accent?.path).toBe('accent');

    // The config stays serializable: no functions leak into the spec.
    expect(() => JSON.stringify(spec)).not.toThrow();
    expect(JSON.stringify(spec)).not.toContain('toColumn');
  });

  test('round-trips through the repository and the REST schema', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client, user: { id: 'u1' } });

    const post = await cms.collection('posts').create({ title: 'T', accent: '#ff0000' });
    expect(post.accent).toBe('#ff0000');

    const read = await cms.collection('posts').find();
    expect(read.docs[0]?.accent).toBe('#ff0000');

    // The admin schema exposes the custom component id.
    const { toAdminSchema } = await import('../../src/admin/schema.js');
    const schema = toAdminSchema(config, { user: { id: 'u1' } });
    const accentField = schema.collections[0]?.fields.find((field) => field.name === 'accent');
    expect(accentField?.type).toBe('color');
    expect(accentField?.admin).toMatchObject({ component: 'color' });
  });

  test('a custom type without defineField is rejected at config validation', () => {
    const invalid = defineConfig({
      collections: [collection('posts', { fields: [{ type: 'color', name: 'accent' }] })],
    });

    expect(validateConfig(invalid)[0]?.message).toMatch(/unknown field type/);
  });
});
