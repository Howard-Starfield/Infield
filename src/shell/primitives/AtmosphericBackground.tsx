import type { CSSProperties, ReactNode } from 'react'

/**
 * Kinetic blob atmosphere — three drifting radial-gradient clusters
 * over the deep charcoal foundation. The "living amber light" backdrop
 * that defines the HerOS aesthetic.
 *
 * Rewritten in H2.2 to use copy/'s class-driven structure
 * (`.blob-container` + `.blob-cluster-{a,b,c}`) declared verbatim in
 * `src/styles/blobs.css`. Earlier inline-style version referenced
 * the now-deleted `infield-blob-cl-*` keyframes; this restores live
 * animation.
 *
 * Layers (defined in blobs.css; bottom → top):
 *   0. charcoal foundation (`--heros-bg-foundation`)
 *   1. Blob A — primary warm glow, 11s drift
 *   2. Blob B — deep red/terracotta accent, 14s drift
 *   3. Blob C — bright orange highlight, 9s drift
 *
 * Reduced-motion: animations are gated globally via `@media
 * (prefers-reduced-motion)` in `src/App.css`.
 *
 * **Bloom + grain are intentionally NOT included here.** copy/'s
 * `HerOSBackground` bundles them; Handy keeps them as separate
 * primitives (`RadiantGlow`, `GrainOverlay`) so callers can compose
 * what they need. See `src/entry/LoginPage.tsx` for the full
 * three-layer composition.
 */
export interface AtmosphericBackgroundProps {
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

export function AtmosphericBackground({
  children,
  className,
  style,
}: AtmosphericBackgroundProps) {
  const composed = className ? `blob-container ${className}` : 'blob-container'

  return (
    <div
      className={composed}
      style={style}
      aria-hidden={children ? undefined : true}
    >
      <div className="blob-bg blob-cluster-a" />
      <div className="blob-bg blob-cluster-b" />
      <div className="blob-bg blob-cluster-c" />
      {children}
    </div>
  )
}
