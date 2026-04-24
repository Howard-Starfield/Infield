import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface HerOSMenuItem {
  id: string
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  danger?: boolean
  onSelect: () => void
}

export interface HerOSMenuProps {
  anchor: { x: number; y: number }
  items: HerOSMenuItem[]
  onDismiss: () => void
}

export function HerOSMenu({ anchor, items, onDismiss }: HerOSMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Clamp to viewport after first render measures our size.
  useEffect(() => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.min(anchor.x, vw - r.width - 8)
    const top = Math.min(anchor.y, vh - r.height - 8)
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [anchor.x, anchor.y, items.length])

  // Stash latest props in refs so the listener effect can bind once on mount
  // without rebinding on every parent render (new `items` array identity would
  // otherwise tear down + re-add document listeners on each render).
  const itemsRef = useRef(items)
  const activeIdxRef = useRef(activeIdx)
  const onDismissRef = useRef(onDismiss)
  itemsRef.current = items
  activeIdxRef.current = activeIdx
  onDismissRef.current = onDismiss

  // Outside-click + Escape dismiss. Bind once; read latest props from refs.
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onDismissRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDismissRef.current()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => Math.min(i + 1, itemsRef.current.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = itemsRef.current[activeIdxRef.current]
        if (item && !item.disabled) {
          item.onSelect()
          onDismissRef.current()
        }
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="heros-menu"
      style={{
        left: pos?.left ?? anchor.x,
        top: pos?.top ?? anchor.y,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          role="menuitem"
          type="button"
          className={
            'heros-menu__item' +
            (item.danger ? ' heros-menu__item--danger' : '') +
            (i === activeIdx ? ' heros-menu__item--active' : '')
          }
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return
            item.onSelect()
            onDismiss()
          }}
          onMouseEnter={() => setActiveIdx(i)}
        >
          {item.icon && <span className="heros-menu__icon">{item.icon}</span>}
          <span className="heros-menu__label">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}
