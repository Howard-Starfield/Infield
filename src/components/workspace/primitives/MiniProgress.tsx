/**
 * MiniProgress — 60×4px horizontal progress bar + numeric label.
 *
 * Mirrors the HerOS mockup's `.prog-bar` component. Fill uses a gradient from
 * brand → on-surface for tactile depth. Fully accessible via ARIA.
 *
 * Values outside `[0, 100]` are clamped. Non-finite values render as 0%.
 */

import type { CSSProperties } from 'react'

export interface MiniProgressProps {
  /** Percentage 0–100. Clamped. */
  value: number
  /** Track width in px. Default 60. */
  width?: number
  /** Hide the trailing numeric label. */
  hideLabel?: boolean
  /** Use a single-tone fill (brand only) instead of the gradient. */
  solid?: boolean
  className?: string
  'aria-label'?: string
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0
  if (v < 0) return 0
  if (v > 100) return 100
  return v
}

export function MiniProgress({
  value,
  width = 60,
  hideLabel = false,
  solid = false,
  className,
  'aria-label': ariaLabel,
}: MiniProgressProps) {
  const pct = clampPct(value)

  const wrapStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 'calc(11px * var(--ui-scale, 1))',
    color: 'var(--workspace-text-muted)',
    fontVariantNumeric: 'tabular-nums',
  }

  const trackStyle: CSSProperties = {
    width,
    height: 4,
    borderRadius: 2,
    background: 'color-mix(in srgb, var(--on-surface) 10%, transparent)',
    overflow: 'hidden',
    flexShrink: 0,
  }

  const fillStyle: CSSProperties = {
    height: '100%',
    width: `${pct}%`,
    borderRadius: 2,
    background: solid
      ? 'var(--heros-brand)'
      : 'linear-gradient(90deg, var(--heros-brand), color-mix(in srgb, var(--heros-brand) 40%, var(--on-surface) 60%))',
    transition: 'width calc(250ms * var(--duration-scale, 1)) cubic-bezier(0.4, 0, 0.2, 1)',
  }

  return (
    <span
      className={className}
      style={wrapStyle}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel ?? `${Math.round(pct)}% complete`}
    >
      <span style={trackStyle}>
        <span style={fillStyle} />
      </span>
      {hideLabel ? null : <span>{Math.round(pct)}%</span>}
    </span>
  )
}
