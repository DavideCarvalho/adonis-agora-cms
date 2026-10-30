import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button } from '../atoms/index.js';
import { useMessages } from '../context.js';
import { LivePreview } from '../organisms/live-preview.js';
import { ArrayBuilder, BlocksBuilder, StructuredRowFields } from '../organisms/structured.js';
import { VersionsPanel } from '../organisms/versions-panel.js';
import { PREVIEW_BLOCK_MIME } from '../preview.js';
import { JsonField, resolveFieldComponent } from '../registry.js';
import type { AdminCollection, AdminDocument, AdminField, AdminPermission } from '../types.js';

export type EditFormProps = {
  collection: AdminCollection;
  doc: AdminDocument;
  permission?: AdminPermission | undefined;
  saving?: boolean | undefined;
  errors?: Record<string, string> | undefined;
  onSubmit: (values: AdminDocument) => void;
  onPublish?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  previewUrl?: string | undefined;
  locales?: readonly string[] | undefined;
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
  onBack,
  previewUrl,
  locales = [],
}: EditFormProps) {
  const t = useMessages();
  const [values, setValues] = useState<AdminDocument>(doc);
  const [showJson, setShowJson] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [locale, setLocale] = useState<string>(locales[0] ?? '');
  const blocksField = collection.fields.find((field) => field.type === 'blocks');
  const visualAllowed = Boolean(collection.admin?.visualEditor && blocksField);
  // With a blocks field the page is the document: open on the visual editor unless it has no
  // preview to render.
  // `null` = follow the document: blocks + preview means visual. The preview URL arrives after
  // mount, so the default cannot be computed once in `useState`.
  const [visualPref, setVisualPref] = useState<boolean | null>(null);
  const visual = visualPref ?? Boolean(visualAllowed && previewUrl);
  const setVisual = setVisualPref;
  const [selected, setSelected] = useState<{ field: string; index: number } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  // A click on a `data-cms-field` region in the preview brings that field into view here.
  const focusField = useCallback((name: string) => {
    const form = formRef.current;
    if (!form) return;
    const selector = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(name) : name;
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

  // The document arrives after mount (query), so the form must adopt it once it lands.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by identity, not deep value
  useEffect(() => {
    setValues(doc);
  }, [doc.id]);

  const readOnly = useMemo(() => {
    const id = doc.id;
    return id ? permission?.update === false : permission?.create === false;
  }, [doc.id, permission]);

  const setValue = (path: string, value: unknown) => {
    setValues((current) => setByPath({ ...current }, path, value));
  };

  /** Structural edits from the preview toolbar mutate the same values the form edits. */
  const mutateRows = (field: string, next: (rows: unknown[]) => unknown[]) =>
    setValues((current) => {
      const rows = getByPath(current, field);
      if (!Array.isArray(rows)) return current;
      const copy = { ...current };
      setByPath(copy, field, next([...rows]));
      return copy;
    });

  const moveBlock = (field: string, from: number, to: number) =>
    mutateRows(field, (rows) => {
      if (from < 0 || to < 0 || from >= rows.length || to >= rows.length) return rows;
      const [row] = rows.splice(from, 1);
      if (row !== undefined) rows.splice(to, 0, row);
      return rows;
    });

  const deleteBlock = (field: string, index: number) =>
    mutateRows(field, (rows) => rows.filter((_, position) => position !== index));

  const duplicateBlock = (field: string, index: number) => {
    mutateRows(field, (rows) => {
      const row = rows[index];
      if (!row) return rows;
      const copy = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
      delete copy.id;
      delete copy._order;
      return [...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)];
    });
    setRefresh((value) => value + 1);
  };

  const focusBlock = (path: string) => {
    const form = formRef.current;
    if (!form) return;
    const first = form.querySelector<HTMLElement>(`[id^="${path}."]`);
    if (first) focusField(first.id);
  };

  const insertBlock = (field: string, type: string, index: number) => {
    mutateRows(field, (rows) => {
      const at = Math.max(0, Math.min(index, rows.length));
      return [...rows.slice(0, at), { type }, ...rows.slice(at)];
    });
    setRefresh((value) => value + 1);
  };

  /** `layout[2].heading` -> { field: 'layout', index: 2 } */
  const selectFromPath = (path: string) => {
    // Non-greedy: `layout[1].items[0].title` belongs to block 1, not to `layout[1].items` row 0.
    const match = /^(.*?)\[(\d+)\]/.exec(path);
    if (match) setSelected({ field: match[1] as string, index: Number(match[2]) });
  };

  const visibleFields = collection.fields.filter((field) => !field.hidden);

  return (
    <form
      ref={formRef}
      className="form page-enter"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      <div className="form-head">
        <div className="form-head__left">
          {onBack ? (
            <Button tone="ghost" size="sm" onClick={onBack} aria-label="back">
              ←
            </Button>
          ) : null}
          <h1 className="page-title" style={{ fontSize: 26 }}>
            {doc.id ? t.edit : t.new} {collection.labels?.singular ?? collection.slug}
          </h1>
          {doc._status ? (
            <Badge tone={doc._status === 'published' ? 'good' : 'warn'}>{doc._status}</Badge>
          ) : null}
        </div>

        <div className="toolbar">
          {locales.length > 1 ? (
            <select
              aria-label="locale"
              className="select"
              style={{ width: 'auto' }}
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

          <Button size="sm" tone="ghost" onClick={() => setShowJson((value) => !value)}>
            {showJson ? t.form : t.json}
          </Button>

          {doc.id && collection.versioned ? (
            <Button size="sm" onClick={() => setHistoryOpen(true)}>
              {t.history}
            </Button>
          ) : null}

          {visualAllowed && previewUrl ? (
            <Button
              size="sm"
              tone={visual ? 'selected' : 'neutral'}
              onClick={() => setVisual((value) => !value)}
            >
              {visual ? t.form : 'Visual'}
            </Button>
          ) : null}

          {previewUrl && !visual ? (
            <Button size="sm" onClick={() => setPreviewOpen(true)}>
              {t.preview}
            </Button>
          ) : null}

          {onDelete && permission?.delete ? (
            <Button size="sm" tone="destructive" onClick={onDelete}>
              {t.delete}
            </Button>
          ) : null}

          {onPublish && collection.drafts && permission?.update !== false ? (
            <Button size="sm" onClick={onPublish}>
              {doc._status === 'published' ? t.unpublish : t.publish}
            </Button>
          ) : null}

          <Button size="sm" tone="accent" type="submit" disabled={saving || readOnly}>
            {saving ? t.saving : t.save}
          </Button>
        </div>
      </div>

      {showJson ? (
        <JsonField
          field={{ type: 'json', name: 'document' }}
          value={values}
          onChange={(next) => setValues((next ?? {}) as AdminDocument)}
        />
      ) : visual && blocksField && previewUrl ? (
        <VisualEditor
          collection={collection}
          blocksField={blocksField}
          values={values}
          setValue={setValue}
          previewUrl={previewUrl}
          selected={selected}
          onSelect={setSelected}
          onSelectIndex={(index) => setSelected({ field: blocksField.name, index })}
          onSetBlock={(index, row) =>
            mutateRows(blocksField.name, (rows) =>
              rows.map((current, position) => (position === index ? row : current)),
            )
          }
          onInsert={insertBlock}
          onDelete={deleteBlock}
          onDuplicate={duplicateBlock}
          onMove={moveBlock}
          onFocusField={(path) => {
            selectFromPath(path);
            // The inspector renders the block's fields on the next paint, so the focus target
            // does not exist yet at message time.
            requestAnimationFrame(() => focusField(path));
          }}
          onEditBlock={(path) => {
            selectFromPath(path);
            focusBlock(path);
          }}
          refresh={refresh}
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

      {errors && Object.keys(errors).length > 0 ? (
        <div className="alert">
          {Object.entries(errors).map(([field, message]) => (
            <div key={field}>
              <strong>{field}</strong> — {message}
            </div>
          ))}
        </div>
      ) : null}

      {doc.id && collection.versioned ? (
        <VersionsPanel
          slug={collection.slug}
          id={String(doc.id)}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}

      {previewUrl ? (
        <LivePreview
          url={previewUrl}
          data={values}
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          onFocusField={focusField}
          onEditBlock={focusBlock}
          onMoveBlock={moveBlock}
          onDeleteBlock={deleteBlock}
        />
      ) : null}
    </form>
  );
}

type VisualEditorProps = {
  collection: AdminCollection;
  blocksField: AdminField;
  values: AdminDocument;
  setValue: (path: string, value: unknown) => void;
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
  refresh: number;
};

/**
 * Visual editor: the page is the canvas.
 *
 * - left: the block palette (`layout` blocks from the schema) — drag a block into the page or click
 *   to append;
 * - centre: the live page, where blocks can be dragged, edited or deleted in place;
 * - right: the inspector, with only the selected block's fields.
 */
function VisualEditor({
  collection,
  blocksField,
  values,
  setValue,
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
  refresh,
}: VisualEditorProps) {
  const t = useMessages();
  const rows = Array.isArray(values[blocksField.name])
    ? (values[blocksField.name] as Record<string, unknown>[])
    : [];
  const definitions = blocksField.blocks ?? [];
  const current = selected && selected.field === blocksField.name ? selected : null;
  const row = current ? rows[current.index] : undefined;
  const definition = row ? definitions.find((item) => item.slug === row.type) : undefined;

  return (
    <div className="visual">
      <aside className="visual__palette" aria-label="Blocos">
        <h2 className="visual__title">Blocos</h2>
        <p className="visual__hint">Arraste para a página ou clique para adicionar.</p>
        <div className="palette">
          {definitions.map((item) => (
            <button
              key={item.slug}
              type="button"
              className="palette__item"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  PREVIEW_BLOCK_MIME,
                  JSON.stringify({ field: blocksField.name, blockType: item.slug }),
                );
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => {
                onInsert(blocksField.name, item.slug, rows.length);
                onSelectIndex(rows.length);
              }}
            >
              <span className="palette__grip">⠿</span>
              {item.slug}
            </button>
          ))}
        </div>

        <h2 className="visual__title" style={{ marginTop: 18 }}>
          Página
        </h2>
        <div className="palette">
          {rows.map((item, index) => (
            <button
              key={String(item.id ?? index)}
              type="button"
              className={`palette__item palette__item--row${
                current?.index === index ? ' palette__item--active' : ''
              }`}
              onClick={() => onSelectIndex(index)}
            >
              <span className="palette__grip">#{index + 1}</span>
              {String(item.type ?? '—')}
            </button>
          ))}
        </div>
      </aside>

      <div className="visual__stage">
        <LivePreview
          url={previewUrl}
          data={values}
          open
          onClose={() => undefined}
          variant="inline"
          refreshKey={refresh}
          onFocusField={onFocusField}
          onEditBlock={onEditBlock}
          onMoveBlock={onMove}
          onDeleteBlock={onDelete}
          onDuplicateBlock={onDuplicate}
          onInsertBlock={onInsert}
          blockTypes={definitions.map((item) => item.slug)}
        />
      </div>

      <aside className="visual__inspector" aria-label="Propriedades">
        <h2 className="visual__title">{t.edit}</h2>
        {!row || !current ? (
          <p className="visual__hint">Clique num bloco na página (ou na lista) para editar.</p>
        ) : (
          <div className="inspector">
            <div className="inspector__head">
              <span className="row-head__index">#{current.index + 1}</span>
              <select
                className="select"
                aria-label="block type"
                value={String(row.type ?? '')}
                onChange={(event) =>
                  onSetBlock(current.index, { ...row, type: event.target.value })
                }
              >
                <option value="">— block —</option>
                {definitions.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.slug}
                  </option>
                ))}
              </select>
              <Button
                size="xs"
                tone="destructive"
                onClick={() => {
                  onDelete(current.field, current.index);
                  onSelect(null);
                }}
              >
                Remove
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
              <p className="visual__hint">Escolha um tipo de bloco.</p>
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
    field.type === 'tabs'
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
  const fieldPath = path ? `${path}.${field.name}` : field.name;

  if (field.type === 'group' && field.fields) {
    return (
      <fieldset className="group">
        <legend>{field.name}</legend>
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
      <ArrayBuilder field={field} value={current} onChange={(next) => setValue(fieldPath, next)} />
    ) : (
      <BlocksBuilder field={field} value={current} onChange={(next) => setValue(fieldPath, next)} />
    );
  }

  if (field.type === 'tabs') {
    return (
      <JsonField
        field={field}
        value={getByPath(values, fieldPath)}
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
    const wantsArray = /^\d+$/.test(next);
    const current = cursor[key];

    if (!current || typeof current !== 'object') {
      cursor[key] = wantsArray ? [] : {};
    } else if (Array.isArray(current) && !wantsArray) {
      // A row path into an array without an index is ambiguous; keep the array as-is.
      cursor[key] = current;
    }

    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[segments.at(-1) ?? ''] = value;
  return target;
}
