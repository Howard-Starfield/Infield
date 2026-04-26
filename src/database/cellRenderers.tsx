/**
 * cellRenderers — six per-field-type cell components consumed by the W4
 * Table and Board views. All plain DOM (no canvas), CSS classes only.
 *
 * Components:
 *   - TextCell        (rich_text, typing-debounced)
 *   - NumberCell      (number, typing-debounced)
 *   - DateCell        (date, immediate)
 *   - SelectCell      (single_select / multi_select, immediate; popover lands in E-3)
 *   - CheckboxCell    (checkbox, immediate)
 *   - UnsupportedCell (read-only fallback for the 8 deferred field types)
 *
 * CSS class names referenced here are defined in `src/styles/databases.css`
 * (created in Commit D). Token-only styling per Rule 12 — the only inline
 * style values are data-driven (e.g. option color), never design constants.
 */

import { useEffect, useRef, useState } from 'react'
import type { CellData, Field, SelectOption } from '../bindings'
import { DatabaseSelectPopover } from '../components/DatabaseSelectPopover'
import type { MutationKind } from './useDatabase'

interface BaseCellProps {
  fieldId: string
  rowId: string
  readOnly?: boolean
}

// ---------- TextCell ----------

export interface TextCellProps extends BaseCellProps {
  value: string | null
  onChange: (newValue: string, kind: MutationKind) => void
}

export function TextCell({ value, onChange, readOnly }: TextCellProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  // Sync external updates (server pushes / undo) into the contenteditable
  // node, but only when the value diverges to avoid clobbering the caret.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const text = value ?? ''
    if (el.textContent !== text) el.textContent = text
  }, [value])

  return (
    <div
      ref={ref}
      className="db-cell-text"
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-readonly={readOnly || undefined}
      onInput={e => {
        if (readOnly) return
        const next = (e.currentTarget.textContent ?? '')
        onChange(next, 'typing')
      }}
    />
  )
}

// ---------- NumberCell ----------

export interface NumberCellProps extends BaseCellProps {
  value: number | null
  onChange: (newValue: number | null, kind: MutationKind) => void
}

export function NumberCell({ value, onChange, readOnly }: NumberCellProps) {
  // Local mirror so the user can type intermediate states ("-", "1.").
  const [draft, setDraft] = useState<string>(value == null ? '' : String(value))

  useEffect(() => {
    setDraft(value == null ? '' : String(value))
  }, [value])

  return (
    <input
      className="db-cell-number"
      type="number"
      value={draft}
      readOnly={readOnly}
      onChange={e => {
        const raw = e.target.value
        setDraft(raw)
        if (readOnly) return
        if (raw === '') {
          onChange(null, 'typing')
          return
        }
        const parsed = Number(raw)
        if (Number.isFinite(parsed)) onChange(parsed, 'typing')
      }}
    />
  )
}

// ---------- DateCell ----------

export interface DateCellProps extends BaseCellProps {
  /** Unix timestamp in milliseconds, or null. */
  value: number | null
  onChange: (newValue: number | null, kind: MutationKind) => void
}

function tsToInputDate(ts: number | null): string {
  if (ts == null) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const yyyy = d.getFullYear().toString().padStart(4, '0')
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function inputDateToTs(value: string): number | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(n => parseInt(n, 10))
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d).getTime()
}

export function DateCell({ value, onChange, readOnly }: DateCellProps) {
  const inputValue = tsToInputDate(value)
  return (
    <label className="db-cell-date">
      <span className="db-cell-date__pill">
        {inputValue || 'Pick date'}
      </span>
      <input
        className="db-cell-date__input"
        type="date"
        value={inputValue}
        readOnly={readOnly}
        onChange={e => {
          if (readOnly) return
          onChange(inputDateToTs(e.target.value), 'immediate')
        }}
      />
    </label>
  )
}

// ---------- SelectCell ----------

export interface SelectCellProps extends BaseCellProps {
  /** Single id (single_select) or array of ids (multi_select). */
  value: string | string[] | null
  /** Always supplied — needed for option name + color lookup. */
  field: Field
  /** Pass the new value with the same shape as `value` for the caller's CellData. */
  onChange: (newValue: string | string[] | null, kind: MutationKind) => void
}

function optionsFor(field: Field): SelectOption[] {
  const t = field.type_option
  if (t.type === 'single_select' || t.type === 'multi_select') return t.config.options
  return []
}

/**
 * Renders selected option pills inline; clicking the trigger opens
 * `DatabaseSelectPopover` anchored to the trigger element. Single-select
 * mode emits a string; multi-select emits a string[]. The popover closes
 * itself in single mode after pick, and on outside click in multi mode.
 */
export function SelectCell({ value, field, onChange, readOnly }: SelectCellProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const options = optionsFor(field)
  const isMulti = field.field_type === 'multi_select'
  const selectedIds: string[] = Array.isArray(value) ? value : value ? [value] : []
  const selected = selectedIds
    .map(id => options.find(o => o.id === id))
    .filter((o): o is SelectOption => Boolean(o))

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="db-cell-select-trigger"
        disabled={readOnly}
        aria-label={field.name}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (readOnly) return
          setOpen(o => !o)
        }}
      >
        {selected.length === 0 ? (
          <span className="db-cell-select-empty">Select…</span>
        ) : (
          selected.map(o => (
            <span
              key={o.id}
              className="db-cell-select-pill"
              // Color is data-driven, not a design constant — Rule 12 carve-out.
              style={{ background: `var(--select-color-${o.color})` }}
            >
              {o.name}
            </span>
          ))
        )}
      </button>
      {open && !readOnly && (
        <DatabaseSelectPopover
          options={options}
          value={isMulti ? selectedIds : selectedIds[0] ?? ''}
          multi={isMulti}
          onChange={next => {
            // Pass the value back in the same shape the dispatcher expects:
            // string for single_select, string[] for multi_select.
            onChange(next, 'immediate')
          }}
          onClose={() => setOpen(false)}
          referenceElement={triggerRef.current}
        />
      )}
    </>
  )
}

// ---------- CheckboxCell ----------

export interface CheckboxCellProps extends BaseCellProps {
  value: boolean | null
  onChange: (newValue: boolean, kind: MutationKind) => void
}

export function CheckboxCell({ value, onChange, readOnly }: CheckboxCellProps) {
  return (
    <input
      className="db-cell-checkbox"
      type="checkbox"
      checked={Boolean(value)}
      readOnly={readOnly}
      disabled={readOnly}
      onChange={e => {
        if (readOnly) return
        onChange(e.target.checked, 'immediate')
      }}
    />
  )
}

// ---------- UnsupportedCell ----------

export interface UnsupportedCellProps extends BaseCellProps {
  cell: CellData | null
}

export function UnsupportedCell({ cell }: UnsupportedCellProps) {
  const summary = summarizeUnsupported(cell)
  return (
    <span
      className="db-cell-unsupported"
      title="Field type not supported in W4"
      aria-label="Field type not supported in W4"
    >
      {summary}
    </span>
  )
}

function summarizeUnsupported(cell: CellData | null): string {
  if (!cell) return '—'
  switch (cell.type) {
    case 'url':
      return cell.value
    case 'checklist':
      return `${cell.value.length} item${cell.value.length === 1 ? '' : 's'}`
    case 'last_edited_time':
    case 'created_time':
    case 'date_time':
      return new Date(cell.value).toLocaleString()
    case 'time':
      return `${cell.value}s`
    case 'media':
      return `${cell.value.length} file${cell.value.length === 1 ? '' : 's'}`
    case 'protected':
      return '••••••'
    default:
      return '—'
  }
}
