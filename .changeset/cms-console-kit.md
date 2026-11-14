---
"@adonis-agora/cms": minor
"@adonis-agora/cms-admin": minor
---

The admin is now an Agora console, built on the shared console kit: the same sidebar, topbar, ⌘K, light and dark themes and Sora / JetBrains Mono fonts as the other consoles, with an orange accent. The sidebar comes from your collections and globals (Content, one section per `admin.group`, Globals, Media, Settings, Views). `admin.theme.accent` and `admin.theme.logoUrl` still white-label it.

The panel joins the `'agora.consoles'` registry (id `cms`): other consoles list it in their switcher, and their ⌘K finds your documents by title or slug, under the same access rules as the REST API (`GET /api/cms/consoles`, `GET /api/cms/consoles/search`). The sidebar footer shows the signed-in user and a sign-out; set them with the new `admin.viewer` and `admin.signOut` options. With `auth.builtin`, a form POST to the logout endpoint now redirects back to the panel.
