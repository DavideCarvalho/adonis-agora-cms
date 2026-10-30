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
  useRestoreDocument,
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

  if (schema.isLoading)
    return (
      <p className="skeleton" style={{ padding: 40 }}>
        Loading…
      </p>
    );
  if (schema.error instanceof CmsApiError && schema.error.status === 401) return <SignIn />;
  if (schema.error)
    return (
      <p className="error" style={{ padding: 40 }}>
        {String(schema.error.message)}
      </p>
    );
  if (!schema.data) return null;

  const data = schema.data;
  const collection =
    data.collections.find((item) => item.slug === route.slug) ?? data.collections[0] ?? null;

  return (
    <div className="shell">
      <Sidebar schema={data} activeSlug={collection?.slug ?? ''} onNavigate={navigate} />

      <div className="main">
        <header className="topbar">
          <nav className="crumb">
            <span>{data.admin.title}</span>
            <span aria-hidden>/</span>
            <strong>{collection?.labels?.plural ?? collection?.slug ?? '—'}</strong>
            {route.view !== 'list' && collection ? (
              <>
                <span aria-hidden>/</span>
                <span>{route.view === 'edit' ? 'edit' : 'new'}</span>
              </>
            ) : null}
          </nav>
          <span className="crumb">{Object.keys(data.collections).length} collections</span>
        </header>

        <main className="page">
          {!collection ? (
            <p className="skeleton">No collections configured.</p>
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
    </div>
  );
}

function toggleTheme(): void {
  const root = document.documentElement;
  const light = root.classList.toggle('light');
  localStorage.setItem('cms-theme', light ? 'light' : 'dark');
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
    <aside className="sidebar">
      <div className="brand">
        <span className="brand__name">{schema.admin.title}</span>
        <span className="brand__tag">cms</span>
      </div>

      <nav className="nav">
        <span className="nav__label">Content</span>
        {schema.collections.map((collection) => (
          <button
            key={collection.slug}
            type="button"
            className={`nav-item${collection.slug === activeSlug ? ' nav-item--active' : ''}`}
            onClick={() => onNavigate({ view: 'list', slug: collection.slug })}
          >
            <span>{collection.labels?.plural ?? collection.slug}</span>
          </button>
        ))}

        {schema.globals.length > 0 ? (
          <>
            <span className="nav__label" style={{ marginTop: 18 }}>
              Globals
            </span>
            {schema.globals.map((item) => (
              <button key={item.slug} type="button" className="nav-item">
                <span>{item.labels?.plural ?? item.slug}</span>
              </button>
            ))}
          </>
        ) : null}
      </nav>

      <div className="sidebar__foot">
        {schema.locales.length > 1 ? `${schema.locales.length} locales · ` : ''}
        {schema.tenancy.strategy}
        <button type="button" className="theme-toggle" onClick={toggleTheme}>
          theme
        </button>
      </div>
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
  const [showDeleted, setShowDeleted] = useState(false);
  const query = useMemo(
    () => ({ page, limit: 20, depth: 0, ...(showDeleted ? { deleted: true } : {}) }),
    [page, showDeleted],
  );
  const documents = useDocuments(collection.slug, query);
  const remove = useDeleteDocument(collection.slug);
  const restore = useRestoreDocument(collection.slug);

  return (
    <>
      <DataTable
        collection={collection}
        docs={documents.data?.docs ?? []}
        total={documents.data?.totalDocs}
        permission={schema.permissions[collection.slug]}
        busy={documents.isFetching || remove.isPending}
        onOpen={(doc: AdminDocument) =>
          onNavigate({ view: 'edit', slug: collection.slug, id: String(doc.id) })
        }
        onCreate={() => onNavigate({ view: 'create', slug: collection.slug })}
        onDelete={(doc) => {
          if (window.confirm('Delete this document?')) remove.mutate(String(doc.id));
        }}
        onRestore={(doc) => restore.mutate(String(doc.id))}
        showDeleted={showDeleted}
        onToggleDeleted={() => setShowDeleted((value) => !value)}
      />

      <div className="pager">
        <Button
          size="sm"
          disabled={!documents.data?.hasPrevPage}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
        >
          Previous
        </Button>
        <span>
          page <span className="num">{documents.data?.page ?? 1}</span> of{' '}
          <span className="num">{documents.data?.totalPages ?? 1}</span>
        </span>
        <Button
          size="sm"
          disabled={!documents.data?.hasNextPage}
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </Button>
      </div>
    </>
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

  if (id && document.isLoading) return <p className="skeleton">Loading…</p>;

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

/** Shown when the API answers 401: the host app owns the login, the panel only links to it. */
function SignIn() {
  const loginUrl = import.meta.env.VITE_CMS_LOGIN_URL ?? '/login';

  return (
    <div className="signin">
      <div className="signin__card">
        <h1 className="page-title" style={{ fontSize: 24 }}>
          Sign in required
        </h1>
        <p>Your session expired or you are not authenticated.</p>
        <a href={loginUrl} style={{ display: 'inline-block', marginTop: 18 }}>
          <Button tone="accent">Go to sign in</Button>
        </a>
      </div>
    </div>
  );
}
