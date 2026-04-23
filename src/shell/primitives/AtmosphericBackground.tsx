import type { CSSProperties, ReactNode } from 'react'

/**
 * Kinetic blob atmosphere — the "living amber light clusters" that define
 * the Sovereign Glass DNA. Three animated radial-gradient clusters drift
 * across a deep charcoal foundation, creating the sense of warm light
 * moving behind frosted glass panels.
 *
 * Ported from HerOS_UI_Kit (see `copy/src/app.css` `.blob-container` +
 * `.blob-cluster-*`). Rewritten to consume theme tokens so preset switches
 * retint the clusters — the underlying `rgb()` stops stay warm by default
 * (they're the kit's exact values) but `--heros-brand` drives the overall
 * warmth when users shift accent hue via the theme editor.
 *
 * Layers (bottom → top):
 *   0. charcoal foundation (`--heros-bg-foundation`)
 *   1. Blob A — main warm glow, 11s drift, 80px blur, opacity 0.55
 *   2. Blob B — deep red/terracotta accent, 14s drift, 75px blur, opacity 0.45
 *   3. Blob C — bright orange highlight, 9s drift, 70px blur, opacity 0.50
 *
 * Reduced-motion: animations are gated via `@media (prefers-reduced-motion)`
 * in `src/App.css` so this component stays state-free.
 */
export interface AtmosphericBackgroundProps {
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

const CONTAINER_STYLE: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  background: 'var(--heros-bg-foundation)',
}

const BLOB_BASE: CSSProperties = {
  position: 'absolute',
  pointerEvents: 'none',
  willChange: 'transform',
}

// Blob A — primary warm glow (kit: `blob-cluster-a`).
// Oversized + off-screen so the blur/drift animation never reveals edges.
const BLOB_A_STYLE: CSSProperties = {
  ...BLOB_BASE,
  left: '-16%',
  top: '-20%',
  width: '160%',
  height: '160%',
  background:
    'radial-gradient(ellipse at 38% 35%, rgb(180, 80, 20) 0%, rgb(120, 40, 10) 50%, transparent 80%)',
  filter: 'blur(80px)',
  opacity: 0.55,
  animation: 'infield-blob-cl-1 calc(11s / max(var(--duration-scale, 1), 0.001)) ease-in-out infinite',
}

// Blob B — deep red/terracotta accent (kit: `blob-cluster-b`).
const BLOB_B_STYLE: CSSProperties = {
  ...BLOB_BASE,
  left: '48%',
  top: '40%',
  width: '140%',
  height: '140%',
  background:
    'radial-gradient(ellipse at 24% 67%, rgb(140, 20, 10) 0%, rgb(80, 5, 5) 50%, transparent 78%)',
  filter: 'blur(75px)',
  opacity: 0.45,
  animation: 'infield-blob-cl-2 calc(14s / max(var(--duration-scale, 1), 0.001)) ease-in-out infinite',
}

// Blob C — bright orange highlight (kit: `blob-cluster-c`).
const BLOB_C_STYLE: CSSProperties = {
  ...BLOB_BASE,
  left: '20%',
  top: '5%',
  width: '140%',
  height: '140%',
  background:
    'radial-gradient(ellipse at 70% 40%, rgb(200, 100, 40) 0%, rgb(160, 60, 20) 45%, transparent 76%)',
  filter: 'blur(70px)',
  opacity: 0.5,
  animation: 'infield-blob-cl-3 calc(9s / max(var(--duration-scale, 1), 0.001)) ease-in-out infinite',
}

export function AtmosphericBackground({
  children,
  className,
  style,
}: AtmosphericBackgroundProps) {
  return (
    <div
      className={className}
      style={{ ...CONTAINER_STYLE, ...style }}
      aria-hidden={children ? undefined : true}
    >
      <div style={BLOB_A_STYLE} />
      <div style={BLOB_B_STYLE} />
      <div style={BLOB_C_STYLE} />
      {children}
    </div>
  )
}
