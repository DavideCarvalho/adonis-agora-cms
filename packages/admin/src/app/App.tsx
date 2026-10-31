import {
  type AdminCollection,
  type AdminDocument,
  type AdminSchema,
  Button,
  CmsApiError,
  ConfirmProvider,
  cmsKeys,
  DataTable,
  EditForm,
  fieldTitle,
  flattenFields,
  useAdminSchema,
  useAutosaveDocument,
  useCms,
  useConfirm,
  useCreateDocument,
  useDeleteDocument,
  useDocument,
  useDocuments,
  useGlobalDocument,
  useMessages,
  usePreviewToken,
  usePublishDocument,
  useRestoreDocument,
  useUpdateDocument,
  useUpdateGlobal,
} from '@adonis-agora/cms-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Moon, Sun, Upload } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CommandPalette } from './command-palette.js';
import { parseCsv, toCsv } from './csv.js';
import { href, parseHash, type Route } from './hash-route.js';

type Navigate = (route: Route, options?: { force?: boolean }) => void;
type Toast = { id: number; message: string; tone: 'ok' | 'bad' };

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(
  () => undefined,
);
const useToast = () => useContext(ToastContext);

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function App() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextToast = useRef(0);

  const toast = useCallback((message: string, tone: Toast['tone'] = 'ok') => {
    nextToast.current += 1;
    const id = nextToast.current;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      tone === 'bad' ? 7000 : 3000,
    );
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmProvider>
        <Panel />
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((item) => (
            <div key={item.id} className={`toast toast--${item.tone}`}>
              {item.message}
            </div>
          ))}
        </div>
      </ConfirmProvider>
    </ToastContext.Provider>
  );
}

function Panel() {
  const t = useMessages();
  const confirm = useConfirm();
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const dirty = useRef(false);

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const schema = useAdminSchema();

  const go = useCallback((next: Route) => {
    window.location.hash = href(next).replace(/^#/, '');
    setRoute(next);
  }, []);

  const navigate = useCallback<Navigate>(
    (next, options) => {
      if (options?.force || !dirty.current) {
        dirty.current = false;
        go(next);
        return;
      }
      void confirm({
        title: t.discardTitle,
        body: t.discardBody,
        action: t.discard,
        danger: true,
      }).then((answer) => {
        if (!answer) return;
        dirty.current = false;
        go(next);
      });
    },
    [confirm, go, t],
  );

  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  // White label from the config. `CSS.supports` keeps a typo from blanking the accent.
  const accent = schema.data?.admin.theme?.accent;
  useEffect(() => {
    if (accent && CSS.supports('color', accent)) {
      document.documentElement.style.setProperty('--accent', accent);
    }
  }, [accent]);

  const title = schema.data?.admin.title;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  if (schema.isLoading) return <div className="boot" aria-busy="true" />;
  if (schema.error instanceof CmsApiError && schema.error.status === 401) return <SignIn />;
  if (schema.error)
    return (
      <div className="signin">
        <div className="signin__card">
          <p className="error">{schema.error.message}</p>
          <Button size="md" onClick={() => void schema.refetch()}>
            {t.retry}
          </Button>
        </div>
      </div>
    );
  if (!schema.data) return null;

  const data = schema.data;
  const global =
    route.view === 'global' ? data.globals.find((item) => item.slug === route.slug) : undefined;
  const collection =
    data.collections.find((item) => item.slug === route.slug) ?? data.collections[0] ?? null;

  return (
    <div className="shell">
      <CommandPalette schema={data} onNavigate={navigate} />
      <Sidebar
        schema={data}
        activeSlug={global?.slug ?? collection?.slug ?? ''}
        onNavigate={navigate}
      />

      <main className="page">
        {global ? (
          <GlobalView
            key={global.slug}
            global={global}
            schema={data}
            onDirtyChange={onDirtyChange}
          />
        ) : !collection ? (
          <p className="empty">{t.noCollections}</p>
        ) : route.view === 'list' || route.view === 'global' ? (
          <ListView
            key={collection.slug}
            collection={collection}
            schema={data}
            onNavigate={navigate}
          />
        ) : (
          <EditView
            key={`${collection.slug}/${route.view === 'edit' ? route.id : 'new'}`}
            collection={collection}
            schema={data}
            id={route.view === 'edit' ? route.id : undefined}
            onNavigate={navigate}
            onDirtyChange={onDirtyChange}
          />
        )}
      </main>
    </div>
  );
}

function ThemeToggle() {
  const t = useMessages();
  const [light, setLight] = useState(() => document.documentElement.classList.contains('light'));
  const toggle = () => {
    const next = document.documentElement.classList.toggle('light');
    localStorage.setItem('cms-theme', next ? 'light' : 'dark');
    setLight(next);
  };
  const label = light ? t.darkTheme : t.lightTheme;

  return (
    <Button size="sm" tone="ghost" onClick={toggle} aria-label={label} title={label}>
      {light ? <Moon aria-hidden /> : <Sun aria-hidden />}
    </Button>
  );
}

function Sidebar({
  schema,
  activeSlug,
  onNavigate,
}: {
  schema: AdminSchema;
  activeSlug: string;
  onNavigate: Navigate;
}) {
  const t = useMessages();

  const item = (entry: AdminCollection, route: Route) => (
    <button
      key={entry.slug}
      type="button"
      className={`nav-item${entry.slug === activeSlug ? ' nav-item--active' : ''}`}
      aria-current={entry.slug === activeSlug ? 'page' : undefined}
      onClick={() => onNavigate(route)}
    >
      {route.view === 'global'
        ? (entry.labels?.singular ?? entry.slug)
        : (entry.labels?.plural ?? entry.slug)}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="brand">
        {schema.admin.theme?.logoUrl ? (
          <img src={schema.admin.theme.logoUrl} alt="" className="brand__logo" />
        ) : null}
        {schema.admin.title}
      </div>

      <nav className="nav">
        <span className="nav__label">{t.content}</span>
        {schema.collections.map((entry) => item(entry, { view: 'list', slug: entry.slug }))}

        {schema.globals.length > 0 ? (
          <>
            <span className="nav__label nav__label--spaced">{t.globals}</span>
            {schema.globals.map((entry) => item(entry, { view: 'global', slug: entry.slug }))}
          </>
        ) : null}
      </nav>

      <div className="sidebar__foot">
        <ThemeToggle />
      </div>
    </aside>
  );
}

const CSV_TYPES = new Set([
  'text',
  'textarea',
  'email',
  'slug',
  'number',
  'date',
  'select',
  'radio',
  'checkbox',
]);

function ListView({
  collection,
  schema,
  onNavigate,
}: {
  collection: AdminCollection;
  schema: AdminSchema;
  onNavigate: Navigate;
}) {
  const t = useMessages();
  const toast = useToast();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [showDeleted, setShowDeleted] = useState(false);
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState<string | undefined>(undefined);

  // Search runs on the title column; a collection without a text title has nothing to search.
  const allFields = useMemo(() => flattenFields(collection.fields), [collection]);
  const searchField = useMemo(() => {
    const candidates = [collection.admin?.useAsTitle, ...(collection.admin?.defaultColumns ?? [])];
    return candidates
      .map((name) => allFields.find((field) => field.name === name))
      .find((field) => field && (field.type === 'text' || field.type === 'slug'))?.name;
  }, [collection, allFields]);

  // The API only hands drafts to a signed-in user; asking anonymously is a 403.
  const canReadDrafts = collection.drafts && Boolean(schema.user);
  const [status, setStatus] = useState('');
  const [fieldFilters, setFieldFilters] = useState<Record<string, string>>({});
  const filterFields = useMemo(
    () =>
      allFields.filter((field) => (field.options?.length ?? 0) > 0 && !field.hidden).slice(0, 3),
    [allFields],
  );

  const where = useMemo(() => {
    const clause: Record<string, unknown> = {};
    if (term && searchField) clause[searchField] = { iContains: term };
    if (status) clause._status = { equals: status };
    for (const [name, value] of Object.entries(fieldFilters)) {
      if (value) clause[name] = { equals: value };
    }
    return clause;
  }, [term, searchField, status, fieldFilters]);

  const query = useMemo(
    () => ({
      page,
      limit: 20,
      depth: 0,
      ...(canReadDrafts ? { draft: true } : {}),
      ...(sort ? { sort } : {}),
      ...(showDeleted ? { deleted: true } : {}),
      ...(Object.keys(where).length > 0 ? { where } : {}),
    }),
    [page, showDeleted, sort, where, canReadDrafts],
  );
  const documents = useDocuments(collection.slug, query);
  const { client } = useCms();
  const queryClient = useQueryClient();
  const remove = useDeleteDocument(collection.slug);
  const restore = useRestoreDocument(collection.slug);
  const onSearch = useCallback((next: string) => {
    setTerm(next);
    setPage(1);
  }, []);
  const fail = (error: unknown) => toast(messageOf(error, t.requestFailed), 'bad');
  const importInput = useRef<HTMLInputElement>(null);

  // Scalars only: nested rows do not survive a spreadsheet.
  const csvColumns = useMemo(
    () =>
      allFields
        .filter((field) => CSV_TYPES.has(field.type) && !field.hidden && !field.localized)
        .map((field) => field.name),
    [allFields],
  );

  const exportCsv = async () => {
    try {
      const rows: AdminDocument[] = [];
      for (let next: number | null = 1; next !== null; ) {
        const result = await client.list(collection.slug, { ...query, page: next, limit: 200 });
        rows.push(...result.docs);
        next = result.hasNextPage ? next + 1 : null;
      }
      const url = URL.createObjectURL(
        new Blob([`\uFEFF${toCsv(['id', ...csvColumns], rows)}`], { type: 'text/csv' }),
      );
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `${collection.slug}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      fail(error);
    }
  };

  const importCsv = async (file: File) => {
    const rows = parseCsv(await file.text());
    const byName = new Map(allFields.map((field) => [field.name, field]));
    const results = await Promise.allSettled(
      rows.map((row) => {
        const data: AdminDocument = {};
        for (const name of csvColumns) {
          const raw = row[name];
          if (raw === undefined || raw === '') continue;
          const type = byName.get(name)?.type;
          data[name] = type === 'number' ? Number(raw) : type === 'checkbox' ? raw === 'true' : raw;
        }
        return client.create(collection.slug, data, { draft: canReadDrafts });
      }),
    );
    const failed = results.filter((item) => item.status === 'rejected').length;
    toast(
      `${results.length - failed} ${t.imported}${failed ? `, ${failed} ${t.failedRows}` : ''}`,
      failed ? 'bad' : 'ok',
    );
    void queryClient.invalidateQueries({ queryKey: [...cmsKeys.all, 'list', collection.slug] });
  };

  return (
    <>
      <DataTable
        collection={collection}
        docs={documents.data?.docs ?? []}
        total={documents.data?.totalDocs}
        permission={schema.permissions[collection.slug]}
        busy={remove.isPending || restore.isPending}
        loading={documents.isLoading}
        error={documents.error?.message}
        onRetry={() => void documents.refetch()}
        onSearch={searchField ? onSearch : undefined}
        filters={
          <>
            <Button
              size="md"
              tone="ghost"
              aria-label={t.exportCsv}
              title={t.exportCsv}
              onClick={() => void exportCsv()}
            >
              <Download aria-hidden />
            </Button>
            {schema.permissions[collection.slug]?.create !== false ? (
              <>
                <Button
                  size="md"
                  tone="ghost"
                  aria-label={t.importCsv}
                  title={t.importCsv}
                  onClick={() => importInput.current?.click()}
                >
                  <Upload aria-hidden />
                </Button>
                <input
                  ref={importInput}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  aria-label={t.importCsv}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void importCsv(file).catch(fail);
                  }}
                />
              </>
            ) : null}
            {canReadDrafts ? (
              <select
                className="select select--inline"
                aria-label={t.status}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">{t.allStatuses}</option>
                <option value="draft">{t.draft}</option>
                <option value="published">{t.published}</option>
              </select>
            ) : null}
            {filterFields.map((field) => (
              <select
                key={field.name}
                className="select select--inline"
                aria-label={fieldTitle(field)}
                value={fieldFilters[field.name] ?? ''}
                onChange={(event) => {
                  setFieldFilters((current) => ({ ...current, [field.name]: event.target.value }));
                  setPage(1);
                }}
              >
                <option value="">
                  {fieldTitle(field)}: {t.all.toLowerCase()}
                </option>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ))}
          </>
        }
        onPublishMany={
          canReadDrafts
            ? (docs, action) => {
                void Promise.all(
                  docs.map((doc) =>
                    action === 'publish'
                      ? client.publish(collection.slug, String(doc.id))
                      : client.unpublish(collection.slug, String(doc.id)),
                  ),
                )
                  .then(() => {
                    toast(action === 'publish' ? t.published : t.unpublished);
                    void queryClient.invalidateQueries({
                      queryKey: [...cmsKeys.all, 'list', collection.slug],
                    });
                  })
                  .catch(fail);
              }
            : undefined
        }
        sort={sort}
        onSort={(next) => {
          setSort(next);
          setPage(1);
        }}
        onOpen={(doc: AdminDocument) =>
          onNavigate({ view: 'edit', slug: collection.slug, id: String(doc.id) })
        }
        onCreate={() => onNavigate({ view: 'create', slug: collection.slug })}
        onDelete={(doc) => {
          void confirm({
            title: t.deleteConfirm,
            body: collection.softDelete ? undefined : t.deleteBody,
            action: t.delete,
            danger: true,
          }).then((answer) => {
            if (!answer) return;
            remove.mutate(String(doc.id), {
              onSuccess: () => toast(t.deleted),
              onError: fail,
            });
          });
        }}
        onDeleteMany={(docs) => {
          void confirm({
            title: t.deleteManyTitle,
            body: `${docs.length} ${docs.length === 1 ? t.document : t.documents}.${
              collection.softDelete ? '' : ` ${t.deleteBody}`
            }`,
            action: t.delete,
            danger: true,
          }).then(async (answer) => {
            if (!answer) return;
            try {
              await Promise.all(docs.map((doc) => remove.mutateAsync(String(doc.id))));
              toast(t.deleted);
            } catch (error) {
              fail(error);
            }
          });
        }}
        onRestore={(doc) =>
          restore.mutate(String(doc.id), {
            onSuccess: () => toast(t.restored),
            onError: fail,
          })
        }
        showDeleted={showDeleted}
        onToggleDeleted={() => {
          setShowDeleted((value) => !value);
          setPage(1);
        }}
      />

      {(documents.data?.totalPages ?? 1) > 1 ? (
        <div className="pager">
          <Button
            size="sm"
            disabled={!documents.data?.hasPrevPage}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            {t.previous}
          </Button>
          <span className="num">
            {documents.data?.page ?? 1} / {documents.data?.totalPages ?? 1}
          </span>
          <Button
            size="sm"
            disabled={!documents.data?.hasNextPage}
            onClick={() => setPage((value) => value + 1)}
          >
            {t.next}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/**
 * Holds the advisory lock while the document is open. The answer is the other editor's name when
 * someone got there first; the lock never blocks a write, it only tells the panel who is editing.
 */
function useDocumentLock(slug: string, id: string | undefined, signedIn: boolean): string | null {
  const { client } = useCms();
  const [lockedBy, setLockedBy] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !signedIn) return;
    let holding = false;

    const take = () => {
      client.lock(slug, id, 120).then(
        () => {
          holding = true;
          setLockedBy(null);
        },
        (error: unknown) => {
          if (!(error instanceof CmsApiError) || error.status !== 409) return;
          setLockedBy(/locked by (.+) until/.exec(error.message)?.[1] ?? '—');
        },
      );
    };

    take();
    const timer = window.setInterval(take, 45_000);
    return () => {
      window.clearInterval(timer);
      if (holding) void client.unlock(slug, id).catch(() => undefined);
    };
  }, [client, slug, id, signedIn]);

  return lockedBy;
}

/** Copies a document: fresh row ids from the server, a title and slug that do not collide. */
function copyOf(doc: AdminDocument, collection: AdminCollection, suffix: string): AdminDocument {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!value || typeof value !== 'object') return value;
    const entries = Object.entries(value).filter(([key]) => key !== 'id' && key !== '_order');
    return Object.fromEntries(entries.map(([key, item]) => [key, strip(item)]));
  };

  const { createdAt: _c, updatedAt: _u, deletedAt: _d, _status: _s, ...rest } = doc;
  const copy = strip(rest) as AdminDocument;
  const stamp = Date.now().toString(36).slice(-4);
  for (const field of collection.fields) {
    if (field.type === 'slug' && typeof copy[field.name] === 'string') {
      copy[field.name] = `${copy[field.name] as string}-${stamp}`;
    }
  }
  const titleField = collection.admin?.useAsTitle;
  if (titleField && typeof copy[titleField] === 'string') {
    copy[titleField] = `${copy[titleField] as string} ${suffix}`;
  }
  return copy;
}

function EditView({
  collection,
  schema,
  id,
  onNavigate,
  onDirtyChange,
}: {
  collection: AdminCollection;
  schema: AdminSchema;
  id: string | undefined;
  onNavigate: Navigate;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useMessages();
  const toast = useToast();
  const confirm = useConfirm();
  const { client } = useCms();
  const canReadDrafts = collection.drafts && Boolean(schema.user);
  const document = useDocument(collection.slug, id, {
    depth: 1,
    ...(canReadDrafts ? { draft: true } : {}),
  });
  // Without a user the panel could never read a draft back, so a new document starts published.
  const create = useCreateDocument(collection.slug, { draft: canReadDrafts });
  const autosave = useAutosaveDocument(collection.slug, id ?? '');
  const lockedBy = useDocumentLock(collection.slug, id, Boolean(schema.user));
  const interval = collection.autosave ? collection.autosave.interval : undefined;
  const queryClient = useQueryClient();
  const scheduleKey = ['cms', 'schedule', collection.slug, id];
  const scheduled = useQuery({
    queryKey: scheduleKey,
    enabled: Boolean(id && canReadDrafts),
    queryFn: () => client.scheduled(collection.slug, id as string),
  });
  const onAutosave = useCallback(
    (values: AdminDocument) =>
      autosave.mutateAsync(values).then(
        () => true,
        () => false,
      ),
    [autosave.mutateAsync],
  );
  const update = useUpdateDocument(collection.slug, id ?? '');
  const publish = usePublishDocument(collection.slug, id ?? '');
  const remove = useDeleteDocument(collection.slug);
  const preview = usePreviewToken(collection.slug, id);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const back = () => onNavigate({ view: 'list', slug: collection.slug });
  const empty = useMemo<AdminDocument>(() => ({}), []);

  const report = (error: unknown) => {
    if (error instanceof CmsApiError && error.fields) setErrors(error.fields);
    else setErrors({ _: messageOf(error, t.requestFailed) });
  };

  /** Returns false on failure, so the form keeps the changes marked as unsaved. */
  const save = async (values: AdminDocument, quiet = false): Promise<boolean> => {
    setErrors({});
    try {
      if (id) {
        await update.mutateAsync(values);
        if (!quiet) toast(t.saved);
      } else {
        const created = await create.mutateAsync(values);
        toast(t.created);
        onDirtyChange(false);
        onNavigate(
          { view: 'edit', slug: collection.slug, id: String(created.id) },
          { force: true },
        );
      }
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  };

  if (id && document.isLoading) return <div className="boot" aria-busy="true" />;
  if (id && document.error)
    return (
      <div className="empty">
        <strong>{document.error.message}</strong>
        <Button size="sm" onClick={back}>
          {t.back}
        </Button>
      </div>
    );

  const published = document.data?._status === 'published';

  return (
    <EditForm
      collection={collection}
      doc={document.data ?? empty}
      permission={schema.permissions[collection.slug]}
      saving={create.isPending || update.isPending || publish.isPending}
      errors={errors}
      onSubmit={(values) => save(values)}
      onBack={back}
      onDirtyChange={onDirtyChange}
      onAutosave={id ? onAutosave : undefined}
      autosaveInterval={interval}
      lockedBy={lockedBy}
      canUnpublish={canReadDrafts}
      schedule={scheduled.data?.schedule}
      onSchedule={
        id && canReadDrafts
          ? (at) => {
              const action = published ? 'unpublish' : 'publish';
              const change = at
                ? client.schedule(collection.slug, id, { at, action })
                : client.unschedule(collection.slug, id);
              change
                .then(() => {
                  toast(at ? t.scheduled : t.unschedule);
                  void queryClient.invalidateQueries({ queryKey: scheduleKey });
                })
                .catch(report);
            }
          : undefined
      }
      onRestored={() => toast(t.restored)}
      previewUrl={preview.data?.url}
      locales={schema.locales}
      onPublish={
        id
          ? async (values, dirty) => {
              if (dirty && !(await save(values, true))) return false;
              try {
                await publish.mutateAsync(published ? 'unpublish' : 'publish');
                toast(published ? t.unpublished : t.published);
                return true;
              } catch (error) {
                report(error);
                return false;
              }
            }
          : undefined
      }
      onDuplicate={
        id
          ? async () => {
              try {
                const source = await client.find(collection.slug, id, {
                  depth: 0,
                  ...(canReadDrafts ? { draft: true } : {}),
                });
                const created = await create.mutateAsync(copyOf(source, collection, t.copySuffix));
                toast(t.duplicated);
                onNavigate({ view: 'edit', slug: collection.slug, id: String(created.id) });
              } catch (error) {
                report(error);
              }
            }
          : undefined
      }
      onDelete={
        id
          ? () => {
              void confirm({
                title: t.deleteConfirm,
                body: collection.softDelete ? undefined : t.deleteBody,
                action: t.delete,
                danger: true,
              }).then((answer) => {
                if (!answer) return;
                remove.mutate(id, {
                  onSuccess: () => {
                    toast(t.deleted);
                    onNavigate({ view: 'list', slug: collection.slug }, { force: true });
                  },
                  onError: report,
                });
              });
            }
          : undefined
      }
    />
  );
}

function GlobalView({
  global,
  schema,
  onDirtyChange,
}: {
  global: AdminCollection;
  schema: AdminSchema;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useMessages();
  const toast = useToast();
  const document = useGlobalDocument(global.slug);
  const update = useUpdateGlobal(global.slug);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (document.isLoading) return <div className="boot" aria-busy="true" />;
  // A global has no row until its first save: that is an empty form, not an error.
  const missing = document.error instanceof CmsApiError && document.error.status === 404;
  if (document.error && !missing) return <p className="error">{document.error.message}</p>;

  return (
    <EditForm
      global
      collection={global}
      doc={document.data ?? {}}
      permission={schema.permissions[global.slug]}
      saving={update.isPending}
      errors={errors}
      onDirtyChange={onDirtyChange}
      onSubmit={async (values) => {
        setErrors({});
        try {
          await update.mutateAsync(values);
          toast(t.saved);
          return true;
        } catch (error) {
          if (error instanceof CmsApiError && error.fields) setErrors(error.fields);
          else setErrors({ _: messageOf(error, t.requestFailed) });
          return false;
        }
      }}
    />
  );
}

/** Shown when the API answers 401: the host app owns the login, the panel only links to it. */
function SignIn() {
  const t = useMessages();
  const loginUrl = import.meta.env.VITE_CMS_LOGIN_URL ?? '/login';

  return (
    <div className="signin">
      <div className="signin__card">
        <h1 className="page-title">{t.signInTitle}</h1>
        <p>{t.signInBody}</p>
        <Button tone="accent" size="md" render={<a href={loginUrl}>{t.signIn}</a>} />
      </div>
    </div>
  );
}
