# Admin API

`GET /api/cms/schema` returns everything the panel needs to render itself: collections, fields,
locales, tenancy and the **evaluated** permissions for the current principal.

```json
{
  "version": 1,
  "admin": { "title": "CMS", "path": "/admin" },
  "locales": ["pt-BR", "en"],
  "defaultLocale": "pt-BR",
  "tenancy": { "strategy": "row", "required": true },
  "collections": [
    {
      "slug": "posts",
      "kind": "collection",
      "versioned": true,
      "drafts": true,
      "fields": [
        { "type": "text", "name": "title", "required": true },
        { "type": "select", "name": "status", "options": [{ "label": "Draft", "value": "draft" }] },
        { "type": "upload", "name": "cover", "relationTo": "media" },
        { "type": "blocks", "name": "layout", "blocks": [{ "slug": "hero", "fields": [] }] }
      ]
    }
  ],
  "globals": [],
  "user": { "id": "u1" },
  "permissions": { "posts": { "read": true, "create": true, "update": false, "delete": false } }
}
```

## Why permissions are evaluated server-side

Access functions cannot cross the wire. Instead of duplicating the rules in the browser, the
endpoint runs them with the request user and ships the **result**:

- `permissions[slug]` — what the session may do.
- `fields[].restricted` — `access.read` denied for this principal, so the panel can hide or
  disable the input.
- A `where`-constraint from `read` counts as allowed: the server still scopes the documents,
  the panel only needs to know the collection is readable.

The output is JSON-safe by construction: defaults, labels and options survive; functions
(`validate`, `hooks`, `access`, `condition`) never do.

## What the panel gets for free

| Data                     | Used by                                       |
| ------------------------ | --------------------------------------------- |
| `fields[]`               | the form renderer, via the `FieldRegistry`    |
| `options` / `relationTo` | select, radio and relation pickers            |
| `blocks[]`               | the blocks builder                            |
| `localized` + `locales`  | locale switcher and per-locale tabs           |
| `versioned` / `drafts`   | publish button, draft toggle, version history |
| `permissions`            | hiding actions without a second request       |

## Next

The React SPA (`@adonis-agora/cms-react` + `@adonis-agora/cms-admin`) consumes this endpoint.
The bundle strategy is decided in the spec: prebuilt SPA by default, `cms:eject-admin` for an
app-owned Vite build with Fast Refresh and custom field components.
