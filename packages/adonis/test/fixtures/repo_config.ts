import { block, collection, defineConfig, fields, global } from '../../src/index.js';

const hero = block('hero', {
  fields: [
    fields.text('heading', { required: true }),
    fields.textarea('subheading'),
    fields.array('gallery', {
      fields: [fields.text('caption'), fields.relation('link', { relationTo: 'pages' })],
    }),
  ],
});

export const repositoryConfig = defineConfig({
  db: { id: 'uuid', tablePrefix: 'cms_' },
  localization: { locales: ['pt-BR', 'en'], defaultLocale: 'pt-BR' },
  collections: [
    collection('users', {
      fields: [fields.text('name', { required: true }), fields.email('email')],
    }),
    collection('pages', {
      fields: [fields.text('title', { required: true })],
    }),
    collection('posts', {
      admin: { useAsTitle: 'title' },
      fields: [
        fields.text('title', { required: true }),
        fields.slug('slug', { from: 'title', unique: true }),
        fields.select('status', {
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
        }),
        fields.richText('body', { localized: true }),
        fields.relation('author', { relationTo: 'users' }),
        fields.select('channels', {
          hasMany: true,
          options: [
            { label: 'Web', value: 'web' },
            { label: 'RSS', value: 'rss' },
          ],
        }),
        fields.array('tags', { fields: [fields.text('label')] }),
        fields.blocks('layout', { blocks: [hero] }),
      ],
    }),
  ],
  globals: [
    global('settings', {
      fields: [fields.text('siteName'), fields.textarea('description')],
    }),
  ],
});

export const doc = { type: 'doc' as const, content: [{ type: 'paragraph' }] };
