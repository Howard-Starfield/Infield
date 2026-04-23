import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CalendarEventExternal } from '@schedule-x/calendar'
import type { Field } from '../../types/workspace'
import { workspaceModalZ } from '@/lib/workspaceFloatingLayer'

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
  /** Set when the database has a mapped End `date_time` column. */
  endIso?: string
}

interface Props {
  event: CalendarEventExternal | null
  dateField: Field
  /** When set, timed events persist start + end (Option A). */
  endDateField?: Field
  primaryField: Field | undefined
  onClose: () => void
  onSaveTitleAndTime: (rowId: string, title: string, payload: CalendarEventSavePayload) => Promise<void>
  onDeleteRow: (rowId: string) => Promise<void>
}

export function WorkspaceCalendarEventModal({
  event,
  dateField,
  endDateField,
  primaryField,
  onClose,
  onSaveTitleAndTime,
  onDeleteRow,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState('')
  const [timeLocal, setTimeLocal] = useState('')
  const [endTimeLocal, setEndTimeLocal] = useState('')
  const [dateOnly, setDateOnly] = useState('')
  const [saving, setSaving] = useState(false)

  const tz = Temporal.Now.timeZoneId()

  const tryBackdropClose = useCallback(
    (target: EventTarget | null) => {
      if (saving) return
      const node = target instanceof Node ? target : null
      const panel = contentRef.current
      if (!node || !panel) return
      if (panel.contains(node)) return
      onClose()
    },
    [onClose, saving],
  )

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

  if (!event) return null

  const modalZ = Number.parseInt(workspaceModalZ(), 10) || 12030

  const handleSave = async () => {
    setSaving(true)
    try {
      if (dateField.field_type === 'date_time') {
        const startZ = datetimeLocalToZoned(timeLocal, tz)
        let startIso = new Date(Number(startZ.toInstant().epochMilliseconds)).toISOString()
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
  }

  const handleDelete = async () => {
    if (!confirm('Delete this row?')) return
    setSaving(true)
    try {
      await onDeleteRow(String(event.id))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: modalZ,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(6px)',
      }}
      onPointerDown={e => {
        if (e.button !== 0) return
        tryBackdropClose(e.target)
      }}
    >
      <div
        ref={contentRef}
        style={{
          position: 'relative',
          zIndex: 1,
          width: 'min(400px, 100%)',
          borderRadius: 12,
          border: '1px solid var(--workspace-border)',
          background: 'var(--workspace-bg)',
          boxShadow: 'var(--workspace-shadow)',
          padding: 16,
          fontFamily: 'Space Grotesk, sans-serif',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--workspace-text)' }}>
          Event
        </div>
        {primaryField ? (
          <label style={{ display: 'block', fontSize: 11, color: 'var(--workspace-text-muted)', marginBottom: 8 }}>
            Title
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 4,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--workspace-border)',
                background: 'var(--workspace-bg)',
                color: 'var(--workspace-text)',
                fontSize: 13,
              }}
            />
          </label>
        ) : null}

        {dateField.field_type === 'date_time' ? (
          <>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--workspace-text-muted)', marginBottom: 12 }}>
              Start
              <input
                type="datetime-local"
                value={timeLocal}
                onChange={e => setTimeLocal(e.target.value)}
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 4,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--workspace-border)',
                  background: 'var(--workspace-bg)',
                  color: 'var(--workspace-text)',
                  fontSize: 13,
                }}
              />
            </label>
            {endDateField ? (
              <label style={{ display: 'block', fontSize: 11, color: 'var(--workspace-text-muted)', marginBottom: 12 }}>
                End ({endDateField.name})
                <input
                  type="datetime-local"
                  value={endTimeLocal}
                  onChange={e => setEndTimeLocal(e.target.value)}
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: 4,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--workspace-border)',
                    background: 'var(--workspace-bg)',
                    color: 'var(--workspace-text)',
                    fontSize: 13,
                  }}
                />
              </label>
            ) : null}
          </>
        ) : (
          <label style={{ display: 'block', fontSize: 11, color: 'var(--workspace-text-muted)', marginBottom: 12 }}>
            Date
            <input
              type="date"
              value={dateOnly}
              onChange={e => setDateOnly(e.target.value)}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 4,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--workspace-border)',
                background: 'var(--workspace-bg)',
                color: 'var(--workspace-text)',
                fontSize: 13,
              }}
            />
          </label>
        )}

        <p style={{ fontSize: 10, color: 'var(--workspace-text-soft)', margin: '0 0 12px' }}>
          Changes save to this database row (same as Grid view). Drag on the week grid to move timed events; duration
          is stored when an End column is mapped in the calendar toolbar.
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid var(--workspace-border)',
              background: 'transparent',
              color: 'var(--workspace-text-muted)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={saving}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid color-mix(in srgb, red 40%, transparent)',
              background: 'transparent',
              color: '#c62828',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--workspace-accent)',
              color: 'var(--workspace-bg)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
