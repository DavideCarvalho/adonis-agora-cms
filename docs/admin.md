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

## Conditional fields

`admin.condition` is a function, so it never reaches the browser. For the panel use data instead:
`admin: { visibleWhen: { field: 'kind', equals: 'link' } }` shows a field while a sibling has that
value. The value stays in the document while the field is hidden.

## Drafts in the panel

The API only hands drafts to a signed-in user. Without a user the panel creates published documents
and does not offer Unpublish, because it could never read the draft back. With a user, new documents
start as drafts. A published document has one row: saving it changes what is live.

## White label

`admin: { theme: { accent: '#0ea5e9', logoUrl: '/logo.svg' } }`.
