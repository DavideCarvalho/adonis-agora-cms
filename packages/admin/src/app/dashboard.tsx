import {
  type AdminCollection,
  type AdminSchema,
  useCms,
  useMessages,
  WIDGET_REGISTRY,
} from '@adonis-agora/cms-react';
import { useQuery } from '@tanstack/react-query';
import type { Route } from './hash-route.js';

function CollectionRow({
  collection,
  schema,
  onNavigate,
}: {
  collection: AdminCollection;
  schema: AdminSchema;
  onNavigate: (route: Route) => void;
}) {
  const { client } = useCms();
  const count = useQuery({
    queryKey: ['cms', 'dashboard-count', collection.slug],
    queryFn: () =>
      client.list(collection.slug, {
        limit: 1,
        depth: 0,
        ...(collection.drafts && schema.user ? { draft: true } : {}),
      }),
  });

  return (
    <button
      type="button"
      className="dashboard__row"
      onClick={() => onNavigate({ view: 'list', slug: collection.slug })}
    >
      <span>{collection.labels?.plural ?? collection.slug}</span>
      <span className="num">{count.data?.totalDocs ?? '…'}</span>
    </button>
  );
}

function Recent({
  schema,
  onNavigate,
}: {
  schema: AdminSchema;
  onNavigate: (route: Route) => void;
}) {
  const t = useMessages();
  const { client, locale } = useCms();
  const recent = useQuery({
    queryKey: ['cms', 'dashboard-recent'],
    queryFn: async () => {
      const pages = await Promise.allSettled(
        schema.collections.map(async (collection) => {
          const page = await client.list(collection.slug, {
            limit: 5,
            depth: 0,
            sort: '-updatedAt',
            ...(collection.drafts && schema.user ? { draft: true } : {}),
          });
          return page.docs.map((doc) => ({ doc, collection }));
        }),
      );
      return pages
        .flatMap((page) => (page.status === 'fulfilled' ? page.value : []))
        .sort((a, b) => String(b.doc.updatedAt).localeCompare(String(a.doc.updatedAt)))
        .slice(0, 8);
    },
  });

  return (
    <section className="dashboard__card">
      <h2>{t.recent}</h2>
      {(recent.data ?? []).map(({ doc, collection }) => {
        const title = collection.admin?.useAsTitle;
        return (
          <button
            type="button"
            key={`${collection.slug}/${String(doc.id)}`}
            className="dashboard__row"
            onClick={() => onNavigate({ view: 'edit', slug: collection.slug, id: String(doc.id) })}
          >
            <span className="dashboard__title">{String((title && doc[title]) ?? doc.id)}</span>
            <small>
              {collection.labels?.singular ?? collection.slug}
              {' · '}
              {new Date(String(doc.updatedAt)).toLocaleDateString(locale)}
            </small>
          </button>
        );
      })}
    </section>
  );
}

/** Where the panel opens: what exists, what changed, and whatever the app's extensions add. */
export function Dashboard({
  schema,
  onNavigate,
}: {
  schema: AdminSchema;
  onNavigate: (route: Route) => void;
}) {
  const t = useMessages();

  return (
    <div className="page-enter dashboard">
      <h1 className="page-title">{t.dashboard}</h1>
      <div className="dashboard__grid">
        <section className="dashboard__card">
          <h2>{t.content}</h2>
          {schema.collections.map((collection) => (
            <CollectionRow
              key={collection.slug}
              collection={collection}
              schema={schema}
              onNavigate={onNavigate}
            />
          ))}
        </section>
        <Recent schema={schema} onNavigate={onNavigate} />
        {[...WIDGET_REGISTRY.values()].map(({ id, component: Widget }) => (
          <section key={id} className="dashboard__card">
            <Widget />
          </section>
        ))}
      </div>
    </div>
  );
}
