import { ArrowDown, ArrowUp, Columns3, Plus, Search, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Badge, Button, Input } from '../atoms/index.js';
import { useCms, useMessages } from '../context.js';
import { fieldTitle, flattenFields, humanize } from '../registry.js';
import type { AdminCollection, AdminDocument, AdminField, AdminPermission } from '../types.js';

export type DataTableProps = {
  collection: AdminCollection;
  docs: AdminDocument[];
  total?: number | undefined;
  permission?: AdminPermission | undefined;
  onOpen: (doc: AdminDocument) => void;
  onCreate?: (() => void) | undefined;
  onDelete?: ((doc: AdminDocument) => void) | undefined;
  onRestore?: ((doc: AdminDocument) => void) | undefined;
  /** Deletes every selected row at once; omit to hide the row checkboxes. */
  onDeleteMany?: ((docs: AdminDocument[]) => void) | undefined;
  showDeleted?: boolean | undefined;
  onToggleDeleted?: (() => void) | undefined;
  busy?: boolean | undefined;
  loading?: boolean | undefined;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
  /** Omit to hide the search box. */
  onSearch?: ((term: string) => void) | undefined;
  /** `title` ascending, `-title` descending. */
  sort?: string | undefined;
  onSort?: ((sort: string | undefined) => void) | undefined;
  /** Filter controls, shown in the toolbar. */
  filters?: ReactNode;
  /** Publishes every selected row; omit to hide the button. */
  onPublishMany?: ((docs: AdminDocument[], action: 'publish' | 'unpublish') => void) | undefined;
  /** Sets one field on every selected row; omit to hide the button. */
  onEditMany?: ((docs: AdminDocument[]) => void) | undefined;
};

const SORTABLE = new Set([
  'text',
  'slug',
  'email',
  'number',
  'date',
  'select',
  'radio',
  'checkbox',
]);
const LISTABLE = new Set([...SORTABLE, 'relation', 'upload', 'textarea']);
const INTERACTIVE = 'button, a, input, label';

/** Schema-driven list: columns from `admin.defaultColumns`, actions gated by permissions. */
export function DataTable({
  collection,
  docs,
  total,
  permission,
  onOpen,
  onCreate,
  onDelete,
  onRestore,
  onDeleteMany,
  showDeleted,
  onToggleDeleted,
  busy,
  loading,
  error,
  onRetry,
  onSearch,
  sort,
  onSort,
  filters,
  onPublishMany,
  onEditMany,
}: DataTableProps) {
  const t = useMessages();
  const { locale } = useCms();
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());

  const allFields = flattenFields(collection.fields);
  const fieldsByName = new Map(allFields.map((field) => [field.name, field]));
  const defaults = collection.admin?.defaultColumns?.length
    ? [...collection.admin.defaultColumns]
    : [collection.admin?.useAsTitle ?? 'id'];
  const columnsKey = `cms-columns-${collection.slug}`;
  const [custom, setCustom] = useState<string[] | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(columnsKey) ?? 'null') as string[] | null;
    } catch {
      return null;
    }
  });
  const columnChoices = allFields.filter(
    (field) => LISTABLE.has(field.type) && !field.hidden && !field.admin?.hiddenInList,
  );
  // Fields removed from the config since the choice was stored simply drop out.
  const columns = (custom ?? defaults).filter(
    (name) => fieldsByName.has(name) || defaults.includes(name),
  );
  const toggleColumn = (name: string) => {
    const next = columns.includes(name)
      ? columns.filter((item) => item !== name)
      : columnChoices
          .map((field) => field.name)
          .filter((item) => columns.includes(item) || item === name);
    if (next.length === 0) return;
    setCustom(next);
    localStorage.setItem(columnsKey, JSON.stringify(next));
  };
  const showUpdated = docs.some((doc) => typeof doc.updatedAt === 'string');
  const selectable = Boolean(onDeleteMany && permission?.delete && !showDeleted);
  const columnCount =
    columns.length + (collection.drafts ? 1 : 0) + (showUpdated ? 1 : 0) + (selectable ? 2 : 1);

  // Debounced: the list refetches per keystroke otherwise. Only user typing counts.
  const emitted = useRef('');
  useEffect(() => {
    if (term === emitted.current) return;
    const timer = window.setTimeout(() => {
      emitted.current = term;
      onSearch?.(term);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [term, onSearch]);

  // A selection never outlives the rows on screen (page change, search, delete).
  const visibleKey = docs.map((doc) => String(doc.id)).join();
  useEffect(() => {
    setPicked((current) => {
      const visible = new Set(visibleKey.split(','));
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleKey]);

  const allPicked = docs.length > 0 && docs.every((doc) => picked.has(String(doc.id)));

  const togglePicked = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const nextSort = (column: string) => {
    if (sort === column) return `-${column}`;
    if (sort === `-${column}`) return undefined;
    return column;
  };

  const header = (column: string, label: string, sortable: boolean): ReactNode => {
    const direction = sort === column ? 'ascending' : sort === `-${column}` ? 'descending' : 'none';
    return (
      <th key={column} scope="col" aria-sort={direction}>
        {sortable && onSort ? (
          <button type="button" className="th-sort" onClick={() => onSort(nextSort(column))}>
            {label}
            {direction === 'ascending' ? <ArrowUp aria-hidden /> : null}
            {direction === 'descending' ? <ArrowDown aria-hidden /> : null}
          </button>
        ) : (
          label
        )}
      </th>
    );
  };

  return (
    <div className="page-enter">
      <div className="page-head">
        <div>
          <h1 className="page-title">{collection.labels?.plural ?? humanize(collection.slug)}</h1>
          <p className="page-sub">
            {total === undefined ? ' ' : `${total} ${total === 1 ? t.document : t.documents}`}
          </p>
        </div>

        <div className="toolbar">
          {filters}

          <details className="menu">
            <summary className="btn btn--ghost btn--md">
              <Columns3 aria-hidden />
              {t.columns}
            </summary>
            <div className="menu__body">
              {columnChoices.map((field) => (
                <label key={field.name} className="check">
                  <input
                    type="checkbox"
                    checked={columns.includes(field.name)}
                    onChange={() => toggleColumn(field.name)}
                  />
                  {fieldTitle(field)}
                </label>
              ))}
            </div>
          </details>

          {collection.softDelete && onToggleDeleted ? (
            <label className="check">
              <input type="checkbox" checked={showDeleted ?? false} onChange={onToggleDeleted} />
              {t.showDeleted}
            </label>
          ) : null}

          {onSearch ? (
            <div className="search">
              <Search aria-hidden />
              <Input
                type="search"
                aria-label={t.search}
                placeholder={t.search}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
              />
            </div>
          ) : null}

          {onCreate && permission?.create !== false ? (
            <Button tone="accent" size="md" onClick={onCreate}>
              <Plus aria-hidden />
              {t.new}
            </Button>
          ) : null}
        </div>
      </div>

      {picked.size > 0 ? (
        <div className="bulk" role="status">
          <span>
            <span className="num">{picked.size}</span> {t.selected}
          </span>
          {onEditMany && permission?.update !== false ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onEditMany(docs.filter((doc) => picked.has(String(doc.id))))}
            >
              {t.editSelected}
            </Button>
          ) : null}
          {onPublishMany && collection.drafts && permission?.update !== false ? (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  onPublishMany(
                    docs.filter((doc) => picked.has(String(doc.id))),
                    'publish',
                  )
                }
              >
                {t.publish}
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  onPublishMany(
                    docs.filter((doc) => picked.has(String(doc.id))),
                    'unpublish',
                  )
                }
              >
                {t.unpublish}
              </Button>
            </>
          ) : null}
          <Button
            size="sm"
            tone="destructive"
            disabled={busy}
            onClick={() => onDeleteMany?.(docs.filter((doc) => picked.has(String(doc.id))))}
          >
            <Trash2 aria-hidden />
            {t.delete}
          </Button>
          <Button size="sm" tone="ghost" onClick={() => setPicked(new Set())}>
            {t.cancel}
          </Button>
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {selectable ? (
                <th className="table__pick">
                  <input
                    type="checkbox"
                    aria-label={t.selectAll}
                    checked={allPicked}
                    onChange={() =>
                      setPicked(allPicked ? new Set() : new Set(docs.map((doc) => String(doc.id))))
                    }
                  />
                </th>
              ) : null}
              {columns.map((column) => {
                const field = fieldsByName.get(column);
                return header(
                  column,
                  field ? fieldTitle(field) : humanize(column),
                  Boolean(field && SORTABLE.has(field.type)),
                );
              })}
              {collection.drafts ? <th scope="col">{t.status}</th> : null}
              {showUpdated ? header('updatedAt', t.updated, true) : null}
              <th scope="col" aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={columnCount}>
                  <div className="empty">
                    <strong>{t.loadFailed}</strong>
                    <span>{error}</span>
                    {onRetry ? (
                      <Button size="sm" onClick={onRetry}>
                        {t.retry}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : loading ? (
              [0, 1, 2, 3].map((row) => (
                <tr key={row} aria-hidden>
                  <td colSpan={columnCount}>
                    <span className="bone" />
                  </td>
                </tr>
              ))
            ) : docs.length === 0 ? (
              <tr>
                <td colSpan={columnCount}>
                  <div className="empty">
                    <strong>{term ? t.noResults : t.noDocuments}</strong>
                    {term ? (
                      <Button size="sm" onClick={() => setTerm('')}>
                        {t.clearSearch}
                      </Button>
                    ) : (
                      <span>{t.noDocumentsHint}</span>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              docs.map((doc) => (
                <tr
                  key={String(doc.id)}
                  className={showDeleted ? undefined : 'table__row--link'}
                  onClick={(event) => {
                    if (showDeleted) return;
                    if ((event.target as Element).closest(INTERACTIVE)) return;
                    onOpen(doc);
                  }}
                >
                  {selectable ? (
                    <td className="table__pick">
                      <input
                        type="checkbox"
                        aria-label={`${t.select} ${String(doc.id)}`}
                        checked={picked.has(String(doc.id))}
                        onChange={() => togglePicked(String(doc.id))}
                      />
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td key={column}>
                      {renderCell(doc[column], fieldsByName.get(column), t.yes, t.no)}
                    </td>
                  ))}
                  {collection.drafts ? (
                    <td>
                      <Badge tone={doc._status === 'published' ? 'good' : 'warn'}>
                        {doc._status === 'published' ? t.published : t.draft}
                      </Badge>
                    </td>
                  ) : null}
                  {showUpdated ? (
                    <td className="table__date">{formatDate(doc.updatedAt, locale)}</td>
                  ) : null}
                  <td>
                    <div className="table__actions">
                      {showDeleted && onRestore ? (
                        <Button size="sm" onClick={() => onRestore(doc)} disabled={busy}>
                          {t.restore}
                        </Button>
                      ) : (
                        <Button size="sm" tone="ghost" onClick={() => onOpen(doc)} disabled={busy}>
                          {t.edit}
                        </Button>
                      )}
                      {!showDeleted && onDelete && permission?.delete ? (
                        <Button
                          size="sm"
                          tone="ghost"
                          className="btn--danger-hover"
                          aria-label={t.delete}
                          title={t.delete}
                          onClick={() => onDelete(doc)}
                          disabled={busy}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDate(value: unknown, locale: string): string {
  if (typeof value !== 'string') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderCell(
  value: unknown,
  field: AdminField | undefined,
  yes: string,
  no: string,
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? yes : no;
  const option = field?.options?.find((item) => item.value === value);
  if (option) return option.label;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.title === 'string') return record.title;
    if (typeof record.titulo === 'string') return record.titulo;
    if (typeof record.name === 'string') return record.name;
    if (typeof record.slug === 'string') return record.slug;
    return Array.isArray(value) ? `${value.length}` : '…';
  }
  return String(value);
}
