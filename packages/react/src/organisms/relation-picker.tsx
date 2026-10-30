import { useQuery } from '@tanstack/react-query';
import { Field, Select } from '../atoms/index.js';
import { useCms } from '../context.js';
import type { FieldComponentProps } from '../registry.js';
import type { AdminDocument } from '../types.js';

function labelOf(doc: AdminDocument): string {
  const candidate = doc.title ?? doc.name ?? doc.label ?? doc.slug;
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
  const targets = Array.isArray(field.relationTo) ? field.relationTo : [field.relationTo ?? ''];
  const target = targets[0] ?? '';

  const query = useQuery({
    queryKey: ['cms', 'relation', target],
    enabled: Boolean(target) && !disabled,
    staleTime: 30_000,
    queryFn: () => client.list(target, { limit: 100, depth: 0 }),
  });

  // The document may arrive populated (depth 1) — accept both the id and `{ id }`.
  const selected =
    typeof value === 'string'
      ? value
      : (((value as { id?: unknown } | null)?.id as string | undefined) ?? '');

  return (
    <Field
      label={field.name}
      description={field.admin?.description}
      error={error ?? (query.isError ? 'failed to load options' : undefined)}
      required={field.required}
      htmlFor={id}
    >
      <Select
        id={id}
        value={selected}
        disabled={disabled || query.isLoading}
        onChange={(event) => {
          const next = (event as unknown as { target: { value: string } }).target.value;
          onChange(next === '' ? null : next);
        }}
      >
        <option value="">—</option>
        {(query.data?.docs ?? []).map((doc) => (
          <option key={doc.id} value={doc.id}>
            {labelOf(doc)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
