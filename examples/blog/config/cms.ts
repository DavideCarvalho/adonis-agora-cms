import type { AccessArgs } from '@adonis-agora/cms';
import {
  adonisAuth,
  adonisMail,
  cmsAuth,
  collection,
  defineConfig,
  driveUploads,
  durableJobs,
  fields,
  global,
  queueJobs,
  redirectsPlugin,
  seoPlugin,
  usersPlugin,
  withPlugins,
} from '@adonis-agora/cms';

export default withPlugins(
  defineConfig({
    db: { id: 'uuid', tablePrefix: 'cms_' },
    localization: { locales: ['pt-BR', 'en'], defaultLocale: 'pt-BR' },
    versions: { drafts: true },
    schedulerInterval: 500,
    webhooks: [
      {
        url: `http://127.0.0.1:${process.env.CMS_WEBHOOK_PORT ?? 5611}/webhook-sink`,
        secret: 'demo',
      },
    ],
    // The official queue by default; `CMS_JOBS=durable` runs the same webhooks through Agora's.
    integrations: {
      ...(process.env.CMS_AUTH === 'adonis' ? { auth: adonisAuth({ guard: 'web' }) } : {}),
      // `CMS_AUTH=builtin` is for an app with no login: the CMS owns the users and the screen.
      ...(process.env.CMS_AUTH === 'builtin'
        ? {
            auth: cmsAuth({
              secret: 'e2e-only-secret-not-for-production-0123',
              mail: adonisMail(async () => (await import('@adonisjs/mail/services/main')).default),
            }),
          }
        : {}),
      jobs:
        process.env.CMS_JOBS === 'durable'
          ? durableJobs(async () => {
              const { default: engine } = await import('@adonis-agora/durable/services/main');
              return engine;
            })
          : queueJobs({
              deliverWebhook: async (input) => {
                const { default: job } = await import('#jobs/deliver_cms_webhook');
                return job.dispatch(input);
              },
            }),
    },
    admin: {
      title: 'Blog',
      livePreview: { url: '/preview', secret: 'local-preview-secret' },
    },
    uploads: {
      maxSize: 5 * 1024 * 1024,
      mimeTypes: ['image/*', 'application/pdf'],
      handler: driveUploads(
        async () => {
          const { default: drive } = await import('@adonisjs/drive/services/main');
          return drive.use();
        },
        { signed: process.env.DRIVE_DISK === 's3' },
      ),
    },
    collections: [
      collection('authors', {
        labels: { singular: 'Author', plural: 'Authors' },
        admin: { useAsTitle: 'name', defaultColumns: ['name'] },
        fields: [fields.text('name', { required: true }), fields.text('bio')],
      }),
      collection('pages', {
        labels: { singular: 'Page', plural: 'Pages' },
        admin: {
          useAsTitle: 'title',
          defaultColumns: ['title', 'slug', 'visibility'],
          visualEditor: true,
        },
        access: {
          /**
           * Per-document access, the Payload way: the stored document arrives as `doc`, so a page
           * marked private is invisible by id unless the request is authenticated. The list keeps the
           * collection-level rule (no `doc` yet).
           */
          read: ({ user, doc }: AccessArgs) =>
            doc ? doc.visibility !== 'private' || Boolean(user) : true,
          update: ({ doc }: AccessArgs) => doc?.visibility !== 'locked',
        },
        fields: [
          fields.text('title', { required: true }),
          fields.slug('slug', { from: 'title', unique: true }),
          fields.select('visibility', {
            defaultValue: 'public',
            options: [
              { label: 'Public', value: 'public' },
              { label: 'Private', value: 'private' },
              { label: 'Locked', value: 'locked' },
            ],
          }),
          fields.blocks('layout', {
            blocks: [
              {
                slug: 'hero',
                labels: { singular: 'Hero', plural: 'Heroes' },
                fields: [
                  fields.text('eyebrow'),
                  fields.text('heading', { required: true }),
                  fields.textarea('subheading'),
                  fields.text('ctaLabel'),
                  fields.text('ctaHref'),
                ],
              },
              {
                slug: 'features',
                labels: { singular: 'Features', plural: 'Features' },
                fields: [
                  fields.text('heading'),
                  fields.textarea('intro'),
                  fields.array('items', {
                    required: true,
                    fields: [fields.text('title'), fields.textarea('text')],
                  }),
                ],
              },
              {
                slug: 'quote',
                labels: { singular: 'Quote', plural: 'Quotes' },
                fields: [fields.textarea('quote'), fields.text('attribution')],
              },
              {
                slug: 'text',
                labels: { singular: 'Text', plural: 'Text' },
                fields: [fields.text('heading'), fields.richText('body')],
              },
              {
                slug: 'cta',
                labels: { singular: 'Call to action', plural: 'Calls to action' },
                fields: [
                  fields.text('heading'),
                  fields.textarea('text'),
                  fields.text('buttonLabel'),
                  fields.text('buttonHref'),
                ],
              },
            ],
          }),
        ],
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
      collection('notes', {
        labels: { singular: 'Note', plural: 'Notes' },
        admin: { useAsTitle: 'title', defaultColumns: ['title', 'kind'] },
        versions: { drafts: true, autosave: { interval: 800 } },
        fields: [
          fields.tabs('main', {
            tabs: [
              { label: 'Content', fields: [fields.text('title', { required: true })] },
              {
                label: 'Details',
                fields: [
                  fields.select('kind', {
                    defaultValue: 'plain',
                    options: [
                      { label: 'Plain', value: 'plain' },
                      { label: 'Link', value: 'link' },
                    ],
                  }),
                  fields.text('href', {
                    admin: { visibleWhen: { field: 'kind', equals: 'link' } },
                  }),
                ],
              },
            ],
          }),
        ],
      }),
    ],
    globals: [
      global('site', {
        labels: { singular: 'Site settings', plural: 'Site settings' },
        fields: [fields.text('siteName')],
      }),
    ],
  }),
  [
    seoPlugin({ collections: ['notes'] }),
    redirectsPlugin(),
    ...(process.env.CMS_AUTH === 'builtin' ? [usersPlugin()] : []),
  ],
);
