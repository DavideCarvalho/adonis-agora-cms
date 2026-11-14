import { readFile } from 'node:fs/promises';
import type { ApplicationService } from '@adonisjs/core/types';

/** The `createCmsConsole` value `@adonis-agora/cms` binds at `'cms.console'`, read structurally. */
type CmsConsoleLike = {
  shellFields(ctx: unknown): Promise<unknown>;
  register(container: unknown, router: unknown, logger?: unknown): Promise<void>;
};

const CMS_CONSOLE_BINDING = 'cms.console';
/** The id of the page's JSON data block; the SPA reads it with `readShellConfig`. */
export const CONFIG_ELEMENT_ID = 'cms-config';

const BASE_PLACEHOLDER = '/__CMS_ADMIN__/';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};

const TEXTUAL = new Set(['.js', '.mjs', '.css', '.html', '.json']);

type RouterLike = {
  get(path: string, handler: (context: unknown) => unknown): unknown;
};

type ContainerLike = {
  hasBinding(binding: string): boolean;
  make(binding: string): Promise<unknown>;
};

type ContextLike = {
  request: { url(): string };
  response: {
    header(name: string, value: string): void;
    status(code: number): { send(body: unknown): void };
    send(body: unknown): void;
  };
};

/**
 * Serves the built admin SPA.
 *
 * The bundle is built with a placeholder base so the same build mounts under any
 * `admin.path`: the placeholder is rewritten per request, and unknown paths fall back to
 * `index.html` so hash routes survive a reload.
 *
 * The panel is an Agora console: it joins the app's `'agora.consoles'` registry (through the
 * console `@adonis-agora/cms` binds at `'cms.console'`), and every `index.html` carries a JSON data
 * block (`#cms-config`) with the console switcher, ⌘K search, the signed-in viewer and the sign-out.
 */
export default class CmsAdminProvider {
  constructor(protected app: ApplicationService) {}

  async boot(): Promise<void> {
    const config = this.app.config.get('cms') as { admin?: { path?: string } } | undefined;
    const basePath = (config?.admin?.path ?? '/admin').replace(/\/$/, '') || '/admin';
    const root = new URL('../spa/', import.meta.url);

    const router = (await this.app.container.make('router')) as RouterLike;
    const container = this.app.container as unknown as ContainerLike;

    // The CMS provider binds its console during its own boot; join the registry once every
    // provider has booted, whatever their order in adonisrc.
    this.app.booted(async () => {
      if (!container.hasBinding(CMS_CONSOLE_BINDING)) return;
      const cmsConsole = (await container.make(CMS_CONSOLE_BINDING)) as CmsConsoleLike;
      let logger: unknown;
      try {
        logger = await container.make('logger');
      } catch {
        logger = undefined;
      }
      await cmsConsole.register(this.app.container, router, logger);
    });

    const page = async (context: unknown, html: string): Promise<string> => {
      if (!container.hasBinding(CMS_CONSOLE_BINDING)) return html;
      try {
        const cmsConsole = (await container.make(CMS_CONSOLE_BINDING)) as CmsConsoleLike;
        return injectDataBlock(html, await cmsConsole.shellFields(context));
      } catch {
        // The shell fields are extras: without them the panel still works, minus switcher and footer.
        return html;
      }
    };

    const serve = async (context: unknown) => {
      const ctx = context as ContextLike;
      const url = ctx.request.url().split('?')[0] ?? '';
      const relative = url.startsWith(basePath) ? url.slice(basePath.length) : url;
      const file = relative === '' || relative === '/' ? '/index.html' : relative;

      const body = await readSpaFile(root, file, basePath);
      if (!body) {
        const html = await readSpaFile(root, '/index.html', basePath);
        if (!html) {
          ctx.response
            .status(404)
            .send('Admin bundle not built. Run `pnpm --filter @adonis-agora/cms-admin build`.');
          return;
        }
        sendPage(ctx, await page(context, String(html.body)));
        return;
      }

      if (file === '/index.html') {
        sendPage(ctx, await page(context, String(body.body)));
        return;
      }
      ctx.response.header('content-type', body.contentType);
      ctx.response.send(body.body);
    };

    router.get(basePath, serve);
    router.get(`${basePath}/*`, serve);
  }
}

/** The page carries the viewer and a CSRF token: never cache it. */
function sendPage(ctx: ContextLike, html: string): void {
  ctx.response.header('content-type', 'text/html; charset=utf-8');
  ctx.response.header('cache-control', 'no-store, must-revalidate');
  ctx.response.send(html);
}

/**
 * Adds the console's JSON data block before `</head>`. A `type="application/json"` script is data,
 * not code, so a CSP that drops un-nonced scripts leaves it alone. `<`, `>` and `&` are escaped so
 * no value can close the element.
 */
export function injectDataBlock(html: string, fields: unknown): string {
  const json = JSON.stringify(fields ?? {})
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const block = `<script type="application/json" id="${CONFIG_ELEMENT_ID}">${json}</script>`;
  return html.includes('</head>')
    ? html.replace('</head>', () => `${block}</head>`)
    : `${block}${html}`;
}

async function readSpaFile(
  root: URL,
  file: string,
  basePath: string,
): Promise<{ body: string | Uint8Array; contentType: string } | null> {
  const normalized = file.replace(/^\/+/, '');
  if (normalized.includes('..')) return null;

  const extension = normalized.slice(normalized.lastIndexOf('.'));
  const target = new URL(normalized || 'index.html', root);

  try {
    const buffer = await readFile(target);
    const contentType = CONTENT_TYPES[extension] ?? 'application/octet-stream';

    if (!TEXTUAL.has(extension)) return { body: buffer, contentType };

    const text = buffer.toString('utf8').split(BASE_PLACEHOLDER).join(`${basePath}/`);
    return { body: text, contentType };
  } catch {
    return null;
  }
}
