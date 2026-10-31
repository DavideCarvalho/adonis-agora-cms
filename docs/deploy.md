# Going to production

## Before the first deploy

1. **A login.** Pick one with `integrations.auth`: `auth.adonis({ guard: 'web' })`, `auth.authkit()`, or
   `auth.builtin({ secret })` with `usersPlugin()` for an app that has none. Without it the panel opens for
   anyone and can read, and every write answers 401. See [the integrations](./using.md#integrations).
2. **Access rules.** Reads are public until you set `read`. See [access control](./access.md).
3. **Files.** `uploads: { handler: uploads.drive() }` with a real disk. Local disks do not survive a redeploy
   on most hosts.

## On every deploy

The schema never changes by itself in production: an out-of-date one only logs an error at boot. Apply it
before serving traffic:

```bash
node ace cms:diff   # exit 0 nothing to do, 1 changes, 2 changes that delete data
node ace cms:sync   # add --force only after reading what cms:diff says it would delete
```

`cms:diff` works as a CI gate. To own the DDL through Lucid instead, set `db: { schema: 'migrations' }` and run
`node ace cms:generate`, which writes a migration. See [the schema workflow](./schema.md).

## Several instances

Scheduled publishing runs on a timer in each web process. It is safe to leave, but with more than one
instance prefer a single runner: set `schedulerInterval: false` and either schedule `cms.runDueSchedules()` or
use `CmsRunDueSchedules` with `@adonis-agora/durable`.

## Removing a field

In development the app keeps running and warns you, since applying it would delete data. Removing a field
drops its column when you run `node ace cms:sync --force`. To keep the data under a new name, declare it in
`db.renames` first. See [the schema workflow](./schema.md).
