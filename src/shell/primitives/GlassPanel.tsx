import {
  forwardRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react'

/**
 * Liquid-glass panel. Fill + blur + saturation + rim light + floating shadow,
 * all from theme tokens (Rule 12). Consumes `--workspace-panel*`,
 * `--workspace-panel-blur`, `--workspace-rim-light`, `--workspace-hairline`,
 * `--workspace-shadow*`. Zero hardcoded literals.
 *
 * Variants:
 *   default  — standard panel fill, floating shadow
 *   muted    — lower fill, used for secondary surfaces inside another panel
 *   strong   — higher fill, used for the most prominent elevation
 *
 * The rim-light + hairline border + backdrop-filter together produce the
 * Liquid Glass effect. Works over any backdrop — best over the atmospheric
 * mesh.
 */
export type GlassPanelVariant = 'default' | 'muted' | 'strong'
export type GlassPanelElevation = 'flat' | 'floating' | 'lifted'

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: GlassPanelVariant
  elevation?: GlassPanelElevation
  /** Disable backdrop-filter. Use when the parent already blurs, for perf. */
  noBlur?: boolean
  children?: ReactNode
}

const VARIANT_BG: Record<GlassPanelVariant, string> = {
  default: 'var(--workspace-panel)',
  muted: 'var(--workspace-panel-muted)',
  strong: 'var(--workspace-pane-strong)',
}

const ELEVATION_SHADOW: Record<GlassPanelElevation, string> = {
  flat: 'none',
  floating: 'var(--workspace-shadow-soft), var(--workspace-rim-light)',
  lifted: 'var(--workspace-shadow), var(--workspace-rim-light)',
}

export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  function GlassPanel(
    {
      variant = 'default',
      elevation = 'floating',
      noBlur = false,
      style,
      children,
      ...rest
    },
    ref,
  ) {
    const composed: CSSProperties = {
      background: VARIANT_BG[variant],
      border: 'var(--workspace-hairline)',
      borderRadius: 'var(--workspace-panel-radius)',
      boxShadow: ELEVATION_SHADOW[elevation],
      backdropFilter: noBlur
        ? undefined
        : 'blur(var(--workspace-panel-blur)) saturate(var(--heros-glass-saturate))',
      WebkitBackdropFilter: noBlur
        ? undefined
        : 'blur(var(--workspace-panel-blur)) saturate(var(--heros-glass-saturate))',
      ...style,
    }
    return (
      <div ref={ref} style={composed} {...rest}>
        {children}
      </div>
    )
  },
)
