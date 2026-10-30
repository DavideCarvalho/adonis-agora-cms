import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '../cn.js';

const badgeVariants = cva('badge', {
  variants: {
    tone: {
      neutral: '',
      good: 'badge--ok',
      warn: 'badge--warn',
      bad: 'badge--bad',
      live: 'badge--live',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return <span className={cn(badgeVariants({ tone }), className)}>{children}</span>;
}
