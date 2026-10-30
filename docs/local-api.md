# Local API

The server-side entry point. No HTTP: access, hooks and tenancy run exactly as they will over
REST, so a script, a queue job or a server component gets the same rules.

```ts
import db from '@adonisjs/lucid/services/db';
import { createCms } from '@adonis-agora/cms';

const cms = createCms({
  config, // config/cms.ts default export
  client: db.connection().getWriteClient(),
  user: ctx.auth.user, // optional
  tenant: ctx.cms.tenant ?? null, // optional (row tenancy)
  req: ctx, // optional, handed to access/hooks
});

const posts = cms.collection('posts');

const post = await posts.create({ title: 'Hello', body: doc, tags: [{ label: 'adonis' }] });
const { docs, totalDocs, page } = await posts.find({
  where: { status: 'published', 'tags.label': 'adonis' },
  sort: '-createdAt',
  limit: 10,
  page: 1,
  depth: 1,
});

await posts.update(post.id, { title: 'Hello again' });
await posts.delete(post.id);
```

Document types come from the config, so `post.title` is `string` and `post.status` is
`'draft' | 'published'` without a cast.

## Scoped instances

```ts
cms.forTenant('acme'); // shares the schema and connection; scopes every query
cms.as(user); // same, with a different request user
```

Both are cheap: nothing is recompiled or reconnected.

## Query grammar

| Key                      | Meaning                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `where`                  | field → value, or field → `{ equals, not_equals, in, not_in, like, not_like, greater_than, greater_than_equal, less_than, less_than_equal }` |
| `where.and` / `where.or` | arrays of the same shape                                                                                                                     |
| `sort`                   | `'-createdAt'` = desc, `'title'` = asc, comma-separated                                                                                      |
| `limit` / `page`         | defaults `20` / `1`, limit capped at `200`                                                                                                   |
| `depth`                  | `0` = raw ids, `1` = populate hasOne relations                                                                                               |
| `draft`                  | `false` restricts to published documents (drafts land with versioning)                                                                       |
| `select`                 | root columns to return                                                                                                                       |

Fields inside arrays and blocks are addressable by their logical path
(`where['layout.type'] = 'hero'`) and compile to `exists (...)` subqueries — no join leaks a
document.

## Access

Collection-level access runs before anything touches the database:

```ts
access: {
  read: ({ user }) => user ? { field: 'owner', operator: 'equals', value: user.id } : false,
  create: ({ user }) => Boolean(user),
  update: ({ user }) => Boolean(user),
  delete: ({ user }) => user?.role === 'admin',
}
```

- `false` → `CmsForbiddenError` on writes, empty result on reads.
- A `{ field, operator, value }` on `read` scopes the query and hides documents from
  `findByID` (returns `null`, not `403` — no existence leak).
- Field-level `access.read` **removes** the property from the returned document.

`overrideAccess: true` skips access checks; tenancy is separate and is never bypassed this way.

## Hooks

```
beforeValidate → field validate → beforeChange → [trx] write → afterChange → commit
```

`afterChange` runs **inside** the transaction: if it throws, the document and its children roll
back. External side effects (webhooks, emails) belong in a queue (`@adonis-agora/durable`), not
in `afterChange`.

## Tenancy

```ts
tenancy: { strategy: 'row', required: true }
```

Every query — root and child tables — carries `_tenant_id`. `unique` is per tenant, so two
tenants can both have `hello-world`. Creating without a tenant when `required: true` throws
`CmsForbiddenError`.

## Limits (current milestone)

- Partial-array merge by row id arrives with versioning/i18n; today a payload replaces the
  array it sends.
- `select` accepts root columns only.
- REST routes and the `filter` integration are the next milestone; the parser here is the one
  they will delegate to.
