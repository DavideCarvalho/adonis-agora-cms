---
"@adonis-agora/cms": patch
---

Describe the CMS infrastructure for telescope's Architecture page: `media.drive()` and `uploads.drive()` carry their Drive disk (`media files` / `uploads`), and at boot the `cms` config is tagged with the default Lucid connection its documents live in (`content`). Uses the global `Symbol.for('@adonis-agora/stack')`; no dependency on telescope.
