/**
 * Document types inferred from the user's config.
 *
 * No codegen: `defineConfig` preserves literals, so `CmsDocument<typeof config, 'posts'>` can
 * be computed with conditional and mapped types. This is the whole reason the config uses
 * `const` type parameters.
 */

export type RichTextValue = {
  type: 'doc';
  content: readonly unknown[];
};

export type CmsUpload = {
  id: string;
  /** Original name of the dropped file, when the upload handler reports it. */
  filename?: string;
  url?: string;
  mime?: string;
  width?: number;
  height?: number;
  /** Generated sizes by name, each with its URL. */
  sizes?: Record<string, string>;
};

type SelectOption = { label: string; value: string };

type FieldName<F> = F extends { name: infer N extends string } ? N : never;

type IsRequired<F> = F extends { required: true } ? true : false;

type LocaleOf<C> = C extends { localization: { locales: readonly (infer L extends string)[] } }
  ? L
  : string;

type CollectionOf<C, S extends string> = C extends { collections: readonly unknown[] }
  ? Extract<C['collections'][number], { slug: S }>
  : never;

type GlobalOf<C, S extends string> = C extends { globals: readonly unknown[] }
  ? Extract<C['globals'][number], { slug: S }>
  : never;

type FieldsOf<T> = T extends { fields: infer FF extends readonly unknown[] } ? FF : never;

type IsLocalized<F> = F extends { localized: true } ? true : false;

/* --------------------------------------------------------------------- values */

type ScalarValue<F> = F extends {
  type: 'text' | 'textarea' | 'email' | 'slug' | 'code' | 'password';
}
  ? string
  : F extends { type: 'number' }
    ? number
    : F extends { type: 'checkbox' }
      ? boolean
      : F extends { type: 'date' }
        ? Date
        : F extends { type: 'json' }
          ? unknown
          : F extends { type: 'richText' }
            ? RichTextValue
            : F extends {
                  type: 'select';
                  hasMany: true;
                  options: infer O extends readonly SelectOption[];
                }
              ? Array<O[number]['value']>
              : F extends { type: 'select'; options: infer O extends readonly SelectOption[] }
                ? O[number]['value']
                : F extends { type: 'radio'; options: infer O extends readonly SelectOption[] }
                  ? O[number]['value']
                  : F extends { type: 'relation'; hasMany: true }
                    ? string[]
                    : F extends { type: 'relation' }
                      ? string
                      : F extends { type: 'upload' }
                        ? CmsUpload
                        : never;

type BlockOutput<B, L extends string> = B extends {
  slug: infer S extends string;
  fields: infer FF extends readonly unknown[];
}
  ? { type: S; id: string } & ObjectOutput<FF, L>
  : never;

type BlockInput<B, L extends string> = B extends {
  slug: infer S extends string;
  fields: infer FF extends readonly unknown[];
}
  ? { type: S; id?: string } & ObjectInput<FF, L>
  : never;

type StructuralValue<F, L extends string> = F extends {
  type: 'array';
  fields: infer FF extends readonly unknown[];
}
  ? Array<{ id: string } & ObjectOutput<FF, L>>
  : F extends { type: 'group'; fields: infer FF extends readonly unknown[] }
    ? ObjectOutput<FF, L>
    : F extends { type: 'blocks'; blocks: infer BB extends readonly unknown[] }
      ? Array<BlockOutput<BB[number], L>>
      : never;

type StructuralInput<F, L extends string> = F extends {
  type: 'array';
  fields: infer FF extends readonly unknown[];
}
  ? Array<{ id?: string } & ObjectInput<FF, L>>
  : F extends { type: 'group'; fields: infer FF extends readonly unknown[] }
    ? ObjectInput<FF, L>
    : F extends { type: 'blocks'; blocks: infer BB extends readonly unknown[] }
      ? Array<BlockInput<BB[number], L>>
      : never;

type IsStructural<F> = F extends { type: 'array' | 'blocks' | 'group' } ? true : false;

type OutputValue<F, L extends string> =
  IsStructural<F> extends true
    ? StructuralValue<F, L>
    : IsLocalized<F> extends true
      ? Record<L, LeafOutput<F>>
      : LeafOutput<F>;

/** Output values are never optional; non-required ones are `| null` instead. */
type LeafOutput<F> = IsRequired<F> extends true ? ScalarValue<F> : ScalarValue<F> | null;

type InputValue<F, L extends string> =
  IsStructural<F> extends true
    ? StructuralInput<F, L>
    : IsLocalized<F> extends true
      ? ScalarValue<F> | Record<L, ScalarValue<F>>
      : ScalarValue<F>;

/* -------------------------------------------------------------------- objects */

export type ObjectOutput<FF extends readonly unknown[], L extends string = string> = {
  [F in FF[number] as FieldName<F>]: OutputValue<F, L>;
};

export type ObjectInput<FF extends readonly unknown[], L extends string = string> = {
  [F in FF[number] as IsRequired<F> extends true ? FieldName<F> : never]: InputValue<F, L>;
} & {
  [F in FF[number] as IsRequired<F> extends true ? never : FieldName<F>]?: InputValue<F, L>;
};

/* ------------------------------------------------------------------ documents */

type IdOf<C> = C extends { db: { id: 'increment' } } ? number : string;

type SystemFields<C> = {
  id: IdOf<C>;
  createdAt: Date;
  updatedAt: Date;
  _status: 'draft' | 'published';
};

export type CmsDocument<C, S extends string> = ObjectOutput<
  FieldsOf<CollectionOf<C, S>>,
  LocaleOf<C>
> &
  SystemFields<C>;

export type CmsGlobal<C, S extends string> = ObjectOutput<FieldsOf<GlobalOf<C, S>>, LocaleOf<C>> &
  SystemFields<C>;

export type CmsCreateInput<C, S extends string> = ObjectInput<
  FieldsOf<CollectionOf<C, S>>,
  LocaleOf<C>
> & {
  draft?: boolean;
  locale?: LocaleOf<C>;
};

export type CmsUpdateInput<C, S extends string> = Partial<CmsCreateInput<C, S>>;

export type CmsCollectionSlug<C> = C extends { collections: readonly (infer Col)[] }
  ? Col extends { slug: infer S extends string }
    ? S
    : never
  : never;

export type CmsGlobalSlug<C> = C extends { globals: readonly (infer G)[] }
  ? G extends { slug: infer S extends string }
    ? S
    : never
  : never;
