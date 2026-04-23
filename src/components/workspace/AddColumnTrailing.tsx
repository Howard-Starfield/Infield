import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  onAdd: (name: string) => void | Promise<void>
}

const shell: CSSProperties = {
  flexShrink: 0,
  width: 224,
  borderRadius: 12,
  border: '2px dashed var(--workspace-border)',
  padding: '12px 16px',
  fontSize: 13,
  color: 'var(--workspace-text-muted)',
  transition: 'border-color 120ms ease, color 120ms ease',
}

export function AddColumnTrailing({ onAdd }: Props) {
  const { t } = useTranslation()
  const [isAdding, setIsAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const onAddRef = useRef(onAdd)
  onAddRef.current = onAdd

  const cancel = () => {
    if (inputRef.current) inputRef.current.value = ''
    setIsAdding(false)
  }

  /** Save non-empty draft, or close without saving (matches BoardColumnFooter blur behavior). */
  const commitOrClose = useCallback(() => {
    const raw = inputRef.current?.value ?? ''
    const val = raw.trim()
    if (inputRef.current) inputRef.current.value = ''
    setIsAdding(false)
    if (val) void Promise.resolve(onAddRef.current(val))
  }, [])

  const start = () => {
    setIsAdding(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  useEffect(() => {
    if (!isAdding) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        commitOrClose()
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [isAdding, commitOrClose])

  if (isAdding) {
    return (
      <div
        ref={rootRef}
        style={{
          ...shell,
          borderColor: 'var(--workspace-accent)',
        }}
      >
        <input
          ref={inputRef}
          placeholder={t('database.columnNamePlaceholder')}
          onBlur={() => commitOrClose()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitOrClose()
            }
            if (e.key === 'Escape') cancel()
          }}
          style={{
            width: '100%',
            borderRadius: 6,
            border: '1px solid var(--workspace-accent)',
            background: 'var(--workspace-panel)',
            color: 'var(--workspace-text)',
            padding: '6px 8px',
            fontSize: 13,
            outline: 'none',
            fontFamily: 'Space Grotesk, sans-serif',
          }}
          autoFocus
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={start}
      style={{
        ...shell,
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'Space Grotesk, sans-serif',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Plus size={16} />
        {t('database.addColumn')}
      </span>
    </button>
  )
}
