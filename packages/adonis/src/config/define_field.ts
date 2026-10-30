import type { CustomColumn } from './types.js';

export type DefineFieldOptions = {
  /** Unique type id; must not collide with a built-in field type. */
  type: string;
  /** Which physical column the compiler should emit. Plain data — it travels into the spec. */
  column: CustomColumn;
  /** Admin component id; the frontend maps it with `registerField`. */
  component?: string;
};

/**
 * Declares a custom field type end to end.
 *
 * The builder produces plain data (`__column`), so the config stays serializable and the
 * compiler can emit the column without executing user code.
 *
 * ```ts
 * const color = defineField({ type: 'color', column: { type: 'string', length: 9 }, component: 'color' })
 * fields: [color('accent', { required: true })]
 * ```
 */
export function defineField<const T extends string>(options: DefineFieldOptions & { type: T }) {
  return function build<
    const N extends string,
    const O extends Record<string, unknown> = Record<never, never>,
  >(name: N, extra?: O): { type: T; name: N; __column: CustomColumn } & O {
    return {
      type: options.type,
      name,
      __column: options.column,
      ...(options.component ? { admin: { component: options.component } } : {}),
      ...(extra ?? {}),
    } as unknown as { type: T; name: N; __column: CustomColumn } & O;
  };
}
