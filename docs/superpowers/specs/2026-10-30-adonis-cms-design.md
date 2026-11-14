# Adonis CMS — spec de arquitetura

- **Status:** aprovado (desenho), escopo completo, implementação por marcos
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

| Área             | Incluído                                                                          |
| ---------------- | --------------------------------------------------------------------------------- |
| Content modeling | collections, globals, todos os field types, blocks, arrays, groups, tabs          |
| Banco            | DDL gerado/diffado, 3 modos de sync, introspecção, drift detection                |
| API              | Local API tipada, REST automático, query grammar via `@adonis-agora/filter`       |
| Segurança        | access control por operação e por campo, field-level read stripping, scoped reads |
| Ciclo de vida    | hooks (validate/change/read/delete), transações                                   |
| Versões          | drafts, autosave, publish/unpublish, restore, retenção, document locks            |
| i18n             | locales por coluna, fallback, campos localizados                                  |
| Painel           | SPA React embutida, schema-driven, blocks builder, live preview                   |
| Integrações      | filter (obrigatória); media, authkit, authz, telescope, durable (opcionais)       |

### Fora do escopo

- GraphQL (decisão explícita do usuário).
- Multi-tenancy / row-level tenancy isolada.
- Real-time collaboration (CRDT) — `document locks` cobre o caso de uso básico.
- Adapter MongoDB.
- Marketplace de plugins (a extensibilidade é por código, não por registro remoto).
- Editor de código customizável (o `code` field é textarea com highlight).

**Não existe MVP.** O produto entregue é a superfície completa descrita neste documento: todos
os field types, armazenamento relacional completo, drafts, histórico sem poda por default,
i18n aninhada, painel, live preview e todas as integrações. A numeração de marcos na §21 é
ordem de entrega e revisão, não corte de escopo — nenhuma feature é implementada "pela metade
para depois".

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
│   │   ├── commands/              # ace: cms:sync, cms:diff, cms:generate, cms:status, cms:types
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
import { defineConfig, collection, global, fields } from '@adonis-agora/cms';

export default defineConfig({
  db: {
    schema: 'managed', // 'managed' | 'migrations' | 'manual'
    tablePrefix: 'cms_',
    id: 'uuid', // 'uuid' | 'increment'
    prune: false, // permite DROP de tabela/coluna órfã do CMS
    renames: {}, // { 'posts.old_field': 'new_field' } — evita drop+add
  },

  admin: {
    path: '/admin',
    auth: 'cms', // 'cms' | 'authkit' | adapter próprio
    title: 'Painel',
    livePreview: {
      url: '/preview', // base do site; o painel acrescenta ?token=&collection=&id=
    },
  },

  localization: {
    locales: ['pt-BR', 'en'],
    defaultLocale: 'pt-BR',
    fallback: true,
    localizedRequired: 'default', // 'default' | 'all'
  },

  versions: {
    retention: null, // null = histórico completo; número = poda por documento
    autosave: false, // default por collection, sobrescrevível
    lockTtl: 300, // segundos
  },

  tenancy: {
    strategy: 'row', // 'row' (coluna _tenant_id) | 'database' (uma conexão por tenant)
    required: true,
    resolve: ({ hostname }) => hostname.split('.')[0] ?? null, // default: subdomínio
    overrides: { acme: { collections: { only: ['posts'] } } },
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
          options: [
            { label: 'Rascunho', value: 'draft' },
            { label: 'Publicado', value: 'published' },
          ],
          defaultValue: 'draft',
        }),
        fields.select('channels', {
          options: [
            { label: 'Web', value: 'web' },
            { label: 'RSS', value: 'rss' },
          ],
          hasMany: true, // tabela filha, filtrável e ordenável
        }),
        fields.date('publishedAt', { admin: { position: 'sidebar' } }),
        fields.relation('author', { relationTo: 'users' }),
        fields.relation('related', { relationTo: ['posts', 'pages'], hasMany: true }), // polimórfico
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
});
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

### Catálogo completo

| Field                 | Armazenamento                    | Admin component          | Notas                                                                     |
| --------------------- | -------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| `text`                | `varchar(len)`                   | `TextInput`              | `maxLength`, `minLength`, `pattern`                                       |
| `textarea`            | `text`                           | `Textarea`               |                                                                           |
| `email`               | `varchar(320)`                   | `EmailInput`             | validação de formato                                                      |
| `password`            | `varchar(255)`                   | `PasswordInput`          | hash via hook; nunca serializado                                          |
| `number`              | `int`/`numeric`                  | `NumberInput`            | `format: 'int' \| 'float' \| 'decimal'`, `min`, `max`                     |
| `checkbox`            | `boolean`                        | `Checkbox`               |                                                                           |
| `date`                | `timestamptz`                    | `DatePicker`             | `withTime: true` default                                                  |
| `select`              | `varchar(255)` ou tabela filha   | `Select` / `MultiSelect` | `hasMany: true` → tabela filha ordenada; valor fora das options rejeitado |
| `radio`               | `varchar(255)`                   | `RadioGroup`             |                                                                           |
| `json`                | `jsonb`                          | `JsonEditor`             | validação de JSON no server                                               |
| `code`                | `text`                           | `CodeEditor`             | `language`, highlight                                                     |
| `slug`                | `varchar(255)`                   | `SlugInput`              | `from`, gera no `beforeValidate` se vazio; unique por locale              |
| `richText`            | `jsonb`                          | `RichText` (SPI)         | documento do editor, não HTML                                             |
| `relation`            | `<name>_id` / tabela filha       | `RelationPicker`         | `hasMany`, `relationTo: string \| string[]` (polimórfico suportado)       |
| `upload`              | `<name>_id` + meta               | `UploadPicker`           | precisa do adapter media                                                  |
| `array`               | tabela filha                     | `ArrayField`             | `fields[]`, `minRows`, `maxRows`, aninhamento recursivo                   |
| `group`               | colunas prefixadas na tabela pai | `GroupField`             | `fields[]`, recursivo                                                     |
| `blocks`              | tabela filha com `type`          | `BlocksBuilder`          | `blocks: BlockDefinition[]`, aninhamento recursivo                        |
| `tabs`                | (estrutural)                     | `Tabs`                   | `fields[]` por tab                                                        |
| `row` / `collapsible` | (estrutural)                     | layout                   | só afeta o admin                                                          |

`tabs`, `row` e `collapsible` são **estruturais**: não geram coluna, apenas reorganizam o
formulário. O compilador achata seus filhos preservando o caminho para o admin.

### Contrato do field

```ts
interface BaseField {
  type: FieldType;
  name: string;
  label?: string | Record<string, string>;
  required?: boolean;
  unique?: boolean;
  index?: boolean;
  localized?: boolean;
  defaultValue?: unknown;
  admin?: {
    position?: 'main' | 'sidebar';
    description?: string;
    component?: string; // id no FieldRegistry do admin
    condition?: (data: Record<string, unknown>) => boolean;
  };
  access?: { read?: FieldAccess; update?: FieldAccess };
  validate?: (args: { value: unknown; data: Record<string, unknown> }) => string | void;
  hooks?: {
    beforeValidate?: FieldHook[];
    beforeChange?: FieldHook[];
    afterRead?: FieldHook[];
  };
}
```

### Extensibilidade

```ts
// package do usuário
export const colorField = defineField({
  type: 'color', // id livre
  toColumn: () => ({ type: 'string', length: 9 }),
  admin: { component: 'color' }, // registrado no React
});
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
  hash: string; // sha256 do spec canônico (sem timestamps)
  engine: 'pg' | 'mysql' | 'sqlite';
  idKind: 'uuid' | 'increment';
  tablePrefix: string;
  locales: string[];
  defaultLocale: string;
  tables: TableSpec[];
}

interface TableSpec {
  name: string; // cms_posts
  kind: 'collection' | 'global' | 'child' | 'system';
  slug: string; // 'posts', 'tags', 'layout'
  owner?: string; // tabela pai, quando kind = 'child'
  path?: string; // 'tags', 'layout.gallery'
  columns: ColumnSpec[];
  indexes: IndexSpec[];
  uniques: UniqueSpec[];
  foreignKeys: ForeignKeySpec[];
}

interface ColumnSpec {
  name: string; // title, title_pt_br, author_id
  type:
    | 'uuid'
    | 'increment'
    | 'string'
    | 'text'
    | 'integer'
    | 'bigint'
    | 'decimal'
    | 'float'
    | 'boolean'
    | 'timestamp'
    | 'json';
  length?: number;
  precision?: number;
  scale?: number;
  nullable: boolean;
  default?: unknown;
  json?: boolean; // marca coluna JSON (GIN index opcional)
  references?: { table: string; column: string; onDelete: 'cascade' | 'set null' | 'restrict' };
}
```

### Mapeamento

- **Collection** → tabela `cms_<slug>`.
- **Global** → tabela própria `cms_<slug>` de linha única (`id = 1`), mesmo compilador.
- **Campo localizado escalar** → uma coluna por locale: `title_pt_br`, `title_en` (`-` vira
  `_`, minúsculo). Fallback é resolvido na leitura, não no banco. Índice único por coluna
  significa unique **por locale**.
- **`group`** → colunas prefixadas na tabela pai (`seo_title`, `seo_description`), recursivo.
  Group é representação, não tabela: mantém a query plana e indexável.
- **`array`** → tabela filha `<table>__<path>` com `id`, `_parent_id`, `_order`, `_locale`
  (quando localizado) e uma coluna por subfield. Aninhamento recursivo gera
  `<table>__<path>__<subpath>`, com `_parent_id` apontando para a linha do nível anterior.
- **`blocks`** → tabela filha com `id`, `_parent_id`, `_order`, `_locale`, `type` (slug do
  bloco) e a **união** das colunas de todos os blocks (nullable). Blocks aninhados seguem a
  mesma regra do `array`. `type` é indexado; `(parent_id, type, _order)` é índice composto.
- **`select` hasMany** → tabela filha com `value`, `_order`, `_parent_id`, `_locale`.
- **`relation` hasOne** → `<name>_id` do tipo do `idKind` alvo, com FK e índice; quando
  `relationTo` é array (polimórfico), acrescenta `<name>_collection` e a FK é lógica.
- **`relation` hasMany** → tabela filha `<table>__<path>` com `related_id`,
  `related_collection` (só polimórfico), `_order`; FK física quando `relationTo` é único.
- **`upload`** → `<name>_id` (string) + FK lógica para a biblioteca de mídia;
  `<name>: { id, url, mime, width, height }` é montado na leitura pelo adapter.
- **`richText` / `json` / `code`** → coluna JSON/text na tabela pai. Rich text é documento de
  editor, não HTML; nunca é achatado em tabela.

### Por que tabela filha, e não JSON

Um `array`/`blocks` em JSON é mais simples de escrever, mas torna impossível o que o Payload
faz de verdade: filtrar (`where[layout.type]=hero`), ordenar, contar e indexar dentro da
estrutura, além de aplicar access por campo interno. Tabela filha dá FK, índice e allow-list
do `filter` sem casos especiais. O custo é mais DDL — que o diff já resolve.

### Query de estruturas aninhadas

O compilador emite, junto com o `TableSpec`, um **query plan** por caminho de campo:

```
posts.layout[].gallery[].caption  →  cms_posts__layout JOIN cms_posts__layout__gallery
```

O repositório usa `EXISTS` (para filtro) ou `LEFT JOIN` + agregação (para population) a partir
desse plan, então nem o `filter` nem o handler REST conhecem o formato das tabelas filhas.
Population é **batched**: uma query por campo por nível (`WHERE _parent_id IN (...)`), nunca
N+1.

### Colunas de sistema (toda tabela de collection/global)

`id`, `created_at`, `updated_at`, `_status` (sempre presente; só muda de significado quando a
collection tem drafts), `_deleted_at` (soft delete opcional, default off) e, em tenancy `row`,
`_tenant_id` (ver §24).

Tabelas filhas têm `id`, `_parent_id`, `_order`, `_locale` (só quando localizado) e
`created_at`/`updated_at` quando o field pede `timestamps: true`.

`_` é reservado: fields não podem começar com underscore.

### Tabelas de sistema do CMS

| Tabela               | Colunas                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cms_versions`       | `id`, `collection`, `document_id`, `locale`, `version`, `status`, `autosave` bool, `snapshot` json, `created_by`, `created_at`, `is_latest` bool |
| `cms_schema_state`   | `id`, `spec_hash`, `engine`, `plan` json, `applied_at`                                                                                           |
| `cms_preferences`    | `id`, `user_id`, `key`, `value` json                                                                                                             |
| `cms_document_locks` | `id`, `collection`, `document_id`, `user_id`, `expires_at`                                                                                       |
| `cms_users`          | quando `admin.auth: 'cms'` (id, email, password, name, role, created_at)                                                                         |

Não existe mais `cms_relations`: relação hasMany tem tabela filha própria (FK quando
monomórfica), e polimorfismo usa `related_collection` na mesma tabela filha.

Índices default: filhas `(parent_id, _order)`, `(parent_id, _locale)` quando localizado,
`(parent_id, type)` em blocks; versões `(collection, document_id, locale, version desc)`;
locks `(collection, document_id)` único.

---

## 9. Sincronização de schema

### Modos

| Modo         | Boot                                                  | Produção                                              | Quando usar                                             |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| `managed`    | compara hash; se divergir, aplica o plano em dev/test | **não aplica**; loga erro e exige `node ace cms:sync` | default; DX de Payload                                  |
| `migrations` | só verifica drift (hash + introspecção) e avisa       | drift = erro no boot                                  | quem versiona schema em PR                              |
| `manual`     | não toca em nada                                      | não toca em nada                                      | quem escreve migration na mão com as funções exportadas |

### Funções exportadas (contrato público)

```ts
// idêntico em espírito ao @adonis-agora/media
export function createCmsTables(knex: Knex, spec?: SchemaSpec): Promise<void>;
export function dropCmsTables(knex: Knex): Promise<void>;
export function syncCmsSchema(
  knex: Knex,
  spec: SchemaSpec,
  opts?: SyncOptions,
): Promise<SchemaPlan>;
```

`syncCmsSchema` é idempotente e roda o mesmo DDL que o modo `managed`, exatamente como o
`createMediaTables` do media faz para o path da migration e o do auto-create.

### Diff

`diffSchema(spec, introspection, opts)` → `SchemaPlan`:

```ts
interface SchemaPlan {
  creates: TableSpec[];
  alters: Array<{
    table: string;
    addColumns: ColumnSpec[];
    dropColumns: string[];
    alterColumns: ColumnAlter[];
  }>;
  indexes: Array<{ table: string; add: IndexSpec[]; drop: string[] }>;
  foreignKeys: Array<{ table: string; add: ForeignKeySpec[]; drop: string[] }>;
  drops: string[];
  destructive: boolean;
  warnings: string[];
}
```

- **Introspecção** por engine: Postgres `information_schema.columns` + `pg_indexes` +
  `information_schema.table_constraints`; MySQL `information_schema`; SQLite `pragma table_info`,
  `pragma index_list` e `pragma foreign_key_list`.
- **Tabelas filhas entram no mesmo plano**: criar/alterar/dropar `cms_posts__layout` é igual a
  qualquer tabela. Quando um block ganha um campo, a **união** de colunas muda e o alter é
  calculado sobre a tabela filha — sem migração especial.
- **Ordem de aplicação**: cria tabelas pai → filhas (por profundidade de `path`) → índices →
  FKs; drop na ordem inversa. Isso evita FK quebrada no meio do plano.
- **Destrutivo** (drop de coluna/tabela, narrowing de tipo) só aplica com `--allow-destructive`
  ou `db.prune: true`; senão vira `warning` e o plano sai com exit code ≠ 0.
- **Rename** não é inferido: `db.renames: { 'posts.old_field': 'new_field' }` transforma
  drop+add em `RENAME COLUMN`. Sem isso, é drop+add (perda de dados, bloqueada por destrutivo).
  Caminhos de tabela filha também são aceitos: `posts.layout.heading`.
- **Transacionalidade**: Postgres e SQLite aplicam o plano em uma transação (rollback total em
  falha). MySQL não tem DDL transacional — o plano é aplicado statement a statement e o
  `cms_schema_state` só é atualizado no fim; falha no meio exige `cms:sync` de novo (idempotente).
- **Drift**: `cms_schema_state.spec_hash` é comparado com `spec.hash`. Divergência em
  `migrations` = `CmsSchemaDriftError` com o diff anexado.
- **Tabelas órfãs**: tabela com prefixo do CMS que não existe no spec vira `drop` — bloqueado
  por destrutivo, nunca silencioso.

### Comandos ace

`@adonis-agora/cms/commands` (array de command classes, registrado pelo `configure` via
`rcFile.addCommand`):

| Comando        | O que faz                                                                              |
| -------------- | -------------------------------------------------------------------------------------- |
| `cms:diff`     | imprime o plano; exit 1 se houver drift (gate de CI)                                   |
| `cms:sync`     | aplica o plano (`--dry-run`, `--allow-destructive`, `--force`)                         |
| `cms:generate` | emite migration Lucid com timestamp + `syncCmsSchema(knex, spec)` e o spec serializado |
| `cms:status`   | hash aplicado vs. atual, contagem de docs/versões por collection                       |

`cms:generate` grava o spec **serializado no arquivo**, não o import da config: migrations
antigas precisam continuar reproduzíveis mesmo depois que a config mudar (é o mesmo motivo
pelo qual o Payload gera SQL, e não importa o schema TS).

---

## 10. Tipos sem codegen

```ts
const config = defineConfig({ collections: [postsCollection] }); // 'const' generic

type Post = CmsDocument<typeof config, 'posts'>;
// { id: string; title: string; slug: string
//   body: RichTextValue | Record<Locale, RichTextValue>
//   status: 'draft' | 'published'; channels: Array<'web' | 'rss'>
//   author: string | CmsDocument<typeof config, 'users'> | null
//   related: Array<Post | Page>
//   cover: CmsUpload | null
//   tags: Array<{ id: string; label: string | null }>
//   layout: Array<HeroBlock | GalleryBlock>
//   seo: { title: string | null; description: string | null }
//   createdAt: Date; updatedAt: Date; _status: 'draft' | 'published' }

const posts = cms.collection('posts');
await posts.create({ title: 'Oi', body: doc }); // erro: falta `status`? não — tem default
await posts.find({ where: { status: 'published' } }); // `status` tipado como união
```

Regras da inferência:

- `required: true` → propriedade obrigatória na entrada; na saída, o tipo é o mesmo do campo
  (nunca `| null`) — nullabilidade é derivada de `required`, não de opcional.
- `select`/`radio` com `options` literais → união de strings; um array de options vira união
  de todos os valores.
- `localized: true` → `LocalizedValue<T>` = `T | Record<locale, T>` na entrada,
  `Record<locale, T>` na saída quando nenhum locale é pedido, `T` quando `locale` é fixado
  (sobrecarga de assinatura por literal).
- `relation` hasOne → `string | DocumentoPopulado` conforme `depth`; `hasMany` → array.
- `array`/`blocks`/`group` → tipos aninhados recursivos; `blocks` vira união discriminada por
  `type`, `array` vira `Array<{ id, ... }>`.
- `select hasMany` → `Array<Value>` na entrada, com ordem preservada.
- Saída sempre inclui `id`, `createdAt`, `updatedAt`, `_status`.
- Entrada omite campos gerados (`createdAt`), aceita `draft?: boolean` e `locale?: string`.
- `access.read` negado remove a propriedade do tipo de saída quando o access é estático
  (`() => false`); access dinâmico mantém a propriedade e o valor é removido em runtime.

Nada disso é gerado em disco. Existe o comando opcional `cms:types` para quem preferir tipos
materializados (configs gigantes, ou consumo por outro pacote), mas ele **não** é necessário
para usar o CMS.

---

## 11. Repositório e Local API

```ts
// server-side, sem HTTP
const posts = cms.collection('posts');

await posts.create({ data: { title: 'Oi' }, draft: true, locale: 'pt-BR', req });
await posts.update({ id, data: { title: 'Oi 2' }, draft: true });
await posts.find({
  where: { status: 'published' },
  sort: '-publishedAt',
  limit: 10,
  page: 1,
  depth: 2,
});
await posts.findByID(id, { depth: 1, locale: 'en', draft: false });
await posts.delete({ id });
await posts.publish({ id });
await posts.unpublish({ id });
await posts.versions({ id });
await posts.restoreVersion({ id, version: 3 });

await cms.global('site_settings').get({ locale: 'pt-BR' });
await cms.global('site_settings').update({ data: { siteName: 'X' } });
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

| Método    | Rota                                               |
| --------- | -------------------------------------------------- |
| GET       | `/collections/:slug`                               |
| POST      | `/collections/:slug`                               |
| GET       | `/collections/:slug/:id`                           |
| PATCH     | `/collections/:slug/:id`                           |
| DELETE    | `/collections/:slug/:id`                           |
| POST      | `/collections/:slug/:id/publish`                   |
| POST      | `/collections/:slug/:id/unpublish`                 |
| GET       | `/collections/:slug/:id/versions`                  |
| GET       | `/collections/:slug/:id/versions/:version`         |
| POST      | `/collections/:slug/:id/versions/:version/restore` |
| GET       | `/globals/:slug`                                   |
| PATCH     | `/globals/:slug`                                   |
| GET       | `/schema` (contrato do admin)                      |
| GET       | `/me`                                              |
| GET/PATCH | `/preferences`                                     |

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
  req: HttpContext | null;
  user: unknown;
  id?: string;
  data?: Record<string, unknown>;
  locale?: string;
}) => boolean | WhereConstraint;
```

- `read` pode devolver `WhereConstraint` (mesmo shape do filter) → leitura escopada sem
  vazar existência do documento (find devolve `null`, list filtra, count respeita).
- `create`/`update`/`delete` devolvem `boolean`; devolver constraint é erro de config.
- **Field-level**: `access.read` remove a chave da resposta (não devolve `null`, remove —
  Payload faz igual). `access.update` rejeita a escrita com `422`.
- Global usa o mesmo contrato; `read`/`update` apenas.
- `cms.access` expõe helpers puros para teste: `evaluateAccess(fn, args)`.

Integração com `@adonis-agora/authz` é um adapter que traduz `AccessFn` em
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

## 15. Versionamento

- **Draft**: `draft: true` escreve na tabela principal com `_status = 'draft'` e cria a versão
  `status = 'draft'`, `is_latest = true` (a anterior recebe `false`). A linha principal sempre
  reflete o estado mais recente (draft ou publicado).
- **Publish**: copia o estado atual para uma versão `status = 'published'`, marca
  `_status = 'published'` no doc. `unpublish` volta para `draft` sem perder a versão publicada.
- **Restore**: lê o snapshot da versão, roda `beforeValidate`/`beforeChange` de novo (o schema
  pode ter mudado) e grava como nova versão — nunca sobrescreve histórico.
- **Snapshot**: JSON com o documento + **todas** as tabelas filhas (arrays, blocks, selects
  hasMany) + ids de relação, e o `editor` do richText. É o que permite restore fiel sem
  duplicar o schema em tabelas de versão.
- **Autosave**: por collection, `interval` em ms; grava versão draft com `autosave: true` e não
  dispara `afterChange` (evita efeito colateral a cada tecla).
- **Retenção**: `versions.retention` é `null` por default = **histórico completo, sem poda**.
  Quando configurado com número, poda por collection/documento/locale preservando sempre a
  última publicada; autosave é podado antes das versões manuais.
- **Locks**: `POST /:id/lock` com TTL; conflito = `409` com o usuário atual. Expira por
  `expires_at`; não é lock de banco, é advisory para o painel.
- **Leitura draft**: `draft: true` exige access `read` = `true` para o usuário (nunca público).
- **Diff de versões**: `GET /:id/versions/:a/diff/:b` devolve diff estrutural por campo
  (inclusive dentro de arrays/blocks, comparando por `id` de linha).

---

## 16. i18n e blocks

### i18n

- Locales vêm de `localization.locales`; campo `localized` escalar gera `nome_<locale>`;
  campo `localized` dentro de tabela filha usa a coluna `_locale` na linha.
- Escrita: `locale` ausente → `defaultLocale`. Escrita parcial (`undefined`) preserva o valor
  existente (não zera o outro locale) — semântica de `PATCH`. Isso vale para linhas filhas:
  enviar um array parcial faz merge por `id` de linha, não delete+insert.
- Leitura: `locale` ausente → devolve `Record<locale, T>` completo; `locale` presente →
  devolve o valor daquele locale (com fallback se `fallback: true` e o campo estiver vazio).
- `localization.localizedRequired`: `'default'` (default) = obrigatório só no locale padrão;
  `'all'` = obrigatório em todos. Regra explícita, sem surpresa em tradução parcial.
- `unique: true` em campo localizado = único **por locale**.
- Índices: campo localizado com `index: true` ganha índice por coluna; filha localizada ganha
  `(parent_id, _locale)`.

### Blocks

```ts
const heroBlock = block('hero', {
  fields: [
    fields.text('heading', { required: true }),
    fields.upload('image', { relationTo: 'media' }),
  ],
});
```

- Armazenamento: tabela filha com `id`, `_parent_id`, `_order`, `_locale`, `type` + união de
  colunas de todos os blocks. Não é JSON — dá para filtrar por `layout.type` e por campo
  interno de bloco.
- Cada linha tem `id` estável (keys no React, patch por bloco, diff de versão).
- Type narrowing: `BlocksValue<[typeof heroBlock, typeof galleryBlock]>` vira união
  discriminada por `type`.
- Population de `upload`/`relation` dentro de blocks é depth-aware e recursiva: o query plan
  da §8 resolve o caminho completo (`posts.layout.gallery.image`), sem N+1.
- Blocks aninhados dentro de blocks usam a mesma regra de tabela por caminho.

---

## 17. Painel admin

### Contrato `/api/cms/schema`

JSON serializável derivado do mesmo `SchemaSpec` + config (sem funções):

```json
{
  "version": 1,
  "admin": { "title": "Painel", "path": "/admin" },
  "locales": ["pt-BR", "en"],
  "defaultLocale": "pt-BR",
  "collections": [
    {
      "slug": "posts",
      "labels": { "singular": "Post", "plural": "Posts" },
      "useAsTitle": "title",
      "defaultColumns": ["title", "status"],
      "versioned": true,
      "fields": [
        { "type": "text", "name": "title", "required": true, "admin": { "position": "main" } }
      ]
    }
  ],
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

### Bundle, componentes e HMR

Dois modos de servir o painel, decididos pela existência do entry no app:

| Modo                 | Quando                           | Build                             | HMR                                  |
| -------------------- | -------------------------------- | --------------------------------- | ------------------------------------ |
| `embedded` (default) | sem `resources/js/admin/entry.*` | SPA pré-buildada dentro do pacote | nenhum (não há o que editar)         |
| `ejected`            | `node ace cms:eject-admin`       | `vite build` do próprio app       | Vite middleware + React Fast Refresh |

`cms:eject-admin` cria `resources/js/admin/entry.tsx` e injeta `cmsAdmin()` no `vite.config.ts`
(aliases, dedupe de React, base `/admin`). Sem entry, nada muda para quem não customiza; com
entry, o `admin_provider` monta o Vite dev server em middleware mode sob `admin.path` em
desenvolvimento e serve o build do app em produção.

**Registro explícito, não caminho por string.** O contrato tem duas pontas:

```ts
// config/cms.ts — serializável, nunca importa React
fields.defineField({ type: 'color', admin: { component: 'color' } });

// resources/js/admin/entry.tsx — imports reais, tipados
registerField('color', ColorInput);
```

O endpoint de schema envia `admin.component: 'color'`; o painel resolve no `FieldRegistry`. Os
built-ins já vêm registrados. Não existe import map, geração de arquivo nem resolução de path em
runtime — e o config continua Node-only por construção.

**Por que não o caminho por string do Payload:** o Payload precisa de import map porque o admin é
gerado a partir do config e o config não pode importar React. Aqui o admin é uma SPA com entry do
app, então React morre onde deve morrer (no bundle do front). Em troca ganhamos autocomplete,
typecheck, rename seguro e Fast Refresh — com o mesmo esforço de editar um path string.

**O que liga no HMR do Adonis**

| Mudança                                    | Efeito                                         | Mecanismo                            |
| ------------------------------------------ | ---------------------------------------------- | ------------------------------------ |
| componente de campo (`ColorInput.tsx`)     | Fast Refresh, estado do form preservado        | Vite                                 |
| `entry.tsx` / registro                     | Fast Refresh (recarrega o módulo)              | Vite                                 |
| `config/cms.ts` ou arquivo que ele importa | restart do servidor (~300ms) + sync automático | watch do `serve --watch` / `--hmr`   |
| campo novo no config                       | painel refaz `/api/cms/schema` e renderiza     | TanStack Query invalida no reconnect |

Loop completo em dev: salva config → servidor reinicia → `managed` aplica o plano → admin
refetcha o schema → o campo aparece. Sem comando manual.

**Limite consciente:** não tentamos hot-reload do config via `hot-hook`. O config é consumido uma
vez pelo repositório de config do Adonis; reimportar o módulo não atualiza esse valor sem
re-registrar tudo. Restart curto é mais previsível que um boundary mal desenhado. `cms.refresh()`
fica exposto para recompilar e re-sincronizar sem reiniciar no dia em que isso doer.

---

## 18. Integrações

| Pacote                    | Tipo            | Subpath         | O que faz                                            |
| ------------------------- | --------------- | --------------- | ---------------------------------------------------- |
| `@adonis-agora/filter`    | **obrigatória** | —               | query grammar da REST e do painel                    |
| `@adonis-agora/media`     | opcional        | `cms/media`     | adapter de upload; `fields.upload` resolve URL/thumb |
| `@adonis-agora/authkit`   | opcional        | `cms/authkit`   | `CmsAuthAdapter` sobre a sessão do authkit           |
| `@adonis-agora/authz`     | opcional        | `cms/authz`     | traduz `AccessFn` em abilities                       |
| `@adonis-agora/telescope` | opcional        | `cms/telescope` | watcher de queries do CMS, hooks lentos, drift       |
| `@adonis-agora/durable`   | opcional        | `cms/durable`   | jobs de autosave/retention/webhooks pós-commit       |

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

| Camada                 | Estratégia                                                                       |
| ---------------------- | -------------------------------------------------------------------------------- |
| `schema/compileSchema` | unit puro, snapshot do `SchemaSpec` por fixture de config                        |
| `db/diff`              | unit com introspecção fake + integração sqlite/pg                                |
| `db/sync`              | integração: cria, altera, dropa, idempotência, rollback                          |
| `repository`           | integração sqlite in-memory; contract test por engine                            |
| `access`               | unit: boolean, constraint, field stripping, override                             |
| `hooks`                | unit: ordem, transformação, rollback                                             |
| `versions`             | integração: draft, publish, restore, retenção, autosave                          |
| `rest`                 | e2e com `@adonisjs/http-server` + Japa/test client                               |
| `admin`                | vitest + Testing Library nos field components; e2e Playwright no `examples/blog` |

Kit:

```ts
const { cms, db, destroy, actAs } = await createTestCms({ config, engine: 'sqlite' });
await actAs({ id: 'u1', role: 'admin' });
```

`createTestCms` sobe better-sqlite3 em memória, roda `syncCmsSchema`, injeta relógio
determinístico e trava `depth` máximo. Todo teste de integração usa o kit; nenhum abre conexão
própria.

---

## 21. Marcos de entrega e critérios de aceite

Marcos são granularidade de **revisão e release**, não corte de escopo. Cada marco entrega
features completas e permanentes; nada aqui é descartado depois.

### Marco 1 — Fundação

`defineConfig` + todos os field types + `compileSchema` + `SchemaSpec` + query plan de
caminhos + diff/introspecção sqlite/pg/mysql + `syncCmsSchema`/`createTables`/`dropTables` +
3 modos + `cms:diff`/`cms:sync`/`cms:generate`/`cms:status` + tipos por inferência +
tenancy no compilador (`row` com `_tenant_id` e unique composto; `database` sem coluna) +
`createTestCms` + `configure`.

**Aceite:** config de blog compila; `cms:diff` em banco vazio == plano de criação; aplicar
duas vezes não muda nada (idempotente); adicionar campo gera alter; adicionar block gera
alter na tabela filha; remover campo sem `--allow-destructive` falha com warning; tipos de
`CmsDocument` batem com a config (type test com `expectTypeOf`), incluindo blocks aninhados;
tenancy `row` gera `_tenant_id` em pai e filhas com unique composto (`slug`, `_tenant_id`).

### Marco 2 — Dados e API

Repositório relacional (pai + filhas), Local API, REST, access, hooks, filter, validação,
transações, population batched, soft delete, escopo de tenant (`cms.forTenant`, `_tenant_id`
injetado em toda query, `allowCrossTenant` restrito).

**Aceite:** CRUD completo via REST e Local API; array/block persistem em tabela filha e
respeitam `_order`; `where[layout.type]=hero` funciona; access constraint esconde docs;
field-level read remove chave; hook que lança faz rollback de pai e filhas; `depth` popula
relation e estruturas aninhadas sem N+1 (assert de contagem de queries); em tenancy `row`,
nenhuma query sai sem `_tenant_id` e um tenant não enxerga documento de outro.

### Marco 3 — Versionamento

Drafts, publish/unpublish, restore, autosave, retenção (default ilimitada), locks, diff de
versões.

**Aceite:** draft não aparece em leitura pública; publish cria versão publicada; restore
recria estado completo (incluindo filhas) e gera nova versão; diff entre versões mostra
mudança dentro de block; retenção configurada preserva a última publicada.

### Marco 4 — i18n

Colunas por locale, `_locale` em filhas, fallback, `localizedRequired`, unique por locale,
merge de linhas filhas por `id`.

**Aceite:** escrever em `en` não zera `pt-BR`; leitura sem locale devolve mapa; array
localizado tem ordem independente por locale; `localizedRequired: 'all'` bloqueia só o que
deve.

### Marco 5 — Painel

SPA embutida, schema JSON, FieldRegistry, list/edit/versions/diff, blocks builder, media
browser, live preview, auth adapters.

**Aceite:** `node ace configure @adonis-agora/cms` deixa uma app crua com painel funcional em
`/admin`; CRUD pelo painel; upload pelo media adapter; permissões refletidas na UI; live
preview reflete edição sem reload.

### Marco 6 — Integrações e endurecimento

Adapters media/authkit/authz/telescope/durable, `cms:types` opcional, e2e no `examples/blog`,
matriz Postgres/MySQL/SQLite no CI, docs por tópico.

**Aceite:** mesma suíte de integração passa nos três engines; telescope registra operações sem
PII; durable recebe eventos pós-commit; e2e do blog verde.

---

## 22. Decisões e riscos

| #   | Item                          | Decisão/risco                                                                                                                                                                                                                                       |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Rich text                     | SPI `RichTextEditor`; **Tiptap** como default (Lexical fica como adapter). O snapshot guarda `editor: 'tiptap@x'` para restore fiel entre versões do editor.                                                                                        |
| 2   | Auth do painel                | Interface `CmsAuthAdapter`; implementações `cms_users` e `authkit` no mesmo marco. Adapter de teste desde o Marco 1.                                                                                                                                |
| 3   | JSON por engine               | `jsonb` no pg, `json` no mysql/sqlite. Igualdade em chave JSON só é uniforme no pg; **estruturas filtráveis não usam JSON** — para isso existem as tabelas filhas. `json` field é livre e não é filtrável por chave em engine não-pg (documentado). |
| 4   | DDL no MySQL                  | Sem transação; plano parcial é possível. `cms:sync` é idempotente, então re-rodar converge. Exigir `--dry-run` em prod.                                                                                                                             |
| 5   | `afterChange` em trx          | Difere do Payload (pós-commit). Efeito externo vai para durable. Documentado em destaque.                                                                                                                                                           |
| 6   | Crescimento de `cms_versions` | Default é histórico completo; snapshot inclui filhas. `cms:status` reporta tamanho por collection; `retention` numérico existe para quem precisar podar.                                                                                            |
| 7   | Bundle do admin               | Tiptap + TanStack pode passar de 600 kB gzip. Code-split por rota e editor em chunk separado (carregado só ao abrir um campo richText).                                                                                                             |
| 8   | Inferência de tipos profunda  | Configs muito grandes podem estourar o TS. `cms:types` materializa os tipos como escape hatch (implementado no Marco 6), mantendo a inferência como caminho default.                                                                                |
| 9   | Renomear campo                | Só via `db.renames` explícito, incluindo caminhos de filha (`posts.layout.heading`). Sem heurística.                                                                                                                                                |
| 10  | FKs em DDL destrutivo         | Drop de tabela pai com filhas exige ordem inversa e `ON DELETE CASCADE` nas filhas. O plano já ordena; o teste cobre drop de collection inteira.                                                                                                    |
| 11  | `_order` concorrente          | Reordenação usa `_order` esparso (100, 200, 300) e normaliza no write, evitando reescrever a lista inteira a cada drag.                                                                                                                             |

---

## 23. Tenancy e instâncias

### Duas estratégias, um contrato

| `tenancy.strategy`                      | Banco                                  | Escopo                        | Config por tenant                       |
| --------------------------------------- | -------------------------------------- | ----------------------------- | --------------------------------------- |
| `row` (default quando `tenancy` existe) | um schema, `_tenant_id` em toda tabela | toda query inclui o tenant    | só admin/labels/visibilidade            |
| `database`                              | uma conexão por tenant                 | conexão resolvida por request | config completa (pode divergir colunas) |

Sem `tenancy` no config, o CMS é `single`: uma instância, sem coluna e sem resolução. Esse é o
caso "plataforma só minha" e continua sendo o default.

### Uma instância, muitos tenants

O provider registra **uma** instância (`cms`). Instâncias por tenant são facades leves e
memoizadas:

```ts
cms.forTenant('acme'); // mesma config, escopo de dados = acme
cms.forTenant('globex');
cms.current; // instância sem tenant (só válida em `single` ou `database`)
```

`forTenant` não recompila o schema nem abre conexão: em `row` a única coisa que muda é o valor
que vai para `_tenant_id`; em `database` muda a conexão.

### Resolução por domínio/subdomínio

O resolver recebe o contexto do request e é o único lugar que conhece sua topologia:

```ts
tenancy: {
  strategy: 'row',
  resolve: ({ hostname }) => hostname.split('.')[0] ?? null,
}
```

No Adonis, o painel é montado com `router.group(...).domain(...)`; um grupo por padrão de
domínio, cada request resolve o tenant e o `admin_provider` injeta `ctx.cms` escopado:

```ts
// o provider faz isso, não o usuário
router
  .group(() => {
    adminRoutes();
  })
  .domain(':tenant.example.com'); // ou domínios explícitos em admin.domains
```

Se o resolver devolver `null` e `required: true`, a request falha com `CmsForbiddenError` antes
de tocar no banco. `www` e `admin` são ignorados pelo resolver default.

### Isolamento (row)

- Toda tabela — inclusive as filhas de `array`/`blocks` — carrega `_tenant_id`. Filtrar filha
  sem join é o que evita N+1 e vazamento por `EXISTS` mal escrito.
- Toda leitura/escrita do repositório injeta `_tenant_id = <tenant>`; não existe query sem
  escopo no caminho público.
- `unique` vira composto: `(campo, _tenant_id)`. Slug único é único **por tenant**.
- `access` roda **depois** do escopo de tenant e não pode ampliá-lo. `overrideAccess` ignora
  access, nunca tenancy; cruzar tenant exige `allowCrossTenant: true`, aceito apenas em
  contexto server-side explícito (seed, migração, job administrativo).
- Tenant em falta com `required: false` grava `_tenant_id = null` (dado compartilhado), e a
  leitura pública inclui esses documentos.

### Overrides por tenant (row)

```ts
overrides: {
  acme: {
    admin: { title: 'Acme CMS' },
    collections: { only: ['posts'], labels: { posts: { singular: 'Matéria', plural: 'Matérias' } } },
    globals: { only: ['site_settings'] },
  },
}
```

Em `row` o DDL é compartilhado, então override **não pode** adicionar/remover campo: a
validação rejeita `only` com slug inexistente e a config compila uma vez só. Em `database` o
override pode ser um config completo e cada conexão tem seu próprio `SchemaSpec`/migration.

### Banco por tenant (database)

```ts
tenancy: {
  strategy: 'database',
  connection: (tenant) => `tenant_${tenant}`,  // conexão Lucid
}
```

`cms:sync --tenant=acme` aplica o schema naquela conexão; `cms:status --all-tenants` lista
drift por conexão. O caminho de migração (`cms:generate`) emite uma migration que itera as
conexões configuradas, para que um deploy não esqueça um tenant.

### Testes

```ts
const kit = await createTestCms({
  config,
  tenants: ['acme', 'globex'],
});
await kit.actAsTenant('acme');
expect(await kit.cms.collection('posts').find()).toHaveLength(1); // só o doc da acme
```

O kit cria os dois escopos no mesmo SQLite e falha o teste se qualquer query não filtrar
`_tenant_id` (asserção por contagem de queries + plano).

### Riscos

| Item                              | Risco/mitigação                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `_tenant_id` duplicado nas filhas | ocupa espaço; ganha isolamento sem join. Aceito em troca de queries simples.                      |
| Row mode sem schema por tenant    | tenant não pode ter campo próprio; quem precisa usa `database`.                                   |
| Custo operacional de `database`   | N conexões e N migrações; `cms:status` e a migration multi-tenant cobrem o esquecimento.          |
| Resolver default por subdomínio   | domínios de dois níveis (`acme.com.br`) quebram a heurística; configure `resolve` explicitamente. |
| `overrideAccess`                  | documentado como "não cruza tenant"; teste garante que não vaza.                                  |

---

## 24. Convenções de repo

- pnpm workspace + turbo + biome + changesets + vitest, espelhando `adonis-media`.
- `pnpm-workspace.yaml` com `allowBuilds` (better-sqlite3, sharp se usado).
- Todo pacote publicável: `type: module`, `exports` por subpath, `files: [dist, README, CHANGELOG, skills]`.
- `@adonis-agora/cms/commands` exporta `commands.json` + classes.
- CI: `biome check` → `tsc --noEmit` → `vitest` (sqlite) → matriz Postgres 16/17 + MySQL 8.
- Um changeset por marco; `release` via `changeset publish`.
- Docs: `docs/` por tópico (schema, fields, access, hooks, versions, i18n, admin, integrations),
  no formato do `adonis-media/docs`.
