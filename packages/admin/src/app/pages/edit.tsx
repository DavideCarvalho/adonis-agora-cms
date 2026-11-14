import {
  type AdminCollection,
  type AdminDocument,
  type AdminSchema,
  Button,
  CmsApiError,
  cmsKeys,
  EditForm,
  useAutosaveDocument,
  useCms,
  useConfirm,
  useCreateDocument,
  useDeleteDocument,
  useDocument,
  useGlobalDocument,
  useMessages,
  usePreviewToken,
  usePublishDocument,
  useUpdateDocument,
  useUpdateGlobal,
} from '@adonis-agora/cms-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RegionError } from '../../agora-kit/blocks/error-boundary';
import { Button as KitButton } from '../../agora-kit/ui/button';
import type { Route } from '../hash-route.js';
import { messageOf } from '../messages.js';
import { EditSkeleton } from '../skeletons.js';
import { useToast } from '../toast.js';

type Navigate = (route: Route, options?: { force?: boolean }) => void;

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

/** A dialog, not a prompt: a browser prompt shows the password as it is typed. */
function SetPassword({ userId }: { userId: string }) {
  const t = useMessages();
  const toast = useToast();
  const { client } = useCms();
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button size="md" tone="ghost" onClick={() => dialog.current?.showModal()}>
        {t.setPassword}
      </Button>
      <dialog ref={dialog} className="confirm" aria-label={t.setPassword}>
        <h2 className="confirm__title">{t.setPassword}</h2>
        <label className="label" htmlFor="cms-set-password">
          {t.newPassword}
        </label>
        <input
          id="cms-set-password"
          className="input"
          type="password"
          autoComplete="new-password"
          minLength={8}
        />
        <div className="confirm__actions">
          <Button size="md" onClick={() => dialog.current?.close()}>
            {t.cancel}
          </Button>
          <Button
            size="md"
            tone="accent"
            onClick={() => {
              const input = dialog.current?.querySelector('input');
              if (!input?.reportValidity() || !input.value) return;
              client
                .auth('password', { userId, password: input.value })
                .then(() => {
                  input.value = '';
                  dialog.current?.close();
                  toast(t.passwordChanged);
                })
                .catch((error: unknown) => toast(messageOf(error, t.requestFailed), 'bad'));
            }}
          >
            {t.setPassword}
          </Button>
        </div>
      </dialog>
    </>
  );
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

/** One document: the form, drafts and publishing, versions, locks, schedule, preview. */
export function EditView({
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
  const update = useUpdateDocument(collection.slug, id ?? '', { draft: canReadDrafts });
  const publish = usePublishDocument(collection.slug, id ?? '');
  const remove = useDeleteDocument(collection.slug);
  const previewable = Boolean(collection.admin?.livePreview || collection.admin?.visualEditor);
  const preview = usePreviewToken(collection.slug, previewable ? id : undefined);

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

  if (id && document.isLoading) return <EditSkeleton />;
  if (id && document.error)
    return (
      <div className="flex flex-col items-start gap-3">
        <RegionError
          title={t.loadFailed}
          error={document.error}
          onRetry={() => void document.refetch()}
          className="w-full"
        />
        <KitButton variant="outline" size="sm" onClick={back}>
          {t.back}
        </KitButton>
      </div>
    );

  const published = document.data?._status === 'published';
  const hasDraft = document.data?._hasDraft === true;

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
      draftOverPublished={canReadDrafts}
      headerActions={
        id && schema.admin.auth?.collection === collection.slug ? <SetPassword userId={id} /> : null
      }
      onDiscardDraft={
        id
          ? () => {
              void confirm({
                title: t.discardDraft,
                body: t.discardDraftBody,
                action: t.discard,
                danger: true,
              }).then((answer) => {
                if (!answer) return;
                client
                  .discardDraft(collection.slug, id)
                  .then(() => {
                    toast(t.discardDraft);
                    void queryClient.invalidateQueries({
                      queryKey: [...cmsKeys.all, 'doc', collection.slug, id],
                    });
                  })
                  .catch(report);
              });
            }
          : undefined
      }
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
                const action = published && !hasDraft && !dirty ? 'unpublish' : 'publish';
                await publish.mutateAsync(action);
                toast(action === 'unpublish' ? t.unpublished : t.published);
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

/** A global: one document for the whole site; no row until its first save. */
export function GlobalView({
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

  if (document.isLoading) return <EditSkeleton />;
  // A global has no row until its first save: that is an empty form, not an error.
  const missing = document.error instanceof CmsApiError && document.error.status === 404;
  if (document.error && !missing)
    return (
      <RegionError
        title={t.loadFailed}
        error={document.error}
        onRetry={() => void document.refetch()}
      />
    );

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
