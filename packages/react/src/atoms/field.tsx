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

/** Molecule: label + control + hint/error. Every field component composes this. */
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
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-sm font-medium text-zinc-900">
          {label}
          {required ? <span className="ml-0.5 text-red-600">*</span> : null}
        </label>
      ) : null}

      {children}

      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : description ? (
        <p className="text-xs text-zinc-500">{description}</p>
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
    neutral: 'bg-zinc-100 text-zinc-700',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
  } as const;

  return (
    <span className={cn('inline-flex rounded px-2 py-0.5 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  );
}
