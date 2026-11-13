import { readFile } from 'node:fs/promises';
import { BaseCommand, flags } from '@adonisjs/core/ace';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import { resolveApiToken } from '../auth/api_tokens.js';
import type { CmsConfig } from '../config/types.js';
import { resolveTenancy } from '../config/types.js';
import { cmsDevTools } from '../dev_tools/tools.js';
import type { Cms } from '../local_api/index.js';
import type { RestRequest, RestResponse } from '../rest/handlers.js';
import { type RouteContext, scopeCmsRequest, type WriteOperation } from '../rest/routes.js';

/** What a command is about to do, for the write guard (the same shape the REST routes pass). */
export type CmsCall =
  | { write: false; slug?: string }
  | {
      write: true;
      slug: string;
      operation: WriteOperation;
    };

/** A refused call, as the REST route would answer it: `403 CMS_FORBIDDEN: token is read-only`. */
export class CmsCliRefusal extends Error {}

/** A REST error body as one line: status, code, message and the invalid fields. */
export function describeRefusal(response: RestResponse): string {
  const error = (
    response.body as { error?: { code?: unknown; message?: unknown; fields?: unknown } } | null
  )?.error;
  const message = typeof error?.message === 'string' ? error.message : 'refused';
  const code = typeof error?.code === 'string' ? ` ${error.code}` : '';
  const fields =
    error?.fields && typeof error.fields === 'object'
      ? ` (${Object.entries(error.fields as Record<string, unknown>)
          .map(([field, problem]) => `${field}: ${String(problem)}`)
          .join(', ')})`
      : '';
  return `${response.status}${code}: ${message}${fields}`;
}

/** A JSON-object flag: inline JSON, or `@path/to/file.json`. */
export async function jsonObjectFlag(
  value: string,
  name: string,
): Promise<Record<string, unknown>> {
  const text = value.startsWith('@') ? await readFile(value.slice(1), 'utf8') : value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CmsCliRefusal(`--${name} must be JSON (inline, or @file.json)`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CmsCliRefusal(`--${name} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Base for the content commands (`cms:collections:*`, `cms:documents:*`, `cms:versions:*`,
 * `cms:globals:*`). Each runs the REST handler its route runs, on the CMS instance
 * `scopeCmsRequest` picks, so access rules, hooks, validation, drafts, versions and tenancy are
 * the same as over REST and on `/mcp/agora`.
 *
 * Who a command acts as:
 * - `--token` (or `CMS_API_TOKEN`): a CMS API token, exactly like `Authorization: Bearer` over
 *   REST. Its tenant is bound; writes need its `write` ability; `--tenant` needs `tenant:switch`.
 * - `--as-system`: no principal. Access rules still run (with no user), only the production
 *   "sign in to write" guard is lifted. Never bypasses an access rule or tenancy.
 * - neither: reads run as an anonymous REST request; writes are refused.
 */
export abstract class CmsContentCommand extends BaseCommand {
  static override options: CommandOptions = { startApp: true };

  @flags.string({ description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)' })
  declare token?: string;

  @flags.boolean({
    description:
      'Write with no principal: access rules run with no user (needs no token); refused without it',
  })
  declare asSystem?: boolean;

  @flags.string({ description: 'Tenant (with a token: needs its tenant:switch ability)' })
  declare tenant?: string;

  @flags.boolean({ description: 'Print JSON' })
  declare json?: boolean;

  /** A refusal is one error line and exit code 1; programming errors keep their stack. */
  override async completed() {
    const error = this.error as unknown;
    if (
      error instanceof Error &&
      !(error instanceof TypeError) &&
      !(error instanceof ReferenceError) &&
      !(error instanceof SyntaxError)
    ) {
      this.logger.error(error.message);
      this.exitCode = 1;
      return true;
    }
    return false;
  }

  /** The app's CMS (the instance `@adonis-agora/cms/services/main` returns). */
  protected async cms(): Promise<Cms<CmsConfig>> {
    const container = this.app.container as unknown as {
      hasBinding(name: string): boolean;
      make(name: string): Promise<unknown>;
    };
    if (!container.hasBinding('cms')) {
      throw new CmsCliRefusal('the CMS is not booted in this app (is config/cms.ts there?)');
    }
    return (await container.make('cms')) as Cms<CmsConfig>;
  }

  /**
   * Run one of the content-model tools of the `/mcp/agora` hub (`cms_list_collections`,
   * `cms_get_collection`): they read the config only, so they need no principal.
   */
  protected async modelTool(
    name: 'cms_list_collections' | 'cms_get_collection',
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const cms = await this.cms();
    const tool = cmsDevTools({ cms, request: {} }).find((item) => item.name === name);
    if (!tool) throw new Error(`missing dev tool ${name}`);
    try {
      return (await tool.run(input, {
        ctx: undefined,
        caller: { id: 'cli', via: 'open' },
        limits: { maxRows: 100, maxBytes: Number.POSITIVE_INFINITY },
      })) as Record<string, unknown>;
    } catch (error) {
      throw new CmsCliRefusal(error instanceof Error ? error.message : String(error));
    }
  }

  private tokenValue(): string | undefined {
    const token = this.token ?? process.env.CMS_API_TOKEN;
    return token !== undefined && token !== '' ? token : undefined;
  }

  /** The CMS instance this call acts as, or the refusal REST would answer. */
  protected async scoped(call: CmsCall): Promise<Cms<CmsConfig>> {
    const cms = await this.cms();
    const token = this.tokenValue();
    if (token !== undefined && this.asSystem) {
      throw new CmsCliRefusal('pass --token or --as-system, not both');
    }
    if (call.write && token === undefined && !this.asSystem) {
      throw new CmsCliRefusal(
        'writes need an actor: --token <CMS API token with the write ability> (or CMS_API_TOKEN), or --as-system',
      );
    }
    const tenant = this.tenant !== undefined && this.tenant !== '' ? this.tenant : undefined;
    if (
      call.write &&
      token === undefined &&
      tenant === undefined &&
      resolveTenancy(cms.config).strategy !== 'single'
    ) {
      throw new CmsCliRefusal('this CMS is multi-tenant: --as-system writes need --tenant');
    }
    const headers: Record<string, string> = {};
    if (token !== undefined) {
      headers.authorization = `Bearer ${token}`;
      if (tenant !== undefined) headers['x-cms-tenant'] = tenant;
    }
    const ctx = {
      request: { headers: () => headers, hostname: () => '' },
    } as unknown as RouteContext;
    const result = await scopeCmsRequest(
      cms,
      ctx,
      {
        // Without a principal only `--as-system` reaches a write (checked above), and it lifts
        // exactly this guard.
        requireUserForWrites: !this.asSystem,
        // An unknown or expired token is refused here: REST would carry on anonymously, a
        // command that was handed a token must not.
        resolveToken: async (value) => {
          const principal = await resolveApiToken(cms.repoContext(), value);
          if (principal === null) {
            throw new CmsCliRefusal('401 CMS_UNAUTHORIZED: unknown or expired CMS API token');
          }
          return principal;
        },
        resolveContext: async () => ({ user: null, ...(tenant !== undefined ? { tenant } : {}) }),
      },
      call.write
        ? { write: true, slug: call.slug, operation: call.operation }
        : { write: false, slug: call.slug, operation: 'update' },
    );
    if (!result.ok) throw new CmsCliRefusal(describeRefusal(result));
    return result.cms;
  }

  /** Run one REST handler as this command's actor: its body, or a refusal. */
  protected async rest(
    call: CmsCall,
    handler: (cms: Cms<CmsConfig>, request: RestRequest) => Promise<RestResponse>,
    request: Partial<RestRequest>,
  ): Promise<unknown> {
    const cms = await this.scoped(call);
    const response = await handler(cms, {
      params: request.params ?? {},
      query: request.query ?? {},
      body: request.body,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new CmsCliRefusal(describeRefusal(response));
    }
    return response.body;
  }

  protected printJson(value: unknown): void {
    this.logger.log(JSON.stringify(value, null, 2));
  }

  /**
   * Destructive actions ask first. `--force` skips the question; without a terminal (CI, a pipe)
   * nobody can answer, so the command refuses unless `--force`.
   */
  protected async confirmed(force: boolean | undefined, question: string): Promise<boolean> {
    if (force) return true;
    if (process.stdin.isTTY !== true) {
      throw new CmsCliRefusal(`${question.replace(/\?$/, '')}: needs confirmation, pass --force`);
    }
    if (await this.prompt.confirm(question)) return true;
    this.logger.warning('cancelled');
    this.exitCode = 1;
    return false;
  }

  /** Rows as a table of the given columns. */
  protected table(rows: readonly Record<string, unknown>[], columns: readonly string[]): void {
    if (rows.length === 0) {
      this.logger.info('nothing to show');
      return;
    }
    const table = this.ui.table();
    table.head([...columns]);
    for (const row of rows) table.row(columns.map((column) => cell(row[column])));
    table.render();
  }

  /** One document: its scalar fields as a Field/Value table. */
  protected document(doc: Record<string, unknown>): void {
    const table = this.ui.table();
    table.head(['Field', 'Value']);
    for (const [key, value] of Object.entries(doc)) table.row([key, cell(value)]);
    table.render();
  }
}

/** One table cell: dates as ISO, objects as compact JSON, long text cut. */
export function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}
