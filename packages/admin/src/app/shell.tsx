import { type AdminSchema, useCms, useMessages, VIEW_REGISTRY } from '@adonis-agora/cms-react';
import { type ReactNode, useMemo } from 'react';
import { ErrorBoundary } from '../agora-kit/blocks/error-boundary';
import { GridIcon, UsersIcon } from '../agora-kit/icons';
import { AppShell, type ConsoleBrand, type NavSection } from '../agora-kit/shell/app-shell';
import type { SearchCommand } from '../agora-kit/shell/console-search';
import type { AgoraShellConfig } from '../agora-kit/shell-config';
import { href, type Route } from './hash-route.js';
import { CmsMark, DocumentsIcon, GlobeIcon, ImageIcon, PuzzleIcon } from './icons.js';
import { buildNav, type NavKind, navIdOf, titleOf } from './nav.js';

const ICONS: Record<NavKind, ReactNode> = {
  dashboard: <GridIcon />,
  collection: <DocumentsIcon />,
  global: <GlobeIcon />,
  media: <ImageIcon />,
  users: <UsersIcon />,
  view: <PuzzleIcon />,
};

/**
 * The CMS inside the Agora console shell: the sidebar comes from the app's collections and
 * globals (see `buildNav`), ⌘K jumps to any of them and searches documents on the server, and the
 * brand is the app's (`admin.title`, `admin.theme.logoUrl`).
 */
export function CmsShell({
  schema,
  route,
  shell,
  onNavigate,
  children,
}: {
  schema: AdminSchema;
  route: Route;
  shell: AgoraShellConfig;
  onNavigate: (route: Route) => void;
  children: ReactNode;
}) {
  const t = useMessages();
  const { locale } = useCms();
  const views = [...VIEW_REGISTRY.values()];
  const viewKey = views.map((view) => view.id).join('|');

  // biome-ignore lint/correctness/useExhaustiveDependencies: the registry is read through `viewKey`
  const groups = useMemo(
    () => buildNav(schema, [...VIEW_REGISTRY.values()], t, locale),
    [schema, t, locale, viewKey],
  );

  const nav = useMemo<NavSection[]>(
    () =>
      groups.map((group) => ({
        section: group.section,
        items: group.items.map((entry) => ({
          id: entry.id,
          label: entry.label,
          icon: ICONS[entry.kind],
          href: href(entry.route),
          onSelect: () => onNavigate(entry.route),
        })),
      })),
    [groups, onNavigate],
  );

  const commands = useMemo<SearchCommand[]>(
    () =>
      groups.flatMap((group) =>
        group.items.map((entry) => ({
          id: entry.id,
          label: entry.label,
          group: group.section,
          icon: ICONS[entry.kind],
          keywords: [entry.route.slug, group.section],
          onSelect: () => onNavigate(entry.route),
        })),
      ),
    [groups, onNavigate],
  );

  const logoUrl = schema.admin.theme?.logoUrl;
  const brand: ConsoleBrand = {
    name: schema.admin.title,
    subtitle: t.content,
    mark: logoUrl ? <img src={logoUrl} alt="" className="size-4 object-contain" /> : <CmsMark />,
    current: { title: schema.admin.title, package: '@adonis-agora/cms', icon: 'generic' },
  };

  const view = route.view === 'custom' ? VIEW_REGISTRY.get(route.slug) : undefined;
  const title = titleOf(route, schema, t, view?.label);

  return (
    <AppShell
      brand={brand}
      nav={nav}
      activeId={navIdOf(route)}
      shell={shell}
      title={title}
      commands={commands}
      searchPlaceholder={t.jumpTo}
    >
      <ErrorBoundary label={title} resetKeys={[href(route)]}>
        {children}
      </ErrorBoundary>
    </AppShell>
  );
}
