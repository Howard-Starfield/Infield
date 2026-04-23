import type { ReactNode } from 'react'

/**
 * HerOSViewport — page-level viewport wrapper. Verbatim port from
 * `copy/src/components/HerOS.tsx`.
 *
 * Provides the dark charcoal foundation (`--heros-bg-foundation`)
 * and the 100vh / 100vw host for all pages. Host every top-level
 * surface inside this wrapper so the atmospheric background can
 * sit underneath consistently.
 */
export interface HerOSViewportProps {
  children: ReactNode
}

export function HerOSViewport({ children }: HerOSViewportProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--heros-bg-foundation)',
      }}
    >
      {children}
    </div>
  )
}
