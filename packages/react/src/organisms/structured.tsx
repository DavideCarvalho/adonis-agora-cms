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
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Button, Field, Select } from '../atoms/index.js';
import { resolveFieldComponent } from '../registry.js';
import type { AdminField } from '../types.js';

type Row = Record<string, unknown>;

function ScalarInput({
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

function RowFields({
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
      {fields.map((field) => (
        <ScalarInput
          key={field.name}
          field={field}
          value={row[field.name]}
          path={`${prefix}.${field.name}`}
          onChange={(next) => onChange({ ...row, [field.name]: next })}
        />
      ))}
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
          ⠿
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
  children,
}: {
  index: number;
  handle: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="row-head">
      {handle}
      <span className="row-head__index">#{index + 1}</span>
      <span className="row-head__spacer" />
      {children}
    </div>
  );
}

/** Array field: ordered rows with drag reorder, add and remove. Nested containers use the registry. */
export function ArrayBuilder({
  field,
  value,
  onChange,
}: {
  field: AdminField;
  value: unknown;
  onChange: (next: unknown[]) => void;
}) {
  const rows = Array.isArray(value) ? (value as Row[]) : [];
  const nested = field.fields ?? [];
  const canSort = field.admin?.isSortable !== false;
  const sortable = canSort && rows.length > 1;
  const { ids, sensors, onDragEnd, move, remove, add } = useSortableRows(rows, onChange);

  const update = (index: number, row: Row) =>
    onChange(rows.map((current, position) => (position === index ? row : current)));

  return (
    <Field label={field.name} description={field.admin?.description}>
      <Rows ids={ids} sensors={sensors} sortable={sortable} onDragEnd={onDragEnd}>
        {rows.map((row, index) => (
          <SortableRow
            key={ids[index]}
            id={ids[index] ?? `row-${index}`}
            label={`row ${index + 1}`}
            onMoveBy={(direction) => move(index, direction)}
          >
            {(handle) => (
              <>
                <RowHead index={index} handle={handle}>
                  {canSort ? null : (
                    <>
                      <Button size="xs" tone="ghost" onClick={() => move(index, -1)}>
                        ↑
                      </Button>
                      <Button size="xs" tone="ghost" onClick={() => move(index, 1)}>
                        ↓
                      </Button>
                    </>
                  )}
                  <Button size="xs" tone="destructive" onClick={() => remove(index)}>
                    Remove
                  </Button>
                </RowHead>
                <div className="row-body">
                  <RowFields
                    fields={nested}
                    row={row}
                    prefix={`${field.name}[${index}]`}
                    onChange={(next) => update(index, next)}
                  />
                </div>
              </>
            )}
          </SortableRow>
        ))}
      </Rows>

      <div className="field-actions">
        <Button
          size="sm"
          onClick={() => add({})}
          disabled={Boolean(field.maxRows && rows.length >= field.maxRows)}
        >
          Add row
        </Button>
      </div>
    </Field>
  );
}

/** Blocks field: one row per block, reorderable by drag, with the block type as its own select. */
export function BlocksBuilder({
  field,
  value,
  onChange,
}: {
  field: AdminField;
  value: unknown;
  onChange: (next: unknown[]) => void;
}) {
  const rows = Array.isArray(value) ? (value as Row[]) : [];
  const blocks = field.blocks ?? [];
  const canSort = field.admin?.isSortable !== false;
  const sortable = canSort && rows.length > 1;
  const { ids, sensors, onDragEnd, move, remove, add } = useSortableRows(rows, onChange);

  const update = (index: number, row: Row) =>
    onChange(rows.map((current, position) => (position === index ? row : current)));

  return (
    <Field label={field.name} description={field.admin?.description}>
      <Rows ids={ids} sensors={sensors} sortable={sortable} onDragEnd={onDragEnd}>
        {rows.map((row, index) => {
          const definition = blocks.find((block) => block.slug === row.type);
          const type = String(row.type ?? '');

          return (
            <SortableRow
              key={ids[index]}
              id={ids[index] ?? `row-${index}`}
              label={`block ${index + 1}`}
              onMoveBy={(direction) => move(index, direction)}
            >
              {(handle) => (
                <>
                  <RowHead index={index} handle={handle}>
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
                          {block.slug}
                        </option>
                      ))}
                    </Select>
                    <Button size="xs" tone="destructive" onClick={() => remove(index)}>
                      Remove
                    </Button>
                  </RowHead>
                  <div className="row-body">
                    {definition ? (
                      <RowFields
                        fields={definition.fields}
                        row={row}
                        prefix={`${field.name}[${index}]`}
                        onChange={(next) => update(index, next)}
                      />
                    ) : (
                      <p className="row-body__empty">Pick a block type to edit its fields.</p>
                    )}
                  </div>
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
            disabled={Boolean(field.maxRows && rows.length >= field.maxRows)}
          >
            + {block.slug}
          </Button>
        ))}
      </div>
    </Field>
  );
}
