import { toAdminSchema } from '../admin/schema.js';
import type { CmsConfig, CollectionConfig, FieldConfig } from '../config/types.js';
import { resolveVersions } from '../config/types.js';
import type { Cms } from '../local_api/index.js';
import { type CmsRouter, type RegisterCmsRoutesOptions, scopeCmsRequest } from '../rest/routes.js';
import {
  type AgoraConsoleSearchHit,
  type HttpContext,
  listVisibleConsoles,
  otherConsoles,
  readAgoraConsoles,
  registerAgoraConsole,
  searchConsoles,
} from './registry.js';
import {
  type ConsoleSignOut,
  type ConsoleViewer,
  csrfTokenOf,
  resolveSignOut,
  resolveViewer,
  viewerFromUser,
} from './shell.js';

/** The admin's id in the app's `'agora.consoles'` registry. */
export const CMS_CONSOLE_ID = 'cms';

/** The container binding the CMS provider puts its console under, for the admin provider. */
export const CMS_CONSOLE_BINDING = 'cms.console';

/** The console-shell fields of the admin page's JSON data block (`#cms-config`). */
export type CmsShellFields = {
  switcher: { endpoint: string; others: number };
  search?: { endpoint: string };
  viewer?: ConsoleViewer;
  signOut?: ConsoleSignOut;
};

type ContainerLike = {
  hasBinding(binding: string): boolean;
  bindValue(binding: string, value: unknown): void;
  make(binding: string): Promise<unknown>;
};

type JsonContext = {
  request: { qs(): Record<string, unknown> };
  response: {
    header(name: string, value: string): unknown;
    status(code: number): { json(payload: unknown): unknown };
  };
};

export type CmsConsole = {
  readonly id: string;
  /** Where the admin SPA is mounted (`/admin`). */
  readonly adminPath: string;
  /**
   * May this request open the admin? It reads like the panel does: a signed-in principal (any
   * principal outside production) that may read at least one collection or global.
   */
  authorize(ctx: HttpContext): Promise<{ allowed: boolean; reason?: string }>;
  /** Documents whose title or slug contains `q`, as the request's principal may read them. */
  search(ctx: HttpContext, q: string, limit: number): Promise<AgoraConsoleSearchHit[]>;
  /** The data-block fields: switcher, ⌘K search, viewer and sign-out. */
  shellFields(ctx: HttpContext): Promise<CmsShellFields>;
  /** Joins the `'agora.consoles'` registry and mounts `GET {prefix}/consoles` and `/consoles/search`. */
  register(
    container: ContainerLike,
    router: CmsRouter,
    logger?: { warn(m: string): void },
  ): Promise<void>;
};

const TEXTUAL = new Set(['text', 'slug', 'email', 'textarea']);

/** The fields stored as the document's own columns: layout containers (tabs, rows, collapsibles) opened up. */
function columnFields(fields: readonly FieldConfig[]): FieldConfig[] {
  return fields.flatMap((field) => {
    if (field.type === 'tabs') return field.tabs.flatMap((tab) => columnFields(tab.fields));
    if (field.type === 'row' || field.type === 'collapsible') return columnFields(field.fields);
    return [field];
  });
}

/** A non-localized text column the database can match with `icontains`. */
function textColumn(fields: readonly FieldConfig[], name: string | undefined): string | undefined {
  if (!name) return undefined;
  const field = columnFields(fields).find((item) => 'name' in item && item.name === name) as
    | { type: string; localized?: boolean }
    | undefined;
  return field && TEXTUAL.has(field.type) && !field.localized ? name : undefined;
}

function slugColumn(fields: readonly FieldConfig[]): string | undefined {
  const field = columnFields(fields).find(
    (item) => item.type === 'slug' && !('localized' in item && item.localized),
  );
  return field && 'name' in field ? (field.name as string) : undefined;
}

/** 0 = exact, 1 = prefix, 2 = contains (case-insensitive). */
function rank(value: string, needle: string): number {
  const v = value.toLowerCase();
  if (v === needle) return 0;
  return v.startsWith(needle) ? 1 : 2;
}

/**
 * The CMS admin as an Agora console. Everything goes through {@link scopeCmsRequest}, so the gate
 * and the search see exactly what the REST API would show this request: its user, its tenant, its
 * API token and the collections' `access` rules.
 */
export function createCmsConsole(options: {
  cms: Cms<CmsConfig>;
  request: Omit<RegisterCmsRoutesOptions, 'prefix'>;
  inProduction: boolean;
}): CmsConsole {
  const { cms, request } = options;
  const config = cms.config;
  const adminPath = (config.admin?.path ?? '/admin').replace(/\/$/, '') || '/admin';
  const prefix = config.rest?.prefix ?? '/api/cms';
  const builtin = Boolean(
    (config.integrations?.auth as { builtin?: unknown } | undefined)?.builtin,
  );

  const scoped = async (ctx: HttpContext) => {
    try {
      const result = await scopeCmsRequest(cms, ctx, request, {
        write: false,
        operation: 'update',
      });
      return result.ok ? result.cms : null;
    } catch {
      return null;
    }
  };

  const authorize: CmsConsole['authorize'] = async (ctx) => {
    const instance = await scoped(ctx);
    if (!instance) return { allowed: false, reason: 'forbidden' };
    if (!instance.user && options.inProduction)
      return { allowed: false, reason: 'unauthenticated' };
    const schema = await toAdminSchema(instance.config, { user: instance.user });
    const readable = Object.values(schema.permissions).some((permission) => permission.read);
    return readable ? { allowed: true } : { allowed: false, reason: 'forbidden' };
  };

  const search: CmsConsole['search'] = async (ctx, q, limit) => {
    const needle = q.trim().toLowerCase();
    if (needle === '') return [];
    const instance = await scoped(ctx);
    if (!instance) return [];
    const signedIn = Boolean(instance.user);

    const perCollection = await Promise.all(
      (config.collections ?? []).map(async (collection: CollectionConfig) => {
        const title = textColumn(collection.fields, collection.admin?.useAsTitle);
        const slug = slugColumn(collection.fields);
        const columns = [...new Set([title, slug].filter((name): name is string => Boolean(name)))];
        if (columns.length === 0) return [];
        const api = instance.collection(collection.slug as never);
        const query = {
          where: { or: columns.map((column) => ({ [column]: { icontains: needle } })) },
          limit,
          depth: 0,
          ...(collection.timestamps === false ? {} : { sort: '-updatedAt' }),
        };
        // Drafts are only ever handed to a signed-in user, as in the REST API; a user who may not
        // read drafts still finds the published documents.
        const drafts = signedIn && resolveVersions(config, collection.versions).drafts;
        try {
          const found = await (drafts
            ? api.find({ ...query, draft: true }).catch(() => api.find(query))
            : api.find(query));
          const singular = collection.labels?.singular ?? collection.slug;
          return (found.docs as Record<string, unknown>[]).map((doc) => {
            const name = String((title && doc[title]) ?? (slug && doc[slug]) ?? doc.id);
            const slugValue = slug && typeof doc[slug] === 'string' ? (doc[slug] as string) : '';
            return {
              score: Math.min(...columns.map((c) => rank(String(doc[c] ?? ''), needle))),
              updatedAt: String(doc.updatedAt ?? ''),
              hit: {
                title: name,
                subtitle: slugValue && slugValue !== name ? `${singular} · ${slugValue}` : singular,
                href: `${adminPath}#/collections/${encodeURIComponent(collection.slug)}/${encodeURIComponent(String(doc.id))}`,
              },
            };
          });
        } catch {
          // A collection this principal may not read (or a draft read it may not do) has no hits.
          return [];
        }
      }),
    );

    return (
      perCollection
        .flat()
        // Best match first; among equals, the most recently edited.
        .sort((a, b) => a.score - b.score || b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit)
        .map((entry) => entry.hit)
    );
  };

  const viewerOf = async (ctx: HttpContext): Promise<ConsoleViewer | undefined> => {
    if (config.admin?.viewer) return resolveViewer(ctx, config.admin.viewer);
    // The principal the REST API sees: an auth adapter's user, `ctx.auth.user`, or nobody.
    const instance = await scoped(ctx);
    return viewerFromUser(instance?.user) ?? (await resolveViewer(ctx, null));
  };

  const signOutOf = (ctx: HttpContext, registry: unknown): ConsoleSignOut | undefined => {
    // The CMS's own login signs out through its own endpoint (a form POST answers with a redirect).
    if (builtin && config.admin?.signOut === undefined) {
      const csrfToken = csrfTokenOf(ctx);
      return { action: `${prefix}/auth/logout`, ...(csrfToken ? { csrfToken } : {}) };
    }
    return resolveSignOut(ctx, config.admin?.signOut, registry);
  };

  let container: ContainerLike | undefined;

  const shellFields: CmsConsole['shellFields'] = async (ctx) => {
    const registry = container ? await readAgoraConsoles(container) : undefined;
    const viewer = await viewerOf(ctx);
    const signOut = signOutOf(ctx, registry);
    return {
      switcher: { endpoint: `${prefix}/consoles`, others: otherConsoles(registry, CMS_CONSOLE_ID) },
      ...(registry ? { search: { endpoint: `${prefix}/consoles/search` } } : {}),
      ...(viewer ? { viewer } : {}),
      ...(signOut ? { signOut } : {}),
    };
  };

  const register: CmsConsole['register'] = async (target, router, logger) => {
    container = target;
    await registerAgoraConsole(
      target,
      {
        id: CMS_CONSOLE_ID,
        title: config.admin?.title ?? 'CMS',
        package: '@adonis-agora/cms',
        icon: 'cms',
        path: adminPath,
        order: 70,
        authorize,
        search,
      },
      logger,
    );

    const guarded =
      (answer: (ctx: HttpContext & JsonContext) => Promise<unknown>) =>
      async (context: unknown) => {
        const ctx = context as HttpContext & JsonContext;
        ctx.response.header('cache-control', 'private, no-store');
        const decision = await authorize(ctx);
        if (!decision.allowed) {
          const status = decision.reason === 'unauthenticated' ? 401 : 403;
          return ctx.response.status(status).json({
            error: {
              code: status === 401 ? 'CMS_UNAUTHORIZED' : 'CMS_FORBIDDEN',
              message: decision.reason,
            },
          });
        }
        return ctx.response.status(200).json(await answer(ctx));
      };

    router.get(
      `${prefix}/consoles`,
      guarded(async (ctx) =>
        listVisibleConsoles(await readAgoraConsoles(target), CMS_CONSOLE_ID, ctx),
      ),
    );
    router.get(
      `${prefix}/consoles/search`,
      guarded(async (ctx) => {
        const q = ctx.request.qs().q;
        return searchConsoles(
          await readAgoraConsoles(target),
          CMS_CONSOLE_ID,
          ctx,
          typeof q === 'string' ? q : '',
        );
      }),
    );
  };

  return { id: CMS_CONSOLE_ID, adminPath, authorize, search, shellFields, register };
}
