# DESIGN

## World

An Agora console, tuned for people who edit content rather than operate servers. It shares the
Aviary tokens with the media, telescope and durable consoles; violet is the CMS accent. Dark by
default with a persisted light theme.

## Palette

The Aviary tokens live at the top of `packages/admin/src/app/styles.css`. On top of them the CMS adds
`--text-2` (labels and secondary text, >=4.5:1 on panels; `--muted` is too dim for small text),
`--line-strong` (control borders), `--on-accent` and `--shadow`.

The accent marks the primary action, the current selection and focus. It is the only solid fill on a
screen, apart from a destructive confirmation.

## Type

- UI and headings: **Geist**, 13-14px, sentence case. Page titles 22px, 600.
- Data (slugs, counts, versions): **JetBrains Mono**. Never for labels or buttons.
- Both are bundled, so the panel depends on no font CDN.

## Composition

224px sidebar, content up to 1160px, forms up to 860px. The edit header is sticky. The visual editor
takes the full window: the sidebar goes away and the page sits between "on this page" and the fields.
Hairline separators, no card inside a card, shadows only on overlays.

## Components

- Buttons: 26/30/34px, 7px radius. Icon-only actions carry `aria-label` and `title`; icons are lucide.
- Inputs: 36px minimum, strong hairline, accent ring on focus.
- Table: 46px rows, whole row opens the document, row actions appear on hover or focus.
- Badges: 22px pills with a soft tint, never saturated fills.
- Confirmation: one native `<dialog>`, only for things that lose data.

## Live preview

The page reads as the page: no permanent outlines. Only the block under the pointer shows its
toolbar, and the selected block keeps a solid outline.

## Motion

Content lifts 4px on route change, panels slide 12px, both 180ms. Reduced motion is respected.
