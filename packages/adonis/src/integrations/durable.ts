export type CmsEvent = {
  collection: string;
  operation: 'create' | 'update' | 'delete';
  documentId: string;
  tenant: string | null;
  userId: string | null;
  /** Snapshot after the write; absent on delete. */
  doc?: Record<string, unknown>;
};

export type CmsEventListener = (event: CmsEvent) => void | Promise<void>;

/**
 * Post-commit event bus.
 *
 * `afterChange` hooks run inside the transaction, so external effects must wait until the write
 * is durable. The repository emits here **after** the commit; the host forwards to
 * `@adonis-agora/durable` (or any queue) with `on`.
 */
export type CmsEventBus = {
  emit(event: CmsEvent): void;
  on(listener: CmsEventListener): () => void;
  listenerCount(): number;
};

export function createCmsEvents(): CmsEventBus {
  const listeners = new Set<CmsEventListener>();

  return {
    emit(event) {
      for (const listener of listeners) {
        try {
          void listener(event);
        } catch {
          // A listener must never break the write that already committed.
        }
      }
    },

    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    listenerCount() {
      return listeners.size;
    },
  };
}

/**
 * Bridges the bus to `@adonis-agora/durable` without importing it: pass a function that
 * dispatches a job, and every committed CMS event becomes one.
 */
export function durableBridge(options: {
  dispatch: (name: string, payload: Record<string, unknown>) => unknown;
  jobName?: string;
}): { listen(bus: CmsEventBus): () => void } {
  return {
    listen(bus) {
      return bus.on((event) => {
        void options.dispatch(options.jobName ?? 'cms.document.changed', { ...event });
      });
    },
  };
}
