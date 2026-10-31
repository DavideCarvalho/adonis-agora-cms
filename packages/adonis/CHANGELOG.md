# @adonis-agora/cms

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
