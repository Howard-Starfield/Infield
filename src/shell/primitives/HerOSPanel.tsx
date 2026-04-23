import type { ReactNode } from 'react'

/**
 * HerOSPanel — main glass content card. Verbatim port from
 * `copy/src/components/HerOS.tsx`. Composes `.heros-shell` (centring
 * frame) around `.heros-glass-panel` (carved glass card with rim light
 * + atmospheric padding). Both classes live in `src/styles/heros.css`.
 *
 * Use this for **every primary content card across every page** —
 * see CLAUDE.md → HerOS Design System → "unified content cards".
 */
export interface HerOSPanelProps {
  children: ReactNode
}

export function HerOSPanel({ children }: HerOSPanelProps) {
  return (
    <div className="heros-shell">
      <div className="heros-glass-panel">{children}</div>
    </div>
  )
}
