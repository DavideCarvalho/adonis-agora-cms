import type { InputHTMLAttributes } from 'react';
import { cn } from '../cn.js';

export function Checkbox({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        'size-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900/10',
        className,
      )}
      {...props}
    />
  );
}
