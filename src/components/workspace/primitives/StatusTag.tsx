/**
 * StatusTag — color-coded pill used in table rows, kanban cards, and calendar
 * events. Five variants from the HerOS mockup:
 *
 *   active  — green (in progress, live)
 *   review  — pink  (awaiting review)
 *   draft   — gray  (early, not yet committed)
 *   blocked — red   (cannot progress; needs attention)
 *   done    — blue  (completed)
 *
 * Colorblind safety: label text is ALWAYS rendered alongside the dot. Never
 * rely on color alone to communicate status.
 *
 * Tokens only (Rule 12). A single `variant` prop picks the three tokens
 * (bg, fg, dot) from `--status-*` in semantic.css.
 */

import type { CSSProperties } from 'react'

export type StatusVariant = 'active' | 'review' | 'draft' | 'blocked' | 'done'

export interface StatusTagProps {
  variant: StatusVariant
  children: React.ReactNode
  /** Add a box-shadow glow on the dot (e.g. live/active feel). */
  glow?: boolean
  /** Compact — 2px padding instead of full. Used in dense tables. */
  compact?: boolean
  className?: string
}

export function StatusTag({
  variant,
  children,
  glow = false,
  compact = false,
  className,
}: StatusTagProps) {
  const padY = compact ? 1 : 2
  const padX = compact ? 7 : 9
  const dotGlow =
    glow && variant === 'active' ? 'var(--status-active-glow)' : undefined

  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: `${padY}px ${padX}px`,
    borderRadius: 10,
    fontSize: 'calc(10.5px * var(--ui-scale, 1))',
    fontWeight: 500,
    background: `var(--status-${variant}-bg)`,
    color: `var(--status-${variant}-fg)`,
    whiteSpace: 'nowrap',
  }

  const dotStyle: CSSProperties = {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: `var(--status-${variant}-dot)`,
    boxShadow: dotGlow,
    flexShrink: 0,
  }

  return (
    <span
      className={className}
      style={style}
      role="status"
      aria-label={`Status: ${variant}`}
    >
      <span style={dotStyle} aria-hidden="true" />
      {children}
    </span>
  )
}

/**
 * Heuristic: infer variant from a free-text status string.
 * Case-insensitive. Falls back to 'draft' on unknown values.
 * Used when a database has a free-form status column without a typed enum.
 *
 * Invariants:
 *   - Word-boundary anchored (`\b`) so substring matches don't fire:
 *     "relationship" no longer hits "ship", "Placeholder" no longer hits
 *     "hold", "undone" no longer hits "done".
 *   - Review and blocked checks run BEFORE done/active, so "waiting for
 *     review" lands on review (not blocked via "wait"), and "done for a
 *     review" lands on review (not done via "done"). Bias: when in doubt,
 *     something still has work left.
 *   - Negations ("not done", "not complete") land on active, because a
 *     non-done status is still in progress.
 */
export function inferStatusVariant(
  text: string | null | undefined,
): StatusVariant {
  if (!text) return 'draft'
  const t = text.toLowerCase().trim()
  if (!t) return 'draft'

  // Negation guard — "not done" / "not complete" shouldn't land on done.
  // Strip the negation token before matching so the downstream regexes see
  // the negated stem without the cue word and fall through to 'active'.
  if (/\bnot\s+(done|complete|completed|shipped|closed|resolved)\b/.test(t)) {
    return 'active'
  }

  // Review first — "waiting for review" / "done pending review" belong here.
  if (/\b(review|reviewing|reviewed|pending|proposed|proposal)\b/.test(t)) {
    return 'review'
  }

  // Blocked before done, so "blocked — needs done" lands on blocked.
  if (/\b(blocked|stuck|waiting|on[\s-]?hold|overdue|paused)\b/.test(t)) {
    return 'blocked'
  }

  if (/\b(done|complete|completed|shipped|closed|resolved|merged)\b/.test(t)) {
    return 'done'
  }

  if (/\b(active|in[\s-]?progress|live|wip|running|doing|ongoing)\b/.test(t)) {
    return 'active'
  }

  return 'draft'
}
