import {
  type AdminCollection,
  type AdminDocument,
  type AdminSchema,
  useCms,
  useMessages,
  WIDGET_REGISTRY,
} from '@adonis-agora/cms-react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '../agora-kit/blocks/empty-state';
import { ErrorBoundary } from '../agora-kit/blocks/error-boundary';
import { MetricCard, MetricGrid, MetricGridSkeleton } from '../agora-kit/blocks/metric-card';
import { PageHeader } from '../agora-kit/blocks/page-header';
import { Panel } from '../agora-kit/blocks/panel';
import { QueryBoundary } from '../agora-kit/blocks/query-boundary';
import { InboxIcon } from '../agora-kit/icons';
import { PageBody } from '../agora-kit/shell/app-shell';
import { Skeleton } from '../agora-kit/ui/skeleton';
import type { Route } from './hash-route.js';

type Navigate = (route: Route) => void;
type Count = { collection: AdminCollection; total: number | null };
type RecentRow = { doc: AdminDocument; collection: AdminCollection };

/** Drafts are only listed for a signed-in user: asking anonymously is a 403. */
const draftsFor = (collection: AdminCollection, schema: AdminSchema) =>
  collection.drafts && schema.user ? { draft: true } : {};

/* ── presentational ──────────────────────────────────────────────────────────────────────────── */

export function CollectionCounts({ counts, onOpen }: { counts: Count[]; onOpen: Navigate }) {
  return (
    <MetricGrid>
      {counts.map(({ collection, total }) => (
        <button
          key={collection.slug}
          type="button"
          className="rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpen({ view: 'list', slug: collection.slug })}
        >
          <MetricCard
            label={collection.labels?.plural ?? collection.slug}
            value={total ?? '—'}
            caption={collection.slug}
            tone={total ? 'brand' : 'default'}
            className="h-full transition-colors hover:border-brand-border"
          />
        </button>
      ))}
    </MetricGrid>
  );
}

export function RecentList({
  rows,
  locale,
  onOpen,
}: {
  rows: RecentRow[];
  locale: string;
  onOpen: Navigate;
}) {
  return (
    <ul className="divide-y divide-border">
      {rows.map(({ doc, collection }) => {
        const title = collection.admin?.useAsTitle;
        return (
          <li key={`${collection.slug}/${String(doc.id)}`}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
              onClick={() => onOpen({ view: 'edit', slug: collection.slug, id: String(doc.id) })}
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
                {String((title && doc[title]) ?? doc.id)}
              </span>
              <span className="shrink-0 text-[11.5px] text-dim">
                {collection.labels?.singular ?? collection.slug}
              </span>
              <span className="mono tnum w-[84px] shrink-0 text-right text-[10.5px] text-faint">
                {doc.updatedAt ? new Date(String(doc.updatedAt)).toLocaleDateString(locale) : '—'}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function RecentSkeleton() {
  return (
    <div className="divide-y divide-border" aria-hidden>
      {['a', 'b', 'c', 'd', 'e'].map((key) => (
        <div key={key} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/* ── container ───────────────────────────────────────────────────────────────────────────────── */

/** Where the panel opens: what exists, what changed, and whatever the app's extensions add. */
export function DashboardPage({
  schema,
  onNavigate,
}: {
  schema: AdminSchema;
  onNavigate: Navigate;
}) {
  const t = useMessages();
  const { client, locale } = useCms();
  const readable = schema.collections.filter(
    (collection) => schema.permissions[collection.slug]?.read !== false,
  );

  const counts = useQuery({
    queryKey: ['cms', 'dashboard-counts', readable.map((item) => item.slug)],
    queryFn: async (): Promise<Count[]> => {
      const pages = await Promise.allSettled(
        readable.map((collection) =>
          client.list(collection.slug, { size: 1, depth: 0, ...draftsFor(collection, schema) }),
        ),
      );
      return readable.map((collection, index) => {
        const page = pages[index];
        return { collection, total: page?.status === 'fulfilled' ? page.value.meta.total : null };
      });
    },
  });

  const recent = useQuery({
    queryKey: ['cms', 'dashboard-recent'],
    queryFn: async (): Promise<RecentRow[]> => {
      const pages = await Promise.allSettled(
        readable.map(async (collection) => {
          const page = await client.list(collection.slug, {
            size: 5,
            depth: 0,
            sort: '-updatedAt',
            ...draftsFor(collection, schema),
          });
          return page.data.map((doc) => ({ doc, collection }));
        }),
      );
      return pages
        .flatMap((page) => (page.status === 'fulfilled' ? page.value : []))
        .sort((a, b) => String(b.doc.updatedAt).localeCompare(String(a.doc.updatedAt)))
        .slice(0, 8);
    },
  });

  return (
    <PageBody className="page-enter">
      <PageHeader title={t.dashboard} description={schema.admin.title} />

      {schema.collections.length === 0 ? (
        <EmptyState icon={<InboxIcon />} title={t.noCollections} />
      ) : (
        <ErrorBoundary label={t.content}>
          <QueryBoundary
            query={counts}
            label={t.content}
            skeleton={<MetricGridSkeleton count={Math.min(readable.length || 1, 6)} />}
          >
            {(data) => <CollectionCounts counts={data} onOpen={onNavigate} />}
          </QueryBoundary>
        </ErrorBoundary>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ErrorBoundary label={t.recent}>
          <Panel title={t.recent} flush>
            <QueryBoundary
              query={recent}
              label={t.recent}
              skeleton={<RecentSkeleton />}
              isEmpty={(rows) => rows.length === 0}
              empty={<EmptyState icon={<InboxIcon />} title={t.noDocuments} className="py-8" />}
            >
              {(rows) => <RecentList rows={rows} locale={locale} onOpen={onNavigate} />}
            </QueryBoundary>
          </Panel>
        </ErrorBoundary>

        {/* An extension's widget brings its own heading: an untitled card around it. */}
        {[...WIDGET_REGISTRY.values()].map(({ id, component: Widget }) => (
          <ErrorBoundary key={id} label={id}>
            <section className="agora-surface agora-rise rounded-lg border border-border p-4 text-[13px] text-fg-2">
              <Widget />
            </section>
          </ErrorBoundary>
        ))}
      </div>
    </PageBody>
  );
}
