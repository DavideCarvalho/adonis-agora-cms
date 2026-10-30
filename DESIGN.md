# DESIGN

## World

Editorial ink on warm paper. A working desk, not a dashboard: paper stock, ink, one amber
marker. It rejects the category's dark-mode-with-neon-accent and the pastel-SaaS-card look.

## Palette

| Token           | Value     | Use                             |
| --------------- | --------- | ------------------------------- |
| `--ink`         | `#16150F` | primary text, sidebar surface   |
| `--ink-soft`    | `#3A362C` | secondary text                  |
| `--muted`       | `#6F6A5E` | labels, hints (≥4.5:1 on paper) |
| `--paper`       | `#FBF9F5` | app background                  |
| `--surface`     | `#FFFFFF` | panels, inputs                  |
| `--line`        | `#E4DDCF` | hairlines                       |
| `--accent`      | `#A85C12` | primary action, active nav      |
| `--accent-soft` | `#F6E7D3` | active nav fill, badges         |
| `--ok`          | `#2F6B4F` | published                       |
| `--warn`        | `#8A5A00` | draft                           |

## Type

- Display/headings: **Newsreader** (400/600), optical sizing, tracking -0.02em.
- UI/body: **Archivo** (400/500), 13–15px, measure ≤72ch.
- Data (ids, counts, versions): **IBM Plex Mono** 12px, tabular numerals.

## Composition

Fixed 248px sidebar in ink; content column max 1080px with 40px gutters. Hairline separators,
no card-on-card nesting, no shadows except a soft one on overlays (panels, dialogs).

## Components

- Buttons: 32/36px height, 8px radius, ink primary, hairline secondary, no gradients.
- Inputs: white surface, hairline border, 8px radius, amber ring on focus.
- Table: sticky header, 44px rows, hairline row dividers, no zebra.
- Badges: 20px pills, accent-soft/ok/warn tints, never saturated fills.

## Motion

One authored moment: content fades and lifts 6px on route change (180ms, cubic-bezier(.2,.7,.2,1)).
Panels slide 12px. No entrance animation per row.

## Browser surfaces

Custom selection (accent-soft), amber focus-visible ring, thin themed scrollbars, tabular
numerals in tables, underlined link offset.
