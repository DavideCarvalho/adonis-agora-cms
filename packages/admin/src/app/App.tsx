import {
  type AdminCollection,
  type AdminDocument,
  type AdminSchema,
  Button,
  CmsApiError,
  DataTable,
  EditForm,
  useAdminSchema,
  useCreateDocument,
  useDeleteDocument,
  useDocument,
  useDocuments,
  usePreviewToken,
  usePublishDocument,
  useUpdateDocument,
} from '@adonis-agora/cms-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { href, parseHash, type Route } from './hash-route.js';

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const schema = useAdminSchema();

  const navigate = useCallback((next: Route) => {
    window.location.hash = href(next).replace(/^#/, '');
    setRoute(next);
  }, []);

  if (schema.isLoading) return <p className="p-8 text-zinc-500">Loading…</p>;
  if (schema.error) return <p className="p-8 text-red-600">{String(schema.error.message)}</p>;
  if (!schema.data) return null;

  const data = schema.data;
  const collection =
    data.collections.find((item) => item.slug === route.slug) ?? data.collections[0] ?? null;

  return (
    <div className="flex min-h-screen">
      <Sidebar schema={data} activeSlug={collection?.slug ?? ''} onNavigate={navigate} />

      <main className="flex-1 p-6">
        {!collection ? (
          <p className="text-zinc-500">No collections configured.</p>
        ) : route.view === 'list' ? (
          <ListView collection={collection} schema={data} onNavigate={navigate} />
        ) : (
          <EditView
            collection={collection}
            schema={data}
            id={route.view === 'edit' ? route.id : undefined}
            onNavigate={navigate}
          />
        )}
      </main>
    </div>
  );
}

function Sidebar({
  schema,
  activeSlug,
  onNavigate,
}: {
  schema: AdminSchema;
  activeSlug: string;
  onNavigate: (route: Route) => void;
}) {
  return (
    <aside className="w-60 shrink-0 border-r border-zinc-200 bg-white p-4">
      <h1 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        {schema.admin.title}
      </h1>

      <nav className="flex flex-col gap-1">
        {schema.collections.map((collection) => (
          <Button
            key={collection.slug}
            variant={collection.slug === activeSlug ? 'primary' : 'ghost'}
            className="justify-start"
            onClick={() => onNavigate({ view: 'list', slug: collection.slug })}
          >
            {collection.labels?.plural ?? collection.slug}
          </Button>
        ))}
      </nav>

      {schema.globals.length > 0 ? (
        <p className="mt-6 text-xs text-zinc-400">Globals: {schema.globals.length}</p>
      ) : null}
    </aside>
  );
}

function ListView({
  collection,
  schema,
  onNavigate,
}: {
  collection: AdminCollection;
  schema: AdminSchema;
  onNavigate: (route: Route) => void;
}) {
  const [page, setPage] = useState(1);
  const query = useMemo(() => ({ page, limit: 20, depth: 0 }), [page]);
  const documents = useDocuments(collection.slug, query);
  const remove = useDeleteDocument(collection.slug);

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        collection={collection}
        docs={documents.data?.docs ?? []}
        permission={schema.permissions[collection.slug]}
        busy={documents.isFetching || remove.isPending}
        onOpen={(doc: AdminDocument) =>
          onNavigate({ view: 'edit', slug: collection.slug, id: String(doc.id) })
        }
        onCreate={() => onNavigate({ view: 'create', slug: collection.slug })}
        onDelete={(doc) => {
          if (window.confirm('Delete this document?')) remove.mutate(String(doc.id));
        }}
      />

      <div className="flex items-center gap-3 text-sm text-zinc-600">
        <Button
          size="sm"
          disabled={!documents.data?.hasPrevPage}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
        >
          Previous
        </Button>
        <span>
          Page {documents.data?.page ?? 1} of {documents.data?.totalPages ?? 1} ·{' '}
          {documents.data?.totalDocs ?? 0} docs
        </span>
        <Button
          size="sm"
          disabled={!documents.data?.hasNextPage}
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function EditView({
  collection,
  schema,
  id,
  onNavigate,
}: {
  collection: AdminCollection;
  schema: AdminSchema;
  id: string | undefined;
  onNavigate: (route: Route) => void;
}) {
  const document = useDocument(collection.slug, id, { depth: 1 });
  const create = useCreateDocument(collection.slug);
  const update = useUpdateDocument(collection.slug, id ?? '');
  const publish = usePublishDocument(collection.slug, id ?? '');
  const remove = useDeleteDocument(collection.slug);
  const preview = usePreviewToken(collection.slug, id);

  const [errors, setErrors] = useState<Record<string, string>>({});

  const back = () => onNavigate({ view: 'list', slug: collection.slug });

  const handleSubmit = (values: AdminDocument) => {
    setErrors({});

    const onError = (error: unknown) => {
      if (error instanceof CmsApiError && error.fields) setErrors(error.fields);
      else setErrors({ _: error instanceof Error ? error.message : 'Request failed' });
    };

    if (id) update.mutate(values, { onError, onSuccess: back });
    else create.mutate(values, { onError, onSuccess: back });
  };

  if (id && document.isLoading) return <p className="text-zinc-500">Loading…</p>;

  return (
    <EditForm
      collection={collection}
      doc={document.data ?? {}}
      permission={schema.permissions[collection.slug]}
      saving={create.isPending || update.isPending}
      errors={errors}
      onSubmit={handleSubmit}
      onBack={back}
      previewUrl={preview.data?.url}
      locales={schema.locales}
      onPublish={
        id
          ? () => publish.mutate(document.data?._status === 'published' ? 'unpublish' : 'publish')
          : undefined
      }
      onDelete={
        id
          ? () => {
              if (!window.confirm('Delete this document?')) return;
              remove.mutate(id, { onSuccess: back });
            }
          : undefined
      }
    />
  );
}
