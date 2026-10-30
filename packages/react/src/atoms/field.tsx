import type { ReactNode } from 'react';
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
  return (
    <div className={cn('field', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="label">
          {label}
          {required ? <span> *</span> : null}
        </label>
      ) : null}

      {children}

      {error ? (
        <p className="error">{error}</p>
      ) : description ? (
        <p className="hint">{description}</p>
      ) : null}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const tones = {
    neutral: '',
    success: 'badge--ok',
    warning: 'badge--warn',
    danger: 'badge--warn',
  } as const;

  return <span className={cn('badge', tones[tone])}>{children}</span>;
}
