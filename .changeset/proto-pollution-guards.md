---
"@adonis-agora/cms": patch
---

Security: the PATCH merge in `update` now ignores `__proto__`, `constructor` and `prototype` keys, so a body parsed with plain `JSON.parse` can no longer swap the merged document's prototype and slip a field (for example a password field denied by `access.update`) past field-level access. Validation only reads a document's own properties, and `setByPath` rejects those reserved path segments and walks own properties only.
