# adonis-cms

A config-first CMS for **AdonisJS** — collections, globals, drafts, i18n and a schema-driven
admin panel, in the spirit of [Payload CMS](https://payloadcms.com).

Part of the [Agora](https://github.com/DavideCarvalho) ecosystem, alongside
[`@adonis-agora/media`](https://github.com/DavideCarvalho/adonis-agora-media),
[`@adonis-agora/filter`](https://github.com/DavideCarvalho/adonis-agora-filter),
`@adonis-agora/authkit` and `@adonis-agora/authz`.

> **Status:** architecture approved — full scope, no MVP. Implementation running by milestones.
> Read [`docs/specs/2026-10-30-adonis-cms-design.md`](./docs/specs/2026-10-30-adonis-cms-design.md).

## The idea

```ts
// config/cms.ts
import { defineConfig, collection, fields } from '@adonis-agora/cms'

export default defineConfig({
  collections: [
    collection('posts', {
      versions: { drafts: true },
      fields: [
        fields.text('title', { required: true }),
        fields.slug('slug', { from: 'title', unique: true }),
        fields.richText('body'),
        fields.select('status', { options: ['draft', 'published'] }),
      ],
    }),
  ],
})
```

That config is the single source of truth for:

| Surface | Derived from the config |
|---|---|
| Database | `node ace cms:diff` prints a plan, `cms:sync` applies it (or generates a Lucid migration) |
| Types | `CmsDocument<typeof config, 'posts'>` — no codegen |
| REST | `/api/cms/collections/posts` with filter/sort/pagination |
| Local API | `cms.collection('posts').find({ where: ... })` |
| Admin panel | React SPA, one field component per field type |

## Packages

| Package | Role |
|---|---|
| `@adonis-agora/cms` | config, schema compiler, DDL/diff, repository, Local API, REST, access, hooks, versions, i18n |
| `@adonis-agora/cms-react` | field components, `FieldRegistry`, admin hooks |
| `@adonis-agora/cms-admin` | the admin SPA (Vite), embedded into the core at build time |

## License

MIT © Davi Carvalho
