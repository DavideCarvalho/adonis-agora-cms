# @adonis-agora/cms-admin

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
