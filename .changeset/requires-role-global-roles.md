---
'@adonis-agora/cms': minor
---

`requiresRole` also matches authkit's `globalRoles` and a `roles` array, not only `user.role`, so `requiresRole('ADMIN')` works with an authkit identity user (in-process or remote authkit). The `authkitAuth` comment no longer refers to the removed `authkit_middleware`.
