import { Badge, Button } from '../atoms/index.js';
import { useMessages } from '../context.js';
import { useRestoreVersion, useVersions } from '../queries.js';

export type VersionsPanelProps = {
  slug: string;
  id: string;
  open: boolean;
  onClose: () => void;
};

/** Version history with one-click restore. Restoring writes a new version, never rewrites. */
export function VersionsPanel({ slug, id, open, onClose }: VersionsPanelProps) {
  const t = useMessages();
  const versions = useVersions(slug, id);
  const restore = useRestoreVersion(slug, id);

  if (!open) return null;

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-96 flex-col border-l border-zinc-200 bg-white shadow-xl">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-2">
        <span className="text-sm font-medium text-zinc-700">{t.history}</span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-3">
        {versions.isLoading ? <p className="text-sm text-zinc-500">{t.loading}</p> : null}
        {versions.error ? <p className="text-sm text-red-600">Failed to load versions.</p> : null}

        <ul className="flex flex-col gap-2">
          {(versions.data?.docs ?? []).map((version) => (
            <li key={version.id} className="rounded-md border border-zinc-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">#{version.version}</span>
                <Badge tone={version.status === 'published' ? 'success' : 'warning'}>
                  {version.status}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {new Date(version.createdAt).toLocaleString()}
                {version.autosave ? ' · autosave' : ''}
              </p>
              <Button
                size="sm"
                className="mt-2"
                disabled={restore.isPending || version.isLatest}
                onClick={() => restore.mutate(version.version, { onSuccess: onClose })}
              >
                {version.isLatest ? t.current : t.restore}
              </Button>
            </li>
          ))}
        </ul>

        {versions.data && versions.data.docs.length === 0 ? (
          <p className="text-sm text-zinc-500">{t.noVersions}</p>
        ) : null}
      </div>
    </aside>
  );
}
