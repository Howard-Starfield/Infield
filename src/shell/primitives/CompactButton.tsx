import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react'

/**
 * Icon-first compact button — rail entries, utility chrome icons,
 * inline card actions. Fixed square footprint (`--compact-button-size`)
 * with a centered icon slot. Consumes `--compact-button-*` tokens.
 *
 * Use `active` for the currently selected item (rail home tab, etc.).
 */
export interface CompactButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  /** Highlight as the current selection. */
  active?: boolean
  /** Optional label for accessibility when the icon alone isn't enough. */
  'aria-label'?: string
}

export const CompactButton = forwardRef<HTMLButtonElement, CompactButtonProps>(
  function CompactButton(
    { active = false, style, children, onMouseEnter, onMouseLeave, ...rest },
    ref,
  ) {
    const composed: CSSProperties = {
      width: 'var(--compact-button-size)',
      height: 'var(--compact-button-size)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      background: active
        ? 'var(--compact-button-bg-active)'
        : 'var(--compact-button-bg)',
      border: 'none',
      borderRadius: 'var(--compact-button-radius)',
      color: active ? 'var(--compact-button-fg-active)' : 'var(--compact-button-fg)',
      cursor: 'pointer',
      transitionProperty: 'background, color, transform',
      transitionDuration: 'calc(140ms * var(--duration-scale, 1))',
      transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
      ...style,
    }
    return (
      <button
        ref={ref}
        type="button"
        style={composed}
        onMouseEnter={(e) => {
          if (!active)
            (e.currentTarget as HTMLButtonElement).style.background =
              'var(--compact-button-bg-hover)'
          onMouseEnter?.(e)
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.background = active
            ? 'var(--compact-button-bg-active)'
            : 'var(--compact-button-bg)'
          onMouseLeave?.(e)
        }}
        {...rest}
      >
        {children}
      </button>
    )
  },
)
