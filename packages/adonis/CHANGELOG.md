# @adonis-agora/cms

## 0.10.1

### Patch Changes

- [#40](https://github.com/DavideCarvalho/adonis-agora-cms/pull/40) [`cbcf2ec`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/cbcf2ec6ff39561d04651a9b10520d2a99aee89e) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - A shared login-attempt store that stops answering (a Redis client reconnecting to a server that is down queues commands instead of failing them) no longer hangs every login: a call gets one second, then counting falls back to this process's memory and the shared store is skipped for ten seconds before it is tried again.

## 0.10.0

### Minor Changes

- [`fc8fc4e`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/fc8fc4eb604f5b9602ba270578666a76e74d05ac) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Security: access rules now cover versions, locks, queries and related documents, and login throttling is shared across processes.

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

## 0.9.1

### Patch Changes

- [#38](https://github.com/DavideCarvalho/adonis-agora-cms/pull/38) [`38066e1`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/38066e1345e9ad39d28346bac861907dcd02c9d0) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Security: the PATCH merge in `update` now ignores `__proto__`, `constructor` and `prototype` keys, so a body parsed with plain `JSON.parse` can no longer swap the merged document's prototype and slip a field (for example a password field denied by `access.update`) past field-level access. Validation only reads a document's own properties, and `setByPath` rejects those reserved path segments and walks own properties only.

## 0.9.0

### Minor Changes

- [#37](https://github.com/DavideCarvalho/adonis-agora-cms/pull/37) [`86f2efb`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/86f2efb14dff1e6ea047bbcef3313a72f265ebba) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - createdAt / updatedAt on everything the CMS owns. Scheduled changes (`cms_document_schedules`) gain nullable `created_at` / `updated_at` columns and `scheduled()` / `schedule()` answer `createdAt` / `updatedAt` (ISO in REST, `null` for a change scheduled before); rescheduling keeps `createdAt`. Password credentials (`cms_auth_credentials`) record `created_at`, and `listApiTokens()` returns each token's `createdAt`. Run `node ace cms:sync` on deploy: production logs schema drift until the columns exist (they are added nullable, no default, no backfill). The admin edit page shows Created / Updated under the title, and the list's Updated date shows the full time on hover.

## 0.8.2

### Patch Changes

- [#34](https://github.com/DavideCarvalho/adonis-agora-cms/pull/34) [`f43a842`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/f43a8421bb5bcd353d3d6993f0bb9a8f16c9eaeb) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Describe the CMS infrastructure for telescope's Architecture page: `media.drive()` and `uploads.drive()` carry their Drive disk (`media files` / `uploads`), and at boot the `cms` config is tagged with the default Lucid connection its documents live in (`content`). Uses the global `Symbol.for('@adonis-agora/stack')`; no dependency on telescope.

## 0.8.1

### Patch Changes

- [#32](https://github.com/DavideCarvalho/adonis-agora-cms/pull/32) [`b29c1dc`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/b29c1dc68ba5b3e4ced6873ebf543532a64338fc) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Console ⌘K: arrow keys now visibly move the selection. The highlighted item was styled with a bare `data-selected:` (cmdk marks every item `true` or `false`) and with the dialog's own surface color, so moving looked like nothing happened.

## 0.8.0

### Minor Changes

- [#26](https://github.com/DavideCarvalho/adonis-agora-cms/pull/26) [`e6ae454`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/e6ae454026a1bff2337fc495a052be6eb65047f2) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - `requiresRole` also matches authkit's `globalRoles` and a `roles` array, not only `user.role`, so `requiresRole('ADMIN')` works with an authkit identity user (in-process or remote authkit). The `authkitAuth` comment no longer refers to the removed `authkit_middleware`.

## 0.7.0

### Minor Changes

- [#22](https://github.com/DavideCarvalho/adonis-agora-cms/pull/22) [`6b09718`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/6b0971811bd541a2c87836532070b5b673754af0) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - The CMS registers in the `agora.consoles` registry with its own `cms` icon (was `generic`), and the `agora.consoles` registry accepts the `flags` and `cms` icon keys, so those consoles show their own tile instead of `generic`. The admin: the console switcher shows the CMS console with its own orange tile and glyph, and the kit gains a 16px `DocumentIcon`; the collapsible nav section toggle has a test pinning its focus ring (Agora console kit round 3).

## 0.6.0

### Minor Changes

- [#21](https://github.com/DavideCarvalho/adonis-agora-cms/pull/21) [`40a4fa0`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/40a4fa04ca37036339431e007b2055f1dd68e9aa) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - The admin is now an Agora console, built on the shared console kit: the same sidebar, topbar, ⌘K, light and dark themes and Sora / JetBrains Mono fonts as the other consoles, with an orange accent. The sidebar comes from your collections and globals (Content, one section per `admin.group`, Globals, Media, Settings, Views). `admin.theme.accent` and `admin.theme.logoUrl` still white-label it.

  The panel joins the `'agora.consoles'` registry (id `cms`): other consoles list it in their switcher, and their ⌘K finds your documents by title or slug, under the same access rules as the REST API (`GET /api/cms/consoles`, `GET /api/cms/consoles/search`). The sidebar footer shows the signed-in user and a sign-out; set them with the new `admin.viewer` and `admin.signOut` options. With `auth.builtin`, a form POST to the logout endpoint now redirects back to the panel.

## 0.5.0

### Minor Changes

- [#20](https://github.com/DavideCarvalho/adonis-agora-cms/pull/20) [`be6c30a`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/be6c30a204e8dee88721085113de9426efe0da6b) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Content from the terminal: `node ace cms:collections:*`, `cms:documents:*` (list, show, create, update, delete, restore, publish, unpublish, discard-draft, schedule, scheduled, unschedule), `cms:versions:*` (list, show, restore) and `cms:globals:*` (show, update). Each runs the REST handler on the CMS instance `scopeCmsRequest` picks, so access rules, hooks, validation, drafts and tenancy match REST and the `/mcp/agora` tools. Writes need an actor: `--token` (or `CMS_API_TOKEN`), a CMS API token with the `write` ability, or `--as-system`, which runs with no principal (access rules still apply; only the production sign-in guard is lifted). An unknown token is refused. `--json` everywhere; destructive commands ask unless `--force`. See `docs/cli.md`.

## 0.4.0

### Minor Changes

- [#18](https://github.com/DavideCarvalho/adonis-agora-cms/pull/18) [`dcb9d86`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/dcb9d864966797eb0d52dac040f7a5cb231632e4) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - The CMS registers its tools in the agora MCP hub (`/mcp/agora`, served by `@adonis-agora/agent/mcp_provider`) as the `cms` lib: `cms_list_collections`, `cms_get_collection`, `cms_list_documents`, `cms_get_document`, `cms_list_versions`, `cms_get_version` and `cms_get_global` (read), plus `cms_create_document`, `cms_update_document`, `cms_publish_document`, `cms_unpublish_document`, `cms_delete_document`, `cms_restore_version` and `cms_update_global` (action). Each call acts as the request's CMS principal, like the REST API, so access rules, drafts and locales apply; `devTools.authorize` in `config/mcp.ts` gates the lib.

  The standalone `@adonis-agora/cms-mcp` package and the `cms:mcp` command are removed: point your MCP client at `/mcp/agora` instead (see `docs/mcp.md`).

## 0.3.0

### Minor Changes

- [#17](https://github.com/DavideCarvalho/adonis-agora-cms/pull/17) [`8b9c7cd`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/8b9c7cd960838ebf64bc3b1a35d3144dffbeef0a) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - REST lists use the `@adonis-agora/filter` wire format and envelope.
  - `GET /api/cms/collections/:slug` takes `filter[field]=v` / `filter[field][op]=v` (plus `where[i]` OR/AND groups from `filter-client`), `sort` checked against the collection's sortable fields, and `page` + `size` (default 20, max 200). It answers `{ data, meta: { total, perPage, currentPage, lastPage, firstPage } }`.
  - `GET /api/cms/collections/:slug/:id/versions` takes `page` + `size` (default 20, max 100), `filter[locale]` and `sort=-version`, and answers the same envelope.
  - An unknown filter field, an unsupported operator or an unknown sort field answers `400` with `CMS_INVALID_QUERY`.
  - `where[field][op]`, `limit` and the `docs`/`totalDocs`/`totalPages`/`hasNextPage`/`hasPrevPage` envelope are gone from REST. The Local API (`cms.collection(slug).find()`) is unchanged.
  - `parseFindQuery` is replaced by `parseListQuery` (lists) and `parseReadOptions` (single reads).
  - `cms-client`: `ContentQuery` takes `filter`, `page` and `size` instead of `where` and `limit`; `ContentList<T>` is `OffsetPage<T>`.
  - `cms-react`: `ListQuery` takes `filter`, `page` and `size`; `ListResult` is `OffsetPage<AdminDocument>`; `AdminClient.versions()` takes `{ page, size }` and returns `OffsetPage<VersionRecord>`.

## 0.2.0

### Minor Changes

- [#15](https://github.com/DavideCarvalho/adonis-agora-cms/pull/15) [`01e3cd3`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/01e3cd304bf2eed717e0a390ff5a8cc841011266) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Config errors suggest what you probably meant, and catch more mistakes: a slug's `from`, `visibleWhen`, `join`,
  reserved field names and a preview with no `admin.livePreview`. `cms.collection()` autocompletes slugs. The
  visual editor shows which side a dragged block lands on. Links in rich text no longer lose the selection.

- [#16](https://github.com/DavideCarvalho/adonis-agora-cms/pull/16) [`367d01a`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/367d01aef681b0bf1b4da1d90e0441d53c7c29a0) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Fix `fields.password`, which stored the value in plain text and returned it from every read. It is now
  hashed with scrypt and never returned, and `cms.collection(slug).checkPassword(id, field, value)` checks
  it. A value already stored by an earlier version stays in plain text until it is set again, and cannot
  be checked: set it again.

  `validate` now runs on every kind of field and may be async; before, only text, slug and number called
  it, and a promise counted as valid. `blocks` respects `minRows` and `maxRows` on write.
  `validateDocument` is now async.

  The config refuses options that did nothing, so they no longer look like they work: `hooks` on a field,
  `withTime`, `language`, `hashWith` and `admin.position`.

- [#13](https://github.com/DavideCarvalho/adonis-agora-cms/pull/13) [`0bbe44a`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/0bbe44ac7dff3b815db96eeed354105e87e3a903) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Saved filters on the list, kept per browser. `mediaPlugin` adds folders to the media library and a focal
  point set by clicking the image. `admin.condition`, which never had an effect, is gone: use `visibleWhen`.
  The preview now shows only on collections that ask for it (`admin.livePreview` or `admin.visualEditor`). In the
  visual editor, a dragged block drops on the nearest sibling, and its toolbar no longer covers the text.

### Patch Changes

- [#14](https://github.com/DavideCarvalho/adonis-agora-cms/pull/14) [`3c3ddf9`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/3c3ddf944943dd569922f36f4d8639eb60e7bcce) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Security: REST routes never saw the HTTP method on a real Adonis context, so read-only API tokens could write.
  In production, an anonymous write or upload to a collection with no `access` rule is now refused
  (`rest.publicWrites` allows it). `node ace add` now configures both packages, and removing a field no longer
  stops the app in development.

## 0.1.0

### Minor Changes

- [`d96cf23`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/d96cf23a17b93708ce3f64635f4572207234b9b6) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - First public release of the CMS: config-first schema with relational child tables, DDL diff/sync,
  Local API, REST, access control, hooks, row and database tenancy, versions, drafts on published
  documents, autosave, scheduled publishing, webhooks, plugins (SEO, redirects, search, forms, nested
  docs), i18n and the visual admin with its own optional login. Integrations are ports that take an
  Agora adapter, an official AdonisJS one, or a custom object.
