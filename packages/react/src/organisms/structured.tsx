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
    <div className="grid gap-3 md:grid-cols-2">
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

/** Array field: ordered rows with add/remove/move. Nested containers are edited through the registry. */
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

  const update = (index: number, row: Row) =>
    onChange(rows.map((current, position) => (position === index ? row : current)));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [item] = next.splice(index, 1);
    if (item) next.splice(target, 0, item);
    onChange(next);
  };

  return (
    <Field label={field.name} description={field.admin?.description}>
      <div className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <div key={String(row.id ?? index)} className="rounded-lg border border-zinc-200 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
              <span>#{index + 1}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => move(index, -1)}>
                  ↑
                </Button>
                <Button size="sm" variant="ghost" onClick={() => move(index, 1)}>
                  ↓
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>
            </div>
            <RowFields
              fields={nested}
              row={row}
              prefix={`${field.name}[${index}]`}
              onChange={(next) => update(index, next)}
            />
          </div>
        ))}

        <Button
          size="sm"
          onClick={() => onChange([...rows, {}])}
          disabled={Boolean(field.maxRows && rows.length >= field.maxRows)}
        >
          Add row
        </Button>
      </div>
    </Field>
  );
}

/** Blocks field: one row per block, with the block type select and its own fields. */
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

  const update = (index: number, row: Row) =>
    onChange(rows.map((current, position) => (position === index ? row : current)));

  return (
    <Field label={field.name} description={field.admin?.description}>
      <div className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const definition = blocks.find((block) => block.slug === row.type);

          return (
            <div key={String(row.id ?? index)} className="rounded-lg border border-zinc-200 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Select
                  value={String(row.type ?? '')}
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
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>

              {definition ? (
                <RowFields
                  fields={definition.fields}
                  row={row}
                  prefix={`${field.name}[${index}]`}
                  onChange={(next) => update(index, next)}
                />
              ) : null}
            </div>
          );
        })}

        <div className="flex flex-wrap gap-2">
          {blocks.map((block) => (
            <Button
              key={block.slug}
              size="sm"
              onClick={() => onChange([...rows, { type: block.slug }])}
              disabled={Boolean(field.maxRows && rows.length >= field.maxRows)}
            >
              + {block.slug}
            </Button>
          ))}
        </div>
      </div>
    </Field>
  );
}
