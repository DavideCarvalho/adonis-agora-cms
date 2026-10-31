import { describe, expect, test } from 'vitest';
import { validateConfig } from '../../src/config/validate.js';
import { collection, defineConfig, fields } from '../../src/index.js';
import { blogConfig, configWith } from '../fixtures/blog_config.js';

describe('validateConfig', () => {
  test('accepts the blog fixture', () => {
    expect(validateConfig(blogConfig)).toEqual([]);
  });

  test('reports duplicate collection slugs', () => {
    const config = defineConfig({
      collections: [
        collection('posts', { fields: [fields.text('title')] }),
        collection('posts', { fields: [fields.text('title')] }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe('collections.posts');
    expect(errors[0]?.message).toMatch(/duplicate/i);
  });

  test('rejects reserved field names', () => {
    const config = defineConfig({
      collections: [collection('posts', { fields: [fields.text('_private')] })],
    });
    const errors = validateConfig(config);
    expect(errors[0]?.message).toMatch(/reserved/i);
  });

  test('rejects duplicate field names in the same level', () => {
    const config = defineConfig({
      collections: [collection('posts', { fields: [fields.text('title'), fields.slug('title')] })],
    });
    expect(validateConfig(config)[0]?.message).toMatch(/duplicate field name/i);
  });

  test('rejects orphan relations', () => {
    const config = defineConfig({
      collections: [
        collection('posts', { fields: [fields.relation('author', { relationTo: 'users' })] }),
      ],
    });
    expect(validateConfig(config)[0]?.message).toMatch(/users/);
  });

  test('rejects invalid locales', () => {
    const config = configWith({
      localization: { locales: ['pt_BR'], defaultLocale: 'pt_BR' },
    });
    expect(validateConfig(config)[0]?.message).toMatch(/invalid locale/i);
  });

  test('rejects localized fields without locales', () => {
    const config = configWith({
      collections: [collection('posts', { fields: [fields.text('title', { localized: true })] })],
    });
    expect(validateConfig(config)[0]?.message).toMatch(/no locales/i);
  });

  test('rejects drafts on globals', () => {
    const config = configWith({
      globals: [collection('site', { fields: [fields.text('name')], versions: { drafts: true } })],
    });
    expect(validateConfig(config)[0]?.message).toMatch(/drafts/i);
  });

  test('rejects duplicate block slugs', () => {
    const config = configWith({
      collections: [
        collection('posts', {
          fields: [
            fields.blocks('layout', {
              blocks: [
                { slug: 'hero', fields: [fields.text('heading')] },
                { slug: 'hero', fields: [fields.text('title')] },
              ],
            }),
          ],
        }),
      ],
    });
    expect(validateConfig(config)[0]?.message).toMatch(/duplicate block slug/i);
  });

  test('rejects empty select options', () => {
    const config = configWith({
      collections: [collection('posts', { fields: [fields.select('status', { options: [] })] })],
    });
    expect(validateConfig(config)[0]?.message).toMatch(/at least one option/i);
  });

  test('rejects uploads without the media integration', () => {
    const config = defineConfig({
      collections: [
        collection('posts', { fields: [fields.upload('cover', { relationTo: 'media' })] }),
      ],
    });
    expect(validateConfig(config)[0]?.message).toMatch(/@adonis-agora\/media/);
  });

  test('rejects useAsTitle on a non-textual field', () => {
    const config = configWith({
      collections: [
        collection('posts', {
          admin: { useAsTitle: 'publishedAt' },
          fields: [fields.date('publishedAt')],
        }),
      ],
    });
    expect(validateConfig(config)[0]?.message).toMatch(/textual/i);
  });

  test('rejects an unknown field type', () => {
    const config = configWith({
      collections: [collection('posts', { fields: [{ type: 'color', name: 'accent' }] })],
    });
    expect(validateConfig(config)[0]?.message).toMatch(/unknown field type/i);
  });
});

describe('mistakes a new config makes', () => {
  const messages = (config: Parameters<typeof validateConfig>[0]) =>
    validateConfig(config).map((error) => error.message);
  const posts = (fieldList: never, admin = {}) =>
    collection('posts', { admin, fields: fieldList }) as never;

  test('a typo gets a suggestion', () => {
    expect(
      messages({
        collections: [posts([fields.text('title')] as never, { useAsTitle: 'titel' })],
      }),
    ).toEqual([expect.stringContaining('Did you mean "title"?')]);
    expect(
      messages({
        collections: [
          collection('authors', { fields: [fields.text('name')] }),
          posts([fields.relation('author', { relationTo: 'autors' })] as never),
        ],
      }),
    ).toEqual([expect.stringContaining('Did you mean "authors"?')]);
  });

  test('nothing is suggested when nothing is close', () => {
    expect(
      messages({
        collections: [posts([fields.text('title')] as never, { useAsTitle: 'xyzzy' })],
      })[0],
    ).not.toContain('Did you mean');
  });

  test('a slug derived from a field that does not exist', () => {
    expect(
      messages({
        collections: [
          posts([fields.text('title'), fields.slug('slug', { from: 'titel' })] as never),
        ],
      }),
    ).toEqual([expect.stringContaining('Did you mean "title"?')]);
  });

  test('system fields are reserved', () => {
    expect(messages({ collections: [posts([fields.text('id')] as never)] })).toEqual([
      expect.stringContaining('reserved'),
    ]);
  });

  test('visibleWhen and join point at real fields', () => {
    expect(
      messages({
        collections: [
          posts([
            fields.text('kind'),
            fields.text('href', { admin: { visibleWhen: { field: 'knd', equals: 'link' } } }),
            fields.join('notes', { collection: 'nots', on: 'post' }),
          ] as never),
        ],
      }),
    ).toEqual([
      expect.stringContaining('Did you mean "kind"?'),
      expect.stringContaining('join target "nots"'),
    ]);
  });

  test('the preview needs its config, and the visual editor a blocks field', () => {
    expect(
      messages({
        collections: [posts([fields.text('title')] as never, { visualEditor: true })],
      }),
    ).toEqual([
      expect.stringContaining('`blocks` field'),
      expect.stringContaining('admin.livePreview'),
    ]);
  });
});
