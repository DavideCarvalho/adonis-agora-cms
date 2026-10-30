import { readFile } from 'node:fs/promises';
import type { ApplicationService } from '@adonisjs/core/types';

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
  '.map': 'application/json; charset=utf-8',
};

const TEXTUAL = new Set(['.js', '.mjs', '.css', '.html', '.json']);

type RouterLike = {
  get(path: string, handler: (context: unknown) => unknown): unknown;
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
 */
export default class CmsAdminProvider {
  constructor(protected app: ApplicationService) {}

  async boot(): Promise<void> {
    const config = this.app.config.get('cms') as { admin?: { path?: string } } | undefined;
    const basePath = (config?.admin?.path ?? '/admin').replace(/\/$/, '') || '/admin';
    const root = new URL('../spa/', import.meta.url);

    const router = (await this.app.container.make('router')) as RouterLike;

    router.get(`${basePath}/*`, async (context: unknown) => {
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
        ctx.response.header('content-type', 'text/html; charset=utf-8');
        ctx.response.send(html.body);
        return;
      }

      ctx.response.header('content-type', body.contentType);
      ctx.response.send(body.body);
    });
  }
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
