import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { workspaceFloatingZ } from '@/lib/workspaceFloatingLayer'

export type ContextMenuItem = {
  label: string
  onSelect: () => void
  danger?: boolean
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function WorkspaceCalendarContextMenu({ x, y, items, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x + 2, top: y + 2 })

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pad = 8
    let left = x + 2
    let top = y + 2
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad)
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad)
    }
    setPos({ left, top })
  }, [x, y, items])

  const handleDocPointerDown = useCallback(
    (e: PointerEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      onClose()
    },
    [onClose],
  )

  useEffect(() => {
    document.addEventListener('pointerdown', handleDocPointerDown, true)
    return () => document.removeEventListener('pointerdown', handleDocPointerDown, true)
  }, [handleDocPointerDown])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const menuZ = Number.parseInt(workspaceFloatingZ(), 10) || 12001

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        zIndex: menuZ,
        minWidth: 160,
        borderRadius: 10,
        border: '1px solid var(--workspace-border)',
        background: 'var(--workspace-bg)',
        boxShadow: 'var(--workspace-shadow)',
        padding: 4,
        fontFamily: 'Space Grotesk, sans-serif',
      }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          onClick={() => {
            item.onSelect()
            onClose()
          }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '8px 10px',
            border: 'none',
            borderRadius: 6,
            background: 'transparent',
            color: item.danger ? '#c62828' : 'var(--workspace-text)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
