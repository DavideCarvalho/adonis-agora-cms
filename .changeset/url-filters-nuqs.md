---
"@adonis-agora/cms-admin": minor
"@adonis-agora/cms-react": minor
---

A collection's list filters now live in the URL, so a filtered view can be shared, bookmarked and reloaded, and back/forward step through it: the search, draft status, option/relation filters, date ranges, sort, page and trash toggle sit in the hash's query (`#/collections/posts?q=launch&status=draft&f=category:news`). A value at its default is left out, so existing links open as before. `DataTable` takes an optional `initialSearch`, so the search box shows a term restored from the URL.
