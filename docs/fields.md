# Fields

Every field builder is a plain-data identity function. The `const` type parameters keep names,
types and option values literal, which is what makes `CmsDocument` inference work without
codegen.

```ts
import { collection, defineConfig, fields } from '@adonis-agora/cms';

export default defineConfig({
  collections: [
    collection('posts', {
      fields: [
        fields.text('title', { required: true, maxLength: 120 }),
        fields.slug('slug', { from: 'title', unique: true }),
        fields.richText('body'),
        fields.select('status', {
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
        }),
      ],
    }),
  ],
});
```

## Catalog

| Builder                        | Storage                              | Notes                                             |
| ------------------------------ | ------------------------------------ | ------------------------------------------------- |
| `text`                         | `varchar(255)` (or `maxLength`)      |                                                   |
| `textarea`                     | `text`                               |                                                   |
| `email`                        | `varchar(320)`                       |                                                   |
| `password`                     | `varchar(255)`                       | hashed by a hook; never serialized                |
| `number`                       | `integer` / `float` / `decimal(p,s)` | `format`                                          |
| `checkbox`                     | `boolean`                            |                                                   |
| `date`                         | `timestamptz`                        |                                                   |
| `select`                       | `varchar(255)` or child table        | `hasMany: true` → child table with `value`        |
| `radio`                        | `varchar(255)`                       |                                                   |
| `json`                         | `json`                               | free-form; not filterable by key outside Postgres |
| `code`                         | `text`                               |                                                   |
| `slug`                         | `varchar(255)`                       | `from` derives it when empty                      |
| `richText`                     | `json`                               | editor document, not HTML                         |
| `relation`                     | `<name>_id` or child table           | `relationTo: string \| string[]` (polymorphic)    |
| `upload`                       | `<name>_id`                          | needs `integrations.media`                        |
| `array`                        | child table                          | recursive                                         |
| `group`                        | prefixed columns on the parent       | recursive, stays flat/queryable                   |
| `blocks`                       | child table with `type`              | recursive                                         |
| `tabs` / `row` / `collapsible` | no column                            | admin layout only                                 |

## Naming

Field names are written in JS style (`publishedAt`); columns are snake_case (`published_at`).
Child tables are named after the path:

```
cms_posts
cms_posts__tags            ← array('tags')
cms_posts__layout          ← blocks('layout')  (type + union of block columns)
cms_posts__layout__gallery ← array('gallery') inside a block
```

## Localized fields

`localized: true` on a document field creates one column per locale (`title_pt_br`,
`title_en`). Inside a child table, localization is row-level: the table gets `_locale` and each
row belongs to one locale, so ordering is independent per locale.

`localization.localizedRequired` decides whether `required` applies only to the default locale
(`'default'`) or to every locale (`'all'`).

## Relations

```ts
fields.relation('author', { relationTo: 'users' }); // author_id + FK, set null
fields.relation('related', { relationTo: ['posts', 'pages'], hasMany: true }); // child table
```

`hasMany` relations get a child table with `related_id` and, when polymorphic,
`related_collection`.

## Blocks

```ts
import { block, fields } from '@adonis-agora/cms';

const hero = block('hero', {
  fields: [
    fields.text('heading', { required: true }),
    fields.upload('image', { relationTo: 'media' }),
  ],
});

fields.blocks('layout', { blocks: [hero] });
```

Blocks compile into one child table with `type` plus the union of every block's columns. A
column that exists in only one block is nullable in the union; two blocks declaring the same
column with incompatible types fail at compile time.

## Validation

`validateConfig` accumulates every problem with its path, so a broken config is fixed in one
pass:

```
collections.posts.fields[3].name: invalid field name "Title"
collections.posts.fields[5].relationTo: relation target "users" is not a declared collection
```

Reserved: names starting with `_` (system columns) and the table slugs `versions`,
`preferences`, `document_locks`, `schema_state`.

## Custom field types

`defineField` (custom column mapping + admin component) is specified but not implemented yet —
it lands with the admin milestone. Until then, `fieldTypes` in the config only whitelists extra
type ids for forward compatibility.
