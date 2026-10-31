import type { AccessArgs } from '@adonis-agora/cms';
import {
  auth,
  collection,
  defineConfig,
  fields,
  formsPlugin,
  global,
  jobs,
  mediaPlugin,
  nestedDocsPlugin,
  redirectsPlugin,
  searchPlugin,
  seoPlugin,
  uploads,
  usersPlugin,
  withPlugins,
} from '@adonis-agora/cms';

export default withPlugins(
  defineConfig({
    db: { id: 'uuid', tablePrefix: 'cms_' },
    localization: { locales: ['pt-BR', 'en'], defaultLocale: 'pt-BR' },
    versions: { drafts: true },
    // `CMS_SCHEDULER=off`: `CmsRunDueSchedules` ticks from `durable:work` instead.
    schedulerInterval: process.env.CMS_SCHEDULER === 'off' ? false : 500,
    webhooks: [
      {
        url: `http://127.0.0.1:${process.env.CMS_WEBHOOK_PORT ?? 5611}/webhook-sink`,
        secret: 'demo',
      },
    ],
    // The official queue by default; `CMS_JOBS=durable` runs the same webhooks through Agora's.
    integrations: {
      ...(process.env.CMS_AUTH === 'adonis' ? { auth: auth.adonis({ guard: 'web' }) } : {}),
      // `CMS_AUTH=builtin` is for an app with no login: the CMS owns the users and the screen.
      ...(process.env.CMS_AUTH === 'builtin'
        ? {
            auth: auth.builtin({
              secret: 'e2e-only-secret-not-for-production-0123',
              mail: true,
            }),
          }
        : {}),
      jobs:
        process.env.CMS_JOBS === 'durable'
          ? jobs.durable()
          : jobs.queue(() => import('#jobs/deliver_cms_webhook')),
    },
    admin: {
      title: 'Blog',
      extensions: ['/cms-extension.js'],
      livePreview: { url: '/preview', secret: 'local-preview-secret' },
    },
    uploads: {
      maxSize: 5 * 1024 * 1024,
      mimeTypes: ['image/*', 'application/pdf'],
      handler: uploads.drive({ signed: process.env.DRIVE_DISK === 's3' }),
    },
    collections: [
      collection('authors', {
        labels: { singular: 'Author', plural: 'Authors' },
        admin: { useAsTitle: 'name', defaultColumns: ['name'] },
        fields: [
          fields.join('posts', { collection: 'posts', on: 'author' }),
          fields.text('name', { required: true }),
          fields.text('bio'),
        ],
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
          fields.richText('body', {
            blocks: [{ slug: 'callout', fields: [fields.text('message')] }],
          }),
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
                  fields.point('location'),
                  fields.date('dueOn'),
                  fields.relation('related', { relationTo: 'posts', hasMany: true }),
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
    mediaPlugin({ collections: ['media'] }),
    formsPlugin(),
    searchPlugin({ collections: { notes: { title: 'title' } } }),
    nestedDocsPlugin({ collections: ['pages'] }),
    ...(process.env.CMS_AUTH === 'builtin' ? [usersPlugin()] : []),
  ],
);
