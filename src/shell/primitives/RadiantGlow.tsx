import type { CSSProperties } from 'react'

/**
 * Radiant backdrop bloom — the third layer of the HerOS atmospheric
 * recipe (mesh → grain → **bloom**). A soft-blurred light source placed
 * behind elevated panels so the glass above it reads as lit from
 * within rather than floating on a flat wash.
 *
 * Visual stack (from back to front):
 *
 *   AtmosphericBackground  — terracotta mesh gradient (drifts 20s)
 *   GrainOverlay           — SVG feTurbulence noise, blend-overlay
 *   RadiantGlow            ← THIS — radial bloom behind the hero panel
 *   GlassPanel / content   — the actual UI
 *
 * Colour / softness / spread are all driven by semantic tokens, so a
 * new theme preset retints the bloom by overriding one variable
 * (`--heros-bloom-color`). Disable by setting it to `transparent`.
 * See semantic.css "Radiant bloom backdrop" section for recipes.
 *
 * The primitive is positionless by default — the consumer chooses where
 * to centre the bloom by setting `top` / `left` / `width` / `height`
 * (or the convenient `centered` prop for "behind me, 80% of my box").
 */
export interface RadiantGlowProps {
  /**
   * When true (default), the glow positions itself `absolute; inset: 10%`
   * inside its parent — i.e. 80% of the parent's width & height,
   * centred. The parent must have `position: relative | absolute | fixed`
   * or the glow escapes to the nearest positioned ancestor.
   *
   * When false, the consumer provides positioning via `style`.
   */
  centered?: boolean
  /** Optional custom color. Defaults to `--heros-bloom-color` token. */
  color?: string
  /** Optional custom blur. Defaults to `--heros-bloom-blur` token. */
  blur?: string
  /**
   * Stacking index. Default 1 — sits above mesh/grain (z:0–1) and
   * below any glass content rendered on top.
   */
  zIndex?: number
  className?: string
  style?: CSSProperties
}

export function RadiantGlow({
  centered = true,
  color,
  blur,
  zIndex = 1,
  className,
  style,
}: RadiantGlowProps) {
  const composed: CSSProperties = {
    position: 'absolute',
    ...(centered ? { inset: '10%' } : {}),
    background: `radial-gradient(circle, ${
      color ?? 'var(--heros-bloom-color)'
    } 0%, transparent var(--heros-bloom-spread, 70%))`,
    filter: `blur(${blur ?? 'var(--heros-bloom-blur)'})`,
    pointerEvents: 'none',
    zIndex,
    ...style,
  }
  return <div aria-hidden className={className} style={composed} />
}
