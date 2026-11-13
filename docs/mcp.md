# MCP: the CMS for AI clients

With `@adonis-agora/agent/mcp_provider` in `adonisrc.ts`, the CMS adds its tools to the agora MCP
endpoint, `/mcp/agora`. There is nothing to configure on the CMS side.

```sh
claude mcp add --transport http agora http://localhost:3333/mcp/agora
```

Cursor, Claude Desktop and any other MCP client take the same URL.

## Who gets in

The CMS has no console of its own, so `devTools.authorize` in `config/mcp.ts` decides who reaches its
tools. Left out, they are open outside production and refused in production.

```ts
// config/mcp.ts
import env from '#start/env';
import { authorizeByToken } from '@adonis-agora/agent';
import { defineMcpConfig } from '@adonis-agora/agent/mcp';

export default defineMcpConfig({
  name: 'Acme',
  version: '1.0.0',
  devTools: {
    authorize: authorizeByToken({ token: env.get('CONSOLE_TOKEN') }),
  },
});
```

```sh
claude mcp add --transport http agora http://localhost:3333/mcp/agora \
  --header "Authorization: Bearer $CONSOLE_TOKEN"
```

Once in, every tool acts as that request's CMS principal, like a call to `/api/cms`: the signed-in
user (`integrations.auth`, or `ctx.auth.user`) and the tenant. Collection `access` rules, hooks,
validation, drafts, locales and versions apply. In production, a write with no signed-in user is
refused unless the collection has an `access` rule for it.

## Tools

Reads are listed by default. List tools take `limit` (default 20, at most 100) and `page`, and return
`{ items, next, total }`; pass `next` back as `page`.

| Tool                     | Kind   | Does                                                       |
| ------------------------ | ------ | ---------------------------------------------------------- |
| `cms_list_collections`   | read   | collections and globals, locales, tenancy                  |
| `cms_get_collection`     | read   | fields of a collection or global, filterable/sortable keys |
| `cms_list_documents`     | read   | filter, sort and page documents (`draft`, `locale`)        |
| `cms_get_document`       | read   | one document by id (`draft`, `locale`, `depth`)            |
| `cms_list_versions`      | read   | version history, newest first                              |
| `cms_get_version`        | read   | one version, `snapshot: true` for its content              |
| `cms_get_global`         | read   | a global                                                   |
| `cms_create_document`    | action | create, `draft: true` to keep it unpublished               |
| `cms_update_document`    | action | update fields, `draft: true` to leave the live version     |
| `cms_publish_document`   | action | publish the latest draft                                   |
| `cms_unpublish_document` | action | take a document offline                                    |
| `cms_delete_document`    | action | delete (destructive), `force: true` skips the trash        |
| `cms_restore_version`    | action | restore a version                                          |
| `cms_update_global`      | action | update a global                                            |

`filter` and `data` are JSON objects passed as strings. A localized field takes a locale map in
`data` (`{"title":{"en":"Hi","pt-BR":"Oi"}}`); `locale` picks the language of what comes back.

```json
{ "collection": "posts", "filter": "{\"title\":{\"contains\":\"launch\"}}", "sort": "-createdAt" }
```

Actions are hidden until the app allows them:

```ts
// config/mcp.ts
devTools: {
  actions: ['cms'],
}
```

To leave the CMS out of `/mcp/agora`, use `devTools: { exclude: ['cms'] }`.
