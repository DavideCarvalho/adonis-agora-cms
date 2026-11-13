---
'@adonis-agora/cms': minor
---

Content from the terminal: `node ace cms:collections:*`, `cms:documents:*` (list, show, create, update, delete, restore, publish, unpublish, discard-draft, schedule, scheduled, unschedule), `cms:versions:*` (list, show, restore) and `cms:globals:*` (show, update). Each runs the REST handler on the CMS instance `scopeCmsRequest` picks, so access rules, hooks, validation, drafts and tenancy match REST and the `/mcp/agora` tools. Writes need an actor: `--token` (or `CMS_API_TOKEN`), a CMS API token with the `write` ability, or `--as-system`, which runs with no principal (access rules still apply; only the production sign-in guard is lifted). An unknown token is refused. `--json` everywhere; destructive commands ask unless `--force`. See `docs/cli.md`.
