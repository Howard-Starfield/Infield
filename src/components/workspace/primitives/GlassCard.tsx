/**
 * GlassCard — liquid-glass surface wrapper (the HerOS mockup's base container).
 *
 * Composes four layers:
 *   1. Semi-transparent fill (`--workspace-panel`) that reveals the backdrop.
 *   2. `backdrop-filter: blur()` for the frosted look.
 *   3. Hairline border (`--workspace-hairline`) for edge definition.
 *   4. Inner rim-light highlight (`--workspace-rim-light`) — the 1px catch
 *      along the top edge that HerOS uses to imply glass thickness.
 *
 * All four are controlled by theme tokens. Switching theme preset automatically
 * changes hue, blur strength, and rim brightness. Changing density / ui-scale
 * composes into the outer padding if `pad` is provided.
 *
 * Rule 3: no Tailwind, inline styles + tokens only.
 * Rule 12: zero hardcoded literals.
 */

import { forwardRef, type CSSProperties, type ReactNode } from 'react'

export interface GlassCardProps {
  children?: ReactNode
  className?: string
  style?: CSSProperties
  /** Padding inside the card, in `--space-N` units (1–12). Defaults to none. */
  pad?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12
  /** Render as a thicker card — deeper shadow + stronger rim. For modals and primary surfaces. */
  elevated?: boolean
  /** Render as a recessed card — inner shadow instead of drop. For input wells and pressed states. */
  recessed?: boolean
  /** Omit backdrop-filter (cheaper on Linux / older WebView2). Surface still uses token fill. */
  noBlur?: boolean
  /** Role override for a11y. Defaults to 'region' when `aria-label` is present, else undefined. */
  role?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
}

const PAD_MAP: Record<NonNullable<GlassCardProps['pad']>, string> = {
  0: '0',
  1: 'calc(4px * var(--density-scale, 1) * var(--ui-scale, 1))',
  2: 'calc(8px * var(--density-scale, 1) * var(--ui-scale, 1))',
  3: 'calc(12px * var(--density-scale, 1) * var(--ui-scale, 1))',
  4: 'calc(16px * var(--density-scale, 1) * var(--ui-scale, 1))',
  5: 'calc(20px * var(--density-scale, 1) * var(--ui-scale, 1))',
  6: 'calc(24px * var(--density-scale, 1) * var(--ui-scale, 1))',
  8: 'calc(32px * var(--density-scale, 1) * var(--ui-scale, 1))',
  10: 'calc(40px * var(--density-scale, 1) * var(--ui-scale, 1))',
  12: 'calc(48px * var(--density-scale, 1) * var(--ui-scale, 1))',
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  function GlassCard(
    {
      children,
      className,
      style,
      pad = 0,
      elevated = false,
      recessed = false,
      noBlur = false,
      role,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      onClick,
    },
    ref,
  ) {
    const base: CSSProperties = {
      background: recessed
        ? 'color-mix(in srgb, var(--on-surface) 3%, transparent)'
        : 'var(--workspace-panel)',
      border: 'var(--workspace-hairline)',
      borderRadius: 'var(--workspace-panel-radius)',
      backdropFilter: noBlur
        ? undefined
        : `blur(var(--workspace-panel-blur)) saturate(calc(var(--heros-glass-saturate, 120%)))`,
      WebkitBackdropFilter: noBlur
        ? undefined
        : `blur(var(--workspace-panel-blur)) saturate(calc(var(--heros-glass-saturate, 120%)))`,
      boxShadow: recessed
        ? `inset 0 4px 12px color-mix(in srgb, black 18%, transparent), inset 0 1px 2px color-mix(in srgb, black 22%, transparent)`
        : elevated
          ? `var(--workspace-shadow), var(--workspace-rim-light)`
          : `var(--workspace-shadow-soft), var(--workspace-rim-light)`,
      padding: PAD_MAP[pad],
      color: 'var(--workspace-text)',
      // willChange hint when elevated (likely in a modal / animating context)
      willChange: elevated ? 'transform, opacity' : undefined,
    }

    return (
      <div
        ref={ref}
        role={role ?? (ariaLabel ? 'region' : undefined)}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={className}
        style={{ ...base, ...style }}
        onClick={onClick}
      >
        {children}
      </div>
    )
  },
)
