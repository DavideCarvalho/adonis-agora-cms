# REST

The provider mounts the surface automatically. Nothing to declare in `start/routes.ts`.

```ts
// config/cms.ts
export default defineConfig({
  rest: {
    enabled: true, // default
    prefix: '/api/cms', // default
  },
});
```

## Routes

| Method   | Path                             |
| -------- | -------------------------------- |
| `GET`    | `/api/cms/collections/:slug`     |
| `POST`   | `/api/cms/collections/:slug`     |
| `GET`    | `/api/cms/collections/:slug/:id` |
| `PATCH`  | `/api/cms/collections/:slug/:id` |
| `DELETE` | `/api/cms/collections/:slug/:id` |
| `GET`    | `/api/cms/globals/:slug`         |
| `PATCH`  | `/api/cms/globals/:slug`         |

List responses use the payload-style envelope:

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

`POST` returns `201`, `DELETE` returns `204` with no body, everything else returns `200`.

## Query string

The wire format is the same one `@adonis-agora/filter` and `filter-client` produce, so the admin
builds these strings with the client package and the API parses them here.

```
?where[status][equals]=published
?where[title][contains]=adonis
?where[views][gte]=10&where[views][lt]=100
?where[status][in]=draft,published
?where[or][0][title][like]=cms&where[or][1][title][like]=adonis
?where[layout.type][equals]=hero
?sort=-publishedAt,title
?limit=10&page=2
?depth=0
?locale=pt-BR
?draft=false
?select=title,slug
```

| Operator                                  | Aliases accepted         |
| ----------------------------------------- | ------------------------ |
| `equals` / `not_equals`                   | `notEquals`              |
| `greater_than` / `greater_than_equal`     | `gt`, `gte`              |
| `less_than` / `less_than_equal`           | `lt`, `lte`              |
| `contains` / `not_contains` / `icontains` | `iContains`              |
| `starts_with` / `ends_with`               | `startsWith`, `endsWith` |
| `in` / `not_in`                           | `notIn`, `isAnyOf`       |
| `like` / `not_like`                       | `notLike`                |
| `is_null` / `is_not_null`                 | `isNull`, `isNotNull`    |

Fields inside arrays and blocks use their logical path (`layout.type`, `tags.label`) and compile
to `exists (...)` subqueries. Prototype-pollution keys (`__proto__`, `constructor`, …) are
dropped before parsing.

## Errors

```json
{
  "error": {
    "code": "CMS_VALIDATION",
    "message": "Validation failed",
    "fields": { "title": "required" }
  }
}
```

| Code                                           | Status |
| ---------------------------------------------- | ------ |
| `CMS_VALIDATION`                               | 422    |
| `CMS_NOT_FOUND`                                | 404    |
| `CMS_FORBIDDEN`                                | 403    |
| `CMS_CONFLICT`                                 | 409    |
| `CMS_CONFIG`, `CMS_SCHEMA`, `CMS_SCHEMA_DRIFT` | 500    |

Unknown errors never leak their message: they become `CMS_INTERNAL`.

## Auth and tenancy per request

The provider resolves the principal from the request, so the same route serves every tenant:

```ts
resolveContext: async (ctx) => {
  const user = ctx.auth?.user ?? null;
  const hostname = ctx.request.hostname();
  const tenant = await tenancy.resolve({ hostname, path: '', request: ctx });
  return { user, tenant };
};
```

In `row` tenancy the tenant comes from `tenancy.resolve` (default: leftmost subdomain). In
`database` tenancy the instance resolves the connection per tenant. With no tenancy configured,
the tenant stays `null` and nothing changes.

Access and hooks run exactly as in the [Local API](./local-api.md) — the route is a translation
layer, not a second implementation.

## Using the handlers directly

The HTTP-shaped handlers are framework-agnostic, which is what makes them testable and lets you
mount them on a custom router:

```ts
import { handleCollectionFind } from '@adonis-agora/cms/rest';

const response = await handleCollectionFind(cms, {
  params: { slug: 'posts' },
  query: { limit: '10' },
  body: undefined,
});
// { status: 200, body: { docs, totalDocs, … } }
```
