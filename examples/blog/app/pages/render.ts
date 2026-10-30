/**
 * Frontend renderer for CMS documents.
 *
 * This is the `slug → component` map: every block type in `config/cms.ts` has one entry here, and
 * the page emits `data-cms-field` markers using the same path the admin form uses
 * (`layout[0].heading`), so live preview can highlight the region and jump to that field.
 */
type Block = { type?: unknown } & Record<string, unknown>;

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

const mark = (path: string): string => `data-cms-field="${path}"`;

function richTextToHtml(value: unknown): string {
  const doc = (value as { tiptap?: { content?: unknown[] } } | null)?.tiptap;
  const nodes = Array.isArray(doc?.content) ? doc.content : [];
  if (nodes.length === 0) return '';

  return nodes
    .map((node) => {
      const typed = node as { type?: string; content?: unknown[] };
      const text = (typed.content ?? [])
        .map((child) => esc((child as { text?: unknown }).text))
        .join('');

      if (typed.type === 'heading') return `<h2>${text}</h2>`;
      return `<p>${text}</p>`;
    })
    .join('');
}

const button = (label: unknown, href: unknown, tone: 'solid' | 'ghost', path: string): string => {
  if (!label) return '';
  return `<a class="btn btn--${tone}" href="${esc(href || '#')}" ${mark(path)}>${esc(label)}</a>`;
};

const blocks: Record<string, (block: Block, path: string) => string> = {
  hero: (block, path) => `
    <header class="hero">
      ${block.eyebrow ? `<p class="eyebrow" ${mark(`${path}.eyebrow`)}>${esc(block.eyebrow)}</p>` : ''}
      <h1 ${mark(`${path}.heading`)}>${esc(block.heading)}</h1>
      ${block.subheading ? `<p class="lede" ${mark(`${path}.subheading`)}>${esc(block.subheading)}</p>` : ''}
      <div class="actions">
        ${button(block.ctaLabel, block.ctaHref, 'solid', `${path}.ctaLabel`)}
      </div>
    </header>`,

  features: (block, path) => {
    const items = Array.isArray(block.items) ? (block.items as Block[]) : [];

    return `<section class="features">
      ${block.heading ? `<h2 ${mark(`${path}.heading`)}>${esc(block.heading)}</h2>` : ''}
      ${block.intro ? `<p class="section-lede" ${mark(`${path}.intro`)}>${esc(block.intro)}</p>` : ''}
      <div class="cards">
        ${items
          .map(
            (item, index) => `
          <article class="card">
            <span class="card__index">0${index + 1}</span>
            <h3 ${mark(`${path}.items[${index}].title`)}>${esc(item.title)}</h3>
            <p ${mark(`${path}.items[${index}].text`)}>${esc(item.text)}</p>
          </article>`,
          )
          .join('')}
      </div>
    </section>`;
  },

  quote: (block, path) => `
    <blockquote class="quote">
      <p ${mark(`${path}.quote`)}>${esc(block.quote)}</p>
      ${block.attribution ? `<footer ${mark(`${path}.attribution`)}>${esc(block.attribution)}</footer>` : ''}
    </blockquote>`,

  text: (block, path) => `
    <section class="prose">
      ${block.heading ? `<h2 ${mark(`${path}.heading`)}>${esc(block.heading)}</h2>` : ''}
      <div ${mark(`${path}.body`)}>${richTextToHtml(block.body)}</div>
    </section>`,

  cta: (block, path) => `
    <section class="cta">
      <h2 ${mark(`${path}.heading`)}>${esc(block.heading)}</h2>
      ${block.text ? `<p ${mark(`${path}.text`)}>${esc(block.text)}</p>` : ''}
      ${button(block.buttonLabel, block.buttonHref, 'solid', `${path}.buttonLabel`)}
    </section>`,
};

function renderBlocks(value: unknown, field: string): string {
  const rows = Array.isArray(value) ? (value as Block[]) : [];

  return rows
    .map((block, index) => {
      const render = blocks[String(block.type ?? '')];
      // Unknown block types render nothing rather than guessing — the map is the contract.
      if (!render) return '';
      return `<div data-cms-block="${field}[${index}]">${render(block, `${field}[${index}]`)}</div>`;
    })
    .join('');
}

const STYLE = `
:root { color-scheme: dark; --bg: #09090b; --panel: #0c0c0f; --line: #1c1c22;
        --text: #e7e7ea; --muted: #a1a1aa; --accent: #c084fc; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; background: var(--bg); color: var(--text); line-height: 1.65;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
body::before {
  content: ""; position: fixed; inset: 0 0 auto 0; height: 520px; pointer-events: none;
  background: radial-gradient(60% 100% at 50% 0%, rgba(192, 132, 252, 0.16), transparent 70%);
}
main { position: relative; max-width: 1040px; margin: 0 auto; padding: 0 24px 120px; }
h1, h2, h3, p, blockquote, a, header, section, article, div, li { border-radius: 8px; }

.hero { padding: 96px 0 64px; max-width: 780px; }
.eyebrow {
  margin: 0 0 20px; color: var(--accent); font-family: ui-monospace, monospace; font-size: 12px;
  letter-spacing: 0.16em; text-transform: uppercase;
}
.hero h1 {
  margin: 0; font-size: clamp(40px, 6vw, 68px); line-height: 1.04; letter-spacing: -0.035em;
  background: linear-gradient(180deg, #fff 35%, #b9b9c3); -webkit-background-clip: text;
  background-clip: text; color: transparent;
}
.lede { margin: 22px 0 0; max-width: 620px; font-size: 19px; color: var(--muted); }
.actions { display: flex; gap: 12px; margin-top: 34px; }

.btn {
  display: inline-flex; align-items: center; gap: 8px; padding: 11px 20px; border-radius: 999px;
  font-size: 14px; font-weight: 500; text-decoration: none; transition: transform 120ms ease,
  background 120ms ease, border-color 120ms ease;
}
.btn:hover { transform: translateY(-1px); }
.btn--solid { background: var(--accent); color: #180a26; }
.btn--solid:hover { background: #d8b4fe; }
.btn--ghost { border: 1px solid var(--line); color: var(--text); }
.btn--ghost:hover { border-color: #2f2f38; }

.features { padding: 48px 0; border-top: 1px solid var(--line); }
.features h2, .prose h2 {
  margin: 0; font-size: 30px; letter-spacing: -0.02em;
}
.section-lede { margin: 12px 0 0; max-width: 600px; color: var(--muted); }
.cards { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); margin-top: 32px; }
.card {
  padding: 22px; border: 1px solid var(--line); background: var(--panel);
  transition: border-color 140ms ease, transform 140ms ease;
}
.card:hover { border-color: #2c2c35; transform: translateY(-2px); }
.card__index {
  display: block; margin-bottom: 14px; color: var(--accent); font-family: ui-monospace, monospace;
  font-size: 11px; letter-spacing: 0.14em;
}
.card h3 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
.card p { margin: 0; color: var(--muted); font-size: 14.5px; }

.quote {
  margin: 64px 0; padding: 8px 0 8px 26px; border-left: 2px solid var(--accent);
}
.quote p { margin: 0; font-size: clamp(20px, 2.4vw, 27px); line-height: 1.45; letter-spacing: -0.01em; }
.quote footer {
  margin-top: 16px; color: var(--muted); font-family: ui-monospace, monospace;
  font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase;
}

.prose { padding: 48px 0; border-top: 1px solid var(--line); max-width: 680px; }
.prose h2 { margin-bottom: 18px; }
.prose p { margin: 0 0 18px; color: #c9c9d1; font-size: 16.5px; }

.cta {
  margin-top: 40px; padding: 44px; border: 1px solid #2a1c3d; border-radius: 16px;
  background: linear-gradient(140deg, rgba(192, 132, 252, 0.16), rgba(12, 12, 15, 0.9) 55%);
  text-align: center;
}
.cta h2 { margin: 0 0 10px; font-size: 30px; letter-spacing: -0.02em; }
.cta p { margin: 0 auto 26px; max-width: 520px; color: var(--muted); }

.footnote {
  margin-top: 72px; padding-top: 22px; border-top: 1px solid var(--line);
  color: #52525b; font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: 0.1em;
  text-transform: uppercase;
}`;

const shell = (body: string, title: string): string => `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <style>${STYLE}</style>
  </head>
  <body><main>${body}</main></body>
</html>`;

export function renderPage(doc: Record<string, unknown>): string {
  const body = `
    ${renderBlocks(doc.layout, 'layout')}
    <p class="footnote" ${mark('slug')}>/${esc(doc.slug)}</p>`;

  return shell(body, String(doc.title ?? 'Page'));
}

export function renderPost(doc: Record<string, unknown>): string {
  const body = `
    <header class="hero">
      <p class="eyebrow" ${mark('slug')}>${esc(doc.slug)}</p>
      <h1 ${mark('title')}>${esc(doc.title)}</h1>
      ${doc.subtitle ? `<p class="lede" ${mark('subtitle')}>${esc(doc.subtitle)}</p>` : ''}
    </header>
    <section class="prose"><div ${mark('body')}>${richTextToHtml(doc.body)}</div></section>`;

  return shell(body, String(doc.title ?? 'Post'));
}
