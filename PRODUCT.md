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

## Pages are documents

A page is a document in a `pages` collection whose `layout` is an ordered list of blocks. The site
owns the `slug → component` map, so only block types the frontend implements are editable, and the
renderer emits the same column paths the form uses (`layout[0].heading`). Access can be decided
per document — `access.read`/`update` receive the stored `doc`, so a page marked private is
invisible by id and a locked page rejects writes.

## Marking what is editable

A page marks its editable regions with `data-cms-field="<field name>"` (the field name in the
document, arrays included: `sections.0.heading`). In live preview the admin outlines those
regions and a click scrolls to the field and focuses it — the page itself says where it can be
changed, so nothing is inferred from markup that the CMS cannot see. For same-origin previews the
bridge is injected; a site on another origin calls `previewBridge()` from
`@adonis-agora/cms-react/preview` on load.

## Editing structured content

Array and blocks rows are cards with a drag handle: drag to reorder, ArrowUp/ArrowDown on a
focused handle to move a step, `admin.isSortable: false` to pin the order. The order on screen is
the order the API stores (the child table carries `_order`), so a drag is a data change, not a
presentation detail.

## Must not change

Data model, REST/SDK contracts, permissions visibility, locale switcher behavior, soft-delete
and version flows. The panel is schema-driven: fields render from the API, never hardcoded.
