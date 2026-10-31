import { type ChangeEvent, type ComponentType, useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Field, Input, Select, Textarea } from './atoms/index.js';
import { useMessages } from './context.js';
import { RelationPicker } from './organisms/relation-picker.js';
import { RichText } from './organisms/rich-text.js';
import { UploadField } from './organisms/upload-field.js';
import type { AdminField } from './types.js';

export type FieldComponentProps = {
  field: AdminField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string | undefined;
  locale?: string | undefined;
  id?: string | undefined;
  disabled?: boolean | undefined;
  /** The other fields at this level of the form. */
  siblings?: Record<string, unknown> | undefined;
};

/**
 * Field registry — the seam between the config and the form.
 *
 * `field.admin.component` carries a serializable id; the entry maps it to a real component with
 * `registerField`. Built-ins are registered below, and any of them can be overridden by binding
 * the same id.
 */
export const FIELD_REGISTRY = new Map<string, ComponentType<FieldComponentProps>>();

export function registerField(type: string, component: ComponentType<FieldComponentProps>): void {
  FIELD_REGISTRY.set(type, component);
}

export function resolveFieldComponent(field: AdminField): ComponentType<FieldComponentProps> {
  return (
    FIELD_REGISTRY.get(field.admin?.component ?? '') ??
    FIELD_REGISTRY.get(field.type) ??
    FIELD_REGISTRY.get('text') ??
    TextField
  );
}

/** `meta_title` / `metaTitle` -> `Meta title`: raw column names never reach an editor. */
export function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Human label for a field: the config `label` when present, otherwise its name, humanized. */
export function fieldTitle(field: AdminField): string {
  return typeof field.label === 'string' && field.label.length > 0
    ? field.label
    : humanize(field.name);
}

/** Tabs, rows and collapsibles are layout only: their fields sit at this level of the document. */
export function flattenFields(fields: readonly AdminField[]): AdminField[] {
  return fields.flatMap((field) => {
    if (field.type === 'tabs')
      return (field.tabs ?? []).flatMap((tab) => flattenFields(tab.fields));
    if (field.type === 'row' || field.type === 'collapsible') {
      return flattenFields(field.fields ?? []);
    }
    return [field];
  });
}

/** Human label for a block definition. */
export function blockTitle(block: { slug: string; labels?: unknown }): string {
  const singular = (block.labels as { singular?: unknown } | undefined)?.singular;
  return typeof singular === 'string' && singular.length > 0 ? singular : humanize(block.slug);
}

const asString = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value);

const INPUT_TYPES: Record<string, string> = { email: 'email', password: 'password' };

export function TextField({ field, value, onChange, error, id, disabled }: FieldComponentProps) {
  return (
    <Field
      label={fieldTitle(field)}
      description={field.admin?.description}
      error={error}
      required={field.required}
      htmlFor={id}
    >
      <Input
        id={id}
        type={INPUT_TYPES[field.type] ?? 'text'}
        className={field.type === 'slug' ? 'mono' : undefined}
        value={asString(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function TextareaField({
  field,
  value,
  onChange,
  error,
  id,
  disabled,
}: FieldComponentProps) {
  return (
    <Field
      label={fieldTitle(field)}
      description={field.admin?.description}
      error={error}
      required={field.required}
      htmlFor={id}
    >
      <Textarea
        id={id}
        className={field.type === 'code' ? 'mono' : undefined}
        value={asString(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function NumberField({ field, value, onChange, error, id, disabled }: FieldComponentProps) {
  return (
    <Field
      label={fieldTitle(field)}
      description={field.admin?.description}
      error={error}
      required={field.required}
      htmlFor={id}
    >
      <Input
        id={id}
        type="number"
        className="num"
        value={asString(value)}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
      />
    </Field>
  );
}

export function CheckboxField({
  field,
  value,
  onChange,
  error,
  id,
  disabled,
}: FieldComponentProps) {
  return (
    <Field description={field.admin?.description} error={error} htmlFor={id}>
      <label className="check check--field" htmlFor={id}>
        <Checkbox
          id={id}
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {fieldTitle(field)}
      </label>
    </Field>
  );
}

export function DateField({ field, value, onChange, error, id, disabled }: FieldComponentProps) {
  const date =
    value instanceof Date ? value.toISOString().slice(0, 10) : asString(value).slice(0, 10);
  return (
    <Field
      label={fieldTitle(field)}
      description={field.admin?.description}
      error={error}
      required={field.required}
      htmlFor={id}
    >
      <Input
        id={id}
        type="date"
        value={date}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function SelectField({ field, value, onChange, error, id, disabled }: FieldComponentProps) {
  return (
    <Field
      label={fieldTitle(field)}
      description={field.admin?.description}
      error={error}
      required={field.required}
      htmlFor={id}
    >
      <Select
        id={id}
        value={asString(value)}
        disabled={disabled}
        onChange={(event) => onChange((event as ChangeEvent<HTMLSelectElement>).target.value)}
      >
        <option value="">—</option>
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/**
 * Keeps its own text: half-typed JSON stays in the box instead of replacing the value with a string,
 * and only a parseable text reaches the document.
 */
export function JsonField({ field, value, onChange, error, id, disabled }: FieldComponentProps) {
  const t = useMessages();
  const serialized = JSON.stringify(value ?? null, null, 2);
  const [text, setText] = useState(serialized);
  const [invalid, setInvalid] = useState(false);
  const lastSent = useRef(serialized);

  useEffect(() => {
    if (serialized === lastSent.current) return;
    lastSent.current = serialized;
    setText(serialized);
    setInvalid(false);
  }, [serialized]);

  return (
    <Field
      label={fieldTitle(field)}
      error={error ?? (invalid ? t.invalidJson : undefined)}
      htmlFor={id}
    >
      <Textarea
        id={id}
        className="mono textarea--code"
        value={text}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => {
          setText(event.target.value);
          try {
            const parsed: unknown = JSON.parse(event.target.value);
            lastSent.current = JSON.stringify(parsed ?? null, null, 2);
            setInvalid(false);
            onChange(parsed);
          } catch {
            setInvalid(true);
          }
        }}
      />
    </Field>
  );
}

/** `[longitude, latitude]`, the order GeoJSON and most map libraries use. */
/** Click the image to choose what stays in frame when it is cropped. */
export function FocalPointField({
  field,
  value,
  onChange,
  error,
  disabled,
  siblings,
}: FieldComponentProps) {
  const t = useMessages();
  const url = typeof siblings?.url === 'string' ? siblings.url : undefined;
  const point = value as { x?: unknown; y?: unknown } | null | undefined;
  const placed = typeof point?.x === 'number' && typeof point?.y === 'number';

  return (
    <Field
      label={fieldTitle(field)}
      description={field.admin?.description}
      error={error}
      required={field.required}
    >
      {url ? (
        <div className="focal">
          <button
            type="button"
            className="focal__image"
            aria-label={fieldTitle(field)}
            disabled={disabled}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const round = (ratio: number) =>
                Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 1000;
              onChange({
                x: round((event.clientX - box.left) / box.width),
                y: round((event.clientY - box.top) / box.height),
              });
            }}
          >
            <img src={url} alt="" />
            {placed ? (
              <span
                className="focal__marker"
                style={{ left: `${Number(point.x) * 100}%`, top: `${Number(point.y) * 100}%` }}
              />
            ) : null}
          </button>
          {placed && !disabled ? (
            <Button size="sm" tone="ghost" onClick={() => onChange(null)}>
              {t.clearFocalPoint}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="hint">{t.focalPointNeedsImage}</p>
      )}
    </Field>
  );
}

export function PointField({ field, value, onChange, error, id, disabled }: FieldComponentProps) {
  const t = useMessages();
  const point = Array.isArray(value) ? (value as (number | null)[]) : [null, null];
  const update = (index: number, raw: string) => {
    const next = [point[0] ?? null, point[1] ?? null];
    next[index] = raw === '' ? null : Number(raw);
    onChange(next[0] === null && next[1] === null ? null : next);
  };

  return (
    <Field
      label={fieldTitle(field)}
      description={field.admin?.description}
      error={error}
      required={field.required}
    >
      <div className="point-field">
        <Input
          id={id}
          type="number"
          step="any"
          min={-180}
          max={180}
          aria-label={`${fieldTitle(field)} ${t.longitude}`}
          placeholder={t.longitude}
          value={asString(point[0])}
          disabled={disabled}
          onChange={(event) => update(0, event.target.value)}
        />
        <Input
          type="number"
          step="any"
          min={-90}
          max={90}
          aria-label={`${fieldTitle(field)} ${t.latitude}`}
          placeholder={t.latitude}
          value={asString(point[1])}
          disabled={disabled}
          onChange={(event) => update(1, event.target.value)}
        />
      </div>
    </Field>
  );
}

/** Read-only: the documents of another collection that point at this one. */
export function JoinFieldView({ field, value }: FieldComponentProps) {
  const t = useMessages();
  const docs = (value as { docs?: Record<string, unknown>[] } | null)?.docs ?? [];
  const target = String(field.relationTo ?? '');

  return (
    <Field label={fieldTitle(field)} description={field.admin?.description}>
      {docs.length === 0 ? <p className="hint">{t.nothingLinked}</p> : null}
      <ul className="join-list">
        {docs.map((doc) => (
          <li key={String(doc.id)}>
            <a href={`#/collections/${target}/${String(doc.id)}`}>
              {String(doc.title ?? doc.titulo ?? doc.name ?? doc.email ?? doc.slug ?? doc.id)}
            </a>
          </li>
        ))}
      </ul>
    </Field>
  );
}

registerField('text', TextField);
registerField('slug', TextField);
registerField('email', TextField);
registerField('password', TextField);
registerField('code', TextareaField);
registerField('textarea', TextareaField);
registerField('richText', RichText);
registerField('number', NumberField);
registerField('checkbox', CheckboxField);
registerField('date', DateField);
registerField('select', SelectField);
registerField('radio', SelectField);
registerField('json', JsonField);
registerField('relation', RelationPicker);
registerField('upload', UploadField);
registerField('point', PointField);
registerField('join', JoinFieldView);
registerField('focal-point', FocalPointField);
