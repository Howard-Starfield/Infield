import { drawTextCell, GridCellKind, type CustomCell, type CustomRenderer, type GridCell } from '@glideapps/glide-data-grid'
import type { Rectangle } from '@glideapps/glide-data-grid'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { WorkspaceMenuSurface } from '@/components/workspace/chrome/workspaceMenuChrome'
import {
  WorkspaceFloatingPortal,
  placeBelowAnchor,
  workspaceFloatingBackdropZ,
  workspaceFloatingZ,
} from '@/lib/workspaceFloatingLayer'
import type { Field, FieldType } from '../../types/workspace'
import { extractCellValue } from './GridCell'
import { extractCellFormula } from '@/lib/workspaceCellPayload'

/** Must match the active grid cell background applied from workspace appearance tokens. */
const BG_CELL = 'var(--workspace-grid-bg-cell, #fdf9f3)'
const GLIDE_OVERLAY_INSET_PX = 1

export const HANDY_WS_TAG = 'handy-ws-v1' as const

/** Custom overlay fields. Plain `url` (no formula) and `media` use Glide native Uri/Image cells in GridView. */
export type HandyWsFieldType = 'single_select' | 'multi_select' | 'date' | 'date_time' | 'time' | 'url'

export type HandyWsCustomData = {
  tag: typeof HANDY_WS_TAG
  fieldType: HandyWsFieldType
  display: string
  /** Edit buffer (option id, JSON array for multi, lines for media, yyyy-MM-dd, datetime-local, HH:mm, url, or formula). */
  edit: string
  /** When set, `edit` holds the formula source; `display` is the evaluated preview. */
  formula: string | null
  options: readonly { id: string; name: string; color?: string }[]
  includeTime?: boolean
}

export function isHandyWsData(d: unknown): d is HandyWsCustomData {
  return typeof d === 'object' && d !== null && (d as { tag?: string }).tag === HANDY_WS_TAG
}

function isHandyFieldType(t: FieldType): boolean {
  return (
    t === 'single_select' ||
    t === 'board' ||
    t === 'multi_select' ||
    t === 'date' ||
    t === 'date_time' ||
    t === 'time' ||
    t === 'url'
  )
}

/** Glide custom cell always stores `single_select` in overlay data (editors are shared). */
function handyGridFieldType(fieldType: FieldType): HandyWsFieldType | null {
  if (!isHandyFieldType(fieldType)) return null
  return fieldType === 'board' ? 'single_select' : (fieldType as HandyWsFieldType)
}

function displayMultiSelect(field: Field, rawCell: unknown, formulaDisplayOverride?: string): string {
  if (formulaDisplayOverride !== undefined) return formulaDisplayOverride
  const v = extractCellValue(rawCell)
  const ids = Array.isArray(v) ? (v as string[]) : []
  const opts = field.type_option?.options ?? []
  if (ids.length === 0) return ''
  return ids
    .map((id) => opts.find((o) => o.id === id)?.name ?? id)
    .filter(Boolean)
    .join(', ')
}

function displayTime(field: Field, rawCell: unknown, formulaDisplayOverride?: string): string {
  if (formulaDisplayOverride !== undefined) return formulaDisplayOverride
  const v = extractCellValue(rawCell)
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' && Number.isFinite(v)) {
    const sec = Math.floor(v) % 86400
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  return String(v)
}

function displayLocaleMediumDate(d: Date): string {
  try {
    return d.toLocaleDateString(undefined, { dateStyle: 'medium' })
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

function displayLocaleDateTimeMediumShort(d: Date): string {
  try {
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return d.toISOString()
  }
}

export function displayForHandyField(field: Field, rawCell: unknown, formulaDisplayOverride?: string): string {
  if (formulaDisplayOverride !== undefined) return formulaDisplayOverride
  const v = extractCellValue(rawCell)
  if (v === null || v === undefined) return ''
  if (field.field_type === 'single_select' || field.field_type === 'board') {
    const opt = field.type_option?.options?.find((o) => o.id === v)
    return opt?.name ?? String(v)
  }
  if (field.field_type === 'multi_select') return displayMultiSelect(field, rawCell, undefined)
  if (field.field_type === 'time') return displayTime(field, rawCell, undefined)
  if (field.field_type === 'date') {
    const d = new Date(String(v))
    if (Number.isNaN(d.getTime())) return String(v)
    return displayLocaleMediumDate(d)
  }
  if (field.field_type === 'date_time') {
    const d = new Date(String(v))
    if (Number.isNaN(d.getTime())) return String(v)
    if (field.type_option?.include_time === true) {
      return displayLocaleDateTimeMediumShort(d)
    }
    return displayLocaleMediumDate(d)
  }
  return String(v)
}

function dateToInputValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dateTimeLocalValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${day}T${h}:${min}`
}

/** Parse grid edit buffer into date / time parts for `datetime-local`-style editing. */
function dateTimeEditParts(edit: string): { date: string; time: string } {
  const raw = edit.trim()
  if (!raw) return { date: '', time: '00:00' }
  const local = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  if (local) {
    return { date: local[1]!, time: local[2]!.slice(0, 5) }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { date: raw, time: '00:00' }
  }
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return { date: '', time: '00:00' }
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return { date: `${y}-${mo}-${day}`, time: `${h}:${min}` }
}

function mergeDateTimeLocal(date: string, time: string): string {
  const d = (date ?? '').trim()
  if (!d) return ''
  const tm = (time ?? '00:00').trim().slice(0, 5)
  const norm = /^\d{2}:\d{2}$/.test(tm) ? tm : '00:00'
  return `${d}T${norm}`
}

function timeToInputValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number' && Number.isFinite(v)) {
    const sec = Math.floor(v) % 86400
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  const s = String(v)
  if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function buildEditString(field: Field, rawCell: unknown): string {
  const v = extractCellValue(rawCell)
  const formulaSrc = extractCellFormula(rawCell)
  if (formulaSrc != null) return formulaSrc

  switch (field.field_type) {
    case 'multi_select':
      return JSON.stringify(Array.isArray(v) ? (v as string[]) : [])
    case 'board':
    case 'single_select':
      return v == null || v === undefined ? '' : String(v)
    case 'date':
      return dateToInputValue(v)
    case 'date_time':
      return field.type_option?.include_time === true ? dateTimeLocalValue(v) : dateToInputValue(v)
    case 'time':
      return timeToInputValue(v)
    case 'url':
      return v == null || v === undefined ? '' : String(v)
    default:
      return ''
  }
}

/** Returns a Glide custom cell for supported workspace field types, or `null` to fall back to text. */
export function buildHandyWorkspaceGridCell(
  field: Field,
  rawCell: unknown,
  formulaDisplayOverride?: string,
): CustomCell<HandyWsCustomData> | null {
  if (field.field_type === 'media') return null
  if (field.field_type === 'url' && extractCellFormula(rawCell) == null) return null
  const glideFieldType = handyGridFieldType(field.field_type)
  if (glideFieldType == null) return null

  const display = displayForHandyField(field, rawCell, formulaDisplayOverride)
  const edit = buildEditString(field, rawCell)
  const data: HandyWsCustomData = {
    tag: HANDY_WS_TAG,
    fieldType: glideFieldType,
    display,
    edit,
    formula: extractCellFormula(rawCell),
    options: field.type_option?.options ?? [],
    includeTime: field.type_option?.include_time === true,
  }

  return {
    kind: GridCellKind.Custom,
    allowOverlay: true,
    readonly: false,
    data,
    copyData: display || edit,
  }
}

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

export function clampGlideOverlayToTarget(wrapRef: React.RefObject<HTMLDivElement | null>, target: Rectangle) {
  const start = wrapRef.current
  if (!start) return
  let el: HTMLElement | null = start
  while (el && !(typeof el.id === 'string' && el.id.startsWith('gdg-overlay-'))) {
    el = el.parentElement
  }
  if (!el) return
  const overlayEl = el
  const posKeys = ['left', 'top'] as const
  const dimKeys = ['width', 'min-width', 'max-width', 'height', 'min-height', 'max-height'] as const
  const padKeys = ['padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom'] as const
  const prior = new Map<string, string>()
  for (const k of posKeys) prior.set(k, overlayEl.style.getPropertyValue(k))
  for (const k of dimKeys) prior.set(k, overlayEl.style.getPropertyValue(k))
  for (const k of padKeys) prior.set(k, overlayEl.style.getPropertyValue(k))
  const inset = GLIDE_OVERLAY_INSET_PX
  const wPx = Math.max(1, Math.ceil(target.width) - inset * 2)
  const hPx = Math.max(1, Math.ceil(target.height) - inset * 2)
  const w = `${wPx}px`
  const h = `${hPx}px`
  overlayEl.style.setProperty('left', `${target.x + inset}px`)
  overlayEl.style.setProperty('top', `${target.y + inset}px`)
  for (const k of dimKeys) {
    overlayEl.style.setProperty(k, k.includes('width') ? w : h)
  }
  for (const k of padKeys) overlayEl.style.setProperty(k, '0')
  return () => {
    for (const k of [...posKeys, ...dimKeys, ...padKeys]) {
      const v = prior.get(k)
      if (v) overlayEl.style.setProperty(k, v)
      else overlayEl.style.removeProperty(k)
    }
  }
}

type EditorProps = {
  value: CustomCell<HandyWsCustomData>
  onChange: (v: GridCell) => void
  onFinishedEditing: (newValue?: GridCell, movement?: readonly [-1 | 0 | 1, -1 | 0 | 1]) => void
  target: Rectangle
  rowPx: number
}

function HandySingleSelectEditor(p: EditorProps) {
  const { value, onChange, onFinishedEditing, target } = p
  const d = value.data
  const wrapRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    return clampGlideOverlayToTarget(wrapRef, target) ?? undefined
  }, [target.x, target.y, target.width, target.height])

  const anchor = useMemo(() => new DOMRect(target.x, target.y, target.width, target.height), [target])
  const opts = d.options
  const menuW = 220
  const estH = Math.min(48 + opts.length * 36, 280)
  const pos = placeBelowAnchor(anchor, { gap: 4, menuWidth: menuW, menuHeight: estH })

  const pick = (id: string | null) => {
    const next: CustomCell<HandyWsCustomData> = {
      ...value,
      data: { ...d, edit: id ?? '', formula: null },
      copyData: id ?? '',
    }
    onChange(next)
    onFinishedEditing(next, [0, 0])
  }

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', minHeight: 0, position: 'relative' }}>
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
            onFinishedEditing(undefined, [0, 0])
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
            onClick={() => pick(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              padding: '5px 8px',
              border: 'none',
              background: 'transparent',
              fontSize: 12,
              cursor: 'pointer',
              borderRadius: 4,
              color: 'var(--workspace-text-soft)',
              fontFamily: 'Space Grotesk, sans-serif',
            }}
          >
            {`${'\u2014'} None`}
          </button>
          {opts.map((opt) => {
            const c = colorToCss(opt.color ?? '')
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => pick(opt.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  padding: '5px 8px',
                  border: 'none',
                  borderRadius: 4,
                  background: opt.id === d.edit ? `${c}18` : 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'Space Grotesk, sans-serif',
                  color: 'var(--workspace-text)',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                {opt.name}
              </button>
            )
          })}
        </WorkspaceMenuSurface>
      </WorkspaceFloatingPortal>
    </div>
  )
}

function parseMultiIds(edit: string): string[] {
  try {
    const arr = JSON.parse(edit || '[]') as unknown
    return Array.isArray(arr) ? (arr as string[]) : []
  } catch {
    return []
  }
}

function HandyMultiSelectEditor(p: EditorProps) {
  const { value, onChange, onFinishedEditing, target } = p
  const d = value.data
  const wrapRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    return clampGlideOverlayToTarget(wrapRef, target) ?? undefined
  }, [target.x, target.y, target.width, target.height])

  const anchor = useMemo(() => new DOMRect(target.x, target.y, target.width, target.height), [target])
  const opts = d.options
  const [sel, setSel] = useState<Set<string>>(() => new Set(parseMultiIds(d.edit)))
  const menuW = 240
  const estH = Math.min(52 + opts.length * 36, 300)
  const pos = placeBelowAnchor(anchor, { gap: 4, menuWidth: menuW, menuHeight: estH })

  const commit = () => {
    const arr = [...sel]
    const json = JSON.stringify(arr)
    const next: CustomCell<HandyWsCustomData> = {
      ...value,
      data: { ...d, edit: json, formula: null },
      copyData: json,
    }
    onChange(next)
    onFinishedEditing(next, [0, 0])
  }

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', minHeight: 0, position: 'relative' }}>
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
            commit()
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
          {opts.map((opt) => {
            const on = sel.has(opt.id)
            const c = colorToCss(opt.color ?? '')
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setSel((prev) => {
                    const n = new Set(prev)
                    if (n.has(opt.id)) n.delete(opt.id)
                    else n.add(opt.id)
                    return n
                  })
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 8px',
                  border: 'none',
                  borderRadius: 4,
                  background: on ? `${c}22` : 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'Space Grotesk, sans-serif',
                }}
              >
                <span style={{ width: 14, textAlign: 'center' }}>{on ? '☑' : '☐'}</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                {opt.name}
              </button>
            )
          })}
          <button
            type="button"
            onClick={commit}
            style={{
              marginTop: 6,
              width: '100%',
              padding: '6px',
              borderRadius: 4,
              border: 'none',
              background: 'var(--workspace-accent)',
              color: '#fff',
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'Space Grotesk, sans-serif',
            }}
          >
            {String.fromCharCode(68, 111, 110, 101)}
          </button>
        </WorkspaceMenuSurface>
      </WorkspaceFloatingPortal>
    </div>
  )
}

/** Date & time with `include_time`: native date picker first, then time picker (no combined `datetime-local`). */
function HandyDateTimeSplitScalarEditor(p: EditorProps) {
  const { value, onChange, onFinishedEditing, target, rowPx } = p
  const d = value.data
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<'date' | 'time'>('date')
  /** Suppress one blur right after committing a date, before the time phase mounts (avoids closing the editor early). */
  const suppressNextBlurRef = useRef(false)

  useLayoutEffect(() => {
    return clampGlideOverlayToTarget(wrapRef, target) ?? undefined
  }, [target.x, target.y, target.width, target.height])

  const patch = useCallback(
    (edit: string) => {
      onChange({
        ...value,
        data: { ...d, edit },
        copyData: edit || d.display,
      })
    },
    [onChange, value, d],
  )

  const parts = dateTimeEditParts(d.edit)
  const inputType = phase === 'date' ? 'date' : 'time'
  const inputValue = phase === 'date' ? parts.date : parts.time

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    const picker = (el as HTMLInputElement & { showPicker?: () => void }).showPicker
    if (typeof picker !== 'function') return
    requestAnimationFrame(() => {
      try {
        picker.call(el)
      } catch {
        /* blocked without user gesture in some browsers */
      }
    })
  }, [phase])

  const commitFromBlur = useCallback(
    (edit: string) => {
      const next: CustomCell<HandyWsCustomData> = {
        ...value,
        data: { ...d, edit, formula: null },
        copyData: edit,
      }
      onChange(next)
      onFinishedEditing(next, [0, 0])
    },
    [onChange, onFinishedEditing, value, d],
  )

  const inputStyle: CSSProperties = {
    width: '100%',
    minWidth: 0,
    height: rowPx - 4,
    fontSize: 13,
    fontFamily: 'Space Grotesk, sans-serif',
    border: '1px solid rgba(28,28,25,0.12)',
    borderRadius: 4,
    padding: '0 6px',
    boxSizing: 'border-box',
  }

  return (
    <div
      ref={wrapRef}
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      style={{
        alignSelf: 'stretch',
        width: '100%',
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        maxHeight: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        backgroundColor: BG_CELL,
        paddingLeft: 8,
        paddingRight: 8,
      }}
    >
      <input
        ref={inputRef}
        autoFocus
        type={inputType}
        value={inputValue}
        onChange={(e) => {
          if (phase === 'date') {
            const merged = mergeDateTimeLocal(e.target.value, parts.time)
            patch(merged)
            suppressNextBlurRef.current = true
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                suppressNextBlurRef.current = false
              })
            })
            setPhase('time')
            return
          }
          patch(mergeDateTimeLocal(parts.date, e.target.value))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const edit =
              phase === 'date'
                ? mergeDateTimeLocal(e.currentTarget.value, parts.time)
                : mergeDateTimeLocal(parts.date, e.currentTarget.value)
            const next: CustomCell<HandyWsCustomData> = {
              ...value,
              data: { ...d, edit, formula: null },
              copyData: edit,
            }
            onChange(next)
            onFinishedEditing(next, [0, 1])
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            onFinishedEditing(undefined, [0, 0])
          }
          if (e.key === 'Tab') {
            e.preventDefault()
            const edit =
              phase === 'date'
                ? mergeDateTimeLocal(e.currentTarget.value, parts.time)
                : mergeDateTimeLocal(parts.date, e.currentTarget.value)
            const next: CustomCell<HandyWsCustomData> = {
              ...value,
              data: { ...d, edit, formula: null },
              copyData: edit,
            }
            onChange(next)
            onFinishedEditing(next, [e.shiftKey ? -1 : 1, 0])
          }
        }}
        onBlur={(e) => {
          if (suppressNextBlurRef.current) return
          const edit =
            phase === 'date'
              ? mergeDateTimeLocal(e.target.value, dateTimeEditParts(d.edit).time)
              : mergeDateTimeLocal(dateTimeEditParts(d.edit).date, e.target.value)
          commitFromBlur(edit)
        }}
        style={inputStyle}
      />
    </div>
  )
}

function HandyScalarInputEditor(p: EditorProps) {
  const { value, onChange, onFinishedEditing, target, rowPx } = p
  const d = value.data
  const wrapRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    return clampGlideOverlayToTarget(wrapRef, target) ?? undefined
  }, [target.x, target.y, target.width, target.height])

  const patch = useCallback(
    (edit: string) => {
      onChange({
        ...value,
        data: { ...d, edit },
        copyData: edit || d.display,
      })
    },
    [onChange, value, d],
  )

  const isFormulaLike = d.formula != null || d.edit.trimStart().startsWith('=')
  if (!isFormulaLike && d.fieldType === 'date_time' && d.includeTime) {
    return <HandyDateTimeSplitScalarEditor {...p} />
  }

  const inputType = isFormulaLike
    ? 'text'
    : d.fieldType === 'date'
      ? 'date'
      : d.fieldType === 'date_time'
        ? 'date'
        : d.fieldType === 'time'
          ? 'time'
          : d.fieldType === 'url'
            ? 'url'
            : 'text'

  const inputRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    if (isFormulaLike) return
    if (inputType !== 'date' && inputType !== 'time') return
    const el = inputRef.current
    if (!el) return
    const picker = (el as HTMLInputElement & { showPicker?: () => void }).showPicker
    if (typeof picker !== 'function') return
    requestAnimationFrame(() => {
      try {
        picker.call(el)
      } catch {
        /* blocked without user gesture in some browsers */
      }
    })
  }, [isFormulaLike, inputType])

  return (
    <div
      ref={wrapRef}
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      style={{
        alignSelf: 'stretch',
        width: '100%',
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        maxHeight: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        backgroundColor: BG_CELL,
        paddingLeft: 8,
        paddingRight: 8,
      }}
    >
        <input
          ref={inputRef}
          autoFocus
          type={inputType}
          value={d.edit}
          onChange={(e) => patch(e.target.value)}
          onKeyDown={(e) => {
            if (isFormulaLike) {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                const next: CustomCell<HandyWsCustomData> = {
                  ...value,
                  data: { ...d, edit: e.currentTarget.value },
                  copyData: e.currentTarget.value,
                }
                onChange(next)
                onFinishedEditing(next, [0, 1])
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                onFinishedEditing(undefined, [0, 0])
              }
              if (e.key === 'Tab') {
                e.preventDefault()
                const next: CustomCell<HandyWsCustomData> = {
                  ...value,
                  data: { ...d, edit: e.currentTarget.value },
                  copyData: e.currentTarget.value,
                }
                onChange(next)
                onFinishedEditing(next, [e.shiftKey ? -1 : 1, 0])
              }
              return
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              const next: CustomCell<HandyWsCustomData> = {
                ...value,
                data: { ...d, edit: e.currentTarget.value, formula: null },
                copyData: e.currentTarget.value,
              }
              onChange(next)
              onFinishedEditing(next, [0, 1])
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              onFinishedEditing(undefined, [0, 0])
            }
            if (e.key === 'Tab') {
              e.preventDefault()
              const next: CustomCell<HandyWsCustomData> = {
                ...value,
                data: { ...d, edit: e.currentTarget.value, formula: null },
                copyData: e.currentTarget.value,
              }
              onChange(next)
              onFinishedEditing(next, [e.shiftKey ? -1 : 1, 0])
            }
          }}
          onBlur={(e) => {
            const next: CustomCell<HandyWsCustomData> = {
              ...value,
              data: { ...d, edit: e.target.value, formula: null },
              copyData: e.target.value,
            }
            onChange(next)
            onFinishedEditing(next, [0, 0])
          }}
          style={{
            width: '100%',
            minWidth: 0,
            height: rowPx - 4,
            fontSize: 13,
            fontFamily: 'Space Grotesk, sans-serif',
            border: '1px solid rgba(28,28,25,0.12)',
            borderRadius: 4,
            padding: '0 6px',
            boxSizing: 'border-box',
          }}
        />
    </div>
  )
}

function HandyWsFieldOverlayEditor(p: EditorProps) {
  const d = p.value.data
  if (d.fieldType === 'single_select') return <HandySingleSelectEditor {...p} />
  if (d.fieldType === 'multi_select') return <HandyMultiSelectEditor {...p} />
  return <HandyScalarInputEditor {...p} />
}

/** Parse `edit` buffer into JSON value for `ws_update_cell` / row storage. */
export function handyEditToPersistedValue(fieldType: HandyWsFieldType, edit: string): unknown {
  const t = edit.trim()
  if (t === '') {
    if (fieldType === 'multi_select') return []
    return null
  }
  switch (fieldType) {
    case 'single_select':
      return t
    case 'multi_select': {
      try {
        const arr = JSON.parse(t) as unknown
        return Array.isArray(arr) ? arr : []
      } catch {
        return []
      }
    }
    case 'date':
    case 'date_time': {
      if (!t) return null
      const d = new Date(t)
      if (Number.isNaN(d.getTime())) return null
      return d.toISOString()
    }
    case 'time': {
      const [hh, mm] = t.split(':').map((x) => parseInt(x, 10))
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
      return hh * 3600 + mm * 60
    }
    case 'url':
      return t
    default:
      return t
  }
}

export const handyWorkspaceCustomRenderer: CustomRenderer<CustomCell<HandyWsCustomData>> = {
  kind: GridCellKind.Custom,
  isMatch: (cell): cell is CustomCell<HandyWsCustomData> =>
    cell.kind === GridCellKind.Custom && isHandyWsData(cell.data),
  draw: (args, cell) => {
    drawTextCell(args, cell.data.display, 'left')
  },
}

export function provideHandyWorkspaceEditor(rowPx: number) {
  return (cell: GridCell) => {
    if (cell.kind !== GridCellKind.Custom || !isHandyWsData(cell.data)) return undefined
    if (cell.readonly === true) return undefined
    return {
      disablePadding: true,
      disableStyling: true,
      styleOverride: {
        padding: 0,
        height: rowPx,
        maxHeight: rowPx,
        backgroundColor: BG_CELL,
        boxSizing: 'border-box' as const,
        overflow: 'hidden',
        outline: 'none',
        boxShadow: 'none',
        borderRadius: 0,
      },
      editor: (p: {
        onChange: (v: GridCell) => void
        value: GridCell
        target: Rectangle
        onFinishedEditing: (newValue?: GridCell, movement?: readonly [-1 | 0 | 1, -1 | 0 | 1]) => void
      }) => {
        const v = p.value
        if (v.kind !== GridCellKind.Custom || !isHandyWsData(v.data)) return null
        return (
          <HandyWsFieldOverlayEditor
            target={p.target}
            rowPx={rowPx}
            onChange={p.onChange}
            onFinishedEditing={p.onFinishedEditing}
            value={v as CustomCell<HandyWsCustomData>}
          />
        )
      },
    }
  }
}
