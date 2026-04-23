import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { WorkspaceMenuSurface } from '@/components/workspace/chrome/workspaceMenuChrome'
import {
  WorkspaceFloatingPortal,
  placeBelowAnchor,
  workspaceFloatingBackdropZ,
  workspaceFloatingZ,
} from '@/lib/workspaceFloatingLayer'
import type { Field } from '../../types/workspace'
import { isBoardColumnFieldType } from '@/lib/workspaceFieldSelect'

// Unwrap the { type, value } cell wrapper that workspace_manager stores
export function extractCellValue(rawCell: unknown): unknown {
  if (rawCell === null || rawCell === undefined) return undefined
  if (typeof rawCell === 'object' && rawCell !== null && 'value' in rawCell) {
    return (rawCell as Record<string, unknown>).value
  }
  return rawCell
}

// CSS color approximations for select chip colors
const SELECT_COLOR_MAP: Record<string, string> = {
  purple: '#8b7355',
  pink: '#E91E8C',
  light_pink: '#f472b6',
  orange: '#F97316',
  yellow: '#EAB308',
  lime: '#84cc16',
  green: '#22C55E',
  aqua: '#06B6D4',
  blue: '#3B82F6',
}

function colorToCss(color: string): string {
  return SELECT_COLOR_MAP[color] ?? color
}

interface SelectOption {
  id: string
  name: string
  color?: string
}

interface Props {
  field: Field
  rawCell: unknown          // the full { type, value } object from cells[fieldId]
  isEditing: boolean
  onStartEdit: () => void
  onCommit: (value: unknown) => void
  onCancelEdit: () => void
  onTabNext: () => void
  onTabPrev: () => void
  onOpenRow?: () => void
}

export function GridCell({
  field,
  rawCell,
  isEditing,
  onStartEdit,
  onCommit,
  onCancelEdit,
  onTabNext,
  onTabPrev,
  onOpenRow,
}: Props) {
  const value = extractCellValue(rawCell)
  const options: SelectOption[] = field.type_option?.options ?? []

  const inputRef = useRef<HTMLInputElement>(null)
  const selectEditAnchorRef = useRef<HTMLDivElement>(null)
  const [selectEditAnchor, setSelectEditAnchor] = useState<DOMRect | null>(null)
  const [draft, setDraft] = useState<string>('')
  const [hovered, setHovered] = useState(false)

  const isSelectEditFloating =
    isEditing &&
    (isBoardColumnFieldType(field.field_type) || field.field_type === 'multi_select')

  useLayoutEffect(() => {
    if (!isSelectEditFloating) {
      setSelectEditAnchor(null)
      return
    }
    const el = selectEditAnchorRef.current
    if (el) setSelectEditAnchor(el.getBoundingClientRect())
  }, [isSelectEditFloating, field.field_type, options.length, value])

  useEffect(() => {
    if (!selectEditAnchor || !isSelectEditFloating) return
    const sync = () => {
      const el = selectEditAnchorRef.current
      if (el) setSelectEditAnchor(el.getBoundingClientRect())
    }
    window.addEventListener('scroll', sync, true)
    window.addEventListener('resize', sync)
    return () => {
      window.removeEventListener('scroll', sync, true)
      window.removeEventListener('resize', sync)
    }
  }, [selectEditAnchor, isSelectEditFloating])

  // When entering edit mode, initialise draft from current value
  useEffect(() => {
    if (isEditing) {
      if (field.field_type === 'checkbox') return // checkbox toggles immediately
      const str = value === null || value === undefined ? '' : String(value)
      setDraft(str)
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
    }
  }, [isEditing, field.field_type])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onCommit(parseFieldValue(draft)); }
    if (e.key === 'Escape') { e.preventDefault(); onCancelEdit(); }
    if (e.key === 'Tab') {
      e.preventDefault()
      onCommit(parseFieldValue(draft))
      if (e.shiftKey) onTabPrev(); else onTabNext()
    }
  }

  const parseFieldValue = (v: string): unknown => {
    if (field.field_type === 'number') {
      const n = parseFloat(v)
      return isNaN(n) ? null : n
    }
    return v || null
  }

  const cellBase: React.CSSProperties = {
    width: '100%',
    height: '100%',
    minHeight: 34,
    display: 'flex',
    alignItems: 'center',
    padding: '0 10px',
    cursor: 'text',
    position: 'relative',
    boxSizing: 'border-box',
    overflow: 'hidden',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 13,
    fontFamily: 'Space Grotesk, sans-serif',
    color: 'var(--workspace-text)',
    padding: 0,
  }

  // ── Checkbox (toggle on click, no text edit mode) ─────────────────────────
  if (field.field_type === 'checkbox') {
    const checked = Boolean(value)
    return (
      <div
        style={{ ...cellBase, cursor: 'pointer', justifyContent: 'center' }}
        onClick={() => onCommit(!checked)}
      >
        <span style={{ fontSize: 15, color: checked ? 'var(--workspace-accent)' : 'var(--workspace-text-soft)' }}>
          {checked ? '☑' : '☐'}
        </span>
      </div>
    )
  }

  // ── Single Select ─────────────────────────────────────────────────────────
  if (isBoardColumnFieldType(field.field_type)) {
    const selected = options.find(o => o.id === value)
    if (isEditing) {
      const menuW = 200
      const estH = Math.min(48 + options.length * 36, 280)
      const pos = selectEditAnchor
        ? placeBelowAnchor(selectEditAnchor, { gap: 4, menuWidth: menuW, menuHeight: estH })
        : null
      return (
        <div
          ref={selectEditAnchorRef}
          style={{ ...cellBase, flexDirection: 'column', alignItems: 'stretch', padding: 0, zIndex: 10 }}
        >
          {selectEditAnchor && pos && (
            <WorkspaceFloatingPortal>
              <div
                role="presentation"
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: workspaceFloatingBackdropZ(),
                  background: 'transparent',
                }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onCancelEdit()
                }}
              />
              <WorkspaceMenuSurface
                style={{
                  position: 'fixed',
                  top: pos.top,
                  left: pos.left,
                  minWidth: menuW,
                  zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
                  padding: 4,
                  boxShadow: 'var(--workspace-shadow)',
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => { onCommit(null); }}
                  style={{
                    display: 'flex', alignItems: 'center', width: '100%',
                    padding: '5px 8px', border: 'none', background: 'transparent',
                    fontSize: 12, cursor: 'pointer', borderRadius: 4,
                    color: 'var(--workspace-text-soft)', fontFamily: 'Space Grotesk, sans-serif',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--workspace-tree-hover)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  — None
                </button>
                {options.map(opt => {
                  const c = colorToCss(opt.color ?? '')
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => { onCommit(opt.id); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        width: '100%', padding: '5px 8px',
                        border: 'none', borderRadius: 4,
                        background: opt.id === value ? `${c}18` : 'transparent',
                        cursor: 'pointer', fontSize: 12,
                        fontFamily: 'Space Grotesk, sans-serif',
                        color: 'var(--workspace-text)',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = `${c}18` }}
                      onMouseLeave={e => { e.currentTarget.style.background = opt.id === value ? `${c}18` : 'transparent' }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                      {opt.name}
                    </button>
                  )
                })}
              </WorkspaceMenuSurface>
            </WorkspaceFloatingPortal>
          )}
        </div>
      )
    }
    return (
      <div style={{ ...cellBase }} onClick={onStartEdit}>
        {selected ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '2px 8px', borderRadius: 4, fontSize: 11,
            background: `${colorToCss(selected.color ?? '')}22`,
            color: colorToCss(selected.color ?? '#666'),
            fontWeight: 500,
          }}>
            {selected.name}
          </span>
        ) : (
          <span style={{ opacity: 0.3, fontSize: 12 }}>—</span>
        )}
      </div>
    )
  }

  // ── Multi Select ──────────────────────────────────────────────────────────
  if (field.field_type === 'multi_select') {
    const selectedIds = Array.isArray(value) ? (value as string[]) : []
    if (isEditing) {
      const menuW = 200
      const estH = Math.min(52 + options.length * 36, 300)
      const pos = selectEditAnchor
        ? placeBelowAnchor(selectEditAnchor, { gap: 4, menuWidth: menuW, menuHeight: estH })
        : null
      return (
        <div ref={selectEditAnchorRef} style={{ ...cellBase, padding: 0, zIndex: 10 }}>
          {selectEditAnchor && pos && (
            <WorkspaceFloatingPortal>
              <div
                role="presentation"
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: workspaceFloatingBackdropZ(),
                  background: 'transparent',
                }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onCancelEdit()
                }}
              />
              <WorkspaceMenuSurface
                style={{
                  position: 'fixed',
                  top: pos.top,
                  left: pos.left,
                  minWidth: menuW,
                  zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
                  padding: 4,
                  boxShadow: 'var(--workspace-shadow)',
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {options.map(opt => {
                  const c = colorToCss(opt.color ?? '')
                  const isSelected = selectedIds.includes(opt.id)
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        const next = isSelected
                          ? selectedIds.filter(id => id !== opt.id)
                          : [...selectedIds, opt.id]
                        onCommit(next.length > 0 ? next : null)
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        width: '100%', padding: '5px 8px',
                        border: 'none', borderRadius: 4,
                        background: isSelected ? `${c}18` : 'transparent',
                        cursor: 'pointer', fontSize: 12,
                        fontFamily: 'Space Grotesk, sans-serif',
                        color: 'var(--workspace-text)',
                      }}
                    >
                      <span style={{ width: 14, color: isSelected ? c : 'transparent', fontSize: 11 }}>✓</span>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                      {opt.name}
                    </button>
                  )
                })}
                <div style={{ borderTop: '1px solid var(--workspace-border)', margin: '4px 0', paddingTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => { onCommit(selectedIds.length > 0 ? selectedIds : null); }}
                    style={{
                      width: '100%', padding: '4px 8px', border: 'none', background: 'transparent',
                      fontSize: 11, cursor: 'pointer', borderRadius: 4,
                      color: 'var(--workspace-text-soft)', fontFamily: 'Space Grotesk, sans-serif',
                    }}
                  >
                    Done
                  </button>
                </div>
              </WorkspaceMenuSurface>
            </WorkspaceFloatingPortal>
          )}
        </div>
      )
    }
    return (
      <div style={{ ...cellBase, gap: 4, flexWrap: 'wrap' }} onClick={onStartEdit}>
        {selectedIds.length === 0
          ? <span style={{ opacity: 0.3, fontSize: 12 }}>—</span>
          : selectedIds.map(id => {
              const opt = options.find(o => o.id === id)
              if (!opt) return null
              const c = colorToCss(opt.color ?? '')
              return (
                <span key={id} style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '2px 6px', borderRadius: 4, fontSize: 11,
                  background: `${c}22`, color: c, fontWeight: 500,
                }}>
                  {opt.name}
                </span>
              )
            })
        }
      </div>
    )
  }

  // ── Date ──────────────────────────────────────────────────────────────────
  if (field.field_type === 'date' || field.field_type === 'date_time') {
    const dateStr = value ? String(value) : ''
    let formatted = ''
    let inputVal = ''
    if (dateStr) {
      try {
        const d = new Date(dateStr)
        if (!isNaN(d.getTime())) {
          formatted = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
          inputVal = d.toISOString().split('T')[0]
        }
      } catch { /* ignore */ }
    }

    if (isEditing) {
      return (
        <div style={cellBase}>
          <input
            ref={inputRef}
            type="date"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { onCommit(draft ? new Date(draft).toISOString() : null); }
              if (e.key === 'Escape') onCancelEdit()
              if (e.key === 'Tab') { e.preventDefault(); onCommit(draft ? new Date(draft).toISOString() : null); if (e.shiftKey) onTabPrev(); else onTabNext(); }
            }}
            onBlur={e => {
              if (e.target.value) onCommit(new Date(e.target.value).toISOString())
              else onCancelEdit()
            }}
            style={{ ...inputStyle }}
          />
        </div>
      )
    }
    return (
      <div style={cellBase} onClick={onStartEdit}>
        {formatted
          ? <span style={{ fontSize: 12 }}>{formatted}</span>
          : <span style={{ opacity: 0.3, fontSize: 12 }}>—</span>
        }
      </div>
    )
  }

  // ── Number ────────────────────────────────────────────────────────────────
  if (field.field_type === 'number') {
    const num = value !== undefined && value !== null ? Number(value) : null

    if (isEditing) {
      return (
        <div style={cellBase}>
          <input
            ref={inputRef}
            type="number"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => onCommit(parseFieldValue(draft))}
            style={{ ...inputStyle, textAlign: 'right' }}
          />
        </div>
      )
    }
    return (
      <div style={{ ...cellBase, justifyContent: 'flex-end' }} onClick={onStartEdit}>
        {num !== null
          ? <span style={{ fontSize: 13 }}>{num.toLocaleString()}</span>
          : <span style={{ opacity: 0.3, fontSize: 12 }}>—</span>
        }
      </div>
    )
  }

  // ── URL ───────────────────────────────────────────────────────────────────
  if (field.field_type === 'url') {
    const url = value ? String(value) : ''
    if (isEditing) {
      return (
        <div style={cellBase}>
          <input
            ref={inputRef}
            type="url"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => onCommit(draft || null)}
            style={inputStyle}
          />
        </div>
      )
    }
    return (
      <div style={cellBase} onClick={onStartEdit}>
        {url
          ? <a href={url} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ color: 'var(--workspace-accent)', fontSize: 12, textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {url}
            </a>
          : <span style={{ opacity: 0.3, fontSize: 12 }}>—</span>
        }
      </div>
    )
  }

  // ── Protected (masked; plain text in storage) ─────────────────────────────
  if (field.field_type === 'protected') {
    const has = value !== null && value !== undefined && String(value).length > 0
    if (isEditing) {
      return (
        <div style={cellBase}>
          <input
            ref={inputRef}
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => onCommit(draft || null)}
            style={inputStyle}
          />
        </div>
      )
    }
    return (
      <div style={cellBase} onClick={onStartEdit}>
        {has ? (
          <span style={{ letterSpacing: 4, fontSize: 12, color: 'var(--workspace-text-muted)' }}>••••••</span>
        ) : (
          <span style={{ opacity: 0.3, fontSize: 12 }}>—</span>
        )}
      </div>
    )
  }

  // ── Rich text (default) ───────────────────────────────────────────────────
  const text = value !== null && value !== undefined ? String(value) : ''
  if (isEditing) {
    return (
      <div style={cellBase}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => onCommit(draft || null)}
          style={inputStyle}
        />
      </div>
    )
  }
  return (
    <div
      style={cellBase}
      onClick={onStartEdit}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {text
        ? <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
        : <span style={{ opacity: 0.3, fontSize: 12 }}>—</span>
      }
      {field.is_primary && hovered && onOpenRow && (
        <button
          onClick={e => { e.stopPropagation(); onOpenRow() }}
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 20, height: 20, border: 'none', background: 'rgba(0,0,0,0.06)',
            borderRadius: 3, cursor: 'pointer', color: 'var(--workspace-text-muted)',
          }}
          title="Open row"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 9 L9 1 M9 1 L1 1 M9 1 L9 9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          </svg>
        </button>
      )}
    </div>
  )
}
