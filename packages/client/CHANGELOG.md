# @adonis-agora/cms-client

## 0.2.0

### Minor Changes

- [#17](https://github.com/DavideCarvalho/adonis-agora-cms/pull/17) [`8b9c7cd`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/8b9c7cd960838ebf64bc3b1a35d3144dffbeef0a) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - REST lists use the `@adonis-agora/filter` wire format and envelope.
  - `GET /api/cms/collections/:slug` takes `filter[field]=v` / `filter[field][op]=v` (plus `where[i]` OR/AND groups from `filter-client`), `sort` checked against the collection's sortable fields, and `page` + `size` (default 20, max 200). It answers `{ data, meta: { total, perPage, currentPage, lastPage, firstPage } }`.
  - `GET /api/cms/collections/:slug/:id/versions` takes `page` + `size` (default 20, max 100), `filter[locale]` and `sort=-version`, and answers the same envelope.
  - An unknown filter field, an unsupported operator or an unknown sort field answers `400` with `CMS_INVALID_QUERY`.
  - `where[field][op]`, `limit` and the `docs`/`totalDocs`/`totalPages`/`hasNextPage`/`hasPrevPage` envelope are gone from REST. The Local API (`cms.collection(slug).find()`) is unchanged.
  - `parseFindQuery` is replaced by `parseListQuery` (lists) and `parseReadOptions` (single reads).
  - `cms-client`: `ContentQuery` takes `filter`, `page` and `size` instead of `where` and `limit`; `ContentList<T>` is `OffsetPage<T>`.
  - `cms-react`: `ListQuery` takes `filter`, `page` and `size`; `ListResult` is `OffsetPage<AdminDocument>`; `AdminClient.versions()` takes `{ page, size }` and returns `OffsetPage<VersionRecord>`.

## 0.1.0

### Minor Changes

- [`d96cf23`](https://github.com/DavideCarvalho/adonis-agora-cms/commit/d96cf23a17b93708ce3f64635f4572207234b9b6) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - First public release of the CMS: config-first schema with relational child tables, DDL diff/sync,
  Local API, REST, access control, hooks, row and database tenancy, versions, drafts on published
  documents, autosave, scheduled publishing, webhooks, plugins (SEO, redirects, search, forms, nested
  docs), i18n and the visual admin with its own optional login. Integrations are ports that take an
  Agora adapter, an official AdonisJS one, or a custom object.
