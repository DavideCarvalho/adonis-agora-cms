# PRODUCT

## What this is

`@adonis-agora/cms` — a config-first CMS for AdonisJS. The admin panel is the surface where a
content editor (not a developer) lists, edits, publishes, restores and previews documents.

## Who uses it, and where

Editors and content leads, several hours a day, in a browser on a laptop, often with a client
or a meeting on the other screen. They are mid-task, not browsing: they arrive knowing the
document they need.

## What success looks like

The document is found in one scan, the form reads top-to-bottom without hunting, and the
publish/restore actions are never a guess. Speed of the third visit matters more than the
delight of the first.

## Surface and mode

Operate. Admin panel at `admin.path` (`/admin`). Design is not the product here — clarity is,
with brand living in precise details (type, rhythm, a single accent).

## Must not change

Data model, REST/SDK contracts, permissions visibility, locale switcher behavior, soft-delete
and version flows. The panel is schema-driven: fields render from the API, never hardcoded.
