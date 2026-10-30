import { readFile } from 'node:fs/promises';
import type { ApplicationService } from '@adonisjs/core/types';
import { resolveApiToken } from '../src/auth/api_tokens.js';
import type { CmsConfig } from '../src/config/types.js';
import { resolveDbConfig, resolveTenancy } from '../src/config/types.js';
import { validateConfig } from '../src/config/validate.js';
import { detectEngine, readSchemaState, syncCmsSchema } from '../src/db/sync.js';
import type { CmsKnex } from '../src/db/types.js';
import { CmsConfigError } from '../src/errors.js';
import { createCms } from '../src/local_api/index.js';
import type { CmsRouter, RouteContext } from '../src/rest/routes.js';
import { registerCmsRoutes } from '../src/rest/routes.js';
import { compileSchema } from '../src/schema/compile.js';

type LucidDatabase = {
  connection(name?: string): { getWriteClient(): unknown };
};

type UploadRouteContext = {
  request: {
    qs?(): Record<string, unknown>;
    headers?(): Record<string, string>;
    file(name: string): {
      clientName: string;
      size?: number;
      type?: string;
      headers?: Record<string, string>;
      tmpPath?: string;
      toBuffer?: () => Promise<Buffer>;
    } | null;
  };
  response: {
    status(code: number): { json(payload: unknown): unknown };
  };
};

function matchesMime(mimeType: string, accepted: readonly string[]): boolean {
  return accepted.some((pattern) =>
    pattern.endsWith('/*') ? mimeType.startsWith(pattern.slice(0, -1)) : pattern === mimeType,
  );
}

/**
 * Wires the CMS into the app.
 *
 * - validates the config at boot;
 * - registers the REST routes when `rest.enabled !== false`;
 * - in `managed` mode applies the schema in development/test and only reports drift in
 *   production — DDL never runs silently against a production database.
 */
export default class CmsProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    const container = this.app.container as unknown as {
      singleton(name: string, factory: () => unknown): void;
    };
    container.singleton('cms.config', () => this.app.config.get('cms'));
  }

  async boot(): Promise<void> {
    const config = this.app.config.get('cms') as CmsConfig | undefined;
    if (!config) return;

    const errors = validateConfig(config);
    if (errors.length > 0) {
      throw new CmsConfigError(
        'config',
        `invalid CMS configuration:\n${errors.map((error) => `  - ${error.message}`).join('\n')}`,
      );
    }

    const database = (await this.app.container.make('lucid.db')) as LucidDatabase;
    const client = database.connection().getWriteClient() as CmsKnex;
    const engine = detectEngine(client);
    const spec = compileSchema(config, { engine });
    const cms = createCms({ config, client, engine });

    if (config.rest?.enabled !== false) {
      await this.registerRoutes(config, cms);
    }

    if (config.uploads) {
      await this.registerUploadRoute(config, cms);
    }

    if (resolveDbConfig(config).schema !== 'managed') return;

    if (this.app.inProduction) {
      const state = await readSchemaState(client, spec.tablePrefix);
      if (state?.hash !== spec.hash) {
        const logger = await this.app.container.make('logger');
        (logger as { error(message: string): void }).error(
          'cms: schema drift detected. Run `node ace cms:sync` before serving traffic.',
        );
      }
      return;
    }

    await syncCmsSchema(client, spec, { engine });
  }

  /**
   * `POST {prefix}/uploads` — the endpoint behind the admin's upload dropzone.
   *
   * The provider normalizes the Adonis multipart file into `CmsUploadFile` and hands it to
   * `config.uploads.handler`, so the handler never depends on `@adonisjs/core`. Files are read
   * into memory: uploads here are assets (images, PDFs), not streamed archives.
   */
  private async registerUploadRoute(
    config: CmsConfig,
    cms: ReturnType<typeof createCms>,
  ): Promise<void> {
    const router = (await this.app.container.make('router')) as CmsRouter;
    const prefix = config.rest?.prefix ?? '/api/cms';
    const uploads = config.uploads;

    if (!uploads) return;

    router.post(`${prefix}/uploads`, async (context) => {
      const ctx = context as UploadRouteContext;
      const write = ctx.response.status(403);

      const authorization = ctx.request.headers?.().authorization ?? '';
      const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
      const principal = bearer ? await resolveApiToken(cms.repoContext(), bearer) : null;

      if (principal && !principal.abilities.includes('write')) {
        write.json({ error: { code: 'CMS_FORBIDDEN', message: 'token is read-only' } });
        return;
      }

      const file = ctx.request.file('file');
      if (!file) {
        ctx.response.status(400).json({
          error: {
            code: 'CMS_UPLOAD_MISSING',
            message:
              'expected a "file" part: let the bodyparser auto-process multipart on this route (config/bodyparser.ts → multipart.autoProcess includes the uploads path)',
          },
        });
        return;
      }

      // Adonis reports the part's type as `image` (top level) in `file.type`; the full value with
      // the subtype lives in the part headers.
      const mimeType =
        (file.headers?.['content-type'] ?? '').split(';')[0]?.trim() ||
        file.type ||
        'application/octet-stream';
      const size = file.size ?? 0;

      if (uploads.maxSize && size > uploads.maxSize) {
        ctx.response.status(413).json({
          error: { code: 'CMS_UPLOAD_TOO_LARGE', message: `file exceeds ${uploads.maxSize} bytes` },
        });
        return;
      }

      if (uploads.mimeTypes?.length && !matchesMime(mimeType, uploads.mimeTypes)) {
        ctx.response.status(415).json({
          error: {
            code: 'CMS_UPLOAD_UNSUPPORTED',
            message: `${mimeType} is not an accepted type`,
          },
        });
        return;
      }

      const contents =
        typeof file.toBuffer === 'function'
          ? await file.toBuffer()
          : await readFile(file.tmpPath ?? '');

      const asset = await uploads.handler(
        { filename: file.clientName, mimeType, size, contents },
        {
          field: String(ctx.request.qs?.().field ?? ''),
          collection: String(ctx.request.qs?.().collection ?? ''),
        },
      );

      ctx.response.status(201).json(asset);
    });
  }

  private async registerRoutes(
    config: CmsConfig,
    cms: ReturnType<typeof createCms>,
  ): Promise<void> {
    const router = (await this.app.container.make('router')) as CmsRouter;
    const tenancy = resolveTenancy(config);

    registerCmsRoutes(router, cms, {
      prefix: config.rest?.prefix ?? '/api/cms',
      resolveToken: (token) => resolveApiToken(cms.repoContext(), token),
      resolveLocale: (context) => {
        const i18n = (context as { i18n?: { locale?: string } }).i18n;
        return i18n?.locale;
      },
      resolveContext: async (context: RouteContext) => {
        const user = (context as { auth?: { user?: unknown } }).auth?.user ?? null;
        const hostname = context.request.hostname?.() ?? '';

        const tenant =
          tenancy.strategy === 'single'
            ? null
            : await tenancy.resolve({ hostname, path: '', request: context });

        return { user, tenant };
      },
    });
  }
}
