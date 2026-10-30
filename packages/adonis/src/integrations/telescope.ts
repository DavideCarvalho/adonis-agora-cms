export type CmsObservation = {
  collection: string;
  operation: 'create' | 'update' | 'delete';
  durationMs: number;
  ok: boolean;
  documentId?: string;
  tenant?: string | null;
  userId?: string | null;
  error?: string;
};

export type CmsObserver = (observation: CmsObservation) => void;

export type TelescopeEntry = {
  type: 'cms';
  content: CmsObservation;
  tags: string[];
};

/**
 * Adapts CMS observations to a telescope-like recorder.
 *
 * Structural on purpose: `record` can be `telescope.record` from `@adonis-agora/telescope`,
 * a test spy, or a logger. Only field names and durations travel — never document data.
 */
export function telescopeWatcher(
  record: (entry: TelescopeEntry) => void,
  options: { tags?: readonly string[] } = {},
): CmsObserver {
  return (observation) => {
    record({
      type: 'cms',
      content: observation,
      tags: [...(options.tags ?? ['cms']), observation.collection, observation.operation],
    });
  };
}
