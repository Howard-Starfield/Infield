/**
 * OwnerAvatar — initials bubble with a deterministic gradient.
 *
 * Key guarantee: `hashNameToGradient('Priya')` returns the same gradient id
 * every time, so Priya is the same color across every database she appears in.
 * Makes at-a-glance scanning work: your eye learns "terra-gold = Priya, mint =
 * Maya" within minutes.
 *
 * Six gradients defined as `--owner-grad-{a..f}` in semantic.css. Hash uses
 * FNV-1a (fast, low collision for short names) and mods to 6.
 */

import type { CSSProperties } from 'react'

const GRADIENT_COUNT = 6
const GRADIENT_IDS = ['a', 'b', 'c', 'd', 'e', 'f'] as const
type GradientId = (typeof GRADIENT_IDS)[number]

/**
 * FNV-1a 32-bit hash of a string. Stable, deterministic, doesn't require
 * crypto. Same input → same output across sessions and platforms.
 */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    // 32-bit FNV prime 16777619
    hash = (hash * 0x01000193) >>> 0
  }
  return hash
}

export function hashNameToGradient(name: string): GradientId {
  const cleaned = name.trim().toLowerCase()
  if (!cleaned) return 'a'
  return GRADIENT_IDS[fnv1a(cleaned) % GRADIENT_COUNT]!
}

/**
 * First 1–2 initials from a name. "Priya" → "P". "Mei Lin" → "ML".
 * "Dr. Sam O'Brien" → "SO" (ignores titles with `.`).
 */
export function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    // Drop empties (from `''.split(/\s+/)`) and titles with a dot (Dr., Mr., …)
    .filter((p) => p.length > 0 && !/\./.test(p))
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase()
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase()
}

export interface OwnerAvatarProps {
  name: string
  /** Pixel diameter. Default 20 matches the mockup's table cell size. */
  size?: number
  /** Show name label next to the avatar. */
  showLabel?: boolean
  /** Override background (for special non-person owners like "Unassigned"). */
  overrideBackground?: string
  className?: string
}

export function OwnerAvatar({
  name,
  size = 20,
  showLabel = false,
  overrideBackground,
  className,
}: OwnerAvatarProps) {
  const gradientId = hashNameToGradient(name)
  const label = initialsOf(name)

  const avStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: `${Math.max(9, Math.round(size * 0.48))}px`,
    fontWeight: 700,
    // Dark ink on pale gradients — centralized as --owner-avatar-ink in
    // semantic.css. Deliberately not --on-surface (which flips per theme).
    color: 'var(--owner-avatar-ink)',
    background: overrideBackground ?? `var(--owner-grad-${gradientId})`,
    boxShadow: 'inset 0 1px 0 color-mix(in srgb, white 50%, transparent)',
    flexShrink: 0,
    userSelect: 'none',
  }

  if (showLabel) {
    return (
      <span
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 'calc(11.5px * var(--ui-scale, 1))',
          color: 'var(--workspace-text)',
        }}
        title={name}
      >
        <span style={avStyle} aria-hidden="true">
          {label}
        </span>
        <span>{name}</span>
      </span>
    )
  }

  return (
    <span className={className} style={avStyle} title={name} aria-label={`Owner: ${name}`}>
      {label}
    </span>
  )
}
