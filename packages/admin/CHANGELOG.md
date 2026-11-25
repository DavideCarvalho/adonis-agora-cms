# @adonis-agora/cms-admin

## 0.7.1

### Patch Changes

- Updated dependencies [[`38066e1`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/38066e1345e9ad39d28346bac861907dcd02c9d0)]:
  - @adonis-agora/cms@0.9.1

## 0.7.0

### Minor Changes

- [#37](https://github.com/DavideCarvalho/adonis-agora-cms/pull/37) [`86f2efb`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/86f2efb14dff1e6ea047bbcef3313a72f265ebba) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - createdAt / updatedAt on everything the CMS owns. Scheduled changes (`cms_document_schedules`) gain nullable `created_at` / `updated_at` columns and `scheduled()` / `schedule()` answer `createdAt` / `updatedAt` (ISO in REST, `null` for a change scheduled before); rescheduling keeps `createdAt`. Password credentials (`cms_auth_credentials`) record `created_at`, and `listApiTokens()` returns each token's `createdAt`. Run `node ace cms:sync` on deploy: production logs schema drift until the columns exist (they are added nullable, no default, no backfill). The admin edit page shows Created / Updated under the title, and the list's Updated date shows the full time on hover.

### Patch Changes

- Updated dependencies [[`86f2efb`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/86f2efb14dff1e6ea047bbcef3313a72f265ebba)]:
  - @adonis-agora/cms@0.9.0
  - @adonis-agora/cms-react@0.5.0

## 0.6.6

### Patch Changes

- [#36](https://github.com/DavideCarvalho/adonis-agora-cms/pull/36) [`a845537`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/a8455372e8c3b9b6671be957b3b1d78ec81275a1) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Admin UI: the app/scope picker button now announces "noun: label" instead of the two spans run together, its search also matches the option hint, the highlight stays on a real option when the list shrinks, and focus returns to the button after a pick (console kit sync).

## 0.6.5

### Patch Changes

- [#35](https://github.com/DavideCarvalho/adonis-agora-cms/pull/35) [`d49ca54`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/d49ca546ae5978f231aa57d5a66e794425a13b13) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Going to another console (switcher, ⌘K, search results, sidebar links) keeps this page's `?app=` and `?tenant=`, so the picked app and organization follow you. The console kit copy is updated from the canonical kit (shared `ScopeMenu` / `ScopeChip` header picker, `app-mode` block, `globalThis.fetch` in console data).

## 0.6.4

### Patch Changes

- Updated dependencies [[`f43a842`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/f43a8421bb5bcd353d3d6993f0bb9a8f16c9eaeb)]:
  - @adonis-agora/cms@0.8.2

## 0.6.3

### Patch Changes

- [#33](https://github.com/DavideCarvalho/adonis-agora-cms/pull/33) [`66b908e`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/66b908ee87c4aeccfdd3736d1332ef09b3fedd67) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - The list's relation filter is a searchable combobox: typing searches the related collection on the server (by its title field), so relations with more than 100 documents stay filterable, and a picked document outside the first page keeps its label. Option filters with more than 6 options are searchable comboboxes too. Console kit re-synced (ComboSelect / ComboMultiSelect).

## 0.6.2

### Patch Changes

- [#32](https://github.com/DavideCarvalho/adonis-agora-cms/pull/32) [`b29c1dc`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/b29c1dc68ba5b3e4ced6873ebf543532a64338fc) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Console ⌘K: arrow keys now visibly move the selection. The highlighted item was styled with a bare `data-selected:` (cmdk marks every item `true` or `false`) and with the dialog's own surface color, so moving looked like nothing happened.
- Updated dependencies [[`b29c1dc`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/b29c1dc68ba5b3e4ced6873ebf543532a64338fc)]:
  - @adonis-agora/cms@0.8.1

## 0.6.1

### Patch Changes

- [#31](https://github.com/DavideCarvalho/adonis-agora-cms/pull/31) [`1262be1`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/1262be13ab9f69e015c5576d2ecba37160c23f39) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Declare `repository` in package.json so npm can verify the provenance of the published packages.
- Updated dependencies [[`1262be1`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/1262be13ab9f69e015c5576d2ecba37160c23f39)]:
  - @adonis-agora/cms-react@0.4.1

## 0.6.0

### Minor Changes

- [#30](https://github.com/DavideCarvalho/adonis-agora-cms/pull/30) [`633fe9f`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/633fe9f7e833f0e95b183745dabed2d26eee103d) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - A collection's list filters now live in the URL, so a filtered view can be shared, bookmarked and reloaded, and back/forward step through it: the search, draft status, option/relation filters, date ranges, sort, page and trash toggle sit in the hash's query (`#/collections/posts?q=launch&status=draft&f=category:news`). A value at its default is left out, so existing links open as before. `DataTable` takes an optional `initialSearch`, so the search box shows a term restored from the URL.

### Patch Changes

- Updated dependencies [[`633fe9f`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/633fe9f7e833f0e95b183745dabed2d26eee103d)]:
  - @adonis-agora/cms-react@0.4.0

## 0.5.4

### Patch Changes

- [#28](https://github.com/DavideCarvalho/adonis-agora-cms/pull/28) [`893a2da`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/893a2da70c1297e363a29e23c348646bad63d00d) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - ⌘K now navigates: it lists every page of the console's sidebar and every other Agora console you can open ("Go to Workflows", found by "durable" too), matched case- and accent-insensitively, before the console's own commands and the cross-console search hits. ⌘K opens even without a search endpoint, and shows the pages and consoles before anything is typed. The admin no longer repeats its nav entries as ⌘K commands, so each appears once.

## 0.5.3

### Patch Changes

- [#27](https://github.com/DavideCarvalho/adonis-agora-cms/pull/27) [`7dbcf0c`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/7dbcf0c2e17fd22ef2d033cfb093ba54f0684f1b) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - The console kit gains charts on TanStack Charts (`agora-kit/charts`: TimeSeriesChart, BarChart, Sparkline, DonutChart) with a themed tooltip on hover and keyboard focus. No chart in this console uses it yet; nothing changes on screen and its JS bundle stays the same (the chart styles add a few lines of CSS).

## 0.5.2

### Patch Changes

- Updated dependencies [[`e6ae454`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/e6ae454026a1bff2337fc495a052be6eb65047f2)]:
  - @adonis-agora/cms@0.8.0

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
