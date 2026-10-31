import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  CalendarClock,
  Copy,
  ExternalLink,
  GripVertical,
  History,
  type LucideIcon,
  Monitor,
  Plus,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FieldErrorsContext, normalizeFieldPath } from '../atoms/field.js';
import { Badge, Button } from '../atoms/index.js';
import { useCms, useMessages } from '../context.js';
import { LivePreview } from '../organisms/live-preview.js';
import {
  ArrayBuilder,
  BlocksBuilder,
  FieldTabs,
  isFieldVisible,
  StructuredRowFields,
} from '../organisms/structured.js';
import { VersionsPanel } from '../organisms/versions-panel.js';
import { PREVIEW_BLOCK_MIME } from '../preview.js';
import {
  blockTitle,
  fieldTitle,
  flattenFields,
  humanize,
  JsonField,
  resolveFieldComponent,
} from '../registry.js';
import type { AdminCollection, AdminDocument, AdminField, AdminPermission } from '../types.js';

/** `false` means the write failed: the form keeps its changes marked as unsaved. */
type WriteResult = boolean | undefined | Promise<boolean | undefined>;

export type EditFormProps = {
  collection: AdminCollection;
  doc: AdminDocument;
  permission?: AdminPermission | undefined;
  saving?: boolean | undefined;
  errors?: Record<string, string> | undefined;
  onSubmit: (values: AdminDocument) => WriteResult;
  /** Receives the form's values: publishing must not silently drop unsaved edits. */
  onPublish?: ((values: AdminDocument, dirty: boolean) => WriteResult) | undefined;
  onDelete?: (() => void) | undefined;
  onDuplicate?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  onRestored?: (() => void) | undefined;
  previewUrl?: string | undefined;
  locales?: readonly string[] | undefined;
  /** A global has a single document: there is nothing to create, version or list. */
  global?: boolean | undefined;
  /** Quiet save of a draft, after `autosaveInterval` ms without typing. */
  onAutosave?: ((values: AdminDocument) => Promise<boolean>) | undefined;
  autosaveInterval?: number | undefined;
  /** Someone else holds the document: the form is read-only and says who. */
  lockedBy?: string | null | undefined;
  /** Off when unpublishing would make the document unreachable from this panel. */
  canUnpublish?: boolean | undefined;
  /** Saving a published document keeps what is live until it is published. */
  draftOverPublished?: boolean | undefined;
  onDiscardDraft?: (() => void) | undefined;
  /** The pending publish/unpublish, and how to change it. Omit to hide the control. */
  schedule?: { at: string; action: string } | null | undefined;
  onSchedule?: ((at: string | null) => void) | undefined;
};

const SHORT = new Set([
  'text',
  'email',
  'slug',
  'number',
  'date',
  'select',
  'radio',
  'checkbox',
  'relation',
  'upload',
  'password',
]);

type View = 'visual' | 'form' | 'json';

/** Schema-driven form: scalars through the FieldRegistry, groups recursive, arrays/blocks built. */
export function EditForm({
  collection,
  doc,
  permission,
  saving,
  errors,
  onSubmit,
  onPublish,
  onDelete,
  onDuplicate,
  onBack,
  onDirtyChange,
  onRestored,
  previewUrl,
  locales = [],
  global: isGlobal = false,
  onAutosave,
  autosaveInterval,
  lockedBy,
  canUnpublish = true,
  draftOverPublished = false,
  onDiscardDraft,
  schedule,
  onSchedule,
}: EditFormProps) {
  const t = useMessages();
  const initial = useMemo<AdminDocument>(
    () => (doc.id || isGlobal ? doc : { ...defaultsOf(flattenFields(collection.fields)), ...doc }),
    [doc, isGlobal, collection.fields],
  );
  const initialKey = useMemo(() => JSON.stringify(initial), [initial]);
  const [values, setValues] = useState<AdminDocument>(initial);
  const [baseline, setBaseline] = useState(initialKey);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [locale, setLocale] = useState<string>(locales[0] ?? '');
  const blocksField = collection.fields.find((field) => field.type === 'blocks');
  const visualAllowed = Boolean(collection.admin?.visualEditor && blocksField && previewUrl);
  // `null` = follow the document: blocks + preview means visual. The preview URL arrives after
  // mount, so the default cannot be computed once in `useState`.
  const [viewPref, setViewPref] = useState<View | null>(null);
  const view: View =
    viewPref === 'visual' && !visualAllowed
      ? 'form'
      : (viewPref ?? (visualAllowed ? 'visual' : 'form'));
  const [selected, setSelected] = useState<{ field: string; index: number } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const dirty = useMemo(() => JSON.stringify(values) !== baseline, [values, baseline]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const adoptNext = useRef(false);

  const valuesRef = useRef(values);
  valuesRef.current = values;
  const [undoStack, setUndoStack] = useState<AdminDocument[]>([]);
  const undoRef = useRef<() => void>(() => undefined);

  // The server's document lands after a save, a publish or a restore. Unsaved typing is never
  // overwritten, except by a restore, which is the editor asking for exactly that.
  useEffect(() => {
    if (!adoptNext.current && dirtyRef.current) return;
    adoptNext.current = false;
    setValues(JSON.parse(initialKey) as AdminDocument);
    setBaseline(initialKey);
    setUndoStack([]);
  }, [initialKey]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(() => formRef.current?.requestSubmit(), []);

  const [autosaved, setAutosaved] = useState(false);
  const canAutosave = Boolean(
    onAutosave && autosaveInterval && (doc._status === 'draft' || draftOverPublished) && !lockedBy,
  );
  useEffect(() => {
    if (dirty) setAutosaved(false);
    if (!dirty || !canAutosave) return;
    const snapshot = values;
    const timer = window.setTimeout(() => {
      void onAutosave?.(snapshot).then((ok) => {
        if (!ok) return;
        setBaseline(JSON.stringify(snapshot));
        setAutosaved(true);
      });
    }, autosaveInterval);
    return () => window.clearTimeout(timer);
  }, [values, dirty, canAutosave, autosaveInterval, onAutosave]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
        return;
      }
      // Text fields keep their own undo; outside them it steps back through the document.
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        event.preventDefault();
        undoRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  // A click on a `data-cms-field` region in the preview brings that field into view here.
  const focusField = useCallback((name: string) => {
    const form = formRef.current;
    if (!form) return;
    const selector = typeof CSS_ESCAPE === 'function' ? CSS_ESCAPE(name) : name;
    const target =
      form.querySelector<HTMLElement>(`[id="${selector}"]`) ??
      form.querySelector<HTMLElement>(`[name="${selector}"]`);
    if (!target) return;

    const wrapper = target.closest('.field') ?? target;
    wrapper.classList.add('field--flash');
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.focus?.();
    window.setTimeout(() => wrapper.classList.remove('field--flash'), 1400);
  }, []);

  const readOnly = useMemo(() => {
    if (lockedBy) return true;
    if (isGlobal) return permission?.update === false;
    return doc.id ? permission?.update === false : permission?.create === false;
  }, [doc.id, permission, isGlobal, lockedBy]);

  const titleField = collection.admin?.useAsTitle;
  const slugField = flattenFields(collection.fields).find((field) => field.type === 'slug');

  const lastTyped = useRef(0);

  const setValue = (path: string, value: unknown) => {
    // One undo step per burst of typing, not per keystroke.
    const now = Date.now();
    if (now - lastTyped.current > 800) {
      setUndoStack((stack) => [...stack.slice(-49), valuesRef.current]);
    }
    lastTyped.current = now;
    setValues((current) => {
      const next = setByPath({ ...current }, path, value);
      // A new document's slug follows its title until the editor types their own.
      if (!doc.id && slugField && path === titleField) {
        const previous = slugify(String(current[path] ?? ''));
        if (String(current[slugField.name] ?? '') === previous) {
          next[slugField.name] = slugify(String(value ?? ''));
        }
      }
      return next;
    });
  };

  /** Structural edits from the preview toolbar mutate the same values the form edits. */
  const mutateRows = (field: string, next: (rows: unknown[]) => unknown[]) => {
    setUndoStack((stack) => [...stack.slice(-49), valuesRef.current]);
    setValues((current) => {
      const rows = getByPath(current, field);
      const list = Array.isArray(rows) ? rows : [];
      return setByPath({ ...current }, field, next([...list]));
    });
  };

  const undo = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setValues(previous);
    setSelected(null);
  };

  undoRef.current = undo;

  const moveBlock = (field: string, from: number, to: number) => {
    const rows = getByPath(valuesRef.current, field);
    if (!Array.isArray(rows) || from === to) return;
    if (from < 0 || to < 0 || from >= rows.length || to >= rows.length) return;
    mutateRows(field, (list) => {
      const [row] = list.splice(from, 1);
      if (row !== undefined) list.splice(to, 0, row);
      return list;
    });
    // The selection follows the block it was on.
    setSelected((current) => {
      if (!current || current.field !== field) return current;
      if (current.index === from) return { field, index: to };
      if (current.index > from && current.index <= to) return { field, index: current.index - 1 };
      if (current.index < from && current.index >= to) return { field, index: current.index + 1 };
      return current;
    });
  };

  const deleteBlock = (field: string, index: number) => {
    mutateRows(field, (rows) => rows.filter((_, position) => position !== index));
    setSelected((current) => {
      if (!current || current.field !== field) return current;
      if (current.index === index) return null;
      return current.index > index ? { field, index: current.index - 1 } : current;
    });
  };

  const duplicateBlock = (field: string, index: number) => {
    mutateRows(field, (rows) => {
      const row = rows[index];
      if (!row) return rows;
      const copy = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
      delete copy.id;
      delete copy._order;
      return [...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)];
    });
    setSelected({ field, index: index + 1 });
  };

  const focusBlock = (path: string) => {
    const form = formRef.current;
    if (!form) return;
    const first = form.querySelector<HTMLElement>(`[id^="${path}."]`);
    if (first) focusField(first.id);
  };

  const insertBlock = (field: string, type: string, index: number) => {
    const rows = getByPath(valuesRef.current, field);
    const at = Math.max(0, Math.min(index, Array.isArray(rows) ? rows.length : 0));
    mutateRows(field, (list) => [...list.slice(0, at), { type }, ...list.slice(at)]);
    setSelected({ field, index: at });
  };

  /** `layout[2].heading` -> { field: 'layout', index: 2 }; a root field clears the selection. */
  const selectFromPath = (path: string) => {
    // Non-greedy: `layout[1].items[0].title` belongs to block 1, not to `layout[1].items` row 0.
    const match = /^(.*?)\[(\d+)\]/.exec(path);
    setSelected(match ? { field: match[1] as string, index: Number(match[2]) } : null);
  };

  const visibleFields = collection.fields.filter((field) => !field.hidden);

  const write = async (run: () => WriteResult) => {
    const snapshot = valuesRef.current;
    const result = await run();
    if (result !== false) setBaseline(JSON.stringify(snapshot));
  };

  const errorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [path, message] of Object.entries(errors ?? {})) {
      map[normalizeFieldPath(path)] = message;
    }
    return map;
  }, [errors]);
  const errorEntries = Object.entries(errors ?? {});

  const singular = collection.labels?.singular ?? humanize(collection.slug);
  const docTitle = titleField ? values[titleField] : undefined;
  const title =
    typeof docTitle === 'string' && docTitle.trim()
      ? docTitle
      : doc.id || isGlobal
        ? singular
        : `${singular} — ${t.new.toLowerCase()}`;
  const canPublish = Boolean(onPublish && collection.drafts && permission?.update !== false);
  const published = doc._status === 'published';
  // Publishing is what is on offer whenever an edit is waiting, here or in the form.
  const pendingPublish = !published || Boolean(doc._hasDraft) || (dirty && draftOverPublished);

  return (
    <FieldErrorsContext.Provider value={errorMap}>
      <form
        ref={formRef}
        className="form page-enter"
        onSubmit={(event) => {
          event.preventDefault();
          void write(() => onSubmit(values));
        }}
      >
        <div className="form-head">
          <div className="form-head__left">
            {onBack ? (
              <Button tone="ghost" size="md" onClick={onBack} aria-label="back" title={t.back}>
                <ArrowLeft aria-hidden />
              </Button>
            ) : null}
            <div className="form-head__title">
              <h1 className="page-title">{title}</h1>
              {doc._status ? (
                <Badge tone={published && !doc._hasDraft ? 'good' : 'warn'}>
                  {doc._hasDraft ? t.pendingChanges : published ? t.published : t.draft}
                </Badge>
              ) : null}
              {dirty ? <span className="dirty">{t.unsavedChanges}</span> : null}
              {autosaved && !dirty ? <span className="hint">{t.autosaved}</span> : null}
            </div>
          </div>

          <div className="toolbar">
            {locales.length > 1 ? (
              <select
                aria-label="locale"
                className="select select--inline"
                value={locale}
                onChange={(event) => setLocale(event.target.value)}
              >
                {locales.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            ) : null}

            <fieldset className="segmented" aria-label="view">
              {visualAllowed ? (
                <Button
                  size="sm"
                  tone={view === 'visual' ? 'selected' : 'ghost'}
                  aria-pressed={view === 'visual'}
                  onClick={() => setViewPref('visual')}
                >
                  {t.visual}
                </Button>
              ) : null}
              <Button
                size="sm"
                tone={view === 'form' ? 'selected' : 'ghost'}
                aria-pressed={view === 'form'}
                onClick={() => setViewPref('form')}
              >
                {t.form}
              </Button>
              <Button
                size="sm"
                tone={view === 'json' ? 'selected' : 'ghost'}
                aria-pressed={view === 'json'}
                onClick={() => setViewPref('json')}
              >
                {t.json}
              </Button>
            </fieldset>

            {doc.id && collection.versioned && !isGlobal ? (
              <Button size="md" tone="ghost" onClick={() => setHistoryOpen(true)}>
                <History aria-hidden />
                {t.history}
              </Button>
            ) : null}

            {previewUrl && view !== 'visual' ? (
              <Button size="md" tone="ghost" onClick={() => setPreviewOpen(true)}>
                {t.preview}
              </Button>
            ) : null}

            {onDuplicate && permission?.create !== false ? (
              <Button
                size="md"
                tone="ghost"
                aria-label={t.duplicate}
                title={t.duplicate}
                onClick={onDuplicate}
              >
                <Copy aria-hidden />
              </Button>
            ) : null}

            {onDelete && permission?.delete ? (
              <Button
                size="md"
                tone="ghost"
                className="btn--danger-hover"
                aria-label={t.delete}
                title={t.delete}
                onClick={onDelete}
              >
                <Trash2 aria-hidden />
              </Button>
            ) : null}

            <Button
              size="md"
              tone="ghost"
              disabled={undoStack.length === 0}
              onClick={undo}
              aria-label={t.undo}
              title={t.undo}
            >
              <Undo2 aria-hidden />
            </Button>

            {canPublish && onSchedule ? (
              <SchedulePicker
                label={published ? t.scheduleUnpublish : t.schedulePublish}
                schedule={schedule}
                onSchedule={onSchedule}
              />
            ) : null}

            {onDiscardDraft && doc._hasDraft ? (
              <Button size="md" tone="ghost" onClick={onDiscardDraft}>
                {t.discardDraft}
              </Button>
            ) : null}

            {canPublish && (pendingPublish || canUnpublish) ? (
              <Button
                size="md"
                disabled={saving}
                onClick={() => void write(() => onPublish?.(values, dirty))}
              >
                {pendingPublish ? (published ? t.publishChanges : t.publish) : t.unpublish}
              </Button>
            ) : null}

            <Button size="md" tone="accent" type="submit" disabled={saving || readOnly || !dirty}>
              {saving ? t.saving : published && draftOverPublished ? t.saveDraft : t.save}
            </Button>
          </div>
        </div>

        {lockedBy ? (
          <div className="notice" role="status">
            <strong>
              {t.lockedBy} {lockedBy}.
            </strong>{' '}
            {t.lockedHint}
          </div>
        ) : null}

        {errorEntries.length > 0 ? (
          <div className="alert" role="alert">
            {errorEntries.some(([field]) => field !== '_') ? <p>{t.validationFailed}</p> : null}
            <ul>
              {errorEntries.map(([field, message]) => (
                <li key={field}>
                  {field === '_' ? (
                    message
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const parts = /^(.*?)\.(\d+)(?:\.|$)/.exec(normalizeFieldPath(field));
                        setSelected(
                          parts ? { field: parts[1] as string, index: Number(parts[2]) } : null,
                        );
                        requestAnimationFrame(() => focusField(field));
                      }}
                    >
                      <strong>{humanize(field)}</strong>: {message}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {view === 'json' ? (
          <JsonField
            field={{ type: 'json', name: 'document', label: t.json }}
            value={values}
            onChange={(next) => setValues((next ?? {}) as AdminDocument)}
          />
        ) : view === 'visual' && blocksField && previewUrl ? (
          <VisualEditor
            blocksField={blocksField}
            values={values}
            previewUrl={previewUrl}
            selected={selected}
            onSelect={setSelected}
            onSelectIndex={(index) => setSelected({ field: blocksField.name, index })}
            onSetBlock={(index, row) => setValue(`${blocksField.name}[${index}]`, row)}
            onInsert={insertBlock}
            onDelete={deleteBlock}
            onDuplicate={duplicateBlock}
            onMove={moveBlock}
            onSave={save}
            onFocusField={(path) => {
              selectFromPath(path);
              // The inspector renders the block's fields on the next paint, so the focus target
              // does not exist yet at message time.
              requestAnimationFrame(() => focusField(path));
            }}
            onEditBlock={(path) => {
              selectFromPath(path);
              requestAnimationFrame(() => focusBlock(path));
            }}
            documentFields={visibleFields
              .filter((field) => field !== blocksField)
              .map((field) => (
                <div key={field.name}>
                  <FieldRenderer
                    field={field}
                    values={values}
                    setValue={setValue}
                    error={errors?.[field.name]}
                    readOnly={readOnly}
                    locale={locale}
                  />
                </div>
              ))}
          />
        ) : (
          <div className="form-body">
            {visibleFields.map((field) => (
              <div key={field.name} className={spanFor(field)}>
                <FieldRenderer
                  field={field}
                  values={values}
                  setValue={setValue}
                  error={errors?.[field.name]}
                  readOnly={readOnly}
                  locale={locale}
                />
              </div>
            ))}
          </div>
        )}

        {doc.id && collection.versioned && !isGlobal ? (
          <VersionsPanel
            slug={collection.slug}
            id={String(doc.id)}
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            current={values}
            fields={collection.fields}
            onRestored={() => {
              adoptNext.current = true;
              onRestored?.();
            }}
          />
        ) : null}

        {previewUrl && view !== 'visual' ? (
          <LivePreview
            url={previewUrl}
            data={values}
            open={previewOpen}
            onClose={() => setPreviewOpen(false)}
            onFocusField={focusField}
            onEditBlock={focusBlock}
            onMoveBlock={moveBlock}
            onDeleteBlock={deleteBlock}
            onSave={save}
          />
        ) : null}
      </form>
    </FieldErrorsContext.Provider>
  );
}

/** ISO -> the local `YYYY-MM-DDTHH:mm` a datetime input wants. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function SchedulePicker({
  label,
  schedule,
  onSchedule,
}: {
  label: string;
  schedule: { at: string; action: string } | null | undefined;
  onSchedule: (at: string | null) => void;
}) {
  const t = useMessages();
  const { locale } = useCms();
  const menu = useRef<HTMLDetailsElement>(null);
  const [at, setAt] = useState('');
  const close = () => menu.current?.removeAttribute('open');

  return (
    <details ref={menu} className="menu">
      <summary
        className={`btn btn--md ${schedule ? 'btn--selected' : 'btn--ghost'}`}
        title={schedule ? new Date(schedule.at).toLocaleString(locale) : t.schedule}
      >
        <CalendarClock aria-hidden />
        {schedule
          ? new Date(schedule.at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
          : t.schedule}
      </summary>
      <div className="menu__body">
        <label className="label" htmlFor="cms-schedule-at">
          {label}
        </label>
        <input
          id="cms-schedule-at"
          type="datetime-local"
          className="input"
          value={at || (schedule ? toLocalInput(schedule.at) : '')}
          onChange={(event) => setAt(event.target.value)}
        />
        <Button
          size="sm"
          tone="accent"
          disabled={!at}
          onClick={() => {
            onSchedule(new Date(at).toISOString());
            close();
          }}
        >
          {t.schedule}
        </Button>
        {schedule ? (
          <Button
            size="sm"
            tone="ghost"
            onClick={() => {
              onSchedule(null);
              setAt('');
              close();
            }}
          >
            {t.unschedule}
          </Button>
        ) : null}
      </div>
    </details>
  );
}

const CSS_ESCAPE: ((value: string) => string) | undefined =
  typeof globalThis.CSS !== 'undefined' ? globalThis.CSS.escape : undefined;

type VisualEditorProps = {
  blocksField: AdminField;
  values: AdminDocument;
  previewUrl: string;
  selected: { field: string; index: number } | null;
  onSelect: (selection: { field: string; index: number } | null) => void;
  onSelectIndex: (index: number) => void;
  onSetBlock: (index: number, row: Record<string, unknown>) => void;
  onInsert: (field: string, type: string, index: number) => void;
  onDelete: (field: string, index: number) => void;
  onDuplicate: (field: string, index: number) => void;
  onMove: (field: string, from: number, to: number) => void;
  onFocusField: (path: string) => void;
  onEditBlock: (path: string) => void;
  onSave: () => void;
  documentFields: React.ReactNode;
};

const DEVICES: { key: 'desktop' | 'tablet' | 'mobile'; width?: number; icon: LucideIcon }[] = [
  { key: 'desktop', icon: Monitor },
  { key: 'tablet', width: 768, icon: Tablet },
  { key: 'mobile', width: 390, icon: Smartphone },
];

function rowSummary(row: Record<string, unknown>, fields: readonly AdminField[]): string {
  for (const field of fields) {
    const value = row[field.name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function OutlineRow({
  id,
  index,
  label,
  summary,
  active,
  onSelect,
}: {
  id: string;
  index: number;
  label: string;
  summary: string;
  active: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`block-outline-row${isDragging ? ' block-outline-row--dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="drag-handle"
        aria-label={`Reorder ${label} ${index + 1}`}
        {...attributes}
        {...(listeners ?? {})}
      >
        <GripVertical aria-hidden />
      </button>
      <button
        type="button"
        className={`palette__item palette__item--row${active ? ' palette__item--active' : ''}`}
        aria-current={active ? 'true' : undefined}
        onClick={onSelect}
      >
        <span className="palette__grip">#{index + 1}</span> <span>{label}</span>
        {summary ? <small>{summary}</small> : null}
      </button>
    </div>
  );
}

/**
 * Visual editor: the page is the canvas.
 *
 * - left: what is on the page (drag to reorder) and the blocks that can be added;
 * - centre: the live page, where blocks can be dragged, edited or deleted in place;
 * - right: the selected block's fields, or the document's own fields when nothing is selected.
 */
function VisualEditor({
  blocksField,
  values,
  previewUrl,
  selected,
  onSelect,
  onSelectIndex,
  onSetBlock,
  onInsert,
  onDelete,
  onDuplicate,
  onMove,
  onFocusField,
  onEditBlock,
  onSave,
  documentFields,
}: VisualEditorProps) {
  const t = useMessages();
  const [device, setDevice] = useState<(typeof DEVICES)[number]['key']>('desktop');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const rows = Array.isArray(values[blocksField.name])
    ? (values[blocksField.name] as Record<string, unknown>[])
    : [];
  const definitions = blocksField.blocks ?? [];
  const current = selected && selected.field === blocksField.name ? selected : null;
  const row = current ? rows[current.index] : undefined;
  const definition = row ? definitions.find((item) => item.slug === row.type) : undefined;
  const ids = rows.map((_, index) => `block-${index}`);

  const onOutlineDrop = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onMove(blocksField.name, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };

  return (
    <div className="visual">
      <aside className="visual__palette" aria-label={t.blocks}>
        <h2 className="visual__title">{t.onThisPage}</h2>
        {rows.length === 0 ? <p className="visual__hint">{t.emptyPage}</p> : null}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onOutlineDrop}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="block-outline">
              {rows.map((item, index) => {
                const known = definitions.find((block) => block.slug === item.type);
                return (
                  <OutlineRow
                    key={ids[index]}
                    id={ids[index] as string}
                    index={index}
                    label={known ? blockTitle(known) : String(item.type ?? '—')}
                    summary={rowSummary(item, known?.fields ?? [])}
                    active={current?.index === index}
                    onSelect={() => onSelectIndex(index)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

        <h2 className="visual__title visual__title--spaced">{t.addBlock}</h2>
        <p className="visual__hint">{t.addBlockHint}</p>
        <div className="palette">
          {definitions.map((item) => (
            <button
              key={item.slug}
              type="button"
              className="palette__item palette__item--add"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  PREVIEW_BLOCK_MIME,
                  JSON.stringify({ field: blocksField.name, blockType: item.slug }),
                );
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => onInsert(blocksField.name, item.slug, rows.length)}
            >
              <Plus aria-hidden />
              {blockTitle(item)}
            </button>
          ))}
        </div>
      </aside>

      <div className="visual__stage">
        <div className="stage-bar">
          <fieldset className="segmented" aria-label="view">
            {DEVICES.map(({ key, icon: Icon }) => (
              <Button
                key={key}
                size="xs"
                tone={device === key ? 'selected' : 'ghost'}
                aria-pressed={device === key}
                aria-label={t[key]}
                title={t[key]}
                onClick={() => setDevice(key)}
              >
                <Icon aria-hidden />
              </Button>
            ))}
          </fieldset>
          <a
            className="btn btn--ghost btn--xs"
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={t.openInTab}
            title={t.openInTab}
          >
            <ExternalLink aria-hidden />
          </a>
        </div>
        <LivePreview
          url={previewUrl}
          data={values}
          open
          onClose={() => undefined}
          variant="inline"
          onFocusField={onFocusField}
          onEditBlock={onEditBlock}
          onMoveBlock={onMove}
          onDeleteBlock={onDelete}
          onDuplicateBlock={onDuplicate}
          onInsertBlock={onInsert}
          onSave={onSave}
          selectedPath={current ? `${current.field}[${current.index}]` : null}
          frameWidth={DEVICES.find((item) => item.key === device)?.width}
          blockTypes={definitions.map((item) => ({ slug: item.slug, label: blockTitle(item) }))}
        />
      </div>

      <aside className="visual__inspector" aria-label={t.edit}>
        {!row || !current ? (
          <div className="inspector">
            <h2 className="visual__title">{t.documentFields}</h2>
            {documentFields}
          </div>
        ) : (
          <div className="inspector">
            <Button
              size="xs"
              tone="ghost"
              className="inspector__back"
              onClick={() => onSelect(null)}
            >
              <ArrowLeft aria-hidden />
              {t.pageDetailsBack}
            </Button>
            <div className="inspector__head">
              <span className="row-head__index">#{current.index + 1}</span>
              <strong className="inspector__name">
                {definition ? blockTitle(definition) : String(row.type ?? '—')}
              </strong>
              <Button
                size="xs"
                tone="ghost"
                aria-label={t.duplicate}
                title={t.duplicate}
                onClick={() => onDuplicate(current.field, current.index)}
              >
                <Copy aria-hidden />
              </Button>
              <Button
                size="xs"
                tone="ghost"
                className="btn--danger-hover"
                aria-label={t.remove}
                title={t.remove}
                onClick={() => onDelete(current.field, current.index)}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>

            {definition ? (
              <StructuredRowFields
                fields={definition.fields}
                row={row}
                prefix={`${current.field}[${current.index}]`}
                onChange={(next) => onSetBlock(current.index, next)}
              />
            ) : (
              <p className="visual__hint">{t.pickBlockType}</p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function spanFor(field: AdminField): string {
  if (
    field.type === 'group' ||
    field.type === 'array' ||
    field.type === 'blocks' ||
    field.type === 'tabs' ||
    field.type === 'row' ||
    field.type === 'collapsible'
  ) {
    return 'field--wide';
  }
  return SHORT.has(field.type) ? 'field--half' : 'field--wide';
}

function FieldRenderer({
  field,
  values,
  setValue,
  error,
  readOnly,
  locale,
  path = '',
}: {
  field: AdminField;
  values: AdminDocument;
  setValue: (path: string, value: unknown) => void;
  error?: string | undefined;
  readOnly: boolean;
  locale?: string | undefined;
  path?: string;
}) {
  const siblings = path ? ((getByPath(values, path) ?? {}) as AdminDocument) : values;
  if (!isFieldVisible(field, siblings)) return null;

  const fieldPath = path ? `${path}.${field.name}` : field.name;

  // Structural fields only change the layout: their fields keep this level's path.
  const nested = (child: AdminField) => (
    <FieldRenderer
      key={child.name}
      field={child}
      values={values}
      setValue={setValue}
      readOnly={readOnly}
      locale={locale}
      path={path}
    />
  );

  if (field.type === 'tabs') {
    return (
      <FieldTabs
        field={field}
        renderField={(child) => (
          <div key={child.name} className="tabs__field">
            {nested(child)}
          </div>
        )}
      />
    );
  }

  if (field.type === 'row') {
    return (
      <div className="form-body">
        {(field.fields ?? []).map((child) => (
          <div key={child.name} className={spanFor(child)}>
            {nested(child)}
          </div>
        ))}
      </div>
    );
  }

  if (field.type === 'collapsible') {
    return (
      <details className="group collapsible" open>
        <summary>{fieldTitle(field)}</summary>
        <div className="form-body">
          {(field.fields ?? []).map((child) => (
            <div key={child.name} className={spanFor(child)}>
              {nested(child)}
            </div>
          ))}
        </div>
      </details>
    );
  }

  if (field.type === 'group' && field.fields) {
    return (
      <fieldset className="group">
        <legend>{fieldTitle(field)}</legend>
        <div className="form-body">
          {field.fields.map((nested) => (
            <div key={nested.name} className={spanFor(nested)}>
              <FieldRenderer
                field={nested}
                values={values}
                setValue={setValue}
                readOnly={readOnly}
                locale={locale}
                path={fieldPath}
              />
            </div>
          ))}
        </div>
      </fieldset>
    );
  }

  if (field.type === 'array' || field.type === 'blocks') {
    const current = getByPath(values, fieldPath);
    return field.type === 'array' ? (
      <ArrayBuilder
        field={field}
        value={current}
        path={fieldPath}
        onChange={(next) => setValue(fieldPath, next)}
      />
    ) : (
      <BlocksBuilder
        field={field}
        value={current}
        path={fieldPath}
        onChange={(next) => setValue(fieldPath, next)}
      />
    );
  }

  const Component = resolveFieldComponent(field);
  const raw = getByPath(values, fieldPath);
  const localized = field.localized === true && Boolean(locale);
  const bucket =
    localized && raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined;

  return (
    <Component
      field={field}
      value={localized ? bucket?.[locale as string] : raw}
      onChange={(next) => {
        if (localized) {
          setValue(fieldPath, { ...(bucket ?? {}), [locale as string]: next });
          return;
        }
        setValue(fieldPath, next);
      }}
      error={error}
      locale={locale}
      disabled={readOnly || field.restricted === true}
      id={fieldPath}
    />
  );
}

/**
 * `layout[1].linhas[0].texto` -> `['layout', '1', 'linhas', '0', 'texto']`.
 *
 * Array indices are just segments, so the same walk works for root fields, rows and blocks nested
 * inside blocks — which is what makes dragging inside a block possible.
 */
function pathSegments(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
}

function getByPath(target: Record<string, unknown>, path: string): unknown {
  return pathSegments(path).reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, target);
}

/** Copies every level it walks through: the form must never write into the query cache's objects. */
function setByPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const segments = pathSegments(path);
  let cursor = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index] ?? '';
    const next = segments[index + 1] ?? '';
    const current = cursor[key];

    if (Array.isArray(current)) cursor[key] = [...current];
    else if (current && typeof current === 'object') cursor[key] = { ...current };
    else cursor[key] = /^\d+$/.test(next) ? [] : {};

    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[segments.at(-1) ?? ''] = value;
  return target;
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function defaultsOf(fields: readonly AdminField[]): AdminDocument {
  const defaults: AdminDocument = {};
  for (const field of fields) {
    if (field.defaultValue !== undefined) defaults[field.name] = field.defaultValue;
  }
  return defaults;
}
