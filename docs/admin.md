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

## The sidebar

The panel is an Agora console and looks like the other ones (durable, telescope, flags…). Its
sidebar comes from your config:

| Section   | What is in it                                                          |
| --------- | ---------------------------------------------------------------------- |
| Content   | the dashboard, then every collection without an `admin.group`          |
| _a group_ | one section per `admin.group`, in the order the groups first appear    |
| Globals   | every global                                                           |
| Media     | the collections that `upload` fields point at (and one called `media`) |
| Settings  | the users collection (the `auth.builtin` collection, else `users`)     |
| Views     | the views your extensions register                                     |

```ts
collection('menus', {
  admin: { group: 'Navigation' },
  fields: [
    /* … */
  ],
});
```

## White label

The console accent is orange. Replace it, and the CMS mark in the sidebar and on the login card:

```ts
admin: { title: 'Acme', theme: { accent: '#0ea5e9', logoUrl: '/logo.svg' } }
```

An accent the browser does not understand keeps orange.

## Search and the console switcher

⌘K (Ctrl+K) jumps to any collection, global or view, and searches documents by their `useAsTitle`
field and their slug. The search runs on the server as the REST API would: the same user, tenant
and `access` rules, and drafts only for a signed-in user. It answers at `GET /api/cms/consoles/search?q=`.

When the app has other Agora consoles, the panel joins their switcher (`'agora.consoles'`
registry, id `cms`) and their ⌘K finds your documents too. The registry entry opens the panel to a
signed-in user (any principal outside production) who may read at least one collection or global.

## Who is signed in

The sidebar footer shows the signed-in user and a sign-out button:

- the user is the one the REST API sees (your `integrations.auth` adapter, else `ctx.auth.user`),
  labelled by `fullName`, `name` or `email`, with its role;
- with `auth.builtin`, sign-out is the CMS's own logout; otherwise it is the one authkit announces
  on the console registry.

Both can be set:

```ts
admin: {
  viewer: (ctx) => ({ label: ctx.auth.user.fullName, role: 'editor' }),
  signOut: '/logout', // a POST action; or { href: '/logout' }; or false for none
}
```
