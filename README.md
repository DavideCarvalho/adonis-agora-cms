# adonis-cms

A config-first CMS for **AdonisJS** — collections, globals, drafts, i18n and a schema-driven
admin panel, in the spirit of [Payload CMS](https://payloadcms.com).

Part of the [Agora](https://github.com/DavideCarvalho) ecosystem, alongside
[`@adonis-agora/media`](https://github.com/DavideCarvalho/adonis-agora-media),
[`@adonis-agora/filter`](https://github.com/DavideCarvalho/adonis-agora-filter),
`@adonis-agora/authkit` and `@adonis-agora/authz`.

> **Status:** foundation milestone shipped (schema, DDL, tenancy, types). Data layer, drafts,
> i18n runtime, admin and integrations are next — see the
> [architecture spec](./docs/specs/2026-10-30-adonis-cms-design.md) and the
> [Marco 1 plan](./docs/superpowers/plans/2026-10-30-cms-marco-1-fundacao.md).

## The idea

```ts
// config/cms.ts
import { block, collection, defineConfig, fields, global } from '@adonis-agora/cms';

const hero = block('hero', {
  fields: [
    fields.text('heading', { required: true }),
    fields.upload('image', { relationTo: 'media' }),
  ],
});

export default defineConfig({
  db: { schema: 'managed', id: 'uuid' },
  localization: { locales: ['pt-BR', 'en'], defaultLocale: 'pt-BR' },
  tenancy: { strategy: 'row' },
  collections: [
    collection('posts', {
      admin: { useAsTitle: 'title' },
      versions: { drafts: true },
      fields: [
        fields.text('title', { required: true }),
        fields.slug('slug', { from: 'title', unique: true }),
        fields.richText('body', { localized: true }),
        fields.select('status', {
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        }),
        fields.array('tags', { fields: [fields.text('label')] }),
        fields.blocks('layout', { blocks: [hero] }),
      ],
    }),
  ],
  globals: [global('site_settings', { fields: [fields.text('siteName')] })],
});
```

That config is the single source of truth for:

| Surface     | Derived from the config                                                            |
| ----------- | ---------------------------------------------------------------------------------- |
| Database    | `cms:diff` prints a plan, `cms:sync` applies it, `cms:generate` writes a migration |
| Types       | `CmsDocument<typeof config, 'posts'>` — no codegen                                 |
| REST        | `/api/cms/collections/posts` with filter/sort/pagination (next milestone)          |
| Local API   | `cms.collection('posts').find({ where: ... })` (next milestone)                    |
| Admin panel | React SPA, one field component per field type (next milestone)                     |

## Install

```bash
node ace add @adonisjs/lucid
node ace configure @adonis-agora/cms
```

The configure hook registers the provider and the `cms:*` commands, publishes `config/cms.ts`
and a migration that creates the schema.

## Schema workflow

```bash
node ace cms:diff          # plan; exit 1 on drift, 2 on destructive drift
node ace cms:sync          # apply (dev/test `managed` mode does this on boot)
node ace cms:sync --dry-run
node ace cms:generate      # write a Lucid migration with the frozen spec
node ace cms:status        # applied hash vs current, documents per collection
```

Three modes: `managed` (auto in dev, explicit in production), `migrations` (Lucid owns the
DDL) and `manual` (you call the exported functions). Read
[`docs/schema.md`](./docs/schema.md).

## Storage model

Arrays, blocks, groups and `hasMany` are **relational**, not JSON — that is what makes
`where[layout.type]=hero` and per-field access possible:

```
cms_posts
cms_posts__tags            ← array('tags')
cms_posts__layout          ← blocks, with type + union of block columns
cms_posts__layout__gallery ← nested array inside a block
```

A logical-path query plan maps `layout.gallery.caption` to its table, column and join chain, so
the filter and the REST layer never need to know the physical layout. Read
[`docs/fields.md`](./docs/fields.md).

## Tenancy

```ts
tenancy: { strategy: 'row', required: true }      // _tenant_id everywhere, unique per tenant
tenancy: { strategy: 'database', connection: (t) => `tenant_${t}` }
```

No `tenancy` key = single instance. Per-tenant overrides in `row` mode are limited to
admin/labels/visibility because the DDL is shared. Read the spec, §23.

## Testing

```ts
import { createTestCms } from '@adonis-agora/cms/testing';

const kit = await createTestCms({ config });
await kit.introspect(); // tables, columns, indexes, FKs
kit.actAs({ id: 'user-1' });
await kit.destroy();
```

## Packages

| Package                   | Role                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `@adonis-agora/cms`       | config, schema compiler, DDL/diff, repository, Local API, REST, access, hooks, versions, i18n |
| `@adonis-agora/cms-react` | field components, `FieldRegistry`, admin hooks _(next milestone)_                             |
| `@adonis-agora/cms-admin` | the admin SPA (Vite), embedded into the core at build time _(next milestone)_                 |

## License

MIT © Davi Carvalho
