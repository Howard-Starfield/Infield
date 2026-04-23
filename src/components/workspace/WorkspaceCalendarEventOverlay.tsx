/**
 * Compact floating edit panel — anchored near the right-clicked event chip.
 * Shown in place of the modal when the user chooses "Edit" from the context menu.
 * Shares save/delete logic with WorkspaceCalendarEventModal.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CalendarEventExternal } from '@schedule-x/calendar'
import type { Field } from '../../types/workspace'
import { workspaceFloatingZ } from '@/lib/workspaceFloatingLayer'
import { CT } from './calendarTheme'

function isZonedDateTime(
  v: Temporal.ZonedDateTime | Temporal.PlainDate,
): v is Temporal.ZonedDateTime {
  return typeof (v as Temporal.ZonedDateTime).timeZoneId === 'string'
}

function zdtToDatetimeLocalValue(zdt: Temporal.ZonedDateTime): string {
  const p = zdt.toPlainDateTime()
  const y = String(p.year).padStart(4, '0')
  const mo = String(p.month).padStart(2, '0')
  const d = String(p.day).padStart(2, '0')
  const h = String(p.hour).padStart(2, '0')
  const mi = String(p.minute).padStart(2, '0')
  return `${y}-${mo}-${d}T${h}:${mi}`
}

function datetimeLocalToZoned(value: string, timeZone: string): Temporal.ZonedDateTime {
  const plain = Temporal.PlainDateTime.from(value)
  return plain.toZonedDateTime(timeZone)
}

function plainDateToInput(pd: Temporal.PlainDate): string {
  const y = String(pd.year).padStart(4, '0')
  const mo = String(pd.month).padStart(2, '0')
  const d = String(pd.day).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

function inputToPlainDate(value: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(value)
}

export type CalendarEventSavePayload = {
  startIso: string
  endIso?: string
}

interface Props {
  event: CalendarEventExternal | null
  anchorX: number
  anchorY: number
  dateField: Field
  endDateField?: Field
  primaryField: Field | undefined
  onClose: () => void
  onSaveTitleAndTime: (rowId: string, title: string, payload: CalendarEventSavePayload) => Promise<void>
  onDeleteRow: (rowId: string) => Promise<void>
}

export function WorkspaceCalendarEventOverlay({
  event,
  anchorX,
  anchorY,
  dateField,
  endDateField,
  primaryField,
  onClose,
  onSaveTitleAndTime,
  onDeleteRow,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState('')
  const [timeLocal, setTimeLocal] = useState('')
  const [endTimeLocal, setEndTimeLocal] = useState('')
  const [dateOnly, setDateOnly] = useState('')
  const [saving, setSaving] = useState(false)
  const [pos, setPos] = useState({ left: anchorX, top: anchorY + 2 })

  const tz = Temporal.Now.timeZoneId()

  useEffect(() => {
    if (!event) return
    setTitle(event.title ?? '')
    if (dateField.field_type === 'date_time' && isZonedDateTime(event.start)) {
      setTimeLocal(zdtToDatetimeLocalValue(event.start))
      if (endDateField && isZonedDateTime(event.end)) {
        setEndTimeLocal(zdtToDatetimeLocalValue(event.end))
      } else {
        setEndTimeLocal('')
      }
    } else if (dateField.field_type === 'date') {
      const pd = isZonedDateTime(event.start) ? event.start.toPlainDate() : (event.start as Temporal.PlainDate)
      setDateOnly(plainDateToInput(pd))
    }
  }, [event, dateField.field_type, endDateField])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pad = 8
    let left = anchorX
    let top = anchorY + 2
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad)
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, anchorY - rect.height - pad)
    }
    setPos({ left, top })
  }, [anchorX, anchorY])

  const handleSave = useCallback(async () => {
    if (!event) return
    setSaving(true)
    try {
      if (dateField.field_type === 'date_time') {
        const startZ = datetimeLocalToZoned(timeLocal, tz)
        const startIso = new Date(Number(startZ.toInstant().epochMilliseconds)).toISOString()
        let endIso: string | undefined
        if (endDateField) {
          let endZ: Temporal.ZonedDateTime
          if (endTimeLocal.trim()) {
            endZ = datetimeLocalToZoned(endTimeLocal, tz)
          } else if (isZonedDateTime(event.end)) {
            endZ = event.end
          } else {
            endZ = startZ.add({ hours: 1 })
          }
          if (Temporal.Instant.compare(endZ.toInstant(), startZ.toInstant()) <= 0) {
            endZ = startZ.add({ hours: 1 })
          }
          endIso = new Date(Number(endZ.toInstant().epochMilliseconds)).toISOString()
        }
        await onSaveTitleAndTime(String(event.id), title.trim() || 'Untitled', { startIso, endIso })
      } else {
        const pd = inputToPlainDate(dateOnly)
        const startIso = new Date(pd.year, pd.month - 1, pd.day).toISOString()
        await onSaveTitleAndTime(String(event.id), title.trim() || 'Untitled', { startIso })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }, [event, dateField.field_type, timeLocal, endTimeLocal, dateOnly, title, tz, endDateField, onSaveTitleAndTime, onClose])

  const handleDelete = useCallback(async () => {
    if (!event) return
    if (!confirm('Delete this row?')) return
    setSaving(true)
    try {
      await onDeleteRow(String(event.id))
      onClose()
    } finally {
      setSaving(false)
    }
  }, [event, onDeleteRow, onClose])

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

  if (!event) return null

  const overlayZ = Number.parseInt(workspaceFloatingZ(), 10) || 12001

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Edit event"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        zIndex: overlayZ,
        width: 280,
        borderRadius: CT.radius_panel,
        border: '1px solid var(--workspace-border)',
        background: 'var(--workspace-bg)',
        boxShadow: 'var(--workspace-shadow)',
        padding: 12,
        fontFamily: CT.font,
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: CT.size_sidebarTitle, fontWeight: CT.weight_title, color: 'var(--workspace-text)' }}>Edit event</span>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          aria-label="Close"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--workspace-text-muted)',
            fontSize: 14,
            lineHeight: 1,
            padding: '2px 4px',
          }}
        >
          ×
        </button>
      </div>

      {/* Title */}
      {primaryField ? (
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Event title"
          style={{
            display: 'block',
            width: '100%',
            marginBottom: 8,
            padding: '7px 9px',
            borderRadius: CT.radius_input,
            border: '1px solid var(--workspace-border)',
            background: 'var(--workspace-bg)',
            color: 'var(--workspace-text)',
            fontSize: 12,
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
      ) : null}

      {/* Date/time fields */}
      {dateField.field_type === 'date_time' ? (
        <>
          <label style={{ display: 'block', fontSize: 10, color: 'var(--workspace-text-muted)', marginBottom: 6 }}>
            Start
            <input
              type="datetime-local"
              value={timeLocal}
              onChange={e => setTimeLocal(e.target.value)}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 3,
                padding: '6px 8px',
                borderRadius: CT.radius_input,
                border: '1px solid var(--workspace-border)',
                background: 'var(--workspace-bg)',
                color: 'var(--workspace-text)',
                fontSize: 12,
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </label>
          {endDateField ? (
            <label style={{ display: 'block', fontSize: 10, color: 'var(--workspace-text-muted)', marginBottom: 8 }}>
              End ({endDateField.name})
              <input
                type="datetime-local"
                value={endTimeLocal}
                onChange={e => setEndTimeLocal(e.target.value)}
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 3,
                  padding: '6px 8px',
                  borderRadius: CT.radius_input,
                  border: '1px solid var(--workspace-border)',
                  background: 'var(--workspace-bg)',
                  color: 'var(--workspace-text)',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </label>
          ) : null}
        </>
      ) : (
        <label style={{ display: 'block', fontSize: 10, color: 'var(--workspace-text-muted)', marginBottom: 8 }}>
          Date
          <input
            type="date"
            value={dateOnly}
            onChange={e => setDateOnly(e.target.value)}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 3,
              padding: '6px 8px',
              borderRadius: CT.radius_input,
              border: '1px solid var(--workspace-border)',
              background: 'var(--workspace-bg)',
              color: 'var(--workspace-text)',
              fontSize: 12,
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </label>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 4 }}>
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={saving}
          style={{
            padding: '5px 10px',
            borderRadius: CT.radius_input,
            border: '1px solid color-mix(in srgb, #c62828 35%, transparent)',
            background: 'transparent',
            color: '#c62828',
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          style={{
            padding: '5px 12px',
            borderRadius: CT.radius_input,
            border: 'none',
            background: 'var(--workspace-accent)',
            color: 'var(--workspace-bg)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
