/**
 * Field builders.
 *
 * Every builder is a pure identity function over plain data. The `const` type parameters are
 * load-bearing: they keep `name`, `type` and `options[].value` as literal types, which is what
 * lets `CmsDocument<typeof config, 'posts'>` infer the document shape without codegen.
 */
import type {
  ArrayField,
  BlockDefinition,
  BlocksField,
  CheckboxField,
  CodeField,
  CollapsibleField,
  DateField,
  EmailField,
  FieldConfig,
  GroupField,
  JsonField,
  NumberField,
  PasswordField,
  RadioField,
  RelationField,
  RichTextField,
  RowField,
  SelectField,
  SlugField,
  TabsField,
  TextareaField,
  TextField,
  UploadField,
} from './types.js';

type Without<T, K extends keyof T> = Omit<T, K>;

type Builder<TType extends string, TName extends string, TOptions> = {
  type: TType;
  name: TName;
} & TOptions;

const EMPTY = {} as Record<never, never>;

function build<TType extends string, TName extends string, TOptions>(
  type: TType,
  name: TName,
  options?: TOptions,
): Builder<TType, TName, TOptions> {
  return { type, name, ...(options ?? EMPTY) } as Builder<TType, TName, TOptions>;
}

export function text<
  const N extends string,
  const O extends Without<TextField, 'type' | 'name'> = typeof EMPTY,
>(name: N, options?: O): Builder<'text', N, O> {
  return build('text', name, options);
}

export function textarea<
  const N extends string,
  const O extends Without<TextareaField, 'type' | 'name'> = typeof EMPTY,
>(name: N, options?: O): Builder<'textarea', N, O> {
  return build('textarea', name, options);
}

export function email<
  const N extends string,
  const O extends Without<EmailField, 'type' | 'name'> = typeof EMPTY,
>(name: N, options?: O): Builder<'email', N, O> {
  return build('email', name, options);
}

export function password<
  const N extends string,
  const O extends Without<PasswordField, 'type' | 'name'> = typeof EMPTY,
>(name: N, options?: O): Builder<'password', N, O> {
  return build('password', name, options);
}

export function number<
  const N extends string,
  const O extends Without<NumberField, 'type' | 'name'> = typeof EMPTY,
>(name: N, options?: O): Builder<'number', N, O> {
  return build('number', name, options);
}

export function checkbox<
  const N extends string,
  const O extends Without<CheckboxField, 'type' | 'name'> = typeof EMPTY,
>(name: N, options?: O): Builder<'checkbox', N, O> {
  return build('checkbox', name, options);
}

export function date<
  const N extends string,
  const O extends Without<DateField, 'type' | 'name'> = typeof EMPTY,
>(name: N, options?: O): Builder<'date', N, O> {
  return build('date', name, options);
}

export function select<
  const N extends string,
  const O extends Without<SelectField, 'type' | 'name'>,
>(name: N, options: O): Builder<'select', N, O> {
  return build('select', name, options);
}

export function radio<const N extends string, const O extends Without<RadioField, 'type' | 'name'>>(
  name: N,
  options: O,
): Builder<'radio', N, O> {
  return build('radio', name, options);
}

export function json<
  const N extends string,
  const O extends Without<JsonField, 'type' | 'name'> = typeof EMPTY,
>(name: N, options?: O): Builder<'json', N, O> {
  return build('json', name, options);
}

export function code<
  const N extends string,
  const O extends Without<CodeField, 'type' | 'name'> = typeof EMPTY,
>(name: N, options?: O): Builder<'code', N, O> {
  return build('code', name, options);
}

export function slug<
  const N extends string,
  const O extends Without<SlugField, 'type' | 'name'> = typeof EMPTY,
>(name: N, options?: O): Builder<'slug', N, O> {
  return build('slug', name, options);
}

export function richText<
  const N extends string,
  const O extends Without<RichTextField, 'type' | 'name'> = typeof EMPTY,
>(name: N, options?: O): Builder<'richText', N, O> {
  return build('richText', name, options);
}

export function relation<
  const N extends string,
  const O extends Without<RelationField, 'type' | 'name'>,
>(name: N, options: O): Builder<'relation', N, O> {
  return build('relation', name, options);
}

export function upload<
  const N extends string,
  const O extends Without<UploadField, 'type' | 'name'>,
>(name: N, options: O): Builder<'upload', N, O> {
  return build('upload', name, options);
}

export function array<const N extends string, const O extends Without<ArrayField, 'type' | 'name'>>(
  name: N,
  options: O,
): Builder<'array', N, O> {
  return build('array', name, options);
}

export function group<const N extends string, const O extends Without<GroupField, 'type' | 'name'>>(
  name: N,
  options: O,
): Builder<'group', N, O> {
  return build('group', name, options);
}

export function blocks<
  const N extends string,
  const O extends Without<BlocksField, 'type' | 'name'>,
>(name: N, options: O): Builder<'blocks', N, O> {
  return build('blocks', name, options);
}

export function tabs<const N extends string, const O extends Without<TabsField, 'type' | 'name'>>(
  name: N,
  options: O,
): Builder<'tabs', N, O> {
  return build('tabs', name, options);
}

export function row<const N extends string, const O extends Without<RowField, 'type' | 'name'>>(
  name: N,
  options: O,
): Builder<'row', N, O> {
  return build('row', name, options);
}

export function collapsible<
  const N extends string,
  const O extends Without<CollapsibleField, 'type' | 'name'>,
>(name: N, options: O): Builder<'collapsible', N, O> {
  return build('collapsible', name, options);
}

export function block<
  const S extends string,
  const B extends { fields: readonly FieldConfig[] } & Record<string, unknown>,
>(slug: S, definition: B): { slug: S } & B {
  return { slug, ...definition };
}

export const fields = {
  text,
  textarea,
  email,
  password,
  number,
  checkbox,
  date,
  select,
  radio,
  json,
  code,
  slug,
  richText,
  relation,
  upload,
  array,
  group,
  blocks,
  tabs,
  row,
  collapsible,
} as const;

export type FieldBuilder = typeof fields;
export type { BlockDefinition };
