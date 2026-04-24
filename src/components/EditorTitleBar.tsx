import { useEffect, useRef, useState } from 'react'

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
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset draft when the node swaps.
  useEffect(() => { setDraft(name) }, [nodeId, name])

  useEffect(() => {
    if (autoFocusTitle && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [autoFocusTitle, nodeId])

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
        type="button"
        className="editor-title-bar__icon-btn"
        aria-label="Change icon"
        onClick={() => setPicker(p => !p)}
      >
        {icon || '📄'}
      </button>
      {picker && (
        <div className="editor-title-bar__picker" role="listbox">
          {EMOJI_PALETTE.map(e => (
            <button
              key={e}
              type="button"
              className="editor-title-bar__picker-item"
              onClick={() => { void onIconChange(e); setPicker(false) }}
            >{e}</button>
          ))}
        </div>
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
