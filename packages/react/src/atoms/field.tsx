import { createContext, type ReactNode, useContext } from 'react';
import { cn } from '../cn.js';

export type FieldProps = {
  label?: ReactNode | undefined;
  description?: ReactNode | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  htmlFor?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
};

/** `layout[0].heading` and `layout.0.heading` are the same field: the API speaks the second. */
export function normalizeFieldPath(path: string): string {
  return path.replace(/\[(\d+)\]/g, '.$1');
}

/**
 * Server validation errors by field path. Fields read their own, so an error on a field nested in a
 * block lands next to that input instead of only in the summary.
 */
export const FieldErrorsContext = createContext<Record<string, string>>({});

/** Label + control + hint/error. Every field component composes this. */
export function Field({
  label,
  description,
  error,
  required,
  htmlFor,
  className,
  children,
}: FieldProps) {
  const errors = useContext(FieldErrorsContext);
  const message = error ?? (htmlFor ? errors[normalizeFieldPath(htmlFor)] : undefined);

  return (
    <div className={cn('field', message ? 'field--invalid' : undefined, className)}>
      {label ? (
        <label htmlFor={htmlFor} className="label">
          {label}
          {required ? <span> *</span> : null}
        </label>
      ) : null}

      {children}

      {message ? (
        <p className="error">{message}</p>
      ) : description ? (
        <p className="hint">{description}</p>
      ) : null}
    </div>
  );
}
