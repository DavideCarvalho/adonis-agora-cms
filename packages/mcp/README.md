# `@adonis-agora/cms-mcp`

Model Context Protocol server for `@adonis-agora/cms`. An AI agent gets the same content surface a
human editor has — list, read, create, update, publish, versions, restore — through the Local API,
so hooks, access and tenancy apply.

## Tools

| Tool                                   | Does                                  |
| -------------------------------------- | ------------------------------------- |
| `cms_schema`                           | collections, fields, locales, tenancy |
| `cms_list`                             | filter/sort/paginate documents        |
| `cms_get`                              | one document by id or `where`         |
| `cms_create`                           | create (draft-aware)                  |
| `cms_update`                           | update fields                         |
| `cms_delete`                           | delete (soft delete aware)            |
| `cms_publish` / `cms_unpublish`        | move between draft and published      |
| `cms_versions` / `cms_restore_version` | history and restore                   |
| `cms_global_get` / `cms_global_update` | globals                               |

Write tools answer `this MCP session is read-only` when the server is created with
`allowWrite: false` — that is how you expose a browsing agent without giving it the keyboard.

## Wire it into an app

```ts
// bin/cms-mcp.ts
import { startCmsMcpStdio } from '@adonis-agora/cms-mcp';
import cms from '#services/cms';

await startCmsMcpStdio({ cms });
```

```json
// .mcp.json (Claude Code / Cursor)
{
  "mcpServers": {
    "cms": {
      "command": "node",
      "args": ["--import", "@poppinss/ts-exec", "bin/cms-mcp.ts"],
      "cwd": "/path/to/app"
    }
  }
}
```

The process must boot the Adonis app before the service resolves — the snippet above relies on the
app's loader; in a plain script call `createCms({ config, client })` instead and pass that instance.

## Authorization

The MCP layer never invents permissions: `allowWrite` decides whether write tools exist at all, and
every call runs through the CMS access functions with the principal the app attached. To bind the
session to a real user/tenant, create the instance with `cms.as(user).forTenant(tenant)`.
