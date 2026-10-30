import { Badge, Button } from '../atoms/index.js';
import { cn } from '../cn.js';
import type { AdminCollection, AdminDocument, AdminPermission } from '../types.js';

export type DataTableProps = {
  collection: AdminCollection;
  docs: AdminDocument[];
  permission?: AdminPermission | undefined;
  onOpen: (doc: AdminDocument) => void;
  onCreate?: (() => void) | undefined;
  onDelete?: ((doc: AdminDocument) => void) | undefined;
  onRestore?: ((doc: AdminDocument) => void) | undefined;
  showDeleted?: boolean | undefined;
  onToggleDeleted?: (() => void) | undefined;
  busy?: boolean | undefined;
};

/** Schema-driven list. Columns come from `admin.defaultColumns`, falling back to the title field. */
export function DataTable({
  collection,
  docs,
  permission,
  onOpen,
  onCreate,
  onDelete,
  onRestore,
  showDeleted,
  onToggleDeleted,
  busy,
}: DataTableProps) {
  const columns = collection.admin?.defaultColumns?.length
    ? [...collection.admin.defaultColumns]
    : [collection.admin?.useAsTitle ?? 'id'];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">
          {collection.labels?.plural ?? collection.slug}
        </h2>
        <div className="flex items-center gap-3">
          {collection.softDelete && onToggleDeleted ? (
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <input type="checkbox" checked={showDeleted ?? false} onChange={onToggleDeleted} />
              Show deleted
            </label>
          ) : null}
          {onCreate && permission?.create !== false ? (
            <Button variant="primary" onClick={onCreate}>
              New
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-3 py-2 font-medium">
                  {column}
                </th>
              ))}
              {collection.drafts ? <th className="px-3 py-2 font-medium">status</th> : null}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="px-3 py-10 text-center text-zinc-500">
                  No documents yet.
                </td>
              </tr>
            ) : (
              docs.map((doc) => (
                <tr key={String(doc.id)} className="border-t border-zinc-100 hover:bg-zinc-50">
                  {columns.map((column) => (
                    <td key={column} className="px-3 py-2 text-zinc-800">
                      {renderCell(doc[column])}
                    </td>
                  ))}
                  {collection.drafts ? (
                    <td className="px-3 py-2">
                      <Badge tone={doc._status === 'published' ? 'success' : 'warning'}>
                        {String(doc._status ?? 'draft')}
                      </Badge>
                    </td>
                  ) : null}
                  <td className={cn('px-3 py-2 text-right')}>
                    <div className="flex justify-end gap-1">
                      {showDeleted && onRestore ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onRestore(doc)}
                          disabled={busy}
                        >
                          Restore
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onOpen(doc)}
                          disabled={busy}
                        >
                          Edit
                        </Button>
                      )}
                      {!showDeleted && onDelete && permission?.delete ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onDelete(doc)}
                          disabled={busy}
                        >
                          Delete
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
  if (value === null || value === undefined) return '—';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('title' in (value as Record<string, unknown>)) {
      return String((value as Record<string, unknown>).title);
    }
    return Array.isArray(value) ? `${value.length} item(s)` : '…';
  }
  return String(value);
}
