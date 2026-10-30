import { collection, defineConfig, fields } from '@adonis-agora/cms';

export default defineConfig({
  db: { id: 'uuid', tablePrefix: 'cms_' },
  versions: { drafts: true },
  collections: [
    collection('posts', {
      labels: { singular: 'Post', plural: 'Posts' },
      admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug'] },
      fields: [
        fields.text('title', { required: true }),
        fields.slug('slug', { from: 'title', unique: true }),
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
