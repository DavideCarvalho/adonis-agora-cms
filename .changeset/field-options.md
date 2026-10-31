---

'@adonis-agora/cms': minor
'@adonis-agora/cms-react': minor
---

Fix `fields.password`, which stored the value in plain text and returned it from every read. It is now
hashed with scrypt and never returned, and `cms.collection(slug).checkPassword(id, field, value)` checks
it. A value already stored by an earlier version stays in plain text until it is set again, and cannot
be checked: set it again.

`validate` now runs on every kind of field and may be async; before, only text, slug and number called
it, and a promise counted as valid. `blocks` respects `minRows` and `maxRows` on write.
`validateDocument` is now async.

The config refuses options that did nothing, so they no longer look like they work: `hooks` on a field,
`withTime`, `language`, `hashWith` and `admin.position`.
