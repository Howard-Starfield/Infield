import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface EditorTitleBarProps {
  nodeId: string
  name: string
  icon: string
  onRename: (newName: string) => Promise<void>
  onIconChange: (newIcon: string) => Promise<void>
  /** If true, auto-focus + select the title input on mount. */
  autoFocusTitle?: boolean
}

const EMOJI_PALETTE = [
  '📄','📝','📁','🗂️','📓','🎯','✅','🔖','⭐','💡',
  '📌','🧭','🏷️','🔗','🔍','🧪','🧰','🗓️','📊','🧵',
]

export function EditorTitleBar({
  nodeId, name, icon, onRename, onIconChange, autoFocusTitle,
}: EditorTitleBarProps) {
  const [draft, setDraft] = useState(name)
  const [picker, setPicker] = useState(false)
  const [pickerAnchor, setPickerAnchor] = useState<{ left: number; top: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const iconBtnRef = useRef<HTMLButtonElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Reset draft when the node swaps.
  useEffect(() => { setDraft(name) }, [nodeId, name])

  useEffect(() => {
    if (autoFocusTitle && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [autoFocusTitle, nodeId])

  // Anchor the portalled picker to the icon button when it opens.
  useLayoutEffect(() => {
    if (!picker) {
      setPickerAnchor(null)
      return
    }
    const btn = iconBtnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    setPickerAnchor({ left: rect.left, top: rect.bottom })
  }, [picker])

  // Outside-click + Escape dismissal while the picker is open.
  useEffect(() => {
    if (!picker) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (pickerRef.current?.contains(target)) return
      if (iconBtnRef.current?.contains(target)) return
      setPicker(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPicker(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [picker])

  const commit = async () => {
    const next = draft.trim()
    if (!next || next === name) {
      setDraft(name)
      return
    }
    await onRename(next)
  }

  return (
    <div className="editor-title-bar">
      <button
        ref={iconBtnRef}
        type="button"
        className="editor-title-bar__icon-btn"
        aria-label="Change icon"
        onClick={() => setPicker(p => !p)}
      >
        {icon || '📄'}
      </button>
      {picker && pickerAnchor && createPortal(
        <div
          ref={pickerRef}
          className="editor-title-bar__picker"
          role="listbox"
          style={{ left: pickerAnchor.left, top: pickerAnchor.top }}
        >
          {EMOJI_PALETTE.map(e => (
            <button
              key={e}
              type="button"
              className="editor-title-bar__picker-item"
              onClick={() => { void onIconChange(e); setPicker(false) }}
            >{e}</button>
          ))}
        </div>,
        document.body
      )}
      <input
        ref={inputRef}
        className="editor-title-bar__title"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            inputRef.current?.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(name)
            inputRef.current?.blur()
          }
        }}
      />
    </div>
  )
}
