---

"@adonis-agora/cms": patch
"@adonis-agora/cms-admin": patch
---

Security: REST routes never saw the HTTP method on a real Adonis context, so read-only API tokens could write.
In production, an anonymous write or upload to a collection with no `access` rule is now refused
(`rest.publicWrites` allows it). `node ace add` now configures both packages, and removing a field no longer
stops the app in development.
