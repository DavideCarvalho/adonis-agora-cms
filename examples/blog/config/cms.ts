import { collection, defineConfig, fields } from '@adonis-agora/cms';

export default defineConfig({
  db: { id: 'uuid', tablePrefix: 'cms_' },
  localization: { locales: ['pt-BR', 'en'], defaultLocale: 'pt-BR' },
  versions: { drafts: true },
  collections: [
    collection('authors', {
      labels: { singular: 'Author', plural: 'Authors' },
      admin: { useAsTitle: 'name', defaultColumns: ['name'] },
      fields: [fields.text('name', { required: true }), fields.text('bio')],
    }),
    collection('posts', {
      softDelete: true,
      labels: { singular: 'Post', plural: 'Posts' },
      admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug'] },
      fields: [
        fields.text('title', { required: true }),
        fields.text('subtitle', { localized: true }),
        fields.richText('body'),
        fields.slug('slug', { from: 'title', unique: true }),
        fields.relation('author', { relationTo: 'authors' }),
        fields.select('status', {
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        }),
      ],
    }),
  ],
});
