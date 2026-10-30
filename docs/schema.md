# Schema

The config is the source of truth. `compileSchema` turns it into a `SchemaSpec`, and the
database layer diffs that spec against what the database actually has. Nothing touches the
database until you apply the plan (or the `managed` mode does it for you in development).

## The four commands

| Command                 | What it does                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `node ace cms:diff`     | Prints the plan. Exit `0` = in sync, `1` = drift, `2` = destructive drift. Good CI gate. |
| `node ace cms:sync`     | Applies the plan. `--dry-run`, `--allow-destructive` / `--force`.                        |
| `node ace cms:generate` | Writes a Lucid migration that embeds the spec.                                           |
| `node ace cms:status`   | Applied hash vs. current hash, table count, documents per collection.                    |

All four accept `-c, --connection` to target a Lucid connection.

## Modes

```ts
export default defineConfig({
  db: { schema: 'managed' }, // 'managed' | 'migrations' | 'manual'
});
```

| Mode         | Development / test       | Production                                            |
| ------------ | ------------------------ | ----------------------------------------------------- |
| `managed`    | applies the plan on boot | **does not apply**; logs drift and you run `cms:sync` |
| `migrations` | only reports drift       | drift is reported at boot                             |
| `manual`     | never touches the schema | never touches the schema                              |

`managed` is the Payload-like experience without the production footgun: DDL never runs
silently against a production database.

## Programmatic use

```ts
import { compileSchema, diffSchema, syncCmsSchema, dropCmsTables } from '@adonis-agora/cms';
import { introspect, detectEngine } from '@adonis-agora/cms/db';

const spec = compileSchema(config, { engine: 'pg' });
const introspection = await introspect(client, 'pg');
const plan = diffSchema(spec, introspection, { prune: false });

await syncCmsSchema(client, spec, { allowDestructive: false });
await dropCmsTables(client, spec.tablePrefix);
```

| Function name                           | What                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `compileSchema(config, { engine })`     | pure; config → `SchemaSpec` (tables, columns, indexes, query plan, hash) |
| `diffSchema(spec, introspection, opts)` | pure; spec + introspection → `SchemaPlan`                                |
| `syncCmsSchema(client, spec, opts)`     | idempotent apply; records `cms_schema_state`                             |
| `createCmsTables(client, spec)`         | alias for a sync against an empty database                               |
| `dropCmsTables(client, prefix)`         | drops children first                                                     |

The `client` is a structural slice of Knex (`CmsKnex`). The core never imports `knex`, so
`@adonisjs/lucid` stays an optional peer.

## Destructive changes

Dropping a table/column, narrowing a type, or making a column `NOT NULL` is destructive:

```
! plan contains destructive changes
  ~ cms_posts
      - legacy_field
  ! the plan contains destructive changes; re-run with --allow-destructive (or db.prune) to apply
```

`syncCmsSchema` refuses to apply a destructive plan unless `allowDestructive: true`. Orphan
tables are only dropped when `db.prune` is on — otherwise they are warnings.

## Renames

Renames are never inferred. Declare them, apply once, then remove the entry:

```ts
db: {
  renames: {
    'posts.title': 'heading',          // cms_posts.title → cms_posts.heading
    'posts.layout.caption': 'label',   // inside blocks/arrays too
  },
}
```

The plan shows `↻ title → heading` and no column is dropped. Without the entry, a rename is
a drop + add, which is blocked by the destructive guard.

## Drift

Every applied plan stores `spec_hash` in `cms_schema_state`. The hash is canonical: field
order, table order and column order do not matter, physical changes do.

```ts
import { readSchemaState } from '@adonis-agora/cms/db';

const state = await readSchemaState(client);
state?.hash === spec.hash; // false → drift
```

## Tenancy

```ts
tenancy: { strategy: 'row', required: true }     // _tenant_id on every table
tenancy: { strategy: 'database', connection: (t) => `tenant_${t}` }
```

- `row`: one schema. Every document table **and every child table** carries `_tenant_id`, and
  `unique` becomes `(field, _tenant_id)` — a slug is unique per tenant.
- `database`: the schema is tenant-free; isolation is the connection.
- No `tenancy` = `single`: no column, no resolver.

Overrides in `row` mode are limited to admin/labels/visibility, because the DDL is shared.

## Engine notes

| Engine   | Notes                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| SQLite   | Cannot alter a column in place; a type change is applied as drop + add, which is why it is destructive.     |
| Postgres | Full transactional DDL: a failed plan rolls back completely.                                                |
| MySQL    | No transactional DDL: a partial failure leaves the state hash untouched, and the next `cms:sync` converges. |

JSON columns are `jsonb` on Postgres and `json` elsewhere. Filterable structures (arrays,
blocks, hasMany) are **not** JSON — they have their own tables.
