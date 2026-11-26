---
"@adonis-agora/cms": minor
---

Security: access rules now cover versions, locks, queries and related documents, and login throttling is shared across processes.

**Breaking:**

- `POST …/lock` with a `ttlSeconds` that is not a positive number, or above the new `versions.maxLockTtl` (default 3600, never below `lockTtl`), answers 422 instead of locking for that long or ignoring it.
- A `sort` on an unknown field, or a field inside an array or blocks, throws `InvalidColumnFilterError` (400 over REST) instead of reaching SQL as a raw column. Fields, `id`, `createdAt`, `updatedAt`, `_status`, `created_at` and `updated_at` still sort.
- `GET …/versions/:v?snapshot=true` (and `version()`) answers 403 to an anonymous caller on a collection with drafts, and 404 when the caller cannot read the document. Listing versions, and a version without its snapshot, needs read access to the document (404 otherwise).
- Filtering or sorting on a field hidden by its `access.read` throws a 400 naming the field.
- Populated relations follow the related collection's `read` rule, drafts, soft deletes, tenant and field rules: what the caller cannot read stays a bare id. An `upload` into a collection of this CMS follows that collection's rules too: one the caller cannot read is not resolved and comes back as `{ id }`.

**Fixed:**

- Hooks and version history see the whole document. `previousData`, `afterChange`'s `doc` and the delete hooks no longer miss fields the writing user's `access.read` hides, an update no longer fails `required` on a hidden field, and versions written by such a user keep those fields (trimmed for each reader on the way out). Delete hooks now get the `id` and `doc` their type promised.
- Per-document access rules decide on the whole document: `read` on `findByID` (and so on version history and snapshots), and `update`/`delete` with their `doc`, now see fields the caller's `access.read` hides, instead of denying because they looked trimmed. Scheduling now evaluates `update` with the request, the id and the document (it had none of them), restoring a soft-deleted document passes its `doc`, and reading a document's schedule takes its `read` rule (404 otherwise). Scheduling or cancelling for a document that does not exist answers 404.
- `MediaAdapter.resolveMany(ids, { user, tenant })` receives the reader, so an external library can apply its own rules.

- Discarding a draft, and taking or releasing a document lock, need the collection's `update` access. Locking a document that does not exist answers 404.
- Version snapshots, pending-draft overlays (`draft: true` reads) and the relations stored in them leave out fields the reader's `access.read` rules hide. A rule on a `row`, `collapsible` or `tabs` field now covers the fields inside it.
- Login throttling adds a per-address limit across all e-mails (password spraying) and no longer grows without bound. It uses `@adonisjs/limiter` (v2/v3, any of its stores) or `@adonisjs/redis` automatically when the app has one, takes `loginAttempts: { perAccount, perIp, windowSeconds, store }`, and logs once at boot in production when the count is per process.
