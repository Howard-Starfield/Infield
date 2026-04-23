import { useState, useEffect, useCallback, useRef } from 'react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import type { WorkspaceNode } from '../../types/workspace'
import { WorkspaceMenuSurface } from '@/components/workspace/chrome/workspaceMenuChrome'
import {
  WorkspaceFloatingPortal,
  placeBelowAnchor,
  workspaceFloatingBackdropZ,
  workspaceFloatingZ,
} from '@/lib/workspaceFloatingLayer'

interface Props {
  node: WorkspaceNode
}

const EMOJI_OPTIONS = [
  '🗂', '📄', '📝', '📋', '📊', '📈', '📉', '📌', '📎', '🔗',
  '💡', '🎯', '🚀', '⭐', '🌟', '✨', '🔥', '💎', '🎨', '🎭',
  '🏠', '🌍', '🌱', '🌿', '🍀', '🦋', '🐝', '🦄', '🐬', '🦉',
  '💼', '📚', '📖', '✏️', '🖊️', '🖍️', '📏', '🔍', '💻', '⚙️',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💕',
]

const EMOJI_MENU_W = 260
const EMOJI_MENU_H = 148

export function DatabaseHeader({ node }: Props) {
  const { updateNode } = useWorkspaceStore()
  const [title, setTitle] = useState(node.name || 'Untitled Database')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [emojiAnchor, setEmojiAnchor] = useState<DOMRect | null>(null)
  const emojiPanelRef = useRef<HTMLDivElement>(null)
  const iconBtnRef = useRef<HTMLButtonElement>(null)

  // Reset local title when navigating to a different database
  useEffect(() => {
    setTitle(node.name || 'Untitled Database')
    setIsEditingTitle(false)
    setShowEmojiPicker(false)
    setEmojiAnchor(null)
  }, [node.id])

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmojiPicker) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (iconBtnRef.current?.contains(t)) return
      if (emojiPanelRef.current && !emojiPanelRef.current.contains(t)) {
        setShowEmojiPicker(false)
        setEmojiAnchor(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showEmojiPicker])

  const commitTitle = useCallback(async () => {
    setIsEditingTitle(false)
    const trimmed = title.trim() || 'Untitled Database'
    setTitle(trimmed)
    if (trimmed !== node.name) {
      await updateNode(node.id, trimmed, node.icon, node.properties, node.body)
    }
  }, [title, node, updateNode])

  const handleEmojiSelect = async (emoji: string) => {
    setShowEmojiPicker(false)
    setEmojiAnchor(null)
    if (emoji !== node.icon) {
      await updateNode(node.id, node.name, emoji, node.properties, node.body)
    }
  }

  // Cover gradient from properties
  const coverGradient = (() => {
    try {
      const props = JSON.parse(node.properties)
      return props.cover as string | undefined
    } catch {
      return undefined
    }
  })()

  const emojiPos = emojiAnchor
    ? placeBelowAnchor(emojiAnchor, { gap: 4, menuWidth: EMOJI_MENU_W, menuHeight: EMOJI_MENU_H })
    : { top: 0, left: 0 }

  return (
    <div style={{ background: 'transparent' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, padding: coverGradient ? '4px 8px 0' : '4px 8px 2px' }}>
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: 14,
            background: coverGradient || 'linear-gradient(145deg, var(--surface-1), var(--surface-3))',
            border: '1px solid rgba(28,28,25,0.08)',
            boxShadow: 'var(--workspace-shadow-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            position: 'relative',
          }}
        >
          <button
            ref={iconBtnRef}
            type="button"
            onClick={() => {
              if (showEmojiPicker) {
                setShowEmojiPicker(false)
                setEmojiAnchor(null)
              } else {
                const r = iconBtnRef.current?.getBoundingClientRect()
                if (r) setEmojiAnchor(r)
                setShowEmojiPicker(true)
              }
            }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 28, lineHeight: 1, padding: 0,
            }}
            title="Change icon"
          >
            {node.icon || '🗂'}
          </button>

          {showEmojiPicker && emojiAnchor && (
            <WorkspaceFloatingPortal>
              <div
                role="presentation"
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: workspaceFloatingBackdropZ(),
                  background: 'transparent',
                }}
                onMouseDown={() => {
                  setShowEmojiPicker(false)
                  setEmojiAnchor(null)
                }}
              />
              <WorkspaceMenuSurface
                ref={emojiPanelRef}
                style={{
                  position: 'fixed',
                  top: emojiPos.top,
                  left: emojiPos.left,
                  zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
                  padding: 8,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(10, 1fr)',
                  gap: 2,
                  minWidth: EMOJI_MENU_W,
                  boxShadow: 'var(--workspace-shadow)',
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {EMOJI_OPTIONS.map(emoji => (
                  <button
                    key={emoji}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); void handleEmojiSelect(emoji) }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 16, lineHeight: 1, padding: '4px 2px',
                      borderRadius: 4,
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </WorkspaceMenuSurface>
            </WorkspaceFloatingPortal>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
          <div
            style={{
              fontSize: 11,
              fontFamily: 'Inter, sans-serif',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.14em',
              color: 'var(--workspace-text-soft)',
              marginBottom: 5,
            }}
          >
            Database
          </div>
          {isEditingTitle ? (
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => void commitTitle()}
              onKeyDown={e => {
                if (e.key === 'Enter') void commitTitle()
                if (e.key === 'Escape') {
                  setTitle(node.name || 'Untitled Database')
                  setIsEditingTitle(false)
                }
              }}
              style={{
                fontSize: 30, fontWeight: 500, fontFamily: 'Georgia, Iowan Old Style, Times New Roman, serif',
                letterSpacing: '-0.03em', lineHeight: 1.08,
                border: 'none', outline: 'none', background: 'transparent',
                color: 'var(--workspace-text)', padding: 0, margin: 0,
                width: '100%', display: 'block',
              }}
            />
          ) : (
            <h1
              onClick={() => setIsEditingTitle(true)}
              style={{
                fontSize: 34, fontWeight: 500, fontFamily: 'Georgia, Iowan Old Style, Times New Roman, serif',
                letterSpacing: '-0.03em', lineHeight: 1.08,
                color: 'var(--workspace-text)', margin: 0, padding: 0,
                cursor: 'text', userSelect: 'none',
              }}
              title="Click to rename"
            >
              {title || 'Untitled Database'}
            </h1>
          )}
          <div
            style={{
              marginTop: 8,
              fontSize: 13,
              color: 'var(--workspace-text-soft)',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            {node.node_type === 'database' ? 'Everything in flight, from draft to publication.' : ''}
          </div>
        </div>
      </div>
    </div>
  )
}
