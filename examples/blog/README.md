# Blog example

Runs the real CMS stack against SQLite: compiled schema, DDL sync, the repository, the REST
handlers and the built admin SPA. It exists to prove the loop end to end without needing a
database server.

```bash
pnpm --filter @adonis-agora/cms-admin build
pnpm --filter cms-example-blog start
# http://127.0.0.1:5611
```

The AdonisJS HTTP kernel is the only piece not present here; `config/cms.ts` and the published
migration in `stubs/` are the files an app generated with `node ace configure` gets.
