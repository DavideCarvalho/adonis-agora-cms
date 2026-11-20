---
"@adonis-agora/cms": minor
"@adonis-agora/cms-react": minor
"@adonis-agora/cms-admin": minor
---

createdAt / updatedAt on everything the CMS owns. Scheduled changes (`cms_document_schedules`) gain nullable `created_at` / `updated_at` columns and `scheduled()` / `schedule()` answer `createdAt` / `updatedAt` (ISO in REST, `null` for a change scheduled before); rescheduling keeps `createdAt`. Password credentials (`cms_auth_credentials`) record `created_at`, and `listApiTokens()` returns each token's `createdAt`. Run `node ace cms:sync` on deploy: production logs schema drift until the columns exist (they are added nullable, no default, no backfill). The admin edit page shows Created / Updated under the title, and the list's Updated date shows the full time on hover.
