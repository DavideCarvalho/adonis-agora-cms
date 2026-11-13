# CLI: content from the terminal

Every content operation the admin, the REST API and the MCP tools offer is also a `node ace`
command. A command runs the same REST handler, on the CMS instance a REST call would get, so
`access` rules, hooks, validation, drafts, versions and tenancy apply exactly as they do over HTTP.

```sh
node ace cms:collections:list
node ace cms:documents:list posts --filter '{"_status":"published"}' --sort -createdAt
node ace cms:documents:create posts --data @post.json --token "$CMS_API_TOKEN"
```

`node ace configure @adonis-agora/cms` registers the commands with the schema ones (`cms:sync`,
`cms:diff`, `cms:status`, …).

## Who a command acts as

| How                                               | Reads                                 | Writes                           |
| ------------------------------------------------- | ------------------------------------- | -------------------------------- |
| `--token <token>`, or the `CMS_API_TOKEN` env var | as that CMS API token                 | need the token's `write` ability |
| `--as-system`                                     | anonymous                             | allowed, with no user            |
| neither                                           | anonymous, like a public REST request | refused                          |

**Prefer a token.** It is the same principal as `Authorization: Bearer` over REST: its tenant is
bound, writes need its `write` ability, and `--tenant` needs its `tenant:switch` ability. An unknown
or expired token is refused instead of falling back to anonymous. Create one from your own code:

```ts
import cms from '@adonis-agora/cms/services/main';
import { createApiToken } from '@adonis-agora/cms';

const token = await createApiToken(cms.repoContext(), {
  name: 'ops',
  abilities: ['read', 'write'],
});
```

**`--as-system`** is for a trusted shell with no token. The command runs with no principal: every
`access` rule still runs (with no user), so a collection whose rules ask for a signed-in user stays
closed. The only thing it lifts is the production guard that refuses an anonymous write to a
collection with no `access` rule for it. On a multi-tenant CMS it needs `--tenant`.

Pass one of `--token` or `--as-system`, not both. Versions written this way record no author, like a
token write over REST.

## Common flags

| Flag                   | Meaning                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--json`               | Print JSON. Lists print the REST envelope: `{ data, meta: { total, perPage, currentPage, lastPage } }`.                                              |
| `--tenant <id>`        | The tenant to act in.                                                                                                                                |
| `--force`              | Skip the confirmation of a destructive action. Without a terminal (CI, a pipe) these refuse unless `--force`.                                        |
| `--data <json\|@file>` | Field values for create and update: inline JSON or `@path/to/file.json`. A localized field takes a locale map, `{"title":{"en":"Hi","pt-BR":"Oi"}}`. |

A refusal prints the REST answer on one line, such as `403 CMS_FORBIDDEN: token is read-only` or
`422 CMS_VALIDATION: Validation failed (title: required)`, and exits with code `1`.

## Content model

| Command                       | What it does                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `cms:collections:list`        | Every collection and global: drafts, versions, soft delete; the locales and the tenancy strategy. |
| `cms:collections:show <slug>` | The fields of a collection or global, and what `cms:documents:list` can filter and sort by.       |

## Documents

| Command                                               | What it does                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cms:documents:list <collection>`                     | `--filter <json\|@file>` (`{"title":{"contains":"news"}}`, operators as in [REST](./rest.md)), `--sort -createdAt`, `--page`, `--size`, `--deleted`, plus the read flags. |
| `cms:documents:show <collection> <id>`                | One document. Read flags: `--locale`, `--draft`, `--depth`, `--select` (repeat).                                                                                          |
| `cms:documents:create <collection> --data …`          | `--draft` creates it unpublished.                                                                                                                                         |
| `cms:documents:update <collection> <id> --data …`     | Unlisted fields are kept. `--draft` keeps the edit as a pending draft.                                                                                                    |
| `cms:documents:delete <collection> <id>`              | Soft delete moves it to the trash; `--permanent` removes it. Asks unless `--force`.                                                                                       |
| `cms:documents:restore <collection> <id>`             | Bring it back from the trash.                                                                                                                                             |
| `cms:documents:publish <collection> <id>`             | Publish the latest draft.                                                                                                                                                 |
| `cms:documents:unpublish <collection> <id>`           | Take it offline.                                                                                                                                                          |
| `cms:documents:discard-draft <collection> <id>`       | Drop the pending draft. Asks unless `--force`.                                                                                                                            |
| `cms:documents:schedule <collection> <id> --at <ISO>` | Schedule `--action publish` (default) or `unpublish`.                                                                                                                     |
| `cms:documents:scheduled <collection> <id>`           | What is scheduled.                                                                                                                                                        |
| `cms:documents:unschedule <collection> <id>`          | Cancel it.                                                                                                                                                                |

## Versions

| Command                                            | What it does                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `cms:versions:list <collection> <id>`              | The history, newest first. `--locale`, `--page`, `--size`.                                          |
| `cms:versions:show <collection> <id> <version>`    | One version; `--snapshot` adds its content (needs draft access).                                    |
| `cms:versions:restore <collection> <id> <version>` | Replace the content with that version; the current one stays in the history. Asks unless `--force`. |

## Globals

| Command                              | What it does                     |
| ------------------------------------ | -------------------------------- |
| `cms:globals:show <slug>`            | The global. Read flags as above. |
| `cms:globals:update <slug> --data …` | Unlisted fields are kept.        |

Uploads, document locks and the admin's CSV import stay in the admin and the REST API.
