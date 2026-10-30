import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn.js';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const VARIANT: Record<ButtonVariant, string> = {
  default: '',
  primary: 'btn--primary',
  ghost: 'btn--ghost',
  danger: 'btn--danger',
};

export function Button({ variant = 'default', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      type={props.type ?? 'button'}
      className={cn('btn', VARIANT[variant], size === 'sm' && 'btn--sm', className)}
      {...props}
    />
  );
}
