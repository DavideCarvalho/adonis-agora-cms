import type { CmsConfig } from '../../src/index.js';
import { block, collection, defineConfig, fields, global } from '../../src/index.js';

export const heroBlock = block('hero', {
  fields: [
    fields.text('heading', { required: true }),
    fields.upload('image', { relationTo: 'media' }),
  ],
});

export const galleryBlock = block('gallery', {
  fields: [
    fields.array('gallery', {
      fields: [fields.text('caption'), fields.relation('link', { relationTo: 'pages' })],
    }),
  ],
});

export const posts = collection('posts', {
  labels: { singular: 'Post', plural: 'Posts' },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'status', 'publishedAt'] },
  versions: { drafts: true, autosave: { interval: 2000 } },
  fields: [
    fields.text('title', { required: true, maxLength: 120 }),
    fields.slug('slug', { from: 'title', unique: true }),
    fields.richText('body', { localized: true }),
    fields.select('status', {
      options: [
        { label: 'Rascunho', value: 'draft' },
        { label: 'Publicado', value: 'published' },
      ],
      defaultValue: 'draft',
    }),
    fields.select('channels', {
      options: [
        { label: 'Web', value: 'web' },
        { label: 'RSS', value: 'rss' },
      ],
      hasMany: true,
    }),
    fields.date('publishedAt'),
    fields.relation('author', { relationTo: 'users' }),
    fields.relation('related', { relationTo: ['posts', 'pages'], hasMany: true }),
    fields.upload('cover', { relationTo: 'media' }),
    fields.array('tags', { fields: [fields.text('label')] }),
    fields.group('seo', {
      fields: [fields.text('title'), fields.textarea('description')],
    }),
    fields.blocks('layout', { blocks: [heroBlock, galleryBlock] }),
  ],
});

export const pages = collection('pages', {
  fields: [fields.text('title', { required: true }), fields.text('path', { required: true })],
});

export const users = collection('users', {
  fields: [fields.email('email', { required: true, unique: true }), fields.text('name')],
});

export const siteSettings = global('site_settings', {
  fields: [fields.text('siteName'), fields.upload('logo', { relationTo: 'media' })],
});

export const blogConfig = defineConfig({
  db: { schema: 'managed', tablePrefix: 'cms_', id: 'uuid' },
  admin: { path: '/admin', auth: 'cms', title: 'Painel' },
  localization: { locales: ['pt-BR', 'en'], defaultLocale: 'pt-BR', fallback: true },
  integrations: { media: true },
  collections: [posts, pages, users],
  globals: [siteSettings],
});

/** Minimal config used by config-level tests that don't care about the blog fixture. */
export function configWith(overrides: Partial<CmsConfig>): CmsConfig {
  return { integrations: { media: true }, ...overrides };
}
