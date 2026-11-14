import {
  type AdminCollection,
  type AdminDocument,
  type AdminField,
  type AdminSchema,
  Button,
  cmsKeys,
  DataTable,
  fieldTitle,
  flattenFields,
  resolveFieldComponent,
  useCms,
  useConfirm,
  useDeleteDocument,
  useDocuments,
  useMessages,
  useRestoreDocument,
} from '@adonis-agora/cms-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseCsv, toCsv } from '../csv.js';
import type { Route } from '../hash-route.js';
import { BookmarkPlusIcon, BookmarkXIcon, DownloadIcon, UploadIcon } from '../icons.js';
import { messageOf } from '../messages.js';
import { useToast } from '../toast.js';

type Navigate = (route: Route, options?: { force?: boolean }) => void;

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

/** A collection: filters, saved views, CSV in and out, bulk edit, trash. */
export function ListView({
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

  const relationFilters = useMemo(
    () =>
      allFields
        .filter(
          (field) =>
            field.type === 'relation' && typeof field.relationTo === 'string' && !field.hasMany,
        )
        .slice(0, 2),
    [allFields],
  );
  const dateFilters = useMemo(
    () => allFields.filter((field) => field.type === 'date').slice(0, 2),
    [allFields],
  );
  const [dateRanges, setDateRanges] = useState<Record<string, { from?: string; to?: string }>>({});
  const [editing, setEditing] = useState<AdminDocument[] | null>(null);
  const filtersNow: SavedFilter = { status, fieldFilters, dateRanges };
  const applyFilter = (saved: SavedFilter) => {
    setStatus(saved.status);
    setFieldFilters(saved.fieldFilters);
    setDateRanges(saved.dateRanges);
    setPage(1);
  };

  const filter = useMemo(() => {
    const clause: Record<string, unknown> = {};
    for (const [name, range] of Object.entries(dateRanges)) {
      const condition: Record<string, string> = {};
      if (range.from) condition.gte = range.from;
      if (range.to) condition.lte = range.to;
      if (Object.keys(condition).length > 0) clause[name] = condition;
    }
    if (term && searchField) clause[searchField] = { iContains: term };
    if (status) clause._status = { equals: status };
    for (const [name, value] of Object.entries(fieldFilters)) {
      if (value) clause[name] = { equals: value };
    }
    return clause;
  }, [term, searchField, status, fieldFilters, dateRanges]);

  const query = useMemo(
    () => ({
      page,
      size: 20,
      depth: 0,
      ...(canReadDrafts ? { draft: true } : {}),
      ...(sort ? { sort } : {}),
      ...(showDeleted ? { deleted: true } : {}),
      ...(Object.keys(filter).length > 0 ? { filter } : {}),
    }),
    [page, showDeleted, sort, filter, canReadDrafts],
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
        const result = await client.list(collection.slug, { ...query, page: next, size: 200 });
        rows.push(...result.data);
        next = result.meta.currentPage < result.meta.lastPage ? next + 1 : null;
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
        docs={documents.data?.data ?? []}
        total={documents.data?.meta.total}
        permission={schema.permissions[collection.slug]}
        busy={remove.isPending || restore.isPending}
        loading={documents.isLoading}
        error={documents.error?.message}
        onRetry={() => void documents.refetch()}
        onSearch={searchField ? onSearch : undefined}
        filters={
          <>
            <SavedFilters slug={collection.slug} current={filtersNow} onApply={applyFilter} />
            <Button
              size="md"
              tone="ghost"
              aria-label={t.exportCsv}
              title={t.exportCsv}
              onClick={() => void exportCsv()}
            >
              <DownloadIcon />
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
                  <UploadIcon />
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
            {relationFilters.map((field) => (
              <RelationFilter
                key={field.name}
                field={field}
                schema={schema}
                value={fieldFilters[field.name] ?? ''}
                onChange={(value) => {
                  setFieldFilters((current) => ({ ...current, [field.name]: value }));
                  setPage(1);
                }}
              />
            ))}
            {dateFilters.map((field) =>
              (['from', 'to'] as const).map((edge) => (
                <input
                  key={`${field.name}-${edge}`}
                  type="date"
                  className="select select--inline"
                  aria-label={`${fieldTitle(field)} ${t[edge]}`}
                  title={`${fieldTitle(field)} ${t[edge]}`}
                  value={dateRanges[field.name]?.[edge] ?? ''}
                  onChange={(event) => {
                    setDateRanges((current) => ({
                      ...current,
                      [field.name]: { ...current[field.name], [edge]: event.target.value },
                    }));
                    setPage(1);
                  }}
                />
              )),
            )}
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
        onEditMany={setEditing}
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

      {editing ? (
        <BulkEdit
          fields={allFields}
          docs={editing}
          draft={canReadDrafts}
          slug={collection.slug}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {(documents.data?.meta.lastPage ?? 1) > 1 ? (
        <div className="pager">
          <Button
            size="sm"
            disabled={(documents.data?.meta.currentPage ?? 1) <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            {t.previous}
          </Button>
          <span className="num">
            {documents.data?.meta.currentPage ?? 1} / {documents.data?.meta.lastPage ?? 1}
          </span>
          <Button
            size="sm"
            disabled={
              (documents.data?.meta.currentPage ?? 1) >= (documents.data?.meta.lastPage ?? 1)
            }
            onClick={() => setPage((value) => value + 1)}
          >
            {t.next}
          </Button>
        </div>
      ) : null}
    </>
  );
}

type SavedFilter = {
  status: string;
  fieldFilters: Record<string, string>;
  dateRanges: Record<string, { from?: string; to?: string }>;
};

const savedFiltersKey = (slug: string) => `cms:saved-filters:${slug}`;

function readSavedFilters(slug: string): Record<string, SavedFilter> {
  try {
    return JSON.parse(window.localStorage.getItem(savedFiltersKey(slug)) ?? '{}');
  } catch {
    return {};
  }
}

/** Kept in this browser: a view of the list, not content the API should know about. */
function SavedFilters({
  slug,
  current,
  onApply,
}: {
  slug: string;
  current: SavedFilter;
  onApply: (saved: SavedFilter) => void;
}) {
  const t = useMessages();
  const [saved, setSaved] = useState(() => readSavedFilters(slug));
  const [active, setActive] = useState('');
  const names = Object.keys(saved).sort();
  const store = (next: Record<string, SavedFilter>) => {
    window.localStorage.setItem(savedFiltersKey(slug), JSON.stringify(next));
    setSaved(next);
  };

  return (
    <>
      {names.length > 0 ? (
        <select
          className="select select--inline"
          aria-label={t.savedFilters}
          value={active}
          onChange={(event) => {
            const choice = saved[event.target.value];
            setActive(event.target.value);
            if (choice) onApply(choice);
          }}
        >
          <option value="">{t.savedFilters}</option>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ) : null}
      {active ? (
        <Button
          size="md"
          tone="ghost"
          aria-label={t.deleteSavedFilter}
          title={t.deleteSavedFilter}
          onClick={() => {
            const { [active]: _gone, ...rest } = saved;
            store(rest);
            setActive('');
          }}
        >
          <BookmarkXIcon />
        </Button>
      ) : null}
      <Button
        size="md"
        tone="ghost"
        aria-label={t.saveFilters}
        title={t.saveFilters}
        onClick={() => {
          const name = window.prompt(t.saveFiltersAs)?.trim();
          if (!name) return;
          store({ ...saved, [name]: current });
          setActive(name);
        }}
      >
        <BookmarkPlusIcon />
      </Button>
    </>
  );
}

function RelationFilter({
  field,
  schema,
  value,
  onChange,
}: {
  field: AdminField;
  schema: AdminSchema;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useMessages();
  const { client } = useCms();
  const target = String(field.relationTo);
  const title = schema.collections.find((item) => item.slug === target)?.admin?.useAsTitle;
  const options = useQuery({
    queryKey: ['cms', 'relation', target, ''],
    staleTime: 30_000,
    queryFn: () => client.list(target, { size: 100, depth: 0 }),
  });

  return (
    <select
      className="select select--inline"
      aria-label={fieldTitle(field)}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">
        {fieldTitle(field)}: {t.all.toLowerCase()}
      </option>
      {(options.data?.data ?? []).map((doc) => (
        <option key={String(doc.id)} value={String(doc.id)}>
          {String((title && doc[title]) ?? doc.id)}
        </option>
      ))}
    </select>
  );
}

const BULK_TYPES = new Set([
  'text',
  'textarea',
  'email',
  'number',
  'checkbox',
  'date',
  'select',
  'radio',
  'relation',
]);

/** One field, one value, every selected document. Partial failures are reported, not hidden. */
function BulkEdit({
  fields,
  docs,
  draft,
  slug,
  onClose,
}: {
  fields: readonly AdminField[];
  docs: AdminDocument[];
  draft: boolean;
  slug: string;
  onClose: () => void;
}) {
  const t = useMessages();
  const toast = useToast();
  const { client } = useCms();
  const queryClient = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const options = fields.filter(
    (field) =>
      BULK_TYPES.has(field.type) &&
      !field.hidden &&
      !field.unique &&
      !field.localized &&
      !field.restricted,
  );
  const [name, setName] = useState(options[0]?.name ?? '');
  const [value, setValue] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);
  const field = options.find((item) => item.name === name);
  const Component = field ? resolveFieldComponent(field) : null;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const apply = async () => {
    setBusy(true);
    const results = await Promise.allSettled(
      docs.map((doc) => client.update(slug, String(doc.id), { [name]: value }, { draft })),
    );
    const failed = results.filter((item) => item.status === 'rejected').length;
    toast(
      `${results.length - failed} ${t.updatedCount}${failed ? `, ${failed} ${t.failedRows}` : ''}`,
      failed ? 'bad' : 'ok',
    );
    void queryClient.invalidateQueries({ queryKey: [...cmsKeys.all, 'list', slug] });
    onClose();
  };

  return (
    <dialog
      ref={dialog}
      className="confirm bulk-edit"
      aria-label={t.bulkEditTitle}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 className="confirm__title">{t.bulkEditTitle}</h2>
      <p className="confirm__body">
        {docs.length} {docs.length === 1 ? t.document : t.documents}
      </p>
      <label className="label" htmlFor="cms-bulk-field">
        {t.field}
      </label>
      <select
        id="cms-bulk-field"
        className="select"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setValue(undefined);
        }}
      >
        {options.map((item) => (
          <option key={item.name} value={item.name}>
            {fieldTitle(item)}
          </option>
        ))}
      </select>
      {field && Component ? (
        <Component
          key={field.name}
          field={field}
          value={value}
          onChange={setValue}
          id="cms-bulk-value"
        />
      ) : null}
      <div className="confirm__actions">
        <Button size="md" onClick={onClose}>
          {t.cancel}
        </Button>
        <Button size="md" tone="accent" disabled={busy || !field} onClick={() => void apply()}>
          {t.apply}
        </Button>
      </div>
    </dialog>
  );
}
