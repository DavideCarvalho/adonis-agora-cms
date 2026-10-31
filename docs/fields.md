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

| Builder                        | Storage                              | Notes                                               |
| ------------------------------ | ------------------------------------ | --------------------------------------------------- |
| `text`                         | `varchar(255)` (or `maxLength`)      | `minLength`, `maxLength`, `pattern`                 |
| `textarea`                     | `text`                               | `maxLength`                                         |
| `email`                        | `varchar(320)`                       | checked on write                                    |
| `password`                     | `varchar(255)`                       | hashed, never returned: see [Passwords](#passwords) |
| `number`                       | `integer` / `float` / `decimal(p,s)` | `format`, `min`, `max`                              |
| `checkbox`                     | `boolean`                            |                                                     |
| `date`                         | `timestamptz`                        | date and time                                       |
| `select`                       | `varchar(255)` or child table        | `hasMany: true` → child table with `value`          |
| `radio`                        | `varchar(255)`                       |                                                     |
| `json`                         | `json`                               | free-form; not filterable by key outside Postgres   |
| `code`                         | `text`                               | monospace, no highlighting                          |
| `slug`                         | `varchar(255)`                       | `from` derives it when empty                        |
| `richText`                     | `json`                               | editor document, not HTML; `blocks`                 |
| `relation`                     | `<name>_id` or child table           | `relationTo: string \| string[]` (polymorphic)      |
| `join`                         | no column                            | the other side of a relation: `collection`, `on`    |
| `upload`                       | `<name>_id`                          | `mimeTypes` filters the file picker                 |
| `point`                        | `json`                               | `[longitude, latitude]`                             |
| `array`                        | child table                          | recursive; `minRows`, `maxRows`                     |
| `group`                        | prefixed columns on the parent       | recursive, stays flat/queryable                     |
| `blocks`                       | child table with `type`              | recursive; `minRows`, `maxRows`                     |
| `tabs` / `row` / `collapsible` | no column                            | admin layout only                                   |

Every field also takes `label`, `required`, `unique`, `index`, `localized`, `defaultValue`, `hidden`,
`access`, `validate` and `admin`.

An `upload` holds an id. With `integrations.media` a read turns it into `{ id, url, mime, ... }`;
without it you get the id as stored.

## Showing a field conditionally

```ts
fields.select('kind', { options: [...] }),
fields.text('href', { admin: { visibleWhen: { field: 'kind', equals: 'link' } } }),
```

`equals` also takes an array of values. It only hides the input: the value stays in the document, and
`required` still applies.

`admin` also takes `description`, `placeholder`, `component`, `hiddenInList` and `isSortable`.

## Passwords

`fields.password` is hashed with scrypt on write, and no read returns it: not the API, not a populated
relation, not a version, not a webhook. It cannot be filtered or sorted by. An update that leaves it
out, or sends it empty, keeps the current one. To check one:

```ts
await cms.collection('members').checkPassword(id, 'password', input); // true or false
```

It has to be at the top level of the document (tabs, rows and collapsibles are fine), and cannot be
localized. On a published document with drafts, saving a draft does not change it: save it live.

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

Every field takes a `validate`, and it may be async. Return a message to refuse the value:

```ts
fields.text('code', {
  validate: async ({ value, data }) => ((await isTaken(value)) ? 'already taken' : undefined),
});
```

It runs on non-empty values, and `data` holds the sibling fields. On an update it runs on the whole
document, not only on what was sent.

To change a value on its way in or out, use the [hooks of the collection](./local-api.md).

## Config errors

`validateConfig` runs at boot and accumulates every problem with its path, so a broken config is fixed
in one pass:

```
collections.posts.fields[3].name: invalid field name "Title"
collections.posts.fields[5].relationTo: relation target "users" is not a declared collection
```

Reserved: names starting with `_` (system columns), `id`, `createdAt`, `updatedAt`, and the table slugs
`versions`, `preferences`, `document_locks`, `schema_state`.

## Custom field types

```ts
import { defineField, fields } from '@adonis-agora/cms';

const color = defineField({
  type: 'color',
  column: { type: 'string', length: 9 },
  component: 'color',
});

collection('posts', { fields: [fields.text('title'), color('accent', { required: true })] });
```

`column` says what the schema creates. `component` is the id the panel looks up, so register it from an
[extension](./using.md#extending-the-panel):

```js
export default ({ React, registerField }) => {
  registerField('color', ({ value, onChange }) =>
    React.createElement('input', {
      type: 'color',
      value: value ?? '#000000',
      onChange: (event) => onChange(event.target.value),
    }),
  );
};
```
