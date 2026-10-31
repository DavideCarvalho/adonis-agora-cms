import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Button, Field, Select } from '../atoms/index.js';
import { useMessages } from '../context.js';
import { blockTitle, fieldTitle, resolveFieldComponent } from '../registry.js';
import type { AdminField } from '../types.js';

type Row = Record<string, unknown>;

/**
 * Row clipboard, the Payload `_payloadClipboard` idea: a copied row lives in localStorage so it
 * survives a reload and can be pasted into the same field later. Rows are pasted without their
 * `id` — the server assigns a fresh one, so a paste is a duplicate, never an alias.
 */
const CLIPBOARD_KEY = '_cmsClipboard';

type ClipboardEntry = { field: string; kind: 'array' | 'blocks'; value: Row };

function readClipboard(): ClipboardEntry | null {
  try {
    const raw = globalThis.localStorage?.getItem(CLIPBOARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClipboardEntry;
    return parsed && typeof parsed === 'object' && parsed.value ? parsed : null;
  } catch {
    return null;
  }
}

function writeClipboard(entry: ClipboardEntry): void {
  try {
    globalThis.localStorage?.setItem(CLIPBOARD_KEY, JSON.stringify(entry));
  } catch {
    // Private mode / storage disabled: copy is a convenience, never a hard failure.
  }
}

/**
 * Clipboard state is read once from localStorage so the paste affordance is live in the same
 * render as the copy (a copy alone would not re-render the field).
 */
function useClipboard() {
  const [entry, setEntry] = useState<ClipboardEntry | null>(() => readClipboard());

  const save = (next: ClipboardEntry) => {
    writeClipboard(next);
    setEntry(next);
  };

  return { clipboard: entry, save };
}

function withoutId(row: Row): Row {
  const { id: _id, _order, ...rest } = row;
  return JSON.parse(JSON.stringify(rest)) as Row;
}

function summaryOf(row: Row, fields: AdminField[]): string {
  for (const field of fields) {
    const value = row[field.name];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 48);
  }
  return '—';
}

/** `admin.visibleWhen`: siblings decide. The value stays in the document while hidden. */
export function isFieldVisible(field: AdminField, siblings: Row): boolean {
  const rule = field.admin?.visibleWhen;
  if (!rule) return true;
  const current = siblings[rule.field];
  return Array.isArray(rule.equals) ? rule.equals.includes(current) : current === rule.equals;
}

/** Tabs only reorganize the form: every tab's fields live at the same level of the document. */
export function FieldTabs({
  field,
  renderField,
}: {
  field: AdminField;
  renderField: (nested: AdminField) => ReactNode;
}) {
  const tabs = field.tabs ?? [];
  const [active, setActive] = useState(0);
  const panel = tabs[active];

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist">
        {tabs.map((tab, index) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            aria-selected={index === active}
            className={`tabs__tab${index === active ? ' tabs__tab--active' : ''}`}
            onClick={() => setActive(index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {panel ? <div className="tabs__panel">{panel.fields.map(renderField)}</div> : null}
    </div>
  );
}

export function ScalarInput({
  field,
  value,
  onChange,
  path,
}: {
  field: AdminField;
  value: unknown;
  onChange: (next: unknown) => void;
  path: string;
}) {
  const Component = resolveFieldComponent(field);
  return (
    <Component
      field={field}
      value={value}
      onChange={onChange}
      id={path}
      disabled={field.restricted === true}
    />
  );
}

/** Exported for the visual editor's inspector: the same inputs the block card renders. */
export function StructuredRowFields({
  fields,
  row,
  onChange,
  prefix,
}: {
  fields: AdminField[];
  row: Row;
  onChange: (next: Row) => void;
  prefix: string;
}) {
  return (
    <div className="row-fields">
      {fields.map((field) => {
        if (!isFieldVisible(field, row)) return null;

        // Structural fields keep the same row: only the layout changes, not the document's shape.
        if (field.type === 'tabs') {
          return (
            <div key={field.name} className="row-fields__wide">
              <FieldTabs
                field={field}
                renderField={(nested) => (
                  <StructuredRowFields
                    key={nested.name}
                    fields={[nested]}
                    row={row}
                    prefix={prefix}
                    onChange={onChange}
                  />
                )}
              />
            </div>
          );
        }
        if (field.type === 'row' || field.type === 'collapsible') {
          const nested = (
            <StructuredRowFields
              fields={field.fields ?? []}
              row={row}
              prefix={prefix}
              onChange={onChange}
            />
          );
          return (
            <div key={field.name} className="row-fields__wide">
              {field.type === 'row' ? (
                nested
              ) : (
                <details className="group collapsible" open>
                  <summary>{fieldTitle(field)}</summary>
                  {nested}
                </details>
              )}
            </div>
          );
        }

        const value = row[field.name];
        const update = (next: unknown) => onChange({ ...row, [field.name]: next });

        // Nested containers keep their real builder: a block with an array of items renders rows,
        // not `[object Object]` from the scalar fallback.
        const nestedPath = `${prefix}.${field.name}`;

        if (field.type === 'array') {
          return (
            <div key={field.name} className="row-fields__wide">
              <ArrayBuilder field={field} value={value} onChange={update} path={nestedPath} />
            </div>
          );
        }

        if (field.type === 'blocks') {
          return (
            <div key={field.name} className="row-fields__wide">
              <BlocksBuilder field={field} value={value} onChange={update} path={nestedPath} />
            </div>
          );
        }

        if (field.type === 'group' && field.fields) {
          return (
            <fieldset key={field.name} className="group row-fields__wide">
              <legend>{fieldTitle(field)}</legend>
              <StructuredRowFields
                fields={field.fields}
                row={(value ?? {}) as Row}
                prefix={nestedPath}
                onChange={update}
              />
            </fieldset>
          );
        }

        return (
          <ScalarInput
            key={field.name}
            field={field}
            value={value}
            path={`${prefix}.${field.name}`}
            onChange={update}
          />
        );
      })}
    </div>
  );
}

let localRowId = 0;
function nextRowId(): string {
  localRowId += 1;
  return `row-${localRowId}`;
}

/**
 * Sorting is local UI state: the row order in the value is the truth the API stores (the child
 * table carries the `_order` column), so we only need ids stable across a drag. Ids follow the
 * rows through reorder/insert/remove, and are topped up when the value is replaced from outside
 * (version restore, live preview, initial load).
 */
function useRowIds(count: number) {
  const [ids, setIds] = useState<string[]>(() => Array.from({ length: count }, nextRowId));

  useEffect(() => {
    setIds((current) => {
      if (current.length === count) return current;
      if (current.length > count) return current.slice(0, count);
      return [...current, ...Array.from({ length: count - current.length }, nextRowId)];
    });
  }, [count]);

  return [ids, setIds] as const;
}

function SortableRow({
  id,
  label,
  onMoveBy,
  children,
}: {
  id: string;
  label: string;
  onMoveBy: (direction: -1 | 1) => void;
  children: (handle: ReactNode) => ReactNode;
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
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`row-card${isDragging ? ' row-card--dragging' : ''}`}
    >
      {children(
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="drag-handle"
          aria-label={`Reorder ${label}`}
          title={`Drag, or press ArrowUp/ArrowDown, to reorder ${label}`}
          {...attributes}
          {...(listeners ?? {})}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            onMoveBy(event.key === 'ArrowUp' ? -1 : 1);
          }}
        >
          <GripVertical aria-hidden />
        </button>,
      )}
    </div>
  );
}

/**
 * Drag to reorder, the way Payload does it: a drag handle per row and a pointer sensor, with
 * `admin.isSortable: false` to pin the order. The handle also answers ArrowUp/ArrowDown so the
 * order is reachable without a pointer.
 */
function useSortableRows(rows: Row[], onChange: (next: Row[]) => void) {
  const [ids, setIds] = useRowIds(rows.length);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      setIds(arrayMove(ids, from, to));
      onChange(arrayMove(rows, from, to));
    },
    [ids, rows, onChange, setIds],
  );

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    setIds(arrayMove(ids, index, target));
    onChange(arrayMove(rows, index, target));
  };

  const remove = (index: number) => {
    setIds(ids.filter((_, position) => position !== index));
    onChange(rows.filter((_, position) => position !== index));
  };

  const add = (row: Row) => {
    setIds([...ids, nextRowId()]);
    onChange([...rows, row]);
  };

  return { ids, sensors, onDragEnd, move, remove, add };
}

/** Collapsed rows: a Set of row ids, so a reorder or an edit keeps the collapsed/expanded shape. */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return { collapsed, toggle };
}

function Rows({
  ids,
  sensors,
  sortable,
  onDragEnd,
  children,
}: {
  ids: string[];
  sensors: ReturnType<typeof useSensors>;
  sortable: boolean;
  onDragEnd: (event: DragEndEvent) => void;
  children: ReactNode;
}) {
  const list = <div className="field-rows">{children}</div>;
  if (sortable === false) return list;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {list}
      </SortableContext>
    </DndContext>
  );
}

function RowHead({
  index,
  handle,
  collapsed,
  summary,
  onToggle,
  label,
  onCopy,
  children,
}: {
  index: number;
  handle: ReactNode;
  collapsed: boolean;
  summary: string;
  onToggle: () => void;
  label: string;
  onCopy: () => void;
  children?: ReactNode;
}) {
  const t = useMessages();
  return (
    <div className="row-head">
      {handle}
      <button
        type="button"
        className="row-toggle"
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
        onClick={onToggle}
      >
        {collapsed ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
      </button>
      <span className="row-head__index">#{index + 1}</span>
      {collapsed ? <span className="row-head__summary">{summary}</span> : null}
      <span className="row-head__spacer" />
      <Button
        size="xs"
        tone="ghost"
        onClick={onCopy}
        aria-label={t.copy}
        title={`${t.copy}: ${label}`}
      >
        <Copy aria-hidden />
      </Button>
      {children}
    </div>
  );
}

/** Array field: ordered rows with drag reorder, collapse, copy/paste, add and remove. */
export function ArrayBuilder({
  field,
  value,
  onChange,
  path,
}: {
  field: AdminField;
  value: unknown;
  onChange: (next: unknown[]) => void;
  /** Where this field sits in the document, so nested inputs get ids the preview can focus. */
  path?: string | undefined;
}) {
  const t = useMessages();
  const base = path ?? field.name;
  const rows = Array.isArray(value) ? (value as Row[]) : [];
  const nested = field.fields ?? [];
  const canSort = field.admin?.isSortable !== false;
  const sortable = canSort && rows.length > 1;
  const { ids, sensors, onDragEnd, move, remove, add } = useSortableRows(rows, onChange);
  const { collapsed, toggle } = useCollapsed();
  const { clipboard, save } = useClipboard();
  const atLimit = Boolean(field.maxRows && rows.length >= field.maxRows);

  const update = (index: number, row: Row) =>
    onChange(rows.map((current, position) => (position === index ? row : current)));

  const copy = (row: Row) => save({ field: field.name, kind: 'array', value: row });

  const paste = () => {
    if (!clipboard || atLimit) return;
    add(withoutId(clipboard.value));
  };

  return (
    <Field label={fieldTitle(field)} description={field.admin?.description} htmlFor={base}>
      <Rows ids={ids} sensors={sensors} sortable={sortable} onDragEnd={onDragEnd}>
        {rows.map((row, index) => {
          const id = ids[index] ?? `row-${index}`;
          const isCollapsed = collapsed.has(id);

          return (
            <SortableRow
              key={id}
              id={id}
              label={`row ${index + 1}`}
              onMoveBy={(direction) => move(index, direction)}
            >
              {(handle) => (
                <>
                  <RowHead
                    index={index}
                    handle={handle}
                    collapsed={isCollapsed}
                    summary={summaryOf(row, nested)}
                    onToggle={() => toggle(id)}
                    label={`row ${index + 1}`}
                    onCopy={() => copy(row)}
                  >
                    {canSort ? null : (
                      <>
                        <Button
                          size="xs"
                          tone="ghost"
                          aria-label={t.moveUp}
                          title={t.moveUp}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button
                          size="xs"
                          tone="ghost"
                          aria-label={t.moveDown}
                          title={t.moveDown}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown aria-hidden />
                        </Button>
                      </>
                    )}
                    <Button
                      size="xs"
                      tone="ghost"
                      className="btn--danger-hover"
                      aria-label={t.remove}
                      title={t.remove}
                      onClick={() => remove(index)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </RowHead>
                  {isCollapsed ? null : (
                    <div className="row-body">
                      <StructuredRowFields
                        fields={nested}
                        row={row}
                        prefix={`${base}[${index}]`}
                        onChange={(next) => update(index, next)}
                      />
                    </div>
                  )}
                </>
              )}
            </SortableRow>
          );
        })}
      </Rows>

      <div className="field-actions">
        <Button size="sm" onClick={() => add({})} disabled={atLimit}>
          <Plus aria-hidden />
          {t.addRow}
        </Button>
        <Button
          size="sm"
          tone="ghost"
          onClick={paste}
          disabled={atLimit || clipboard?.kind !== 'array'}
        >
          {t.pasteRow}
        </Button>
      </div>
    </Field>
  );
}

/** Blocks field: one row per block, draggable, collapsible and copy/paste-able. */
export function BlocksBuilder({
  field,
  value,
  onChange,
  path,
}: {
  field: AdminField;
  value: unknown;
  onChange: (next: unknown[]) => void;
  /** Where this field sits in the document, so nested inputs get ids the preview can focus. */
  path?: string | undefined;
}) {
  const t = useMessages();
  const base = path ?? field.name;
  const rows = Array.isArray(value) ? (value as Row[]) : [];
  const blocks = field.blocks ?? [];
  const canSort = field.admin?.isSortable !== false;
  const sortable = canSort && rows.length > 1;
  const { ids, sensors, onDragEnd, move, remove, add } = useSortableRows(rows, onChange);
  const { collapsed, toggle } = useCollapsed();
  const { clipboard, save } = useClipboard();
  const atLimit = Boolean(field.maxRows && rows.length >= field.maxRows);
  const pasteable =
    clipboard?.kind === 'blocks' && blocks.some((block) => block.slug === clipboard.value.type);

  const update = (index: number, row: Row) =>
    onChange(rows.map((current, position) => (position === index ? row : current)));

  const copy = (row: Row) => save({ field: field.name, kind: 'blocks', value: row });

  const paste = () => {
    if (!clipboard || !pasteable || atLimit) return;
    add(withoutId(clipboard.value));
  };

  return (
    <Field label={fieldTitle(field)} description={field.admin?.description} htmlFor={base}>
      <Rows ids={ids} sensors={sensors} sortable={sortable} onDragEnd={onDragEnd}>
        {rows.map((row, index) => {
          const id = ids[index] ?? `row-${index}`;
          const isCollapsed = collapsed.has(id);
          const definition = blocks.find((block) => block.slug === row.type);
          const type = String(row.type ?? '');

          return (
            <SortableRow
              key={id}
              id={id}
              label={`block ${index + 1}`}
              onMoveBy={(direction) => move(index, direction)}
            >
              {(handle) => (
                <>
                  <RowHead
                    index={index}
                    handle={handle}
                    collapsed={isCollapsed}
                    summary={
                      definition
                        ? `${blockTitle(definition)} — ${summaryOf(row, definition.fields)}`
                        : '—'
                    }
                    onToggle={() => toggle(id)}
                    label={`block ${index + 1}`}
                    onCopy={() => copy(row)}
                  >
                    <Select
                      aria-label={`block ${index + 1} type`}
                      value={type}
                      onChange={(event) =>
                        update(index, {
                          ...row,
                          type: (event as unknown as { target: { value: string } }).target.value,
                        })
                      }
                    >
                      <option value="">— block —</option>
                      {blocks.map((block) => (
                        <option key={block.slug} value={block.slug}>
                          {blockTitle(block)}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="xs"
                      tone="ghost"
                      className="btn--danger-hover"
                      aria-label={t.remove}
                      title={t.remove}
                      onClick={() => remove(index)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </RowHead>
                  {isCollapsed ? null : (
                    <div className="row-body">
                      {definition ? (
                        <StructuredRowFields
                          fields={definition.fields}
                          row={row}
                          prefix={`${base}[${index}]`}
                          onChange={(next) => update(index, next)}
                        />
                      ) : (
                        <p className="row-body__empty">{t.pickBlockType}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </SortableRow>
          );
        })}
      </Rows>

      <div className="field-actions">
        {blocks.map((block) => (
          <Button
            key={block.slug}
            size="sm"
            onClick={() => add({ type: block.slug })}
            disabled={atLimit}
          >
            <Plus aria-hidden />
            {blockTitle(block)}
          </Button>
        ))}
        <Button size="sm" tone="ghost" onClick={paste} disabled={atLimit || !pasteable}>
          {t.pasteBlock}
        </Button>
      </div>
    </Field>
  );
}
