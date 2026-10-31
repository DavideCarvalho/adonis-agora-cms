import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button } from '../atoms/index.js';
import { useCms, useMessages } from '../context.js';
import { useRestoreVersion, useVersions } from '../queries.js';
import { fieldTitle, flattenFields } from '../registry.js';
import type { AdminDocument, AdminField } from '../types.js';

export type VersionsPanelProps = {
  slug: string;
  id: string;
  open: boolean;
  onClose: () => void;
  /** The restore landed: the form must take the restored document. */
  onRestored?: (() => void) | undefined;
  /** With these two, each version can be compared with what the form holds now. */
  current?: AdminDocument | undefined;
  fields?: readonly AdminField[] | undefined;
};

/** Ids and row order columns differ between reads without the content having changed. */
function comparable(value: unknown): unknown {
  if (value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (typeof record.id === 'string' && Object.keys(record).length > 2) return record.id;
  const entries = Object.entries(record)
    .filter(([key]) => key !== 'id' && key !== '_order')
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries.map(([key, item]) => [key, comparable(item)]));
}

function summarize(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value.length > 140 ? `${value.slice(0, 140)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' ? id : '{…}';
}

function VersionDiff({
  slug,
  id,
  version,
  current,
  fields,
}: {
  slug: string;
  id: string;
  version: number;
  current: AdminDocument;
  fields: readonly AdminField[];
}) {
  const t = useMessages();
  const { client } = useCms();
  const query = useQuery({
    queryKey: ['cms', 'version', slug, id, version],
    queryFn: () => client.version(slug, id, version),
  });

  if (query.isLoading) return <p className="skeleton">{t.loading}</p>;
  if (query.error) return <p className="error">{query.error.message}</p>;

  const snapshot = query.data?.snapshot?.doc ?? {};
  const changed = flattenFields(fields)
    .filter((field) => !field.hidden)
    .filter(
      (field) =>
        JSON.stringify(comparable(snapshot[field.name])) !==
        JSON.stringify(comparable(current[field.name])),
    );

  if (changed.length === 0) return <p className="hint">{t.noDifferences}</p>;

  return (
    <dl className="diff">
      {changed.map((field) => (
        <div key={field.name} className="diff__row">
          <dt>{fieldTitle(field)}</dt>
          <dd>
            <del title={t.inThisVersion}>{summarize(snapshot[field.name])}</del>
            <ins title={t.inTheForm}>{summarize(current[field.name])}</ins>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Version history with one-click restore. Restoring writes a new version, never rewrites. */
export function VersionsPanel({
  slug,
  id,
  open,
  onClose,
  onRestored,
  current,
  fields,
}: VersionsPanelProps) {
  const t = useMessages();
  const versions = useVersions(slug, id);
  const restore = useRestoreVersion(slug, id);
  const [comparing, setComparing] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside className="panel" role="dialog" aria-label={t.history}>
      <header className="panel__head">
        <h2>{t.history}</h2>
        <Button size="sm" tone="ghost" onClick={onClose} aria-label={t.close} title={t.close}>
          <X aria-hidden />
        </Button>
      </header>

      <div className="panel__body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {versions.isLoading ? <p className="skeleton">{t.loading}</p> : null}
        {versions.error ? <p className="error">{t.versionsFailed}</p> : null}

        {(versions.data?.docs ?? []).map((version) => (
          <div key={version.id} className="version">
            <div className="version__row">
              <span className="version__meta">v{version.version}</span>
              <Badge tone={version.status === 'published' ? 'good' : 'warn'}>
                {version.status === 'published' ? t.published : t.draft}
              </Badge>
            </div>
            <span className="version__meta">
              {new Date(version.createdAt).toLocaleString()}
              {version.autosave ? ` · ${t.autosave}` : ''}
            </span>
            <div className="version__actions">
              {current && fields ? (
                <Button
                  size="sm"
                  tone={comparing === version.version ? 'selected' : 'ghost'}
                  aria-pressed={comparing === version.version}
                  onClick={() =>
                    setComparing((value) => (value === version.version ? null : version.version))
                  }
                >
                  {t.compare}
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={restore.isPending || version.isLatest}
                onClick={() =>
                  restore.mutate(version.version, {
                    onSuccess: () => {
                      onRestored?.();
                      onClose();
                    },
                  })
                }
              >
                {version.isLatest ? t.current : t.restore}
              </Button>
            </div>
            {comparing === version.version && current && fields ? (
              <VersionDiff
                slug={slug}
                id={id}
                version={version.version}
                current={current}
                fields={fields}
              />
            ) : null}
          </div>
        ))}

        {versions.data && versions.data.docs.length === 0 ? (
          <p className="skeleton">{t.noVersions}</p>
        ) : null}
      </div>
    </aside>
  );
}
