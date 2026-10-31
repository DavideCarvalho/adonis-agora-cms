# Using the CMS in an app

What a developer writes, in order. Everything below is what `examples/blog` and the Entre Textos
integration actually do — the snippets compile and run.

## 1. Install

```bash
node ace add @adonisjs/lucid
node ace configure @adonis-agora/cms          # provider, cms:* commands, config stub, migration
node ace configure @adonis-agora/cms-admin    # the provider that serves the admin SPA
```

## 2. Declare the content

`config/cms.ts` — the collections are code, and the editor form, the tables, the REST routes and
the types all come from here:

```ts
import { collection, defineConfig, fields } from '@adonis-agora/cms';

export default defineConfig({
  db: { id: 'uuid', tablePrefix: 'cms_' },

  collections: [
    collection('posts', {
      admin: { useAsTitle: 'title', defaultColumns: ['title', 'status'] },
      fields: [
        fields.text('title', { required: true }),
        fields.slug('slug', { from: 'title', unique: true }),
        fields.richText('body'),
        fields.select('status', {
          defaultValue: 'draft',
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        }),
      ],
    }),

    collection('pages', {
      admin: { useAsTitle: 'title' },
      fields: [
        fields.text('title', { required: true }),
        fields.slug('slug', { from: 'title', unique: true }),
        fields.blocks('layout', {
          blocks: [
            { slug: 'hero', fields: [fields.text('heading'), fields.textarea('subheading')] },
            {
              slug: 'features',
              fields: [
                fields.text('heading'),
                fields.array('items', { fields: [fields.text('title'), fields.textarea('text')] }),
              ],
            },
          ],
        }),
      ],
    }),
  ],
});
```

## 3. Create the tables

```bash
node ace cms:sync        # print the plan: node ace cms:diff
```

In `managed` mode (the default) the provider applies the schema on boot in development and only
warns about drift in production.

## 4. Read it

```ts
// app/controllers/pages_controller.ts
import type { CmsDocument } from '@adonis-agora/cms';
import cms from '@adonis-agora/cms/services/main';
import type cmsConfig from '#config/cms';

type Page = CmsDocument<typeof cmsConfig, 'pages'>;

export default class PagesController {
  async show({ params, response }) {
    const { docs } = await cms.collection('pages').find({
      where: { slug: { equals: params.slug } },
    });

    const page = docs[0] as Page | undefined;
    if (!page) return response.notFound();

    return response.type('html').send(render(page));
  }
}
```

- `cms` is the typed singleton the provider fills at boot — the same instance the REST routes
  use, so hooks, access and tenancy apply.
- `Page` gives you `page.layout[0]` typed as the block union; a field that is not in the config
  does not typecheck.
- `find` only returns published documents. Drafts need `{ draft: true }` **and** a preview token
  (step 6).

For scripts outside an app, `createCms({ config, client })` gives the same API.

## 5. Render the blocks

```ts
const components: Record<string, (block: any, path: string) => string> = {
  hero: (block, path) => `<h1 data-cms-field="${path}.heading">${block.heading}</h1>`,
  features: (block, path) => `…`,
};

const body = page.layout
  .map((block, index) =>
    components[block.type]
      ? `<div data-cms-block="layout[${index}]">${components[block.type](
          block,
          `layout[${index}]`,
        )}</div>`
      : '',
  )
  .join('');
```

The `path` is the same one the admin form uses (`layout[1].items[0].title`); that is what makes
the live preview highlight the region, focus the field, and give each block its toolbar.

## 6. Live preview

```ts
// config/cms.ts
admin: {
  path: '/admin',
  livePreview: { url: '/preview', secret: env.get('CMS_PREVIEW_SECRET') },
},
```

```ts
// the route the iframe loads
import { verifyPreviewToken } from '@adonis-agora/cms';
import cms from '@adonis-agora/cms/services/main';

router.get('/preview', async ({ request, response }) => {
  const claims = verifyPreviewToken(String(request.qs().token ?? ''), secret);
  if (!claims) return response.status(401).send('invalid or expired preview token');

  const doc = await cms
    .forTenant(claims.tenant)
    .collection(claims.collection)
    .findByID(claims.documentId, { draft: true, overrideAccess: true });

  if (!doc) return response.status(404).send('not found');

  // The admin embeds this page; the default shield answers `x-frame-options: DENY`.
  response.header('x-frame-options', 'SAMEORIGIN');
  return response.type('html').send(render(doc));
});
```

The admin panel gets a **Preview** button as soon as `livePreview` is configured.

## 7. Open the panel

`/admin` (`admin.path`). It renders itself from `GET /api/cms/schema`: list, edit, publish,
versions, uploads, live preview.

## 8. Build your own (optional)

The panel is composed from exported pieces:

```tsx
import {
  AdminClient,
  CmsProvider,
  DataTable,
  EditForm,
  useDocuments,
} from '@adonis-agora/cms-react';

<CmsProvider client={new AdminClient()} upload={(file) => client.upload(file)}>
  <EditForm collection={collection} doc={doc} onSubmit={save} previewUrl={previewUrl} />
</CmsProvider>;
```

Everything is exported: client, TanStack Query hooks, field registry, atoms, organisms and
templates.

## Webhooks

`webhooks: [{ url, secret, collections, operations }]` POSTs every committed write as JSON, signed
with `x-cms-signature: sha256=<hmac of the body>`. Delivery has a 5s timeout and two retries, then it
logs and gives up. If an event must not be lost, listen on the event bus with a durable queue instead.

## Plugins

A plugin is a function from config to config:

```ts
export default withPlugins(defineConfig({ ... }), [
  seoPlugin({ collections: ['pages'] }),
  redirectsPlugin(),
])
```

`seoPlugin` adds a `seo` group to those collections. `redirectsPlugin` adds a `redirects` collection;
call `findRedirect(cms, path)` from a middleware to apply them.

## Integrations

The CMS depends on none of these libraries. Each port takes the Agora adapter, the official AdonisJS
one, or your own object:

| Port                     | Agora                                | Official AdonisJS               | Default          |
| ------------------------ | ------------------------------------ | ------------------------------- | ---------------- |
| `integrations.jobs`      | `durableJobs(() => engine)`          | `queueJobs({ deliverWebhook })` | in process       |
| `integrations.auth`      | `authkitAdapter({ resolveUser })`    | `adonisAuth({ guard })`         | `ctx.auth.user`  |
| `integrations.media`     | `mediaLibraryAdapter(library)`       | `driveMedia(disk)`              | the id as stored |
| `uploads.handler`        | your `media.upload` call             | `driveUploads(disk)`            | none             |
| `access` of a collection | `authzCollectionAccess(prefix, can)` | `bouncerAccess(ability)`        | open             |
| `integrations.observer`  | `telescopeWatcher(record)`           | `loggerObserver(logger)`        | none             |

`bouncerAccess` needs a synchronous ability, because access also decides what the panel shows; an
`async` one throws instead of allowing.

### Files with @adonisjs/drive

The config file loads before the app boots, so import the service inside the function. A top-level
`import drive from '@adonisjs/drive/services/main'` here would not be ready yet.

```ts
// config/cms.ts
const disk = async () => (await import('@adonisjs/drive/services/main')).default.use()

uploads: { handler: driveUploads(disk) },
integrations: { media: driveMedia(disk) },
```

Keys are generated and must fit 64 characters, so keep `prefix` short. On a private disk pass
`{ signed: true }` to both, or the URLs answer 403; a signed URL lasts `expiresIn` (default `1h`).

### Jobs with @adonisjs/queue

```ts
// app/jobs/deliver_cms_webhook.ts
import { Job } from '@adonisjs/queue';
import { type DeliverWebhookInput, runWebhookDelivery } from '@adonis-agora/cms';

export default class DeliverCmsWebhook extends Job<DeliverWebhookInput> {
  static options = { maxRetries: 8 };
  async execute() {
    await runWebhookDelivery(this.payload);
  }
}
```

```ts
// config/cms.ts
integrations: {
  jobs: queueJobs({
    deliverWebhook: async (input) => {
      const { default: job } = await import('#jobs/deliver_cms_webhook')
      return job.dispatch(input)
    },
  }),
},
```

### Jobs with @adonis-agora/durable

```ts
// app/workflows/cms.ts
export { CmsDeliverWebhook, CmsRunDueSchedules } from '@adonis-agora/cms/durable';
```

```ts
// config/cms.ts
integrations: {
  jobs: durableJobs(async () => (await import('@adonis-agora/durable/services/main')).default),
},
schedulerInterval: false, // `CmsRunDueSchedules` ticks from `durable:work` instead
```

### What holds for any queue

- The payload holds the hook's position in `webhooks`, never its secret.
- If the job cannot be enqueued, the webhook is delivered in process, so the event is not lost.
- Scheduled changes need something calling `cms.runDueSchedules()`: the built-in timer
  (`schedulerInterval`), `CmsRunDueSchedules`, or your own cron. With none of them, nothing publishes.
- For anything else that reacts to a write, use `cms.events.on(listener)`, or
  `durableBridge({ dispatch }).listen(cms.events)` to turn each write into a job.

## MySQL

Timestamps are stored as UTC. Set `timezone: 'Z'` on the connection, or the driver reads them back in
the server's zone:

```ts
connection: { host, user, password, database, timezone: 'Z' }
```
