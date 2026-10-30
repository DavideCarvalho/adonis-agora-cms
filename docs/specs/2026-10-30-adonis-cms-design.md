# Adonis CMS — spec de arquitetura

- **Status:** aprovado (desenho), implementação faseada
- **Data:** 2026-10-30
- **Alvo:** AdonisJS 7.x · Lucid 22.x · Node >= 20.6 · TypeScript 7
- **Repo:** `adonis-cms` (`@adonis-agora/cms`), espelhando `adonis-media`

---

## 1. Contexto

O ecossistema Agora já tem as peças de um CMS (media, authkit, authz, filter, telescope,
durable), mas não o content layer. Este projeto entrega um CMS **config-first**, no modelo do
Payload CMS v3, para AdonisJS.

A tese central é a mesma do Payload: **o schema é código TypeScript**, e disso derivam banco,
tipos, API e painel. A diferença é que Adonis já tem um dono de banco (Lucid/Knex) e um
mecanismo de migrations — então o CMS não substitui essa camada, ele se **encaixa** nela.

O `@adonis-agora/media` já resolveu o precedente exato: funções de schema exportadas
(`createMediaTables` / `dropMediaTables`) usadas tanto por uma migration publicada quanto por
`autoCreateSchema` no boot. O CMS estende esse contrato de "funções exportadas" com uma peça a
mais: **diff de schema**, porque as tabelas do CMS são definidas pelo usuário e mudam com o
tempo.

---

## 2. Objetivo e não-objetivos

### Dentro do escopo (paridade Payload menos GraphQL)

| Área | Incluído |
|---|---|
| Content modeling | collections, globals, todos os field types, blocks, arrays, groups, tabs |
| Banco | DDL gerado/diffado, 3 modos de sync, introspecção, drift detection |
| API | Local API tipada, REST automático, query grammar via `@adonis-agora/filter` |
| Segurança | access control por operação e por campo, field-level read stripping, scoped reads |
| Ciclo de vida | hooks (validate/change/read/delete), transações |
| Versões | drafts, autosave, publish/unpublish, restore, retenção, document locks |
| i18n | locales por coluna, fallback, campos localizados |
| Painel | SPA React embutida, schema-driven, blocks builder, live preview |
| Integrações | filter (obrigatória); media, authkit, authz, telescope, durable (opcionais) |

### Fora do escopo

- GraphQL (decisão explícita do usuário).
- Multi-tenancy / row-level tenancy isolada.
- Real-time collaboration (CRDT) — `document locks` cobre o caso de uso básico.
- Adapter MongoDB.
- Marketplace de plugins (a extensibilidade é por código, não por registro remoto).
- Editor de código customizável (o `code` field é textarea com highlight).

### Não-objetivo de design

O CMS **não** vira um framework paralelo. Ele não tem router próprio, não substitui
`@adonisjs/auth`, não gerencia uploads (delega ao media) e não implementa RBAC (delega ao
authz). Cada um desses é uma interface com adapter default.

---

## 3. Princípios

1. **Config é a fonte da verdade, banco é artefato revisável.** Toda mudança de schema produz
   um plano legível; nada altera o banco sem que o plano exista e seja aplicado de forma
   explícita ou por um modo previsível.
2. **Nunca DDL silencioso em produção.** `managed` é automático em `development`/`test` e exige
   comando explícito em `production`.
3. **Zero codegen para tipos.** `defineConfig` preserva literais; os tipos derivam por mapped
   types. Codegen existe só onde paga: arquivos de migration.
4. **Camadas testáveis sem HTTP.** Compilador, diff e repositório são puros/injetáveis; a rota
   REST é uma tradução fina por cima da Local API.
5. **Adapters para tudo que é externo.** Auth, storage, rich text, jobs, observabilidade. O
   core não importa `@adonisjs/auth`, `@adonis-agora/media` nem `@adonis-agora/telescope` em
   runtime — apenas tipos e subpaths opcionais.
6. **Lucid é peer, não dependência de runtime do repositório.** O data layer fala Knex. Isso
   permite SQLite/Postgres/MySQL, testes in-memory e nenhum acoplamento a model estático.
7. **Subpath exports (idioma Agora).** Quem não usa o painel não carrega React; quem não usa
   media não carrega sharp.
8. **Tipos são a documentação.** Se o config diz `title: text`, o documento tem `title: string`
   e o admin renderiza um `<input>`; não há segunda declaração em lugar nenhum.

---

## 4. Arquitetura

```
                        ┌──────────────────────────────┐
                        │      config/cms.ts           │
                        │  defineConfig({ collections })│
                        └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │  schema/compileSchema()      │  puro, sem I/O
                        │  SchemaSpec + hash           │
                        └───────┬──────────────┬───────┘
                                │              │
              ┌─────────────────▼──┐      ┌────▼─────────────────┐
              │ db/diff + sync     │      │ types (inferência)   │
              │ introspect → plan  │      │ CmsDocument<C,'posts'│
              └─────────┬──────────┘      └────┬─────────────────┘
                        │                      │
              ┌─────────▼──────────────────────▼─────────┐
              │  repository (knex, trx, hooks, access)   │
              └───────┬───────────────────────┬──────────┘
                      │                       │
            ┌─────────▼─────────┐   ┌─────────▼──────────┐
            │  local API        │   │  REST (routes)     │
            │  cms.collection() │   │  /api/cms/*        │
            └─────────┬─────────┘   └─────────┬──────────┘
                      │                       │
                      └───────────┬───────────┘
                                  │
                       ┌──────────▼───────────┐
                       │  admin API + SPA     │
                       │  schema JSON → React │
                       └──────────────────────┘
```

**Fluxo de uma escrita:**

```
request → access(op) → beforeValidate → validate → field.validate → beforeChange
        → BEGIN trx → write row → write version row → afterChange → COMMIT
        → afterRead (transform de saída)
```

**Fluxo de uma leitura REST:**

```
request → access(read) [boolean | where-constraint]
        → query builder (filter pipeline) → depth population
        → field-level read stripping → beforeRead → afterRead → JSON
```

---

## 5. Layout do repo

```
adonis-cms/
├── packages/
│   ├── adonis/                    # @adonis-agora/cms
│   │   ├── src/
│   │   │   ├── config/            # defineConfig, collection, global, fields.*
│   │   │   ├── schema/            # compileSchema, field→column, hash
│   │   │   ├── db/                # diff, introspect, sync, system tables
│   │   │   ├── repository/        # queries, trx, population, versions
│   │   │   ├── local_api/         # cms.collection(), cms.global()
│   │   │   ├── rest/              # routes, handlers, serializers
│   │   │   ├── access/            # AccessFn, where constraints, stripping
│   │   │   ├── hooks/             # pipeline
│   │   │   ├── versions/          # drafts, autosave, publish, restore
│   │   │   ├── i18n/              # locale resolution, fallback
│   │   │   ├── admin/             # admin API (schema JSON, prefs, preview tokens)
│   │   │   ├── integrations/      # media, authkit, authz, telescope, durable
│   │   │   └── testing/           # createTestCms
│   │   ├── commands/              # ace: cms:sync, cms:diff, cms:generate
│   │   ├── providers/             # cms_provider, admin_provider
│   │   ├── stubs/                 # config/cms.stub, migrations/*.stub
│   │   └── configure.ts           # node ace configure
│   ├── react/                     # @adonis-agora/cms-react
│   └── admin/                     # @adonis-agora/cms-admin (Vite SPA)
├── docs/specs/
├── examples/blog/                 # app Adonis mínima usada em e2e
└── turbo.json, pnpm-workspace.yaml, biome.json, tsconfig.base.json
```

Espelha `adonis-media` em scripts (`build`, `test`, `typecheck`, `lint`, `changeset`,
`release`), `allowBuilds` no workspace e `copy:stubs` no build do core.

---

## 6. Config API

```ts
// config/cms.ts
import { defineConfig, collection, global, fields } from '@adonis-agora/cms'

export default defineConfig({
  db: {
    schema: 'managed',        // 'managed' | 'migrations' | 'manual'
    tablePrefix: 'cms_',
    id: 'uuid',               // 'uuid' | 'increment'
    prune: false,             // permite DROP de tabela/coluna órfã do CMS
    renames: {},              // { 'posts.old_field': 'new_field' } — evita drop+add
  },

  admin: {
    path: '/admin',
    auth: 'cms',              // 'cms' | 'authkit' | adapter próprio
    title: 'Painel',
  },

  localization: {
    locales: ['pt-BR', 'en'],
    defaultLocale: 'pt-BR',
    fallback: true,
  },

  versions: {
    maxPerDocument: 50,
    autosave: false,          // default por collection, sobrescrevível
    lockTtl: 300,             // segundos
  },

  collections: [
    collection('posts', {
      labels: { singular: 'Post', plural: 'Posts' },
      admin: {
        useAsTitle: 'title',
        defaultColumns: ['title', 'status', 'publishedAt'],
        group: 'Conteúdo',
      },
      versions: { drafts: true, autosave: { interval: 2000 } },
      access: {
        read: () => true,
        create: ({ user }) => Boolean(user),
        update: ({ user, doc }) => user?.id === doc?.authorId,
        delete: ({ user }) => user?.role === 'admin',
      },
      hooks: {
        beforeChange: [({ data }) => ({ ...data })],
        afterChange: [({ doc, previousDoc, operation }) => {}],
      },
      fields: [
        fields.text('title', { required: true, maxLength: 120 }),
        fields.slug('slug', { from: 'title', unique: true }),
        fields.richText('body', { localized: true }),
        fields.select('status', {
          options: [{ label: 'Rascunho', value: 'draft' }, { label: 'Publicado', value: 'published' }],
          defaultValue: 'draft',
        }),
        fields.date('publishedAt', { admin: { position: 'sidebar' } }),
        fields.relation('author', { relationTo: 'users' }),
        fields.upload('cover', { relationTo: 'media' }),
        fields.array('tags', { fields: [fields.text('label')] }),
        fields.group('seo', { fields: [fields.text('title'), fields.textarea('description')] }),
        fields.blocks('layout', { blocks: [heroBlock, galleryBlock] }),
      ],
    }),
  ],

  globals: [
    global('site_settings', {
      fields: [fields.text('siteName'), fields.upload('logo', { relationTo: 'media' })],
    }),
  ],
})
```

### Regras de validação da config

Falham no boot (dev) e no `cms:diff` (CI), com erro `CmsConfigError` apontando o caminho:

- `collection`/`global` slug duplicado, ou fora de `^[a-z][a-z0-9_]*$`.
- Field `name` duplicado dentro da collection; nome começando com `_` (reservado).
- `relationTo` / `upload.relationTo` apontando para collection inexistente.
- `localized: true` em field dentro de `array`/`blocks` sem locale configurado.
- `versions.drafts` em global (globals não têm drafts; têm versões simples).
- `db.schema: 'migrations'` sem `@adonisjs/lucid` instalado.
- Locale inválido em `localization.locales` (BCP-47 na forma `xx` / `xx-YY`).
- `useAsTitle` apontando para field inexistente ou não textual.

---

## 7. Campos

### Catálogo v1

| Field | Coluna | Admin component | Notas |
|---|---|---|---|
| `text` | `varchar(len)` | `TextInput` | `maxLength`, `minLength` |
| `textarea` | `text` | `Textarea` | |
| `email` | `varchar(320)` | `EmailInput` | validação de formato |
| `password` | `varchar(255)` | `PasswordInput` | hash via hook; nunca serializado |
| `number` | `int`/`numeric` | `NumberInput` | `format: 'int' \| 'float' \| 'decimal'`, `min`, `max` |
| `checkbox` | `boolean` | `Checkbox` | |
| `date` | `timestamptz` | `DatePicker` | `withTime: true` default |
| `select` | `varchar(255)` | `Select` | `hasMany: false` v1; valor fora das options rejeitado |
| `radio` | `varchar(255)` | `RadioGroup` | |
| `json` | `jsonb` | `JsonEditor` | validação de JSON no server |
| `code` | `text` | `CodeEditor` | `language`, highlight |
| `slug` | `varchar(255)` | `SlugInput` | `from`, gera no `beforeValidate` se vazio |
| `richText` | `jsonb` | `RichText` (SPI) | documento do editor, não HTML |
| `relation` | `<name>_id` / `cms_relations` | `RelationPicker` | `hasMany`, `relationTo` único na v1 |
| `upload` | `<name>_id` + meta | `UploadPicker` | precisa do adapter media |
| `array` | `jsonb` | `ArrayField` | `fields[]`, `minRows`, `maxRows` |
| `group` | `jsonb` | `GroupField` | `fields[]`, `flatten: false` |
| `blocks` | `jsonb` | `BlocksBuilder` | `blocks: BlockDefinition[]` |
| `tabs` | (agrupador) | `Tabs` | só afeta o admin; `fields[]` por tab |
| `row` / `collapsible` | (agrupador) | layout | só afeta o admin |

`tabs`, `row` e `collapsible` são **estruturais**: não geram coluna, apenas reorganizam o
formulário. O compilador achata seus filhos preservando o caminho para o admin.

### Contrato do field

```ts
interface BaseField {
  type: FieldType
  name: string
  label?: string | Record<string, string>
  required?: boolean
  unique?: boolean
  index?: boolean
  localized?: boolean
  defaultValue?: unknown
  admin?: {
    position?: 'main' | 'sidebar'
    description?: string
    component?: string            // id no FieldRegistry do admin
    condition?: (data: Record<string, unknown>) => boolean
  }
  access?: { read?: FieldAccess; update?: FieldAccess }
  validate?: (args: { value: unknown; data: Record<string, unknown> }) => string | void
  hooks?: {
    beforeValidate?: FieldHook[]
    beforeChange?: FieldHook[]
    afterRead?: FieldHook[]
  }
}
```

### Extensibilidade

```ts
// package do usuário
export const colorField = defineField({
  type: 'color',                        // id livre
  toColumn: () => ({ type: 'string', length: 9 }),
  admin: { component: 'color' },        // registrado no React
})
```

`defineField` é açúcar sobre o contrato acima; o compilador não tem `switch` fechado — ele
consulta o registry de field types, que vem com os built-ins e aceita `extendFields()` no
`defineConfig`. Um field desconhecido sem `toColumn` falha na compilação, não no banco.

---

## 8. Compilador de schema

`compileSchema(config)` é **puro**: recebe config, devolve especificação. Nenhuma query,
nenhum `process.env`, nenhuma leitura de arquivo. Isso é o que torna o diff testável e o
`--dry-run` confiável.

```ts
interface SchemaSpec {
  hash: string                     // sha256 do spec canônico (sem timestamps)
  engine: 'pg' | 'mysql' | 'sqlite'
  idKind: 'uuid' | 'increment'
  tablePrefix: string
  locales: string[]
  defaultLocale: string
  tables: TableSpec[]
}

interface TableSpec {
  name: string                     // cms_posts
  kind: 'collection' | 'global' | 'system'
  slug: string
  columns: ColumnSpec[]
  indexes: IndexSpec[]
  uniques: UniqueSpec[]
}

interface ColumnSpec {
  name: string                     // title, title_pt_br, author_id
  type: 'uuid' | 'increment' | 'string' | 'text' | 'integer' | 'bigint'
      | 'decimal' | 'float' | 'boolean' | 'timestamp' | 'json'
  length?: number
  precision?: number
  scale?: number
  nullable: boolean
  default?: unknown
  json?: boolean                   // marca coluna JSON (GIN index opcional)
}
```

### Mapeamento

- **Collection** → tabela `cms_<slug>` (+ sufixo de locale quando `localized`).
- **Campo localizado** → uma coluna por locale: `title_pt_br`, `title_en` (`-` vira `_`,
  minúsculo). Fallback é resolvido na leitura, não no banco.
- **`group`** → JSON (`seo` = `{ title, description }`). `flatten: true` vira colunas
  prefixadas `seo_title`, `seo_description` — útil para indexar/filtrar.
- **`array`/`blocks`/`richText`** → JSON. Sem tabela filha na v1 (limitação documentada na §22).
- **`relation` hasOne** → `<name>_id` do tipo do `idKind` alvo, com índice.
- **`relation` hasMany** → linhas em `cms_relations` (`owner_collection`, `owner_id`, `field`,
  `related_collection`, `related_id`, `order_index`).
- **`upload`** → `<name>_id` (string) quando o adapter media está presente; `<name>: { id, url, mime, width, height }` é montado na leitura.

### Colunas de sistema (toda tabela de collection/global)

`id`, `created_at`, `updated_at`, `_status` (só quando `versions.drafts`), `_deleted_at`
(soft delete opcional, default off).

`_` é reservado: fields não podem começar com underscore.

### Tabelas de sistema do CMS

| Tabela | Colunas |
|---|---|
| `cms_versions` | `id`, `collection`, `document_id`, `locale`, `version`, `status`, `snapshot` json, `created_by`, `created_at`, `is_latest` bool |
| `cms_relations` | `id`, `owner_collection`, `owner_id`, `field`, `related_collection`, `related_id`, `order_index` |
| `cms_schema_state` | `id`, `spec_hash`, `engine`, `plan` json, `applied_at` |
| `cms_preferences` | `id`, `user_id`, `key`, `value` json |
| `cms_document_locks` | `id`, `collection`, `document_id`, `user_id`, `expires_at` |
| `cms_users` | opcional, só quando `admin.auth: 'cms'` (id, email, password, name, role, created_at) |

Índices default: `cms_versions (collection, document_id, locale, version desc)`,
`cms_relations (owner_collection, owner_id, field, order_index)`,
`cms_document_locks (collection, document_id)` único.

---

## 9. Sincronização de schema

### Modos

| Modo | Boot | Produção | Quando usar |
|---|---|---|---|
| `managed` | compara hash; se divergir, aplica o plano em dev/test | **não aplica**; loga erro e exige `node ace cms:sync` | default; DX de Payload |
| `migrations` | só verifica drift (hash + introspecção) e avisa | drift = erro no boot | quem versiona schema em PR |
| `manual` | não toca em nada | não toca em nada | quem escreve migration na mão com as funções exportadas |

### Funções exportadas (contrato público)

```ts
// idêntico em espírito ao @adonis-agora/media
export function createCmsTables(knex: Knex, spec?: SchemaSpec): Promise<void>
export function dropCmsTables(knex: Knex): Promise<void>
export function syncCmsSchema(knex: Knex, spec: SchemaSpec, opts?: SyncOptions): Promise<SchemaPlan>
```

`syncCmsSchema` é idempotente e roda o mesmo DDL que o modo `managed`, exatamente como o
`createMediaTables` do media faz para o path da migration e o do auto-create.

### Diff

`diffSchema(spec, introspection, opts)` → `SchemaPlan`:

```ts
interface SchemaPlan {
  creates: TableSpec[]
  alters: Array<{ table: string; addColumns: ColumnSpec[]; dropColumns: string[]; alterColumns: ColumnAlter[] }>
  indexes: Array<{ table: string; add: IndexSpec[]; drop: string[] }>
  drops: string[]
  destructive: boolean
  warnings: string[]
}
```

- **Introspecção** por engine: Postgres `information_schema.columns` + `pg_indexes`; MySQL
  `information_schema`; SQLite `pragma table_info` + `pragma index_list`.
- **Destrutivo** (drop de coluna/tabela, narrowing de tipo) só aplica com `--allow-destructive`
  ou `db.prune: true`; senão vira `warning` e o plano sai com exit code ≠ 0.
- **Rename** não é inferido: `db.renames: { 'posts.old_field': 'new_field' }` transforma
  drop+add em `RENAME COLUMN`. Sem isso, é drop+add (perda de dados, bloqueada por destrutivo).
- **Transacionalidade**: Postgres e SQLite aplicam o plano em uma transação (rollback total em
  falha). MySQL não tem DDL transacional — o plano é aplicado statement a statement e o
  `cms_schema_state` só é atualizado no fim; falha no meio exige `cms:sync` de novo (idempotente).
- **Drift**: `cms_schema_state.spec_hash` é comparado com `spec.hash`. Divergência em
  `migrations` = `CmsSchemaDriftError` com o diff anexado.

### Comandos ace

`@adonis-agora/cms/commands` (array de command classes, registrado pelo `configure` via
`rcFile.addCommand`):

| Comando | O que faz |
|---|---|
| `cms:diff` | imprime o plano; exit 1 se houver drift (gate de CI) |
| `cms:sync` | aplica o plano (`--dry-run`, `--allow-destructive`, `--force`) |
| `cms:generate` | emite migration Lucid com timestamp + `syncCmsSchema(knex, spec)` e o spec serializado |
| `cms:status` | hash aplicado vs. atual, contagem de docs/versões por collection |

`cms:generate` grava o spec **serializado no arquivo**, não o import da config: migrations
antigas precisam continuar reproduzíveis mesmo depois que a config mudar (é o mesmo motivo
pelo qual o Payload gera SQL, e não importa o schema TS).

---

## 10. Tipos sem codegen

```ts
const config = defineConfig({ collections: [postsCollection] })  // 'const' generic

type Post = CmsDocument<typeof config, 'posts'>
// { id: string; title: string; slug: string; body: RichTextValue | null
//   authorId: string | null; status: 'draft' | 'published'
//   layout: Array<HeroBlock | GalleryBlock>; seo: { title?: string; description?: string }
//   createdAt: Date; updatedAt: Date; _status: 'draft' | 'published' }

const posts = cms.collection('posts')
await posts.create({ title: 'Oi', body: doc })      // erro: falta `status`? não — tem default
await posts.find({ where: { status: 'published' } }) // `status` tipado como união
```

Regras da inferência:

- `required: true` → propriedade obrigatória na entrada; nullable na saída só se não-required.
- `select`/`radio` com `options` literais → união de strings.
- `localized: true` → `LocalizedValue<T>` = `T | Record<locale, T>` na entrada,
  `Record<locale, T>` na saída.
- `hasMany` → `string[]` na entrada, documento populado quando `depth > 0`.
- Saída sempre inclui `id`, `createdAt`, `updatedAt`, `_status` (se drafts).
- Entrada omite campos gerados (`createdAt`), aceita `draft?: boolean` e `locale?: string`.

Nada disso é gerado em disco. Se a inferência ficar pesada em configs gigantes, existe escape
hatch `cms:types` opcional — mas ele **não** é necessário para usar o pacote.

---

## 11. Repositório e Local API

```ts
// server-side, sem HTTP
const posts = cms.collection('posts')

await posts.create({ data: { title: 'Oi' }, draft: true, locale: 'pt-BR', req })
await posts.update({ id, data: { title: 'Oi 2' }, draft: true })
await posts.find({ where: { status: 'published' }, sort: '-publishedAt', limit: 10, page: 1, depth: 2 })
await posts.findByID(id, { depth: 1, locale: 'en', draft: false })
await posts.delete({ id })
await posts.publish({ id })
await posts.unpublish({ id })
await posts.versions({ id })
await posts.restoreVersion({ id, version: 3 })

await cms.global('site_settings').get({ locale: 'pt-BR' })
await cms.global('site_settings').update({ data: { siteName: 'X' } })
```

Contrato:

- Toda escrita em **uma transação** (dado + versão + relações).
- `req` é opcional e só serve para resolver `user` no `access` e auditoria. Sem `req`, o
  access recebe `user: null` → operações que exigem usuário falham com `CmsForbiddenError`.
- `depth` (default `1`, máx configurável) controla population de relations; `depth: 0` devolve
  ids crus.
- `select` reduz colunas; access de campo roda **depois** do select (um campo negado continua
  negado).
- `overrideAccess: false` é o default; `true` só é aceito em contexto server-side explícito
  (usado pelos próprios hooks e pelo seed).

---

## 12. REST

Base: `/api/cms` (configurável). Rotas geradas para toda collection/global.

| Método | Rota |
|---|---|
| GET | `/collections/:slug` |
| POST | `/collections/:slug` |
| GET | `/collections/:slug/:id` |
| PATCH | `/collections/:slug/:id` |
| DELETE | `/collections/:slug/:id` |
| POST | `/collections/:slug/:id/publish` |
| POST | `/collections/:slug/:id/unpublish` |
| GET | `/collections/:slug/:id/versions` |
| GET | `/collections/:slug/:id/versions/:version` |
| POST | `/collections/:slug/:id/versions/:version/restore` |
| GET | `/globals/:slug` |
| PATCH | `/globals/:slug` |
| GET | `/schema` (contrato do admin) |
| GET | `/me` |
| GET/PATCH | `/preferences` |

### Query grammar

Delegada ao `@adonis-agora/filter`, com allow-list derivada do schema (só campos `index` ou
escalares simples são filtráveis por default; relations via `where[author][equals]=<id>`):

```
?where[status][equals]=published
?where[or][0][title][like]=adonis
?where[publishedAt][greater_than]=2026-01-01
?sort=-publishedAt,title
?limit=10&page=2
?depth=2
?locale=pt-BR
?draft=true
?select=title,slug
```

### Resposta de lista (Payload-like)

```json
{
  "docs": [],
  "totalDocs": 42,
  "limit": 10,
  "page": 2,
  "totalPages": 5,
  "hasNextPage": true,
  "hasPrevPage": true
}
```

Item único devolve o documento direto. Erros seguem `{ error: { code, message, fields? } }`.

Status: `200`, `201` (create), `204` (delete), `400` (validação), `401` (sem usuário quando
exigido), `403` (access negado), `404`, `409` (unique/lock), `422` (validação de field).

---

## 13. Access control

```ts
type AccessFn = (args: {
  req: HttpContext | null
  user: unknown
  id?: string
  data?: Record<string, unknown>
  locale?: string
}) => boolean | WhereConstraint
```

- `read` pode devolver `WhereConstraint` (mesmo shape do filter) → leitura escopada sem
  vazar existência do documento (find devolve `null`, list filtra, count respeita).
- `create`/`update`/`delete` devolvem `boolean`; devolver constraint é erro de config.
- **Field-level**: `access.read` remove a chave da resposta (não devolve `null`, remove —
  Payload faz igual). `access.update` rejeita a escrita com `422`.
- Global usa o mesmo contrato; `read`/`update` apenas.
- `cms.access` expõe helpers puros para teste: `evaluateAccess(fn, args)`.

Integração com `@adonis-agora/authz` (fase 5) é um adapter que traduz `AccessFn` em
`authz.can(...)`, sem mudar o contrato do core.

---

## 14. Hooks

Ordem exata (documento + campo):

```
operação
  → collection.beforeValidate
  → field.beforeValidate (ordem de declaração)
  → validação estrutural (required, tipo, options, unique)
  → field.validate
  → collection.beforeChange
  → field.beforeChange
  → [trx] persistência
  → field.afterChange (só com o doc persistido)
  → collection.afterChange
  → commit
```

Leitura: `collection.beforeRead` → `field.afterRead` (por campo) → `collection.afterRead`.

Regras:

- Hook que lança aborta a transação inteira (`CmsHookError` com `hook`, `collection`, `operation`).
- `afterChange` roda **dentro** da transação, então falha nele também faz rollback — diferente
  do Payload, onde `afterChange` é pós-commit. Motivo: o versionamento e as relations precisam
  ser atômicos; efeitos externos devem ir para `durable`/queue (documentado e recomendado).
- `beforeChange` devolve o data transformado (ou `undefined` para não alterar).
- `afterRead` recebe o doc já com relations populadas e é o lugar de montar URL de upload.

---

## 15. Versionamento (fase 3)

- **Draft**: `draft: true` escreve na tabela principal com `_status = 'draft'` e cria a versão
  `status = 'draft'`, `is_latest = true` (a anterior recebe `false`). A linha principal sempre
  reflete o estado mais recente (draft ou publicado).
- **Publish**: copia o estado atual para uma versão `status = 'published'`, marca
  `_status = 'published'` no doc. `unpublish` volta para `draft` sem perder a versão publicada.
- **Restore**: lê o snapshot da versão, roda `beforeValidate`/`beforeChange` de novo (o schema
  pode ter mudado) e grava como nova versão — nunca sobrescreve histórico.
- **Autosave**: por collection, `interval` em ms; grava versão draft com `autosave: true` no
  snapshot e não dispara `afterChange` (evita efeito colateral a cada tecla). Versões autosave
  são podadas primeiro.
- **Retenção**: mantém `versions.maxPerDocument`; poda por collection/documento/locale, sempre
  preservando a última publicada. Roda no write (barato, delete por índice) e no `cms:status`.
- **Locks**: `POST /:id/lock` com TTL; conflito = `409` com o usuário atual. Expira por
  `expires_at`; não é lock de banco, é advisory para o painel.
- **Leitura draft**: `draft: true` exige access `read` = `true` para o usuário (nunca público).

---

## 16. i18n e blocks (fase 4)

### i18n

- Locales vêm de `localization.locales`; cada campo `localized` gera `nome_<locale>`.
- Escrita: `locale` ausente → `defaultLocale`. Escrita parcial (`undefined`) preserva o valor
  existente (não zera o outro locale) — semântica de `PATCH`.
- Leitura: `locale` ausente → devolve `Record<locale, T>` completo; `locale` presente →
  devolve o valor daquele locale (com fallback se `fallback: true` e o campo estiver vazio).
- `required` em campo localizado = obrigatório em **todos** os locales? Não: obrigatório no
  `defaultLocale`, opcional nos demais (regra explícita, evita bloquear tradução parcial).
- Índices: índice composto por locale só quando o campo é `index: true`.

### Blocks

```ts
const heroBlock = block('hero', {
  fields: [fields.text('heading', { required: true }), fields.upload('image', { relationTo: 'media' })],
})
```

- Snapshot: `[{ type: 'hero', id: 'uuid', value: { heading, image } }, ...]`.
- Cada bloco recebe `id` estável (para keys no React e para patch por bloco).
- Type narrowing: `BlocksValue<[typeof heroBlock, typeof galleryBlock]>` vira união
  discriminada por `type`.
- Population de `upload`/`relation` **dentro** de blocks: depth-aware, mas só 1 nível (v1).

---

## 17. Painel admin (fase 5)

### Contrato `/api/cms/schema`

JSON serializável derivado do mesmo `SchemaSpec` + config (sem funções):

```json
{
  "version": 1,
  "admin": { "title": "Painel", "path": "/admin" },
  "locales": ["pt-BR", "en"],
  "defaultLocale": "pt-BR",
  "collections": [{
    "slug": "posts",
    "labels": { "singular": "Post", "plural": "Posts" },
    "useAsTitle": "title",
    "defaultColumns": ["title", "status"],
    "versioned": true,
    "fields": [{ "type": "text", "name": "title", "required": true, "admin": { "position": "main" } }]
  }],
  "globals": [],
  "user": { "id": "...", "name": "...", "role": "admin" },
  "permissions": { "posts": { "create": true, "update": true, "delete": false } }
}
```

`permissions` é o resultado **avaliado** de `access` para o usuário da sessão — o painel
esconde botões sem duplicar a lógica.

### SPA

- Vite + React + TanStack Router/Query/Table. Build copiado para `dist/assets/spa` no build do
  core (mesmo `copy:stubs` do media) e servido por `admin_provider`.
- **FieldRegistry**: `Map<fieldType, Component>`; `tabs`, `row`, `collapsible` são containers.
  Custom fields registram via `registerField('color', ColorInput)` no entry do painel.
- Telas: login, dashboard, list (filter-client + TanStack Table), edit (form schema-driven),
  versions (diff lado a lado), global edit, account, media browser (quando adapter presente).
- **Live preview**: `admin.livePreview: { url, collections: {...} }`; o painel abre iframe com
  `?token=` (JWT curto assinado pelo app, TTL 5 min) e envia `postMessage({ type: 'cms:preview', data })`
  a cada mudança; o site escuta e re-renderiza. Protocolo documentado, sem dependência de
  framework no lado do site.
- Tema: CSS variables com tokens Agora; sem Tailwind obrigatório no app do usuário (o painel
  compila o próprio CSS).

---

## 18. Integrações

| Pacote | Tipo | Subpath | O que faz |
|---|---|---|---|
| `@adonis-agora/filter` | **obrigatória** | — | query grammar da REST e do painel |
| `@adonis-agora/media` | opcional | `cms/media` | adapter de upload; `fields.upload` resolve URL/thumb |
| `@adonis-agora/authkit` | opcional | `cms/authkit` | `CmsAuthAdapter` sobre a sessão do authkit |
| `@adonis-agora/authz` | opcional | `cms/authz` | traduz `AccessFn` em abilities |
| `@adonis-agora/telescope` | opcional | `cms/telescope` | watcher de queries do CMS, hooks lentos, drift |
| `@adonis-agora/durable` | opcional | `cms/durable` | jobs de autosave/retention/webhooks pós-commit |

Regra: o core **não importa** os opcionais. Cada subpath exporta uma função de wiring
(`mediaAdapter()`, `authkitAdapter()`, `telescopeWatcher()`) que o usuário passa na config.

Se `media` não estiver presente, `fields.upload` falha na compilação da config com
`CmsConfigError` explicando como instalar o adapter. **Não existe modo degradado**: o CMS não
implementa storage próprio. Quem não quer o media usa `fields.relation` para a própria tabela
de mídia.

---

## 19. Erros e observabilidade

```
CmsError (base: code, message, context)
├── CmsConfigError        // config inválida (boot / diff)
├── CmsSchemaError        // plano inválido, engine sem suporte
├── CmsSchemaDriftError   // hash/introspecção divergentes
├── CmsValidationError    // fields inválidos (fields: Record<name, string>)
├── CmsNotFoundError
├── CmsForbiddenError
├── CmsConflictError      // unique, lock
└── CmsHookError          // hook que lançou
```

- Mapeamento HTTP 1:1 na §12; `CmsError` desconhecido = 500 com log.
- `telescope`: um watcher por operação (collection, op, duração, linhas, hook mais lento) e
  entry de drift. Nunca loga `data` completo (PII) — só nomes de campo.
- `logger`: child scope `cms`; `debug` para plano, `info` para sync aplicado, `warn` para drift
  em dev, `error` para drift em prod.

---

## 20. Testes

| Camada | Estratégia |
|---|---|
| `schema/compileSchema` | unit puro, snapshot do `SchemaSpec` por fixture de config |
| `db/diff` | unit com introspecção fake + integração sqlite/pg |
| `db/sync` | integração: cria, altera, dropa, idempotência, rollback |
| `repository` | integração sqlite in-memory; contract test por engine |
| `access` | unit: boolean, constraint, field stripping, override |
| `hooks` | unit: ordem, transformação, rollback |
| `versions` | integração: draft, publish, restore, retenção, autosave |
| `rest` | e2e com `@adonisjs/http-server` + Japa/test client |
| `admin` | vitest + Testing Library nos field components; e2e Playwright no `examples/blog` |

Kit:

```ts
const { cms, db, destroy, actAs } = await createTestCms({ config, engine: 'sqlite' })
await actAs({ id: 'u1', role: 'admin' })
```

`createTestCms` sobe better-sqlite3 em memória, roda `syncCmsSchema`, injeta relógio
determinístico e trava `depth` máximo. Todo teste de integração usa o kit; nenhum abre conexão
própria.

---

## 21. Fases e critérios de aceite

### Fase 1 — Fundação
`defineConfig` + fields + `compileSchema` + `SchemaSpec` + diff/introspecção sqlite/pg +
`syncCmsSchema`/`createTables`/`dropTables` + 3 modos + `cms:diff`/`cms:sync`/`cms:generate` +
tipos por inferência + `createTestCms` + `configure`.

**Aceite:** config de blog compila; `cms:diff` em banco vazio == plano de criação; aplicar
duas vezes não muda nada (idempotente); adicionar campo gera alter; remover campo sem
`--allow-destructive` falha com warning; tipos de `CmsDocument` batem com a config (type test
com `expectTypeOf`).

### Fase 2 — Dados e API
Repositório, Local API, REST, access, hooks, filter, validação, transações, population.

**Aceite:** CRUD completo via REST e Local API; access constraint esconde docs; field-level
read remove chave; hook que lança faz rollback; `where`/`sort`/`page` do filter funcionam;
`depth` popula relation.

### Fase 3 — Versionamento
Drafts, publish/unpublish, restore, autosave, retenção, locks.

**Aceite:** draft não aparece em leitura pública; publish cria versão publicada; restore
recria estado e gera nova versão; retenção mantém a última publicada.

### Fase 4 — i18n e blocks
Colunas por locale, fallback, blocks tipados, arrays/group aninhados, `flatten`.

**Aceite:** escrever em `en` não zera `pt-BR`; leitura sem locale devolve mapa; blocks com
união discriminada compilam; upload dentro de block popula com depth 1.

### Fase 5 — Painel e integrações
SPA embutida, schema JSON, FieldRegistry, list/edit/versions, live preview, adapters
media/authkit/authz/telescope/durable.

**Aceite:** `node ace configure @adonis-agora/cms` deixa uma app crua com painel funcional em
`/admin`; CRUD pelo painel; upload pelo media adapter; permissões refletidas na UI.

---

## 22. Decisões em aberto e riscos

| # | Item | Decisão/risco |
|---|---|---|
| 1 | Rich text | SPI `RichTextEditor`; **Tiptap** como default (Lexical fica como adapter). Risco: formato do documento precisa ser versionado no snapshot — guardar `editor: 'tiptap@x'` junto. |
| 2 | Auth do painel | Interface `CmsAuthAdapter`; default `cms_users` (fase 5), authkit como alternativa. Fase 1 só o adapter de teste. |
| 3 | JSON por engine | `jsonb` no pg, `json` no mysql/sqlite. Filtro em chave de JSON não é uniforme — documentar como limitação (só igualdade em pg via `->>`). |
| 4 | Blocks/array em JSON | Não dá para filtrar/ordenar por campo interno sem expression index. Aceitável na v1; se doer, Fase 6 cria tabelas filhas. |
| 5 | DDL no MySQL | Sem transação; plano parcial é possível. Documentar e exigir backup/`--dry-run`. |
| 6 | `afterChange` em trx | Difere do Payload (pós-commit). Efeito externo deve ir para durable. Documentar em destaque. |
| 7 | Crescimento de `cms_versions` | Retenção por documento; sem particionamento na v1. Monitorar via `cms:status`. |
| 8 | Bundle do admin | Lexical/Tiptap + TanStack pode passar de 600 kB gzip. Code-split por rota e editor lazy. |
| 9 | Inferência de tipos profunda | Configs muito grandes podem estourar o TS. Escape hatch `cms:types` fica reservado, não implementado. |
| 10 | Renomear campo | Só via `db.renames` explícito. Sem inferência heurística. |

---

## 23. Convenções de repo

- pnpm workspace + turbo + biome + changesets + vitest, espelhando `adonis-media`.
- `pnpm-workspace.yaml` com `allowBuilds` (better-sqlite3, sharp se usado).
- Todo pacote publicável: `type: module`, `exports` por subpath, `files: [dist, README, CHANGELOG, skills]`.
- `@adonis-agora/cms/commands` exporta `commands.json` + classes.
- CI: `biome check` → `tsc --noEmit` → `vitest` (sqlite) → matriz Postgres 16/17 (fase 2+).
- Um changeset por fase; `release` via `changeset publish`.
- Docs: `docs/` por tópico (schema, fields, access, hooks, versions, i18n, admin, integrations),
  no formato do `adonis-media/docs`.
