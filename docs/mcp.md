# MCP — the CMS for AI clients

`@adonis-agora/cms-mcp` exposes the content surface over the
[Model Context Protocol](https://modelcontextprotocol.io): an agent can read the schema, list,
create, update, publish and restore documents. Every call goes through the Local API, so access
functions, hooks, versions and tenancy behave exactly as they do for a human editor.

## Install and run

```bash
pnpm add @adonis-agora/cms-mcp
node ace cms:mcp        # stdio server, app booted
```

`cms:mcp` resolves the package from the app and starts a stdio server; the process stays alive
until the client disconnects.

## Point a client at it

`.mcp.json` (Claude Code, Cursor, anything that speaks MCP):

```json
{
  "mcpServers": {
    "cms": {
      "command": "node",
      "args": ["ace.js", "cms:mcp"],
      "cwd": "/path/to/app"
    }
  }
}
```

## Tools

| Tool                                   | Does                                  | Read-only |
| -------------------------------------- | ------------------------------------- | --------- |
| `cms_schema`                           | collections, fields, locales, tenancy | yes       |
| `cms_list`                             | filter / sort / paginate              | yes       |
| `cms_get`                              | one document by id or `where`         | yes       |
| `cms_create`                           | create (draft-aware)                  | no        |
| `cms_update`                           | update fields                         | no        |
| `cms_delete`                           | delete (soft delete aware)            | no        |
| `cms_publish` / `cms_unpublish`        | draft ⇄ published                     | no        |
| `cms_versions` / `cms_restore_version` | history and restore                   | no        |
| `cms_global_get` / `cms_global_update` | globals                               | get only  |

## Bounding what the agent can do

Two levers, both explicit:

```ts
// read-only: write tools refuse with `this MCP session is read-only`
createCmsMcpServer({ cms, allowWrite: false });

// act as a specific editor/tenant: access functions see that user
createCmsMcpServer({ cms: cms.as(user).forTenant(tenant) });
```

Nothing here bypasses access. If a collection's `access.update` says no, the tool says no.

## Programmatic use

```ts
import { createCmsMcpServer, createCmsTools, startCmsMcpStdio } from '@adonis-agora/cms-mcp';

await startCmsMcpStdio({ cms });

// or plug the tool list into an existing MCP server / agent runtime
for (const tool of createCmsTools({ cms, allowWrite: false })) {
  registry.register(tool);
}
```

## Auth

The CMS instance carries the identity. If the app runs AuthKit, resolve the principal first and
create the instance with `cms.as(principal)` (and `forTenant(principal.tenant)` when the schema has
row tenancy). That keeps the MCP surface governed by the same authz as the rest of the app — no
separate token scheme to drift.
