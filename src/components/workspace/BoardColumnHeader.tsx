import { useState, useRef } from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SelectColor } from '@/stores/workspaceStore'
import { ColorPickerPopover } from './ColorPickerPopover'
import { ColumnContextMenu } from './ColumnContextMenu'

interface Props {
  columnId: string
  name: string
  color: SelectColor
  cardCount: number
  dragHandleProps: Record<string, unknown>
  onRename: (name: string) => void
  onColorChange: (color: SelectColor) => void
  onDelete: () => void
  onAddCardTop: () => void
}

/**
 * Per-color dot + background tint — tokens would be ideal, but SelectColor is
 * an enum set by the user per-column and not part of the theme primitives.
 * Each entry: dot color for the column indicator, label color inherited from
 * --workspace-text. Tints are transparent so they work on any theme mode.
 */
const COLOR_STYLE: Record<SelectColor, { dot: string; tint: string }> = {
  purple:     { dot: '#c8a8f0', tint: 'color-mix(in srgb, #c8a8f0 22%, transparent)' },
  pink:       { dot: '#f0a8c8', tint: 'color-mix(in srgb, #f0a8c8 22%, transparent)' },
  light_pink: { dot: '#f0d8d0', tint: 'color-mix(in srgb, #f0d8d0 22%, transparent)' },
  orange:     { dot: '#e8a24a', tint: 'color-mix(in srgb, #e8a24a 22%, transparent)' },
  yellow:     { dot: '#ffd089', tint: 'color-mix(in srgb, #ffd089 22%, transparent)' },
  lime:       { dot: '#c8e896', tint: 'color-mix(in srgb, #c8e896 22%, transparent)' },
  green:      { dot: '#9cf0c9', tint: 'color-mix(in srgb, #9cf0c9 22%, transparent)' },
  aqua:       { dot: '#8adfd8', tint: 'color-mix(in srgb, #8adfd8 22%, transparent)' },
  blue:       { dot: '#bfd4ff', tint: 'color-mix(in srgb, #bfd4ff 22%, transparent)' },
}

export function BoardColumnHeader({
  columnId: _columnId,
  name,
  color,
  cardCount,
  dragHandleProps,
  onRename,
  onColorChange,
  onDelete,
  onAddCardTop,
}: Props) {
  const { t } = useTranslation()
  const [showColor, setShowColor] = useState(false)
  const [colorAnchor, setColorAnchor] = useState<DOMRect | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleStartRename = () => {
    setShowMenu(false)
    setDraft(name)
    setIsRenaming(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const handleRenameSubmit = () => {
    if (draft.trim()) onRename(draft.trim())
    setIsRenaming(false)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleRenameSubmit()
    else if (e.key === 'Escape') setIsRenaming(false)
  }

  return (
    <div
      {...dragHandleProps}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 'calc(8px * var(--density-scale, 1) * var(--ui-scale, 1))',
        padding: '0 4px calc(8px * var(--density-scale, 1) * var(--ui-scale, 1))',
        userSelect: 'none',
      }}
    >
      {/* Left: colored badge / rename input */}
      <div style={{ position: 'relative' }}>
        {isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleRenameKeyDown}
            className="workspace-board-rename-input"
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              if (showColor) {
                setColorAnchor(null)
                setShowColor(false)
              } else {
                setColorAnchor(r)
                setShowColor(true)
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '3px 10px',
              borderRadius: 999,
              border: 'none',
              fontSize: 'calc(11.5px * var(--ui-scale, 1))',
              fontWeight: 600,
              letterSpacing: '-0.005em',
              color: 'var(--workspace-text)',
              background: COLOR_STYLE[color].tint,
              cursor: 'pointer',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: COLOR_STYLE[color].dot,
                flexShrink: 0,
              }}
            />
            {name}
          </button>
        )}
        {showColor && colorAnchor && (
          <ColorPickerPopover
            anchorRect={colorAnchor}
            current={color}
            onSelect={c => {
              onColorChange(c)
              setShowColor(false)
              setColorAnchor(null)
            }}
            onClose={() => {
              setShowColor(false)
              setColorAnchor(null)
            }}
          />
        )}
      </div>

      {/* Middle: card count */}
      <span
        style={{
          fontSize: 'calc(11px * var(--ui-scale, 1))',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--workspace-text-soft)',
        }}
      >
        {cardCount}
      </span>

      {/* Right: context menu button */}
      <div style={{ position: 'relative', marginLeft: 'auto' }}>
        <button
          type="button"
          className="workspace-board-icon-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            if (showMenu) {
              setMenuAnchor(null)
              setShowMenu(false)
            } else {
              setMenuAnchor(r)
              setShowMenu(true)
            }
          }}
        >
          <MoreHorizontal size={14} />
        </button>
        {showMenu && menuAnchor && (
          <ColumnContextMenu
            anchorRect={menuAnchor}
            onRename={handleStartRename}
            onDelete={() => {
              setShowMenu(false)
              setMenuAnchor(null)
              onDelete()
            }}
            onClose={() => {
              setShowMenu(false)
              setMenuAnchor(null)
            }}
          />
        )}
      </div>

      {/* Far right: add card button */}
      <button
        type="button"
        className="workspace-board-icon-btn"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onAddCardTop}
      >
        <Plus size={14} />
      </button>
    </div>
  )
}