---
'@adonis-agora/cms': minor
'@adonis-agora/cms-admin': minor
---

The CMS registers in the `agora.consoles` registry with its own `cms` icon (was `generic`), and the `agora.consoles` registry accepts the `flags` and `cms` icon keys, so those consoles show their own tile instead of `generic`. The admin: the console switcher shows the CMS console with its own orange tile and glyph, and the kit gains a 16px `DocumentIcon`; the collapsible nav section toggle has a test pinning its focus ring (Agora console kit round 3).
