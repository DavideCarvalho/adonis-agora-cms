import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collection, defineConfig, fields } from '@adonis-agora/cms';

const UPLOAD_DIR = new URL('../storage/uploads/', import.meta.url).pathname;

export default defineConfig({
  db: { id: 'uuid', tablePrefix: 'cms_' },
  localization: { locales: ['pt-BR', 'en'], defaultLocale: 'pt-BR' },
  versions: { drafts: true },
  admin: {
    title: 'Blog',
    livePreview: { url: '/preview/post', secret: 'local-preview-secret' },
  },
  uploads: {
    maxSize: 5 * 1024 * 1024,
    mimeTypes: ['image/*', 'application/pdf'],
    /**
     * The example has no media library: the bytes land on disk and the field stores the id the
     * handler returns. A real app creates a media document and returns its id (`@adonis-agora/media`).
     */
    async handler(file) {
      await mkdir(UPLOAD_DIR, { recursive: true });
      const safe = file.filename.replace(/[^a-zA-Z0-9._-]/g, '-');
      const folder = randomUUID();
      await mkdir(join(UPLOAD_DIR, folder), { recursive: true });
      await writeFile(join(UPLOAD_DIR, folder, safe), file.contents);
      return {
        id: randomUUID(),
        filename: file.filename,
        url: `/uploads/${folder}/${safe}`,
        mime: file.mimeType,
      };
    },
  },
  collections: [
    collection('authors', {
      labels: { singular: 'Author', plural: 'Authors' },
      admin: { useAsTitle: 'name', defaultColumns: ['name'] },
      fields: [fields.text('name', { required: true }), fields.text('bio')],
    }),
    collection('media', {
      labels: { singular: 'Media', plural: 'Media' },
      admin: { useAsTitle: 'filename', defaultColumns: ['filename', 'mime'] },
      fields: [
        fields.text('filename', { required: true }),
        fields.text('url'),
        fields.text('mime'),
      ],
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
        fields.upload('banner', { relationTo: 'media' }),
        fields.array('sections', {
          fields: [fields.text('heading'), fields.text('note')],
        }),
        fields.blocks('layout', {
          blocks: [
            { slug: 'hero', fields: [fields.text('headline')] },
            { slug: 'quote', fields: [fields.textarea('quote')] },
          ],
        }),
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
