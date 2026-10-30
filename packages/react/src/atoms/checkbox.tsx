import type { InputHTMLAttributes } from 'react';
import { cn } from '../cn.js';

export function Checkbox({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn('size-4 rounded border-[var(--line-strong)] accent-[var(--accent)]', className)}
      {...props}
    />
  );
}
