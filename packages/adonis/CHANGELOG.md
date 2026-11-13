# @adonis-agora/cms

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
