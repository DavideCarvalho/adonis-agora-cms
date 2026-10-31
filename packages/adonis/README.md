# @adonis-agora/cms

A config-first CMS for AdonisJS, in the spirit of Payload: declare collections in `config/cms.ts` and get
the tables, a REST API, typed queries and an admin panel.

```bash
node ace add @adonis-agora/cms
node ace add @adonis-agora/cms-admin
node ace serve --hmr
```

Open <http://localhost:3333/admin>. It needs AdonisJS 7 and Lucid.

**Before production:** in development anyone can write. In production, an anonymous write to a collection
with no `access` rule gets a 401, so pick a login with `integrations.auth`.

[Documentation](https://github.com/DavideCarvalho/adonis-agora-cms#readme)
