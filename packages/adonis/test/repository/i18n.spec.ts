import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const kits: TestCms[] = [];
afterEach(async () => {
  await Promise.all(kits.map((kit) => kit.destroy()));
  kits.length = 0;
});

const config = defineConfig({
  db: { id: 'uuid' },
  localization: { locales: ['pt-BR', 'en'], defaultLocale: 'pt-BR', fallback: true },
  collections: [
    collection('posts', {
      fields: [
        fields.text('title', { localized: true }),
        fields.text('subtitle', { localized: true }),
        fields.slug('slug', { from: 'title' }),
        fields.array('tags', {
          localized: true,
          fields: [fields.text('label')],
        }),
      ],
    }),
  ],
});

const strictFallback = defineConfig({
  ...config,
  localization: { locales: ['pt-BR', 'en'], defaultLocale: 'pt-BR', fallback: false },
});

async function setup(selected = config) {
  const kit = await createTestCms({ config: selected });
  kits.push(kit);
  return createCms({ config: selected, client: kit.client, user: { id: 'u1' } });
}

describe('i18n — scalars', () => {
  test('reads a full locale map when no locale is requested', async () => {
    const cms = await setup();
    const post = await cms.collection('posts').create({
      title: { 'pt-BR': 'Oi', en: 'Hi' },
      tags: [],
    });

    const read = await cms.collection('posts').findByID(post.id);
    expect(read?.title).toEqual({ 'pt-BR': 'Oi', en: 'Hi' });
  });

  test('reads a single locale when requested', async () => {
    const cms = await setup();
    const post = await cms.collection('posts').create({
      title: { 'pt-BR': 'Oi', en: 'Hi' },
      tags: [],
    });

    const read = await cms.collection('posts').findByID(post.id, { locale: 'en' });
    expect(read?.title).toBe('Hi');
  });

  test('falls back to the default locale when the value is empty', async () => {
    const cms = await setup();
    const post = await cms.collection('posts').create({
      title: { 'pt-BR': 'Só português' },
      tags: [],
    });

    const fallback = await cms.collection('posts').findByID(post.id, { locale: 'en' });
    expect(fallback?.title).toBe('Só português');
  });

  test('does not fall back when fallback is disabled', async () => {
    const cms = await setup(strictFallback);
    const post = await cms.collection('posts').create({
      title: { 'pt-BR': 'Só português' },
      tags: [],
    });

    const read = await cms.collection('posts').findByID(post.id, { locale: 'en' });
    expect(read?.title).toBeNull();
  });

  test('a partial locale patch keeps the other locales', async () => {
    const cms = await setup();
    const post = await cms.collection('posts').create({
      title: { 'pt-BR': 'Oi', en: 'Hi' },
      tags: [],
    });

    await cms.collection('posts').update(post.id, { title: { en: 'Hello' } });

    const read = await cms.collection('posts').findByID(post.id);
    expect(read?.title).toEqual({ 'pt-BR': 'Oi', en: 'Hello' });

    const english = await cms.collection('posts').findByID(post.id, { locale: 'en' });
    expect(english?.title).toBe('Hello');
  });

  test('writes the same scalar into every locale when a plain value is given', async () => {
    const cms = await setup();
    const post = await cms.collection('posts').create({ title: 'Same', tags: [] });

    const map = await cms.collection('posts').findByID(post.id);
    expect(map?.title).toEqual({ 'pt-BR': 'Same', en: 'Same' });
  });
});

describe('i18n — localized children', () => {
  test('stores rows per locale and reads them back by locale', async () => {
    const cms = await setup();
    const post = await cms.collection('posts').create({
      title: 'T',
      tags: {
        'pt-BR': [{ label: 'novo' }, { label: 'antigo' }],
        en: [{ label: 'new' }],
      },
    });

    const portuguese = await cms.collection('posts').findByID(post.id, { locale: 'pt-BR' });
    const ptTags = (portuguese?.tags ?? []) as { label: string }[];
    expect(ptTags.map((tag) => tag.label)).toEqual(['novo', 'antigo']);

    const english = await cms.collection('posts').findByID(post.id, { locale: 'en' });
    const enTags = (english?.tags ?? []) as { label: string }[];
    expect(enTags.map((tag) => tag.label)).toEqual(['new']);
  });

  test('returns a locale map of arrays when no locale is requested', async () => {
    const cms = await setup();
    const post = await cms.collection('posts').create({
      title: 'T',
      tags: { 'pt-BR': [{ label: 'novo' }], en: [{ label: 'new' }] },
    });

    const read = await cms.collection('posts').findByID(post.id);
    const tags = read?.tags as Record<string, { label: string }[]>;
    expect(tags['pt-BR']?.map((tag) => tag.label)).toEqual(['novo']);
    expect(tags.en?.map((tag) => tag.label)).toEqual(['new']);
  });

  test('falls back to the default locale rows when the requested locale has none', async () => {
    const cms = await setup();
    const post = await cms.collection('posts').create({
      title: 'T',
      tags: { 'pt-BR': [{ label: 'novo' }] },
    });

    const english = await cms.collection('posts').findByID(post.id, { locale: 'en' });
    const enTags = (english?.tags ?? []) as { label: string }[];
    expect(enTags.map((tag) => tag.label)).toEqual(['novo']);
  });
});
