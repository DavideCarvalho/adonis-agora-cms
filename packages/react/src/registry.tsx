import type { ChangeEvent, ComponentType } from 'react';
import { Checkbox, Field, Input, Select, Textarea } from './atoms/index.js';
import type { AdminField } from './types.js';

export type FieldComponentProps = {
  field: AdminField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string | undefined;
  locale?: string | undefined;
  id?: string | undefined;
  disabled?: boolean | undefined;
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

const asString = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value);

export function TextField({ field, value, onChange, error, id }: FieldComponentProps) {
  return (
    <Field
      label={field.name}
      description={field.admin?.description}
      error={error}
      required={field.required}
      htmlFor={id}
    >
      <Input
        id={id}
        value={asString(value)}
        placeholder={field.admin?.description}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function TextareaField({ field, value, onChange, error, id }: FieldComponentProps) {
  return (
    <Field
      label={field.name}
      description={field.admin?.description}
      error={error}
      required={field.required}
      htmlFor={id}
    >
      <Textarea
        id={id}
        value={asString(value)}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function NumberField({ field, value, onChange, error, id }: FieldComponentProps) {
  return (
    <Field label={field.name} error={error} required={field.required} htmlFor={id}>
      <Input
        id={id}
        type="number"
        value={asString(value)}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
      />
    </Field>
  );
}

export function CheckboxField({ field, value, onChange, error, id }: FieldComponentProps) {
  return (
    <Field label={field.name} error={error} htmlFor={id}>
      <Checkbox
        id={id}
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    </Field>
  );
}

export function DateField({ field, value, onChange, error, id }: FieldComponentProps) {
  const date =
    value instanceof Date ? value.toISOString().slice(0, 10) : asString(value).slice(0, 10);
  return (
    <Field label={field.name} error={error} required={field.required} htmlFor={id}>
      <Input id={id} type="date" value={date} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

export function SelectField({ field, value, onChange, error, id }: FieldComponentProps) {
  return (
    <Field label={field.name} error={error} required={field.required} htmlFor={id}>
      <Select
        id={id}
        value={asString(value)}
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

export function JsonField({ field, value, onChange, error, id }: FieldComponentProps) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);

  return (
    <Field label={field.name} error={error} htmlFor={id}>
      <Textarea
        id={id}
        className="font-mono text-xs"
        value={text}
        onChange={(event) => {
          try {
            onChange(JSON.parse(event.target.value));
          } catch {
            onChange(event.target.value);
          }
        }}
      />
    </Field>
  );
}

registerField('text', TextField);
registerField('slug', TextField);
registerField('email', TextField);
registerField('password', TextField);
registerField('code', TextField);
registerField('textarea', TextareaField);
registerField('richText', TextareaField);
registerField('number', NumberField);
registerField('checkbox', CheckboxField);
registerField('date', DateField);
registerField('select', SelectField);
registerField('radio', SelectField);
registerField('json', JsonField);
