import type { CSSProperties } from 'react'
import { AudioLines, CalendarDays, Mic } from 'lucide-react'

type Props = {
  icon: string | null | undefined
  /** Shown when icon is empty */
  fallbackEmoji?: string
  size?: number
  strokeWidth?: number
  style?: CSSProperties
}

/** List-row / picker glyph: maps persisted workspace emoji to Lucide for consistency with the tree. */
export function WorkspaceNodeListIcon({
  icon,
  fallbackEmoji = '📄',
  size = 14,
  strokeWidth = 1.5,
  style,
}: Props) {
  const t = (icon ?? '').trim()
  if (t === '📅') {
    return (
      <CalendarDays
        size={size}
        strokeWidth={strokeWidth}
        aria-hidden
        style={{ flexShrink: 0, ...style }}
      />
    )
  }
  if (t === '🎙️') {
    return (
      <Mic size={size} strokeWidth={strokeWidth} aria-hidden style={{ flexShrink: 0, ...style }} />
    )
  }
  if (t === '🎧') {
    return (
      <AudioLines
        size={size}
        strokeWidth={strokeWidth}
        aria-hidden
        style={{ flexShrink: 0, ...style }}
      />
    )
  }
  return (
    <span style={{ fontSize: size, flexShrink: 0, lineHeight: 1, ...style }}>
      {t || fallbackEmoji}
    </span>
  )
}
