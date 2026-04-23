import type { CSSProperties, ReactNode } from 'react'

/**
 * Stage container — a light framing wrapper for page content. The
 * atmospheric mesh + grain are painted at the AppShell root (matching
 * the LoadingScreen / LoginPage recipe), so the stage itself is just a
 * clipped, rounded scroll container that sits on top of the atmosphere.
 *
 * A subtle inner-surface tint separates the stage from the surrounding
 * titlebar / rail region without blocking the terracotta atmosphere
 * behind it. Tokens only; Rule 12.
 */
export interface AtmosphericStageProps {
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

export function AtmosphericStage({
  children,
  className,
  style,
}: AtmosphericStageProps) {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        isolation: 'isolate',
        // Translucent inner tint — lets the window-level atmospheric
        // mesh show through while giving the stage a subtle "lifted"
        // read against the surrounding chrome.
        background: 'color-mix(in srgb, var(--on-surface) 3%, transparent)',
        border: '1px solid color-mix(in srgb, var(--on-surface) 8%, transparent)',
        boxShadow:
          'inset 0 1px 0 color-mix(in srgb, var(--on-surface) 10%, transparent), var(--workspace-shadow-soft)',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
