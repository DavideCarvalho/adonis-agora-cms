import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../cn.js';

/**
 * The console's button, vendored the Aviary way: a `cva` recipe over Base UI's `useRender`.
 *
 * Tone names are semantic, not hue names — `accent` follows `--accent` wherever the console brand
 * lands, and `destructive` follows `--bad`. `render` lets a link borrow the button's classes
 * without nesting a second interactive element.
 */
export const buttonVariants = cva('btn', {
  variants: {
    tone: {
      neutral: 'btn--neutral',
      accent: 'btn--accent',
      destructive: 'btn--destructive',
      ghost: 'btn--ghost',
      quiet: 'btn--quiet',
      selected: 'btn--selected',
    },
    size: {
      xs: 'btn--xs',
      sm: 'btn--sm',
      md: 'btn--md',
    },
  },
  defaultVariants: { tone: 'neutral', size: 'sm' },
});

export type ButtonTone = NonNullable<VariantProps<typeof buttonVariants>['tone']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render a different element (a link, a Base UI part) with the button's classes. */
  render?: useRender.RenderProp;
}

export function Button({
  className,
  tone,
  size,
  render,
  type,
  ...props
}: ButtonProps): React.ReactElement {
  return useRender({
    // A `<button>` inside a form defaults to submit; actions should not.
    render: render ?? <button type={type ?? 'button'} />,
    props: { ...props, className: cn(buttonVariants({ tone, size }), className) },
  });
}
