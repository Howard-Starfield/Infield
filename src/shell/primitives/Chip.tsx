import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react'

/**
 * Compact capsule control — pills, filter tabs, tag badges. Renders as a
 * `<button>` by default so it's tabbable + keyboard-activatable; pass
 * `asStatic` for a non-interactive badge.
 *
 * Consumes `--chip-*` tokens from `semantic.css`.
 */
export type ChipVariant = 'default' | 'active' | 'accent'

interface BaseChipProps {
  children?: ReactNode
  variant?: ChipVariant
  /** Leading element — icon or dot. */
  leading?: ReactNode
  /** Trailing element — close button or chevron. */
  trailing?: ReactNode
}

export interface ChipProps
  extends BaseChipProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  asStatic?: false
}

export interface StaticChipProps extends BaseChipProps {
  asStatic: true
  className?: string
  style?: CSSProperties
  title?: string
}

type AnyChipProps = ChipProps | StaticChipProps

function chipStyle(variant: ChipVariant, extra?: CSSProperties): CSSProperties {
  const bg =
    variant === 'active'
      ? 'var(--chip-bg-active)'
      : variant === 'accent'
        ? 'var(--workspace-accent-soft)'
        : 'var(--chip-bg)'
  const fg =
    variant === 'active'
      ? 'var(--chip-fg-active)'
      : variant === 'accent'
        ? 'var(--workspace-accent)'
        : 'var(--chip-fg)'
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'calc(6px * var(--ui-scale, 1))',
    padding: 'var(--chip-padding-y) var(--chip-padding-x)',
    borderRadius: 'var(--chip-radius)',
    background: bg,
    color: fg,
    fontSize: 'var(--chip-font-size)',
    fontWeight: 500,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    border: 'none',
    cursor: 'pointer',
    transitionProperty: 'background, color, transform',
    transitionDuration: 'calc(120ms * var(--duration-scale, 1))',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    ...extra,
  }
}

export const Chip = forwardRef<HTMLButtonElement, AnyChipProps>(function Chip(
  props,
  ref,
) {
  const { variant = 'default', leading, trailing, children } = props
  if ((props as StaticChipProps).asStatic) {
    const { className, style, title } = props as StaticChipProps
    const composed = chipStyle(variant, { cursor: 'default', ...style })
    return (
      <span className={className} style={composed} title={title}>
        {leading}
        {children}
        {trailing}
      </span>
    )
  }
  const {
    style,
    onMouseEnter,
    onMouseLeave,
    onMouseDown,
    onMouseUp,
    disabled,
    ...rest
  } = props as ChipProps
  const composed = chipStyle(variant, {
    ...(disabled && { opacity: 0.5, cursor: 'not-allowed' }),
    ...style,
  })
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      style={composed}
      onMouseEnter={(e) => {
        if (!disabled && variant !== 'active')
          (e.currentTarget as HTMLButtonElement).style.background =
            'var(--chip-bg-hover)'
        onMouseEnter?.(e)
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background =
          variant === 'active'
            ? 'var(--chip-bg-active)'
            : variant === 'accent'
              ? 'var(--workspace-accent-soft)'
              : 'var(--chip-bg)'
        onMouseLeave?.(e)
      }}
      onMouseDown={(e) => {
        if (!disabled)
          (e.currentTarget as HTMLButtonElement).style.transform =
            'translateY(1px)'
        onMouseDown?.(e)
      }}
      onMouseUp={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.transform = ''
        onMouseUp?.(e)
      }}
      {...rest}
    >
      {leading}
      {children}
      {trailing}
    </button>
  )
})
