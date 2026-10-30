import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button } from '../atoms/index.js';
import { useMessages } from '../context.js';
import { LivePreview } from '../organisms/live-preview.js';
import { ArrayBuilder, BlocksBuilder } from '../organisms/structured.js';
import { VersionsPanel } from '../organisms/versions-panel.js';
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

          {previewUrl ? (
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
        />
      ) : null}
    </form>
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
