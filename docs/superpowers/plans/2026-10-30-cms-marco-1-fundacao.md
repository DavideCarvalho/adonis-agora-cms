# Adonis CMS — Marco 1 (Fundação) — plano de implementação

> **For agentic workers:** execute tarefa por tarefa, na ordem. Cada tarefa termina em teste
> verde + commit. Leia a spec antes: `docs/specs/2026-10-30-adonis-cms-design.md`.

**Goal:** entregar o núcleo de schema do CMS — config tipada, compilador de `SchemaSpec`
(incluindo tabelas filhas de `array`/`blocks`/`group`/`select hasMany`), diff/introspecção,
sync em três modos, comandos ace e tipos de documento por inferência.

**Architecture:** seis camadas puras empilhadas (`config` → `schema` → `db` → `commands`),
com `testing` por cima. Nada de HTTP neste marco, exceto o que o `configure` publica.

**Tech Stack:** TypeScript 7, pnpm 11, turbo, biome, vitest, `@adonisjs/core` 7, `@adonisjs/lucid`
22 (peer), `knex` 3, `better-sqlite3` + `pg` + `mysql2` como dev deps.

**Escopo:** Marco 1 completo. Marcos 2–6 têm planos próprios.

---

## Mapa de arquivos

```
adonis-cms/
├── package.json                        # workspace root (turbo/biome/changesets/vitest)
├── pnpm-workspace.yaml
├── turbo.json
├── biome.json
├── tsconfig.base.json
├── vitest.workspace.ts
└── packages/adonis/
    ├── package.json                    # @adonis-agora/cms
    ├── tsconfig.json
    ├── vitest.config.ts
    ├── configure.ts
    ├── stubs/main.ts
    ├── stubs/config/cms.stub
    ├── stubs/database/migrations/create_cms_tables.stub
    ├── src/
    │   ├── index.ts                    # barrel público
    │   ├── errors.ts                   # CmsError hierarchy
    │   ├── config/
    │   │   ├── types.ts                # FieldOption, CollectionConfig, CmsConfig, SchemaMode
    │   │   ├── fields.ts               # fields.text(), fields.array(), block(), ...
    │   │   ├── collection.ts           # collection(), global(), defineConfig()
    │   │   └── validate.ts             # validateConfig() → CmsConfigError[]
    │   ├── schema/
    │   │   ├── types.ts                # SchemaSpec, TableSpec, ColumnSpec, IndexSpec, FkSpec
    │   │   ├── compile.ts              # compileSchema() — entrada
    │   │   ├── compile_fields.ts       # field → ColumnSpec[] (escalares, group, relations)
    │   │   ├── compile_children.ts     # field → TableSpec (array, blocks, select hasMany)
    │   │   ├── query_plan.ts           # path → { table, parentTable, join }
    │   │   └── hash.ts                 # canonicalHash(spec)
    │   ├── db/
    │   │   ├── types.ts                # Introspection, SchemaPlan, SyncOptions
    │   │   ├── introspect/
    │   │   │   ├── sqlite.ts
    │   │   │   ├── pg.ts
    │   │   │   └── mysql.ts
    │   │   ├── diff.ts
    │   │   ├── sync.ts                 # syncCmsSchema, createCmsTables, dropCmsTables
    │   │   └── plan_render.ts          # SchemaPlan → texto legível (cms:diff)
    │   ├── types/
    │   │   └── document.ts             # CmsDocument, FieldsToObject, FieldValue
    │   ├── testing/
    │   │   ├── index.ts
    │   │   └── create_test_cms.ts
    │   └── commands/
    │       ├── main.ts                 # array exportado em ./commands
    │       ├── diff.ts
    │       ├── sync.ts
    │       ├── generate.ts
    │       └── status.ts
    └── test/
        ├── fixtures/blog_config.ts
        ├── config/validate.spec.ts
        ├── schema/compile.spec.ts
        ├── schema/children.spec.ts
        ├── schema/hash.spec.ts
        ├── db/diff.spec.ts
        ├── db/sync.spec.ts
        ├── types/document.types-test.ts
        └── testing/create_test_cms.spec.ts
```

---

## Task 1: Scaffold do monorepo

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `biome.json`,
  `tsconfig.base.json`, `vitest.workspace.ts`
- Create: `packages/adonis/package.json`, `packages/adonis/tsconfig.json`,
  `packages/adonis/vitest.config.ts`

- [ ] **Step 1: root `package.json`**

```json
{
  "name": "adonis-cms",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "packageManager": "pnpm@11.24.0",
  "engines": { "node": ">=20.6.0" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "changeset": "changeset",
    "release": "pnpm --filter './packages/*' build && changeset publish"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.11",
    "@changesets/cli": "3.0.1",
    "@changesets/changelog-github": "^1.0.0",
    "turbo": "2.10.12",
    "typescript": "^7.0.2",
    "vitest": "^5.0.5"
  }
}
```

- [ ] **Step 2: `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"

allowBuilds:
  "@biomejs/biome": true
  better-sqlite3: true
  esbuild: true
```

- [ ] **Step 3: `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 4: `packages/adonis/package.json`** — `type: module`, `exports` com `.`,
  `./commands`, `./testing`, `./schema`, `./configure`; `peerDependencies` de
  `@adonisjs/core` e `@adonisjs/lucid` (este último opcional); devDeps `knex`,
  `better-sqlite3`, `pg`, `mysql2`, `@types/better-sqlite3`.

- [ ] **Step 5: instalar e verificar**

Run: `pnpm install`
Expected: lockfile criado, sem erro de build script.

- [ ] **Step 6: commit**

```bash
git add -A && git commit -m "chore: scaffold pnpm monorepo for @adonis-agora/cms"
```

---

## Task 2: Erros e tipos de config

**Files:**
- Create: `packages/adonis/src/errors.ts`, `packages/adonis/src/config/types.ts`
- Test: `packages/adonis/test/config/validate.spec.ts` (primeiro caso)

- [ ] **Step 1: teste de `CmsConfigError`**

```ts
import { expect, test } from 'vitest'
import { CmsConfigError } from '../../src/errors.js'

test('config error carries path and code', () => {
  const error = new CmsConfigError('collections.posts.fields[0].name', 'reserved name')
  expect(error.code).toBe('CMS_CONFIG')
  expect(error.path).toBe('collections.posts.fields[0].name')
  expect(error.message).toContain('reserved name')
})
```

- [ ] **Step 2: rodar e ver falhar**

Run: `pnpm --filter @adonis-agora/cms test test/config/validate.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: `errors.ts`**

```ts
export class CmsError extends Error {
  readonly code: string
  readonly context: Record<string, unknown>
  constructor(code: string, message: string, context: Record<string, unknown> = {}) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.context = context
  }
}

export class CmsConfigError extends CmsError {
  readonly path: string
  constructor(path: string, message: string) {
    super('CMS_CONFIG', `${path}: ${message}`, { path })
    this.path = path
  }
}

export class CmsSchemaError extends CmsError { constructor(m: string, c = {}) { super('CMS_SCHEMA', m, c) } }
export class CmsSchemaDriftError extends CmsError { constructor(m: string, c = {}) { super('CMS_SCHEMA_DRIFT', m, c) } }
export class CmsValidationError extends CmsError {
  readonly fields: Record<string, string>
  constructor(fields: Record<string, string>) {
    super('CMS_VALIDATION', 'Validation failed', { fields })
    this.fields = fields
  }
}
export class CmsNotFoundError extends CmsError { constructor(m = 'Not found') { super('CMS_NOT_FOUND', m) } }
export class CmsForbiddenError extends CmsError { constructor(m = 'Forbidden') { super('CMS_FORBIDDEN', m) } }
export class CmsConflictError extends CmsError { constructor(m: string) { super('CMS_CONFLICT', m) } }
export class CmsHookError extends CmsError {
  constructor(hook: string, cause: unknown) {
    super('CMS_HOOK', `Hook "${hook}" failed: ${String(cause)}`, { hook })
  }
}
```

- [ ] **Step 4: `config/types.ts`** — declara `CmsConfig`, `CollectionConfig`, `GlobalConfig`,
  `FieldConfig` (união discriminada por `type`), `AccessFns`, `HookMap`, `SchemaMode`.

- [ ] **Step 5: rodar teste**

Run: `pnpm --filter @adonis-agora/cms test test/config/validate.spec.ts`
Expected: PASS.

- [ ] **Step 6: commit**

```bash
git add packages/adonis/src/errors.ts packages/adonis/src/config/types.ts packages/adonis/test
git commit -m "feat(cms): error hierarchy and config types"
```

---

## Task 3: Field builders tipados

**Files:**
- Create: `packages/adonis/src/config/fields.ts`
- Test: `packages/adonis/test/config/fields.spec.ts`

- [ ] **Step 1: teste de literais preservados**

```ts
import { expectTypeOf, test } from 'vitest'
import { fields } from '../../src/config/fields.js'

test('select keeps literal option values', () => {
  const status = fields.select('status', {
    options: [{ label: 'Draft', value: 'draft' }, { label: 'Live', value: 'live' }],
  })
  expectTypeOf(status.name).toEqualTypeOf<'status'>()
  expectTypeOf(status.type).toEqualTypeOf<'select'>()
  expectTypeOf(status.options[0].value).toEqualTypeOf<'draft' | 'live'>()
})
```

- [ ] **Step 2: implementar builders**

Um builder por tipo, todos `function <const N extends string>(name: N, options?: O)` retornando
`{ type: 'x' as const, name, ...options }`. `hasMany` só existe em `select` e `relation`.
`blocks()` recebe `readonly BlockDefinition[]` e devolve `readonly` também.

- [ ] **Step 3: rodar**

Run: `pnpm --filter @adonis-agora/cms test test/config/fields.spec.ts`
Expected: PASS.

- [ ] **Step 4: commit**

```bash
git add packages/adonis/src/config/fields.ts packages/adonis/test/config/fields.spec.ts
git commit -m "feat(cms): typed field builders preserving literals"
```

---

## Task 4: `defineConfig` / `collection` / `global`

**Files:**
- Create: `packages/adonis/src/config/collection.ts`, `packages/adonis/src/config/define_config.ts`
- Test: `packages/adonis/test/config/define_config.spec.ts`

- [ ] **Step 1: teste**

```ts
test('defineConfig preserves collection slugs and field literals', () => {
  const config = defineConfig({
    collections: [collection('posts', { fields: [fields.text('title')] })] as const,
    globals: [global('site', { fields: [fields.text('siteName')] })] as const,
  })
  expectTypeOf(config.collections[0].slug).toEqualTypeOf<'posts'>()
  expect(config.collections[0].fields[0].type).toBe('text')
})
```

- [ ] **Step 2: implementar** — `defineConfig<const C extends CmsConfigInput>(c: C): C` sem
  transformação (identidade preserva literais; validação é passo separado para manter puro).
  `collection('slug', cfg)` injeta `slug`. `global` idem.

- [ ] **Step 3: rodar + commit**

```bash
pnpm --filter @adonis-agora/cms test test/config/define_config.spec.ts
git add packages/adonis/src/config packages/adonis/test/config
git commit -m "feat(cms): defineConfig, collection and global helpers"
```

---

## Task 5: Validador de config

**Files:**
- Create: `packages/adonis/src/config/validate.ts`
- Test: `packages/adonis/test/config/validate.spec.ts`

- [ ] **Step 1: testes (tabela de casos)**

```ts
const invalid: Array<[string, CmsConfig, RegExp]> = [
  ['duplicate slug', cfg({ collections: [collection('a', { fields: [] }), collection('a', { fields: [] })] }), /duplicate/i],
  ['reserved name', cfg({ collections: [collection('a', { fields: [fields.text('_x')] })] }), /reserved/i],
  ['orphan relation', cfg({ collections: [collection('a', { fields: [fields.relation('r', { relationTo: 'nope' })] })] }), /nope/],
  ['bad locale', cfg({ localization: { locales: ['pt_BR'], defaultLocale: 'pt_BR' } }), /locale/i],
]
```

- [ ] **Step 2: implementar `validateConfig(config): CmsConfigError[]`** — acumula todos os
  erros (não para no primeiro). Regras da §6 da spec, incluindo `useAsTitle` textual,
  `localized` sem locales, `schema: 'migrations'` sem Lucid, nome de field por regex
  `^[a-z][a-z0-9_]*$`, e `blocks` com `type` duplicado.

- [ ] **Step 3: rodar** — todos os casos retornam 1 erro com o path certo.

- [ ] **Step 4: commit**

```bash
git add packages/adonis/src/config/validate.ts packages/adonis/test/config/validate.spec.ts
git commit -m "feat(cms): config validation with accumulated errors"
```

---

## Task 6: Compilador — escalares, groups e relations

**Files:**
- Create: `packages/adonis/src/schema/types.ts`, `compile_fields.ts`, `compile.ts`
- Test: `packages/adonis/test/schema/compile.spec.ts`, `test/fixtures/blog_config.ts`

- [ ] **Step 1: fixture `blog_config.ts`** — a config completa da §6 (posts com text, slug,
  select, select hasMany, date, relation, upload, array, group, blocks + global).
- [ ] **Step 2: teste de colunas**

```ts
test('compiles parent columns for scalars, localized and group', () => {
  const spec = compileSchema(blogConfig, { engine: 'sqlite' })
  const posts = spec.tables.find((t) => t.name === 'cms_posts')!
  expect(columnNames(posts)).toEqual([
    'id', 'created_at', 'updated_at', '_status',
    'title', 'slug', 'body_pt_br', 'body_en',
    'status', 'published_at', 'author_id', 'cover_id',
    'seo_title', 'seo_description',
  ])
})
```

- [ ] **Step 3: implementar `compile` + `compile_fields`** — `compileSchema(config, { engine,
  idKind })` percorre collections e globals, gera `TableSpec` com colunas de sistema,
  escalares, `group` achatado com prefixo, `localized` por locale, `hasOne` com FK.
  `ColumnSpec.references` só quando `relationTo` é string única.

- [ ] **Step 4: teste de tipos/limites** — `number` com formato, `text` com `maxLength`,
  `required` refletido em `nullable: false`, `unique` em `uniques`.

- [ ] **Step 5: rodar + commit**

```bash
pnpm --filter @adonis-agora/cms test test/schema/compile.spec.ts
git add packages/adonis/src/schema packages/adonis/test/schema packages/adonis/test/fixtures
git commit -m "feat(cms): compile collections and globals into table specs"
```

---

## Task 7: Compilador — tabelas filhas + query plan

**Files:**
- Create: `packages/adonis/src/schema/compile_children.ts`, `schema/query_plan.ts`
- Test: `packages/adonis/test/schema/children.spec.ts`

- [ ] **Step 1: teste de `array`**

```ts
test('array compiles to a child table keyed by parent and order', () => {
  const spec = compileSchema(blogConfig, { engine: 'sqlite' })
  const tags = spec.tables.find((t) => t.name === 'cms_posts__tags')!
  expect(tags.kind).toBe('child')
  expect(tags.owner).toBe('cms_posts')
  expect(columnNames(tags)).toEqual(['id', '_parent_id', '_order', 'label'])
  expect(tags.columns.find((c) => c.name === '_parent_id')!.references)
    .toEqual({ table: 'cms_posts', column: 'id', onDelete: 'cascade' })
})
```

- [ ] **Step 2: teste de `blocks`**

```ts
test('blocks compile to one child table with the union of block columns', () => {
  const layout = spec.tables.find((t) => t.name === 'cms_posts__layout')!
  expect(columnNames(layout)).toEqual([
    'id', '_parent_id', '_order', 'type',
    'heading', 'image_id', 'gallery', // colunas dos blocos hero e gallery
  ].sort())
  expect(layout.indexes).toContainEqual({ name: 'cms_posts__layout_type_idx', columns: ['type'] })
})
```

- [ ] **Step 3: teste de aninhamento e paths**

```ts
test('nested array inside blocks gets its own table and query plan', () => {
  const nested = spec.tables.find((t) => t.name === 'cms_posts__layout__gallery')!
  expect(nested.path).toBe('layout.gallery')
  expect(nested.owner).toBe('cms_posts__layout')
  expect(spec.queryPlan['layout.gallery.caption']).toEqual({
    table: 'cms_posts__layout__gallery',
    parentTable: 'cms_posts',
    path: ['layout', 'gallery', 'caption'],
  })
})
```

- [ ] **Step 4: implementar** — recursivo com `TableSpec.owner`/`path`; `select hasMany` e
  `relation hasMany` geram filha também (mesma função, colunas diferentes). `query_plan.ts`
  indexa todo caminho folha → tabela + junções; collisions (mesmo nome em níveis diferentes)
  resolvidas pelo path completo.

- [ ] **Step 5: rodar + commit**

```bash
pnpm --filter @adonis-agora/cms test test/schema/children.spec.ts
git add packages/adonis/src/schema packages/adonis/test/schema
git commit -m "feat(cms): compile arrays, blocks and hasMany into child tables with query plan"
```

---

## Task 8: Hash canônico e ordem estável

**Files:**
- Create: `packages/adonis/src/schema/hash.ts`
- Test: `packages/adonis/test/schema/hash.spec.ts`

- [ ] **Step 1: teste**

```ts
test('hash ignores declaration order but not content', () => {
  const a = compileSchema(cfgWithOrder(['title', 'slug']), { engine: 'sqlite' })
  const b = compileSchema(cfgWithOrder(['slug', 'title']), { engine: 'sqlite' })
  const c = compileSchema(cfgWithOrder(['title', 'body']), { engine: 'sqlite' })
  expect(a.hash).toBe(b.hash)
  expect(a.hash).not.toBe(c.hash)
})
```

- [ ] **Step 2: implementar** — normaliza (ordena tabelas por nome, colunas por nome, índices
  por nome), `JSON.stringify` com chaves ordenadas, `sha256` via `node:crypto`.

- [ ] **Step 3: rodar + commit**

```bash
pnpm --filter @adonis-agora/cms test test/schema/hash.spec.ts
git add packages/adonis/src/schema/hash.ts packages/adonis/test/schema/hash.spec.ts
git commit -m "feat(cms): canonical schema hash for drift detection"
```

---

## Task 9: Introspecção SQLite e o tipo `Introspection`

**Files:**
- Create: `packages/adonis/src/db/types.ts`, `db/introspect/sqlite.ts`
- Test: `packages/adonis/test/db/introspect_sqlite.spec.ts`

- [ ] **Step 1: teste** — cria `cms_demo` com knex/better-sqlite3, introspecta, compara
  colunas/tipos/índices/FKs com o esperado.
- [ ] **Step 2: implementar** — `pragma table_info`, `pragma index_list`/`index_info`,
  `pragma foreign_key_list`; normaliza tipo para o enum de `ColumnSpec.type`.
- [ ] **Step 3: rodar + commit**

```bash
pnpm --filter @adonis-agora/cms test test/db/introspect_sqlite.spec.ts
git add packages/adonis/src/db packages/adonis/test/db
git commit -m "feat(cms): sqlite schema introspection"
```

---

## Task 10: Diff → `SchemaPlan`

**Files:**
- Create: `packages/adonis/src/db/diff.ts`, `db/plan_render.ts`
- Test: `packages/adonis/test/db/diff.spec.ts`

- [ ] **Step 1: testes** — banco vazio → só `creates`, ordenados pai→filha; spec igual →
  plano vazio; coluna nova → `alters`; coluna removida → `destructive: true` + warning;
  `renames` → `alterColumns` com `rename`; índice divergente → `indexes`.

- [ ] **Step 2: implementar `diffSchema(spec, introspection, { prune, renames, allowDestructive })`**
  — compara tabelas/colunas/índices/FKs, ordena por profundidade de `path`, marca destrutivo,
  e não emite DDL.
- [ ] **Step 3: implementar `renderPlan(plan)`** — texto legível com `+/-/~/!` e exit code.
- [ ] **Step 4: rodar + commit**

```bash
pnpm --filter @adonis-agora/cms test test/db/diff.spec.ts
git add packages/adonis/src/db packages/adonis/test/db/diff.spec.ts
git commit -m "feat(cms): schema diff with destructive guards and renames"
```

---

## Task 11: Sync (apply) + helpers de tabela

**Files:**
- Create: `packages/adonis/src/db/sync.ts`
- Test: `packages/adonis/test/db/sync.spec.ts`

- [ ] **Step 1: testes** — `createCmsTables` em banco vazio; `syncCmsSchema` duas vezes =
  idempotente; add column preserva dados; drop column bloqueado sem `allowDestructive`;
  `dropCmsTables` remove tudo na ordem inversa.
- [ ] **Step 2: implementar** — knex `schema.createTable/alterTable/dropTable`, FKs por último,
  transação em sqlite/pg, statement-a-statement em mysql, grava `cms_schema_state` no fim.
- [ ] **Step 3: rodar + commit**

```bash
pnpm --filter @adonis-agora/cms test test/db/sync.spec.ts
git add packages/adonis/src/db/sync.ts packages/adonis/test/db/sync.spec.ts
git commit -m "feat(cms): idempotent schema sync with transactional apply"
```

---

## Task 12: Introspecção Postgres e MySQL

**Files:**
- Create: `packages/adonis/src/db/introspect/pg.ts`, `db/introspect/mysql.ts`,
  `db/introspect/index.ts`
- Test: `packages/adonis/test/db/introspect_pg.spec.ts` (skip sem `CMS_TEST_PG_URL`),
  `test/db/introspect_mysql.spec.ts` (skip sem `CMS_TEST_MYSQL_URL`)

- [ ] **Step 1: testes** — `describe.skipIf(!process.env.CMS_TEST_PG_URL)`; criam tabela,
  introspectam, validam tipo normalizado (`timestamptz` → `timestamp`, `jsonb` → `json`).
- [ ] **Step 2: implementar** — queries em `information_schema` + `pg_indexes`; MySQL
  `information_schema.columns/statistics/key_column_usage`.
- [ ] **Step 3: rodar + commit**

```bash
pnpm --filter @adonis-agora/cms test test/db
git add packages/adonis/src/db/introspect packages/adonis/test/db
git commit -m "feat(cms): postgres and mysql schema introspection"
```

---

## Task 13: Comandos ace

**Files:**
- Create: `packages/adonis/src/commands/{main,diff,sync,generate,status}.ts`
- Modify: `packages/adonis/package.json` (export `./commands`)
- Test: `packages/adonis/test/commands/generate.spec.ts`

- [ ] **Step 1: teste do `cms:generate`**

```ts
test('emits a migration with the serialized spec, not the config import', async () => {
  const file = await renderMigration(spec, { timestamp: 1760000000000 })
  expect(file).toContain('1760000000000_create_cms_tables.ts')
  expect(file).toContain('syncCmsSchema')
  expect(file).toContain('"hash"')
  expect(file).not.toContain("from '../../config/cms.js'")
})
```

- [ ] **Step 2: implementar** — `cms:diff` (exit 1 com drift), `cms:sync`
  (`--dry-run`, `--allow-destructive`, `--force`), `cms:generate` (stub + spec serializado),
  `cms:status`. Todos usam `app.container.use('Adonis/Core/Logger')` e a conexão default do
  Lucid.
- [ ] **Step 3: rodar + commit**

```bash
pnpm --filter @adonis-agora/cms test test/commands/generate.spec.ts
git add packages/adonis/src/commands packages/adonis/package.json packages/adonis/test/commands
git commit -m "feat(cms): cms:diff, cms:sync, cms:generate and cms:status commands"
```

---

## Task 14: Tipos de documento por inferência

**Files:**
- Create: `packages/adonis/src/types/document.ts`
- Test: `packages/adonis/test/types/document.types-test.ts` (type test, rodado pelo vitest)

- [ ] **Step 1: type tests**

```ts
type Post = CmsDocument<typeof blogConfig, 'posts'>

expectTypeOf<Post['title']>().toEqualTypeOf<string>()
expectTypeOf<Post['status']>().toEqualTypeOf<'draft' | 'published'>()
expectTypeOf<Post['channels']>().toEqualTypeOf<Array<'web' | 'rss'>>()
expectTypeOf<Post['layout']>().toEqualTypeOf<Array<HeroBlock | GalleryBlock>>()
expectTypeOf<Post['seo']>().toEqualTypeOf<{ title: string | null; description: string | null }>()
expectTypeOf<Post['body']>().toEqualTypeOf<Record<'pt-BR' | 'en', RichTextValue>>()

type PostInput = CmsCreateInput<typeof blogConfig, 'posts'>
expectTypeOf<PostInput['title']>().toEqualTypeOf<string>()
expectTypeOf<PostInput['id']>().toBeNever() // id é gerado
```

- [ ] **Step 2: implementar** `FieldValue`, `FieldsToObject`, `BlocksValue`, `LocalizedValue`,
  `CmsDocument`, `CmsCreateInput`, `CmsUpdateInput`. `required`/`defaultValue` controlam
  optionalidade na entrada; saída não tem `?`.
- [ ] **Step 3: rodar** — `tsc --noEmit` + vitest (type tests via `expectTypeOf`).
- [ ] **Step 4: commit**

```bash
pnpm --filter @adonis-agora/cms typecheck && pnpm --filter @adonis-agora/cms test test/types
git add packages/adonis/src/types packages/adonis/test/types
git commit -m "feat(cms): document types inferred from config without codegen"
```

---

## Task 15: `createTestCms` + `configure` + stubs

**Files:**
- Create: `packages/adonis/src/testing/{index,create_test_cms}.ts`,
  `packages/adonis/configure.ts`, `packages/adonis/stubs/main.ts`,
  `packages/adonis/stubs/config/cms.stub`,
  `packages/adonis/stubs/database/migrations/create_cms_tables.stub`
- Test: `packages/adonis/test/testing/create_test_cms.spec.ts`

- [ ] **Step 1: teste do kit**

```ts
test('createTestCms syncs the schema and tears down', async () => {
  const kit = await createTestCms({ config: blogConfig })
  const tables = await kit.introspect()
  expect(tables.map((t) => t.name)).toContain('cms_posts__layout')
  await kit.destroy()
  await expect(kit.db.raw('select 1 from cms_posts')).rejects.toThrow()
})
```

- [ ] **Step 2: implementar** — better-sqlite3 `:memory:`, `syncCmsSchema`, `destroy()`,
  `actAs()` (só guarda o user para o Marco 2), `introspect()`.
- [ ] **Step 3: `configure.ts`** — `rcFile.addProvider('@adonis-agora/cms/cms_provider')`
  (provider vazio neste marco), `addCommand('@adonis-agora/cms/commands')`, publica
  `config/cms.stub` e a migration `create_cms_tables.stub` que chama `syncCmsSchema`.
- [ ] **Step 4: rodar + commit**

```bash
pnpm --filter @adonis-agora/cms test test/testing/create_test_cms.spec.ts
git add packages/adonis/src/testing packages/adonis/configure.ts packages/adonis/stubs packages/adonis/test/testing
git commit -m "feat(cms): testing kit, install hook and published stubs"
```

---

## Task 16: Barrel, build e docs

**Files:**
- Create/Modify: `packages/adonis/src/index.ts`, `packages/adonis/README.md`,
  `docs/schema.md`, `docs/fields.md`
- Test: `packages/adonis/test/public_api.spec.ts`

- [ ] **Step 1: teste de superfície pública** — `expect(Object.keys(api)).toEqual(expect.arrayContaining([...]))`.
- [ ] **Step 2: `index.ts`** — exporta `defineConfig`, `collection`, `global`, `fields`,
  `block`, `compileSchema`, `diffSchema`, `syncCmsSchema`, `createCmsTables`,
  `dropCmsTables`, `createTestCms`, types.
- [ ] **Step 3: `pnpm --filter @adonis-agora/cms build`** — `tsc -p tsconfig.json` +
  `copy:stubs`; verifica `dist/` com `stubs/` e `commands`.
- [ ] **Step 4: docs** — `docs/schema.md` (modos, diff, drift, renames) e `docs/fields.md`
  (catálogo completo, armazenamento relacional, extensibilidade).
- [ ] **Step 5: commit**

```bash
git add -A && git commit -m "feat(cms): public surface, build and docs"
```

---

## Critérios de aceite do marco

- [ ] `pnpm test` verde (sqlite; pg/mysql condicionais por env).
- [ ] `pnpm typecheck` verde, incluindo os type tests de `CmsDocument`.
- [ ] `cms:diff` em banco vazio imprime o plano de criação e sai 0.
- [ ] `cms:sync` duas vezes seguidas não altera nada (idempotente).
- [ ] Adicionar `blocks.gallery` gera `alter` na tabela filha, não recria.
- [ ] Remover campo sem `--allow-destructive` sai ≠ 0 com warning.
- [ ] `cms:generate` produz migration autocontida (spec serializado).
- [ ] `dropCmsTables` remove pai e filhas na ordem correta.

## Fora deste plano (marcos 2–6)

Repositório, Local API, REST, access, hooks (Marco 2); drafts/versões/locks (3); i18n runtime
(4); painel (5); integrações e endurecimento (6). Cada um recebe plano próprio referenciando
a spec.
