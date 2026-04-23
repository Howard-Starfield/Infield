import {
  forwardRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react'

/**
 * Pressed / carved surface — the inverse of a GlassPanel. Recessed fill +
 * inner shadow + faint bottom-lip highlight. Used for inputs, search wells,
 * recessed slots.
 *
 * Consumes `--glass-well-*` tokens from `semantic.css`.
 *
 * The focus-within state uses a deeper inner shadow instead of a bright
 * glow — matches the HerOS pressed-input language (no bright outlines inside
 * the well).
 */
export interface GlassWellProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
  /**
   * When true, well tracks any descendant's focus state — used for
   * search inputs with a slot icon that visually belongs to the well.
   * Default: true.
   */
  focusTrack?: boolean
}

export const GlassWell = forwardRef<HTMLDivElement, GlassWellProps>(
  function GlassWell(
    { focusTrack = true, style, children, onFocus, onBlur, ...rest },
    ref,
  ) {
    const [focused, setFocused] = useState(false)

    const composed: CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      background:
        focusTrack && focused
          ? 'var(--glass-well-bg-focus)'
          : 'var(--glass-well-bg)',
      border: 'var(--glass-well-border)',
      borderRadius: 'var(--glass-well-radius)',
      boxShadow:
        focusTrack && focused
          ? 'var(--glass-well-shadow-focus)'
          : 'var(--glass-well-shadow)',
      // 300ms matches HerOS kit `.heros-input-wrapper` transition exactly.
      // Scaled by `--duration-scale` so reduced-motion presets shorten.
      transitionProperty: 'background, box-shadow',
      transitionDuration: 'calc(300ms * var(--duration-scale, 1))',
      transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
      ...style,
    }

    // `data-infield-well` attribute unlocks the CSS rules in semantic.css
    // that drive `.infield-input-icon` rotation and branded ::selection
    // inside the well — keeps the JSX clean while matching kit fidelity.
    return (
      <div
        ref={ref}
        data-infield-well
        style={composed}
        onFocus={(e) => {
          if (focusTrack) setFocused(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          if (focusTrack) setFocused(false)
          onBlur?.(e)
        }}
        {...rest}
      >
        {children}
      </div>
    )
  },
)
