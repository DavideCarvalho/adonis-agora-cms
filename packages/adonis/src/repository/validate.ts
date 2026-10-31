import type { FieldConfig, SelectOption } from '../config/types.js';

export type ValidateContext = {
  locales: readonly string[];
  defaultLocale: string;
  localizedRequired: 'default' | 'all';
};

export type ValidateResult = {
  data: Record<string, unknown>;
  errors: Record<string, string>;
};

export function validateDocument(
  fields: readonly FieldConfig[],
  input: Record<string, unknown>,
  ctx: ValidateContext,
): ValidateResult {
  const errors: Record<string, string> = {};
  const data = validateFields(fields, input, '', ctx, errors);
  return { data, errors };
}

function validateFields(
  fields: readonly FieldConfig[],
  input: Record<string, unknown>,
  path: string,
  ctx: ValidateContext,
  errors: Record<string, string>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const field of fields) {
    const fieldPath = path ? `${path}.${field.name}` : field.name;

    // Layout only: these fields live at this level of the document, like the compiled columns.
    if (field.type === 'tabs' || field.type === 'row' || field.type === 'collapsible') {
      const children =
        field.type === 'tabs' ? field.tabs.flatMap((tab) => [...tab.fields]) : field.fields;
      Object.assign(output, validateFields(children, input, path, ctx, errors));
      continue;
    }

    if (isStructural(field)) {
      const nested = validateFields(
        childrenOf(field),
        asObject(input[field.name]),
        fieldPath,
        ctx,
        errors,
      );
      output[field.name] = nested;
      continue;
    }

    if (!(field.name in input)) {
      const generated = generateSlug(field, input);
      if (generated !== undefined) output[field.name] = generated;
      else if (field.required && field.defaultValue === undefined) errors[fieldPath] = 'required';
      continue;
    }

    const raw = input[field.name];
    output[field.name] = validateField(field, raw, fieldPath, ctx, errors, input);
  }

  return output;
}

function validateField(
  field: FieldConfig,
  raw: unknown,
  path: string,
  ctx: ValidateContext,
  errors: Record<string, string>,
  siblings: Record<string, unknown>,
): unknown {
  if (field.localized) {
    const localizedRequired =
      ctx.localizedRequired === 'all' || field.required === true
        ? (locale: string) => ctx.localizedRequired === 'all' || locale === ctx.defaultLocale
        : undefined;

    if (isLocaleMap(raw, ctx.locales)) {
      const result: Record<string, unknown> = {};
      for (const locale of ctx.locales) {
        const value = raw[locale];
        const required = localizedRequired ? localizedRequired(locale) : false;
        if (required && isEmpty(value)) {
          errors[`${path}.${locale}`] = 'required';
          continue;
        }
        if (value === undefined) continue;
        result[locale] = validateLeaf(field, value, `${path}.${locale}`, ctx, errors, siblings);
      }
      return result;
    }

    const result: Record<string, unknown> = {};
    for (const locale of ctx.locales) {
      if (localizedRequired?.(locale) && isEmpty(raw)) {
        errors[`${path}.${locale}`] = 'required';
        continue;
      }
      result[locale] = validateLeaf(field, raw, `${path}.${locale}`, ctx, errors, siblings);
    }
    return result;
  }

  if (field.required && isEmpty(raw)) {
    errors[path] = 'required';
    return undefined;
  }

  return validateLeaf(field, raw, path, ctx, errors, siblings);
}

function validateLeaf(
  field: FieldConfig,
  raw: unknown,
  path: string,
  ctx: ValidateContext,
  errors: Record<string, string>,
  siblings: Record<string, unknown>,
): unknown {
  if (raw === null || raw === undefined) return undefined;

  const fail = (message: string) => {
    errors[path] = message;
    return undefined;
  };

  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'password':
    case 'code':
      if (typeof raw !== 'string') return fail('must be a string');
      if ('maxLength' in field && field.maxLength && raw.length > field.maxLength) {
        return fail(`must have at most ${field.maxLength} characters`);
      }
      if ('minLength' in field && field.minLength && raw.length < field.minLength) {
        return fail(`must have at least ${field.minLength} characters`);
      }
      if ('pattern' in field && field.pattern && !new RegExp(field.pattern).test(raw)) {
        return fail('does not match the required pattern');
      }
      if (field.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
        return fail('must be a valid email');
      }
      return applyCustomValidator(field, raw, path, errors, siblings);

    case 'slug': {
      const value =
        typeof raw === 'string' && raw.length > 0
          ? raw
          : field.from
            ? slugify(String(siblings[field.from] ?? ''))
            : '';
      return applyCustomValidator(field, value, path, errors, siblings);
    }

    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isNaN(value)) return fail('must be a number');
      if ((field.format ?? 'int') === 'int' && !Number.isInteger(value)) {
        return fail('must be an integer');
      }
      if (field.min !== undefined && value < field.min)
        return fail(`must be at least ${field.min}`);
      if (field.max !== undefined && value > field.max) return fail(`must be at most ${field.max}`);
      return applyCustomValidator(field, value, path, errors, siblings);
    }

    case 'checkbox':
      if (typeof raw !== 'boolean') return fail('must be a boolean');
      return raw;

    case 'date': {
      const value = raw instanceof Date ? raw : new Date(String(raw));
      if (Number.isNaN(value.getTime())) return fail('must be a valid date');
      return value;
    }

    case 'select':
    case 'radio': {
      const values = allowedValues(field.options);
      if (field.type === 'select' && field.hasMany) {
        if (!Array.isArray(raw)) return fail('must be an array');
        const invalid = raw.find((item) => !values.includes(String(item)));
        if (invalid !== undefined) return fail(`"${String(invalid)}" is not an allowed option`);
        return raw.map(String);
      }
      if (!values.includes(String(raw))) return fail(`"${String(raw)}" is not an allowed option`);
      return String(raw);
    }

    case 'json':
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw);
        } catch {
          return fail('must be valid JSON');
        }
      }
      return raw;

    case 'richText':
      if (typeof raw !== 'object') return fail('must be an editor document');
      return raw;

    case 'relation': {
      if (field.hasMany) {
        if (!Array.isArray(raw)) return fail('must be an array of ids');
        return raw.map((item) => normalizeRelation(item, path, errors));
      }
      return normalizeRelation(raw, path, errors);
    }

    case 'upload': {
      if (typeof raw === 'string') return raw;
      if (raw && typeof raw === 'object' && 'id' in raw) return String((raw as { id: unknown }).id);
      return fail('must be a media id');
    }

    case 'array': {
      if (!Array.isArray(raw)) return fail('must be an array');
      if (field.minRows !== undefined && raw.length < field.minRows) {
        return fail(`must have at least ${field.minRows} rows`);
      }
      if (field.maxRows !== undefined && raw.length > field.maxRows) {
        return fail(`must have at most ${field.maxRows} rows`);
      }
      return raw.map((row, index) =>
        validateFields(field.fields, asObject(row), `${path}[${index}]`, ctx, errors),
      );
    }

    case 'blocks': {
      if (!Array.isArray(raw)) return fail('must be an array');
      return raw.map((row, index) => validateBlock(field, row, `${path}[${index}]`, ctx, errors));
    }

    default:
      return raw;
  }
}

function validateBlock(
  field: Extract<FieldConfig, { type: 'blocks' }>,
  row: unknown,
  path: string,
  ctx: ValidateContext,
  errors: Record<string, string>,
): unknown {
  const object = asObject(row);
  const type = String(object.type ?? '');
  const definition = field.blocks.find((blockDefinition) => blockDefinition.slug === type);

  if (!definition) {
    errors[`${path}.type`] = `unknown block type "${type}"`;
    return undefined;
  }

  const values = validateFields(definition.fields, object, path, ctx, errors);
  return { type, ...(typeof object.id === 'string' ? { id: object.id } : {}), ...values };
}

function applyCustomValidator(
  field: FieldConfig,
  value: unknown,
  path: string,
  errors: Record<string, string>,
  data: Record<string, unknown>,
): unknown {
  if (!field.validate) return value;
  const message = field.validate({ value, data });
  if (typeof message === 'string' && message.length > 0) {
    errors[path] = message;
    return undefined;
  }
  return value;
}

function normalizeRelation(raw: unknown, path: string, errors: Record<string, string>): unknown {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const value = raw as { id?: unknown; collection?: unknown; relationTo?: unknown };
    if (value.id === undefined) {
      errors[path] = 'relation value needs an id';
      return undefined;
    }
    const collection = value.collection ?? value.relationTo;
    return collection ? { collection: String(collection), id: String(value.id) } : String(value.id);
  }
  errors[path] = 'must be an id or { collection, id }';
  return undefined;
}

function generateSlug(field: FieldConfig, input: Record<string, unknown>): string | undefined {
  if (field.type !== 'slug' || !field.from) return undefined;
  const source = input[field.from];
  if (source === undefined || source === null) return undefined;
  const slug = slugify(String(source));
  return slug.length > 0 ? slug : undefined;
}

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function allowedValues(options: readonly SelectOption[]): string[] {
  return options.map((option) => String(option.value));
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function isLocaleMap(value: unknown, locales: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => locales.includes(key));
}

function isStructural(field: FieldConfig): boolean {
  return field.type === 'group';
}

function childrenOf(field: FieldConfig): readonly FieldConfig[] {
  return field.type === 'group' ? field.fields : [];
}
