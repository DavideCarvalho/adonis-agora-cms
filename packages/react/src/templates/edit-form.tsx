import { useMemo, useState } from 'react';
import { Badge, Button, Field } from '../atoms/index.js';
import { ArrayBuilder, BlocksBuilder } from '../organisms/structured.js';
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
};

const CONTAINERS = new Set(['group', 'row', 'collapsible']);

/**
 * Schema-driven form.
 *
 * Scalars render through the `FieldRegistry` (so custom fields just work). Groups render
 * recursively; arrays and blocks fall back to a JSON editor until their builders land.
 */
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
}: EditFormProps) {
  const [values, setValues] = useState<AdminDocument>(doc);
  const [showJson, setShowJson] = useState(false);

  const readOnly = useMemo(() => {
    const id = doc.id;
    return id ? permission?.update === false : permission?.create === false;
  }, [doc.id, permission]);

  const setValue = (path: string, value: unknown) => {
    setValues((current) => setByPath({ ...current }, path, value));
  };

  const visibleFields = collection.fields.filter((field) => !field.hidden);

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {onBack ? (
            <Button variant="ghost" size="sm" onClick={onBack}>
              ←
            </Button>
          ) : null}
          <h2 className="text-lg font-semibold text-zinc-900">
            {doc.id ? 'Edit' : 'New'} {collection.labels?.singular ?? collection.slug}
          </h2>
          {doc._status ? (
            <Badge tone={doc._status === 'published' ? 'success' : 'warning'}>{doc._status}</Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowJson((value) => !value)}>
            {showJson ? 'Form' : 'JSON'}
          </Button>
          {onDelete && permission?.delete ? (
            <Button size="sm" variant="danger" onClick={onDelete}>
              Delete
            </Button>
          ) : null}
          {onPublish && collection.drafts && permission?.update !== false ? (
            <Button size="sm" onClick={onPublish}>
              {doc._status === 'published' ? 'Unpublish' : 'Publish'}
            </Button>
          ) : null}
          <Button size="sm" variant="primary" type="submit" disabled={saving || readOnly}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </header>

      {showJson ? (
        <JsonField
          field={{ type: 'json', name: 'document' }}
          value={values}
          onChange={(next) => setValues((next ?? {}) as AdminDocument)}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visibleFields.map((field) => (
            <div
              key={field.name}
              className={field.admin?.position === 'sidebar' ? 'md:col-span-1' : 'md:col-span-2'}
            >
              <FieldRenderer
                field={field}
                values={values}
                setValue={setValue}
                error={errors?.[field.name]}
                readOnly={readOnly}
              />
            </div>
          ))}
        </div>
      )}

      {errors && Object.keys(errors).length > 0 ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {Object.entries(errors).map(([field, message]) => (
            <div key={field}>
              <strong>{field}</strong>: {message}
            </div>
          ))}
        </div>
      ) : null}
    </form>
  );
}

function FieldRenderer({
  field,
  values,
  setValue,
  error,
  readOnly,
  path = '',
}: {
  field: AdminField;
  values: AdminDocument;
  setValue: (path: string, value: unknown) => void;
  error?: string | undefined;
  readOnly: boolean;
  path?: string;
}) {
  const fieldPath = path ? `${path}.${field.name}` : field.name;

  if (CONTAINERS.has(field.type) && field.fields) {
    return (
      <fieldset className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4">
        <legend className="px-1 text-sm font-medium text-zinc-700">{field.name}</legend>
        {field.fields.map((nested) => (
          <FieldRenderer
            key={nested.name}
            field={nested}
            values={values}
            setValue={setValue}
            readOnly={readOnly}
            path={fieldPath}
          />
        ))}
      </fieldset>
    );
  }

  if (field.type === 'array' || field.type === 'blocks' || field.type === 'tabs') {
    return (
      <Field
        label={`${field.name} (JSON)`}
        description="Structured editor lands with the blocks builder."
      >
        <JsonField
          field={field}
          value={getByPath(values, fieldPath)}
          onChange={(next) => setValue(fieldPath, next)}
        />
      </Field>
    );
  }

  const Component = resolveFieldComponent(field);
  return (
    <Component
      field={field}
      value={getByPath(values, fieldPath)}
      onChange={(next) => setValue(fieldPath, next)}
      error={error}
      disabled={readOnly || field.restricted === true}
      id={fieldPath}
    />
  );
}

function getByPath(target: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
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
  const segments = path.split('.');
  let cursor = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index] ?? '';
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[segments.at(-1) ?? ''] = value;
  return target;
}
