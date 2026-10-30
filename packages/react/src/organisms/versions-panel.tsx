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
    <aside className="panel" role="dialog" aria-label={t.history}>
      <header className="panel__head">
        <h2>{t.history}</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t.close}
        </Button>
      </header>

      <div className="panel__body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {versions.isLoading ? <p className="skeleton">{t.loading}</p> : null}
        {versions.error ? <p className="error">Failed to load versions.</p> : null}

        {(versions.data?.docs ?? []).map((version) => (
          <div key={version.id} className="version">
            <div className="version__row">
              <span className="version__meta">v{version.version}</span>
              <Badge tone={version.status === 'published' ? 'success' : 'warning'}>
                {version.status}
              </Badge>
            </div>
            <span className="version__meta">
              {new Date(version.createdAt).toLocaleString()}
              {version.autosave ? ' · autosave' : ''}
            </span>
            <Button
              size="sm"
              disabled={restore.isPending || version.isLatest}
              onClick={() => restore.mutate(version.version, { onSuccess: onClose })}
            >
              {version.isLatest ? t.current : t.restore}
            </Button>
          </div>
        ))}

        {versions.data && versions.data.docs.length === 0 ? (
          <p className="skeleton">{t.noVersions}</p>
        ) : null}
      </div>
    </aside>
  );
}
