# @adonis-agora/cms-admin

## 0.5.1

### Patch Changes

- [#25](https://github.com/DavideCarvalho/adonis-agora-cms/pull/25) [`83b9551`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/83b9551b798191461b56f2db8e6fb825e3c077e2) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Console sidebar matches the old authkit admin console exactly (Agora console kit): nav rows are 32px with no gap between them, section labels and the brand/switcher header use authkit's spacing, the footer role shows as sent (no forced uppercase), and the theme toggle sits left-aligned with a 13px icon next to a 26px sign-out button.

## 0.5.0

### Minor Changes

- [#22](https://github.com/DavideCarvalho/adonis-agora-cms/pull/22) [`6b09718`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/6b0971811bd541a2c87836532070b5b673754af0) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - The CMS registers in the `agora.consoles` registry with its own `cms` icon (was `generic`), and the `agora.consoles` registry accepts the `flags` and `cms` icon keys, so those consoles show their own tile instead of `generic`. The admin: the console switcher shows the CMS console with its own orange tile and glyph, and the kit gains a 16px `DocumentIcon`; the collapsible nav section toggle has a test pinning its focus ring (Agora console kit round 3).

### Patch Changes

- Updated dependencies [[`6b09718`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/6b0971811bd541a2c87836532070b5b673754af0)]:
  - @adonis-agora/cms@0.7.0

## 0.4.0

### Minor Changes

- [#21](https://github.com/DavideCarvalho/adonis-agora-cms/pull/21) [`40a4fa0`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/40a4fa04ca37036339431e007b2055f1dd68e9aa) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - The admin is now an Agora console, built on the shared console kit: the same sidebar, topbar, ⌘K, light and dark themes and Sora / JetBrains Mono fonts as the other consoles, with an orange accent. The sidebar comes from your collections and globals (Content, one section per `admin.group`, Globals, Media, Settings, Views). `admin.theme.accent` and `admin.theme.logoUrl` still white-label it.

  The panel joins the `'agora.consoles'` registry (id `cms`): other consoles list it in their switcher, and their ⌘K finds your documents by title or slug, under the same access rules as the REST API (`GET /api/cms/consoles`, `GET /api/cms/consoles/search`). The sidebar footer shows the signed-in user and a sign-out; set them with the new `admin.viewer` and `admin.signOut` options. With `auth.builtin`, a form POST to the logout endpoint now redirects back to the panel.

### Patch Changes

- Updated dependencies [[`40a4fa0`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/40a4fa04ca37036339431e007b2055f1dd68e9aa)]:
  - @adonis-agora/cms@0.6.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`be6c30a`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/be6c30a204e8dee88721085113de9426efe0da6b)]:
  - @adonis-agora/cms@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`dcb9d86`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/dcb9d864966797eb0d52dac040f7a5cb231632e4)]:
  - @adonis-agora/cms@0.4.0

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

### Patch Changes

- Updated dependencies [[`8b9c7cd`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/8b9c7cd960838ebf64bc3b1a35d3144dffbeef0a)]:
  - @adonis-agora/cms@0.3.0
  - @adonis-agora/cms-react@0.3.0

## 0.2.0

### Minor Changes

- [#13](https://github.com/DavideCarvalho/adonis-agora-cms/pull/13) [`0bbe44a`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/0bbe44ac7dff3b815db96eeed354105e87e3a903) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Saved filters on the list, kept per browser. `mediaPlugin` adds folders to the media library and a focal
  point set by clicking the image. `admin.condition`, which never had an effect, is gone: use `visibleWhen`.
  The preview now shows only on collections that ask for it (`admin.livePreview` or `admin.visualEditor`). In the
  visual editor, a dragged block drops on the nearest sibling, and its toolbar no longer covers the text.

### Patch Changes

- [#14](https://github.com/DavideCarvalho/adonis-agora-cms/pull/14) [`3c3ddf9`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/3c3ddf944943dd569922f36f4d8639eb60e7bcce) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Security: REST routes never saw the HTTP method on a real Adonis context, so read-only API tokens could write.
  In production, an anonymous write or upload to a collection with no `access` rule is now refused
  (`rest.publicWrites` allows it). `node ace add` now configures both packages, and removing a field no longer
  stops the app in development.
- Updated dependencies [[`01e3cd3`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/01e3cd304bf2eed717e0a390ff5a8cc841011266), [`367d01a`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/367d01aef681b0bf1b4da1d90e0441d53c7c29a0), [`3c3ddf9`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/3c3ddf944943dd569922f36f4d8639eb60e7bcce), [`0bbe44a`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/0bbe44ac7dff3b815db96eeed354105e87e3a903)]:
  - @adonis-agora/cms@0.2.0
  - @adonis-agora/cms-react@0.2.0

## 0.1.0

### Minor Changes

- [`d96cf23`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/d96cf23a17b93708ce3f64635f4572207234b9b6) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - First public release of the CMS: config-first schema with relational child tables, DDL diff/sync,
  Local API, REST, access control, hooks, row and database tenancy, versions, drafts on published
  documents, autosave, scheduled publishing, webhooks, plugins (SEO, redirects, search, forms, nested
  docs), i18n and the visual admin with its own optional login. Integrations are ports that take an
  Agora adapter, an official AdonisJS one, or a custom object.

### Patch Changes

- Updated dependencies [[`d96cf23`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/d96cf23a17b93708ce3f64635f4572207234b9b6)]:
  - @adonis-agora/cms@0.1.0
  - @adonis-agora/cms-react@0.1.0
