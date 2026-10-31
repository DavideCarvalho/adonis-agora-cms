# Access control

Set who can do what on each collection. A rule gets the request's `user`, and may be async.

```ts
import { collection, fields, requiresRole, requiresUser } from '@adonis-agora/cms';

collection('posts', {
  access: {
    read: () => true,
    create: requiresUser,
    update: requiresUser,
    delete: requiresRole('admin'),
  },
  fields: [fields.text('title')],
});
```

A rule that throws fails the operation, so a bug cannot open anything.

## Without a rule

| Environment       | Read | Anonymous write                                                     |
| ----------------- | ---- | ------------------------------------------------------------------- |
| Development, test | Open | Open, so a new app works before it has a login                      |
| Production        | Open | 401, unless the collection has a rule or `rest.publicWrites` is set |

Each operation is checked on its own: a rule for `read` says nothing about `create`. Reads stay public until
you set `read`. A signed-in user with no rule can do everything, so declare the rules when roles matter.

## Per document

For `read`, `update` and `delete` by id, the stored document arrives as `doc`:

```ts
access: {
  read: ({ user, doc }) => (doc ? doc.visibility !== 'private' || Boolean(user) : true),
}
```

`doc` is empty on a list, so return `true` there or use a constraint.

## Only some documents

Return a constraint instead of a boolean, and it becomes part of the query:

```ts
access: {
  read: ({ user }) =>
    user ? true : { field: 'visibility', operator: 'equals', value: 'public' },
}
```

Combine them with `{ and: [...] }` and `{ or: [...] }`.

## Per field

```ts
fields.select('role', {
  options: [{ label: 'Admin', value: 'admin' }],
  access: { update: requiresRole('admin') },
});
```

## With a library

```ts
import { access } from '@adonis-agora/cms';

collection('posts', { access: access.authz('posts'), fields: [] }); // @adonis-agora/authz
collection('posts', { access: { update: access.bouncer(editPost) }, fields: [] }); // @adonisjs/bouncer
```

`access.authz('posts')` checks `posts.read`, `posts.create`, `posts.update` and `posts.delete`, and refuses a
guest. On a field, pass the check too: `access.authz('posts', (user, ability) => authz.can(user, ability))`.

## Your own code

The Local API applies the same rules with the instance's user. `cms.as(user)` scopes it to someone, and
`{ overrideAccess: true }` skips the rules for a job or a seed. It never crosses tenants.
