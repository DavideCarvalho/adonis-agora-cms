import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field, Input, Select } from '../atoms/index.js';
import { useCms, useMessages } from '../context.js';
import { useAdminSchema } from '../queries.js';
import { type FieldComponentProps, fieldTitle } from '../registry.js';
import type { AdminDocument } from '../types.js';

/** The related collection's `useAsTitle`, then the usual title-ish fields, then the id. */
function labelOf(doc: AdminDocument, titleField?: string): string {
  const configured = titleField ? doc[titleField] : undefined;
  const candidate =
    configured ?? doc.title ?? doc.rotulo ?? doc.titulo ?? doc.name ?? doc.label ?? doc.slug;

  return typeof candidate === 'string' && candidate.length > 0 ? candidate : String(doc.id);
}

/**
 * Relation/upload picker.
 *
 * Loads the target collection through the admin client, so the option list is real data — no
 * typing ids by hand. Upload fields reuse it with the media collection as target.
 */
export function RelationPicker({
  field,
  value,
  onChange,
  error,
  id,
  disabled,
}: FieldComponentProps) {
  const { client } = useCms();
  const t = useMessages();
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(term), 250);
    return () => window.clearTimeout(timer);
  }, [term]);
  const schema = useAdminSchema();
  const targets = Array.isArray(field.relationTo) ? field.relationTo : [field.relationTo ?? ''];
  const target = targets[0] ?? '';
  const titleField = schema.data?.collections.find((item) => item.slug === target)?.admin
    ?.useAsTitle;

  const query = useQuery({
    queryKey: ['cms', 'relation', target, search],
    enabled: Boolean(target) && !disabled,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    queryFn: () =>
      client.list(target, {
        limit: 100,
        depth: 0,
        ...(search && titleField ? { where: { [titleField]: { iContains: search } } } : {}),
      }),
  });

  // The document may arrive populated (depth 1) — accept both the id and `{ id }`.
  const selected =
    typeof value === 'string'
      ? value
      : (((value as { id?: unknown } | null)?.id as string | undefined) ?? '');

  // The list stops at 100: a current value beyond it must still show, or saving would look like it
  // cleared the field. The box only appears when the list was actually cut (or is being searched).
  const docs = query.data?.docs ?? [];
  const populated = value && typeof value === 'object' ? (value as AdminDocument) : null;
  const missing = selected && !docs.some((doc) => doc.id === selected);
  const searchable = Boolean(titleField) && (Boolean(term) || (query.data?.totalDocs ?? 0) > 100);

  return (
    <Field
      label={fieldTitle(field)}
      description={field.admin?.description}
      error={error ?? (query.isError ? 'failed to load options' : undefined)}
      required={field.required}
      htmlFor={id}
    >
      {searchable ? (
        <Input
          type="search"
          aria-label={t.filterOptions}
          placeholder={t.filterOptions}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      ) : null}
      <Select
        id={id}
        value={selected}
        disabled={disabled || (query.isLoading && !selected)}
        onChange={(event) => {
          const next = (event as unknown as { target: { value: string } }).target.value;
          onChange(next === '' ? null : next);
        }}
      >
        <option value="">—</option>
        {missing ? (
          <option value={selected}>{populated ? labelOf(populated, titleField) : selected}</option>
        ) : null}
        {docs.map((doc) => (
          <option key={doc.id} value={doc.id}>
            {labelOf(doc, titleField)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
