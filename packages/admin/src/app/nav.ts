import type {
  AdminCollection,
  AdminField,
  AdminSchema,
  CmsMessages,
} from '@adonis-agora/cms-react';
import type { Route } from './hash-route.js';

/** The kinds of sidebar entry; the shell picks an icon per kind. */
export type NavKind = 'dashboard' | 'collection' | 'global' | 'media' | 'users' | 'view';

export type NavEntry = { id: string; label: string; kind: NavKind; route: Route };
export type NavGroup = { section: string; items: NavEntry[] };

/** Section labels cms-react's messages do not carry. */
const EXTRA_LABELS = {
  en: { media: 'Media', settings: 'Settings' },
  'pt-BR': { media: 'Mídia', settings: 'Configurações' },
} as const;

export function extraLabels(locale: string): { media: string; settings: string } {
  return locale.toLowerCase().startsWith('pt') ? EXTRA_LABELS['pt-BR'] : EXTRA_LABELS.en;
}

/** The nav id of a route (what `AppShell.activeId` compares against). */
export function navIdOf(route: Route): string {
  if (route.view === 'dashboard') return 'dashboard';
  if (route.view === 'global') return `g:${route.slug}`;
  if (route.view === 'custom') return `v:${route.slug}`;
  return `c:${route.slug}`;
}

function uploadTargets(fields: readonly AdminField[], into: Set<string>): void {
  for (const field of fields) {
    if (field.type === 'upload' && typeof field.relationTo === 'string') into.add(field.relationTo);
    if (field.fields) uploadTargets(field.fields, into);
    for (const block of field.blocks ?? []) uploadTargets(block.fields, into);
    for (const tab of field.tabs ?? []) uploadTargets(tab.fields, into);
  }
}

/**
 * The collections `upload` fields point at (the media library), anywhere in any collection or
 * global, plus a collection literally called `media`.
 */
export function mediaSlugs(schema: AdminSchema): Set<string> {
  const slugs = new Set<string>();
  for (const item of [...schema.collections, ...schema.globals]) uploadTargets(item.fields, slugs);
  if (schema.collections.some((item) => item.slug === 'media')) slugs.add('media');
  return slugs;
}

const plural = (item: AdminCollection) => item.labels?.plural ?? item.slug;
const singular = (item: AdminCollection) => item.labels?.singular ?? item.slug;

/**
 * The sidebar, from the app's schema:
 * - CONTENT: the dashboard, then one entry per collection without an admin `group`;
 * - one section per admin `group`, in the order the groups first appear;
 * - GLOBALS: one entry per global;
 * - MEDIA: the collections `upload` fields point at;
 * - SETTINGS: the users collection (the CMS's own auth collection, else `users`);
 * - VIEWS: what the app's extensions registered.
 * A section with no entries is hidden by the shell.
 */
export function buildNav(
  schema: AdminSchema,
  views: readonly { id: string; label: string }[],
  t: Pick<CmsMessages, 'content' | 'dashboard' | 'globals' | 'views'>,
  locale: string,
): NavGroup[] {
  const extra = extraLabels(locale);
  const media = mediaSlugs(schema);
  const usersSlug = schema.admin.auth?.collection ?? 'users';

  const content: NavEntry[] = [
    {
      id: 'dashboard',
      label: t.dashboard,
      kind: 'dashboard',
      route: { view: 'dashboard', slug: '' },
    },
  ];
  const groups = new Map<string, NavEntry[]>();
  const mediaItems: NavEntry[] = [];
  const settings: NavEntry[] = [];

  for (const item of schema.collections) {
    const entry = (kind: NavKind): NavEntry => ({
      id: `c:${item.slug}`,
      label: plural(item),
      kind,
      route: { view: 'list', slug: item.slug },
    });
    if (media.has(item.slug)) {
      mediaItems.push(entry('media'));
      continue;
    }
    if (item.slug === usersSlug) {
      settings.push(entry('users'));
      continue;
    }
    const group = item.admin?.group?.trim();
    if (!group) {
      content.push(entry('collection'));
      continue;
    }
    groups.set(group, [...(groups.get(group) ?? []), entry('collection')]);
  }

  return [
    { section: t.content, items: content },
    ...[...groups.entries()].map(([section, items]) => ({ section, items })),
    {
      section: t.globals,
      items: schema.globals.map((item) => ({
        id: `g:${item.slug}`,
        label: singular(item),
        kind: 'global' as const,
        route: { view: 'global', slug: item.slug } as Route,
      })),
    },
    { section: extra.media, items: mediaItems },
    { section: extra.settings, items: settings },
    {
      section: t.views,
      items: views.map((view) => ({
        id: `v:${view.id}`,
        label: view.label,
        kind: 'view' as const,
        route: { view: 'custom', slug: view.id } as Route,
      })),
    },
  ];
}

/** The topbar title of a route. */
export function titleOf(
  route: Route,
  schema: AdminSchema,
  t: Pick<CmsMessages, 'dashboard'>,
  viewLabel?: string,
): string {
  if (route.view === 'dashboard') return t.dashboard;
  if (route.view === 'custom') return viewLabel ?? route.slug;
  if (route.view === 'global') {
    const global = schema.globals.find((item) => item.slug === route.slug);
    return global ? singular(global) : route.slug;
  }
  const collection = schema.collections.find((item) => item.slug === route.slug);
  if (!collection) return t.dashboard;
  return route.view === 'list' ? plural(collection) : singular(collection);
}
