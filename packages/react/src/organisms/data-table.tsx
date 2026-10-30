import { Badge, Button } from '../atoms/index.js';
import { useMessages } from '../context.js';
import type { AdminCollection, AdminDocument, AdminPermission } from '../types.js';

export type DataTableProps = {
  collection: AdminCollection;
  docs: AdminDocument[];
  total?: number | undefined;
  permission?: AdminPermission | undefined;
  onOpen: (doc: AdminDocument) => void;
  onCreate?: (() => void) | undefined;
  onDelete?: ((doc: AdminDocument) => void) | undefined;
  onRestore?: ((doc: AdminDocument) => void) | undefined;
  showDeleted?: boolean | undefined;
  onToggleDeleted?: (() => void) | undefined;
  busy?: boolean | undefined;
};

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
  showDeleted,
  onToggleDeleted,
  busy,
}: DataTableProps) {
  const t = useMessages();

  const columns = collection.admin?.defaultColumns?.length
    ? [...collection.admin.defaultColumns]
    : [collection.admin?.useAsTitle ?? 'id'];

  return (
    <div className="page-enter">
      <div className="page-head">
        <div>
          <h1 className="page-title">{collection.labels?.plural ?? collection.slug}</h1>
          <p className="page-sub">
            {total === undefined ? '—' : `${total} ${total === 1 ? 'document' : 'documents'}`}
          </p>
        </div>

        <div className="toolbar">
          {collection.softDelete && onToggleDeleted ? (
            <label className="check">
              <input type="checkbox" checked={showDeleted ?? false} onChange={onToggleDeleted} />
              {t.showDeleted}
            </label>
          ) : null}

          {onCreate && permission?.create !== false ? (
            <Button tone="accent" onClick={onCreate}>
              {t.new}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
              {collection.drafts ? <th>status</th> : null}
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2}>
                  <div className="empty">
                    <strong>{t.noDocuments}</strong>
                    Create the first one to see it here.
                  </div>
                </td>
              </tr>
            ) : (
              docs.map((doc) => (
                <tr key={String(doc.id)}>
                  {columns.map((column) => (
                    <td key={column}>{renderCell(doc[column])}</td>
                  ))}
                  {collection.drafts ? (
                    <td>
                      <Badge tone={doc._status === 'published' ? 'good' : 'warn'}>
                        {String(doc._status ?? 'draft')}
                      </Badge>
                    </td>
                  ) : null}
                  <td>
                    <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
                      {showDeleted && onRestore ? (
                        <Button
                          size="sm"
                          tone="ghost"
                          onClick={() => onRestore(doc)}
                          disabled={busy}
                        >
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
                          onClick={() => onDelete(doc)}
                          disabled={busy}
                        >
                          {t.delete}
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

function renderCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.title === 'string') return record.title;
    if (typeof record.name === 'string') return record.name;
    if (typeof record.slug === 'string') return record.slug;
    return Array.isArray(value) ? `${value.length} item(s)` : '…';
  }
  return String(value);
}
