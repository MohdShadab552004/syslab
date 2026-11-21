import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '@/lib/utils/cx';
import { Icon } from './Icon';

type Variant = 'default' | 'primary' | 'danger';
type Size = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  active?: boolean;
  icon?: string;
  iconOnly?: boolean;
  /** solid icon (play / pause) instead of stroked */
  iconFill?: boolean;
  children?: ReactNode;
}

/** Tactile button: dark bottom edge, presses 1px on click (Shopify-style). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', active, icon, iconOnly, iconFill, className, children, type = 'button', ...rest }, ref,
) {
  return (
    <button ref={ref} type={type}
      className={cx('btn', variant === 'primary' && 'btn-primary', variant === 'danger' && 'btn-danger', size === 'sm' && 'btn-sm', iconOnly && 'btn-icon', active && 'on', className)}
      {...rest}>
      {icon && <Icon path={icon} size={size === 'sm' ? 13 : 14} fill={iconFill} />}
      {children}
    </button>
  );
});
