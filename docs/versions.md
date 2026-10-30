# Versions and drafts

Every save writes a version row. That is what makes drafts, publish, restore and the history
panel possible — and it is why a document and its history are always written in the same
transaction.

```ts
export default defineConfig({
  versions: {
    drafts: true,
    retention: null, // null = full history
    autosave: false, // per collection, or { interval: 2000 }
    lockTtl: 300,
  },
});
```

A collection can override any of it with its own `versions` block.

## The two states

| `_status`   | Visible by default | Notes                                             |
| ----------- | ------------------ | ------------------------------------------------- |
| `published` | yes                | what the public API returns                       |
| `draft`     | no                 | needs `draft: true` **and** an authenticated user |

```ts
const draft = await posts.create({ title: 'Soon' }, { draft: true });

await posts.find(); // []
await posts.find({ draft: true }); // [draft]   (requires user)
await posts.publish(draft.id); // _status = 'published', new published version
await posts.unpublish(draft.id); // back to draft; published history stays
```

Anonymous access to `draft: true` throws `CmsForbiddenError` — drafts are never public.

## History

```ts
await posts.versions(post.id);
// { docs: [{ version: 3, status: 'published', autosave: false, createdAt, createdBy }, … ],
//   totalDocs }

const restored = await posts.restoreVersion(post.id, 1);
```

Restore never rewrites history: it loads the snapshot, runs `beforeValidate`/`beforeChange`
again (the schema may have changed) and writes it as the **next** version.

Snapshots include the document, its child tables (arrays, blocks, relation lists) and the
`schemaHash` they were taken against.

## Autosave

```ts
await posts.update(post.id, { body }, { autosave: true, draft: true });
```

Autosave versions are recorded with `autosave: true` and `status: 'draft'`, and **do not fire
`afterChange`** — otherwise every keystroke would trigger webhooks. They are the first to be
pruned.

## Retention

`retention: null` (default) keeps everything. With a number, pruning runs after every write and
keeps:

1. the newest `retention` manual versions,
2. **always** the latest published version,
3. deleting autosave rows first.

Implement pruning with care in a CMS where "the published page" is the audit trail — the last
publish is never dropped.

## Document locks

Advisory, not a database lock: it tells the panel who is editing, and it never blocks a write.

```ts
await posts.lock(post.id); // { userId: 'u1', expiresAt }
await posts.unlock(post.id); // owner only
```

A second user gets `CmsConflictError` (409) with the holder and expiry. Expired locks are
cleared on the next acquisition.

## Diff

```ts
import { diffSnapshots } from '@adonis-agora/cms';
diffSnapshots(versionA.snapshot.doc, versionB.snapshot.doc);
// { 'title': { before: 'a', after: 'b' }, 'tags[0].label': { before: 'x', after: 'y' } }
```

Paths point inside arrays, so a change inside a block is reported at its own path.

## REST

| Method   | Path                                                       |
| -------- | ---------------------------------------------------------- |
| `POST`   | `/api/cms/collections/:slug/:id/publish`                   |
| `POST`   | `/api/cms/collections/:slug/:id/unpublish`                 |
| `GET`    | `/api/cms/collections/:slug/:id/versions`                  |
| `GET`    | `/api/cms/collections/:slug/:id/versions/:version`         |
| `POST`   | `/api/cms/collections/:slug/:id/versions/:version/restore` |
| `POST`   | `/api/cms/collections/:slug/:id/lock`                      |
| `DELETE` | `/api/cms/collections/:slug/:id/lock`                      |

`?draft=true` on a read requires an authenticated request.

## Storage

| Table                | Columns                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cms_versions`       | `collection`, `document_id`, `locale`, `version`, `status`, `autosave`, `snapshot` (json), `created_by`, `created_at`, `is_latest`, `_tenant_id` |
| `cms_document_locks` | `collection`, `document_id`, `user_id`, `expires_at`, `_tenant_id`                                                                               |

Both are part of the compiled schema, so `cms:diff`, `cms:sync` and `cms:generate` cover them
like any other table. With row tenancy they also carry `_tenant_id` and are scoped per tenant.
