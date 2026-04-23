import { cloneElement, isValidElement, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react'

/**
 * HerOSButton — floating-light pill button. Verbatim port from
 * `copy/src/components/HerOS.tsx`.
 *
 * Renders `.heros-btn` (defined in `src/styles/heros.css`) with
 * optional leading / trailing icon. Variants (default / brand /
 * danger) are applied by combining with `.heros-btn-brand` or
 * `.heros-btn-danger` class via the `className` prop.
 *
 * Use this for **every button across every page** — see CLAUDE.md →
 * HerOS Design System.
 */
export interface HerOSButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode
  loading?: boolean
  iconPosition?: 'left' | 'right'
}

export function HerOSButton({
  children,
  icon,
  loading,
  disabled,
  style,
  iconPosition = 'left',
  className,
  ...props
}: HerOSButtonProps) {
  const iconElement =
    icon && !loading ? (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {isValidElement(icon)
          ? cloneElement(icon as ReactElement, { className: 'heros-icon-animate-hover' } as never)
          : icon}
      </div>
    ) : null

  return (
    <button
      className={className ? `heros-btn ${className}` : 'heros-btn'}
      disabled={loading || disabled}
      style={{
        display: 'inline-flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        ...style,
      }}
      {...props}
    >
      {iconPosition === 'left' && iconElement}
      <span style={{ display: 'inline-block', lineHeight: 1 }}>{children}</span>
      {iconPosition === 'right' && iconElement}
    </button>
  )
}
