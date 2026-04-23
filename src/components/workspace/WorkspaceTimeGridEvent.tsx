import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CalendarEventExternal } from '@schedule-x/calendar'
import { CALENDAR_PX_PER_MINUTE } from './calendarTimeGridScale'
import { CALENDAR_SNAP_MIN as SNAP_MIN, snapZonedToSlotMinutes as snapZdt } from './calendarSlotSnap'
import { useWorkspaceCalendarInteraction } from './workspaceCalendarInteractionContext'
import { CT } from './calendarTheme'

function isZonedDateTime(
  v: Temporal.ZonedDateTime | Temporal.PlainDate,
): v is Temporal.ZonedDateTime {
  return typeof (v as Temporal.ZonedDateTime).timeZoneId === 'string'
}

function toExternal(raw: CalendarEventExternal & { _getExternalEvent?: () => CalendarEventExternal }): CalendarEventExternal {
  return raw._getExternalEvent?.() ?? raw
}

function formatZonedRange(start: Temporal.ZonedDateTime, end: Temporal.ZonedDateTime): string {
  const o: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true }
  return `${start.toLocaleString('en-US', o)} – ${end.toLocaleString('en-US', o)}`
}

const RESIZE_HIT_PX = 5 // compact hit target

/** MIT-only: drag-move, bottom-edge resize (when End column exists), context menu. */
export function WorkspaceTimeGridEvent({ calendarEvent }: { calendarEvent: CalendarEventExternal }) {
  const {
    persistEventUpdate,
    calendarAppRef,
    fieldType,
    openEventEditor,
    hasEndField,
    openEventContextMenu,
  } = useWorkspaceCalendarInteraction()
  const dragRef = useRef<{ startY: number; orig: CalendarEventExternal } | null>(null)
  const resizeRef = useRef<{ startY: number; orig: CalendarEventExternal } | null>(null)

  const external = toExternal(calendarEvent)

  const clearWindowListeners = useRef<(() => void) | null>(null)

  const [dragHud, setDragHud] = useState<{
    pointerX: number
    pointerY: number
    label: string
    /** Clamped so the hairline never leaves the column. */
    clampedY: number
  } | null>(null)

  const endDrag = useCallback(async () => {
    setDragHud(null)
    clearWindowListeners.current?.()
    clearWindowListeners.current = null
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    const cal = calendarAppRef.current
    const cur = cal?.events.get(String(external.id))
    if (cur) await persistEventUpdate(cur)
  }, [calendarAppRef, external.id, persistEventUpdate])

  const endResize = useCallback(async () => {
    setDragHud(null)
    clearWindowListeners.current?.()
    clearWindowListeners.current = null
    const d = resizeRef.current
    resizeRef.current = null
    if (!d) return
    const cal = calendarAppRef.current
    const cur = cal?.events.get(String(external.id))
    if (cur) await persistEventUpdate(cur)
  }, [calendarAppRef, external.id, persistEventUpdate])

  const updateDragHudFromStore = useCallback(
    (ev: PointerEvent, clampedY: number) => {
      const cur = calendarAppRef.current?.events.get(String(external.id))
      if (!cur || !isZonedDateTime(cur.start) || !isZonedDateTime(cur.end)) {
        setDragHud({ pointerX: ev.clientX, pointerY: ev.clientY, label: '', clampedY })
        return
      }
      setDragHud({
        pointerX: ev.clientX,
        pointerY: ev.clientY,
        label: formatZonedRange(cur.start, cur.end),
        clampedY,
      })
    },
    [calendarAppRef, external.id],
  )

  const onPointerMove = useCallback(
    (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d || fieldType !== 'date_time') return
      const orig = d.orig
      if (!isZonedDateTime(orig.start) || !isZonedDateTime(orig.end)) return
      const dy = ev.clientY - d.startY
      const deltaMin = Math.round((dy * CALENDAR_PX_PER_MINUTE) / SNAP_MIN) * SNAP_MIN
      const deltaMs = deltaMin * 60 * 1000
      const ns = Number(orig.start.toInstant().epochMilliseconds) + deltaMs
      const ne = Number(orig.end.toInstant().epochMilliseconds) + deltaMs
      const tz = orig.start.timeZoneId
      const start = snapZdt(Temporal.Instant.fromEpochMilliseconds(ns).toZonedDateTimeISO(tz))
      const end = snapZdt(Temporal.Instant.fromEpochMilliseconds(ne).toZonedDateTimeISO(tz))
      calendarAppRef.current?.events.update({ ...orig, start, end })
      // Clamp to calendar column (page coords), not viewport
      const el = (ev.target as Element)?.closest('.sx__time-grid-day')
      if (el) {
        const rect = el.getBoundingClientRect()
        const clampedY = Math.max(rect.top, Math.min(rect.bottom, ev.clientY))
        updateDragHudFromStore(ev, clampedY)
      } else {
        updateDragHudFromStore(ev, ev.clientY)
      }
    },
    [calendarAppRef, fieldType, updateDragHudFromStore],
  )

  const onResizePointerMove = useCallback(
    (ev: PointerEvent) => {
      const d = resizeRef.current
      if (!d || fieldType !== 'date_time' || !hasEndField) return
      const orig = d.orig
      if (!isZonedDateTime(orig.start) || !isZonedDateTime(orig.end)) return
      const dy = ev.clientY - d.startY
      const deltaMin = Math.round((dy * CALENDAR_PX_PER_MINUTE) / SNAP_MIN) * SNAP_MIN
      const deltaMs = deltaMin * 60 * 1000
      const ne = Number(orig.end.toInstant().epochMilliseconds) + deltaMs
      const tz = orig.end.timeZoneId
      let end = snapZdt(Temporal.Instant.fromEpochMilliseconds(ne).toZonedDateTimeISO(tz))
      const start = orig.start
      const minEnd = start.add({ minutes: SNAP_MIN })
      if (Temporal.Instant.compare(end.toInstant(), minEnd.toInstant()) < 0) {
        end = minEnd
      }
      calendarAppRef.current?.events.update({ ...orig, start, end })
      const el = (ev.target as Element)?.closest('.sx__time-grid-day')
      if (el) {
        const rect = el.getBoundingClientRect()
        const clampedY = Math.max(rect.top, Math.min(rect.bottom, ev.clientY))
        updateDragHudFromStore(ev, clampedY)
      } else {
        updateDragHudFromStore(ev, ev.clientY)
      }
    },
    [calendarAppRef, fieldType, hasEndField, updateDragHudFromStore],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    if (fieldType !== 'date_time') return
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-cal-resize]')) return
    if (!isZonedDateTime(external.start) || !isZonedDateTime(external.end)) return
    dragRef.current = { startY: e.clientY, orig: { ...external } }
    const move = (ev: PointerEvent) => onPointerMove(ev)
    const up = () => {
      window.removeEventListener('pointermove', move)
      void endDrag()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    window.addEventListener('pointercancel', up, { once: true })
    clearWindowListeners.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (fieldType !== 'date_time' || !hasEndField) return
    if (e.button !== 0) return
    if (!isZonedDateTime(external.start) || !isZonedDateTime(external.end)) return
    resizeRef.current = { startY: e.clientY, orig: { ...external } }
    const move = (ev: PointerEvent) => onResizePointerMove(ev)
    const up = () => {
      window.removeEventListener('pointermove', move)
      void endResize()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    window.addEventListener('pointercancel', up, { once: true })
    clearWindowListeners.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }

  useEffect(
    () => () => {
      clearWindowListeners.current?.()
    },
    [],
  )

  const onContextMenu = (e: React.MouseEvent) => {
    if (String(external.id) === '__draft_range') return
    e.preventDefault()
    e.stopPropagation()
    openEventContextMenu(e.clientX, e.clientY, external)
  }

  const isDraft = String(external.id) === '__draft_range'

  const hud =
    dragHud &&
    createPortal(
      <>
        {/* Hairline: clamped to the column bounds (clampedY, not raw pointerY) */}
        <div
          aria-hidden
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            top: dragHud.clampedY,
            height: 1,
            pointerEvents: 'none',
            zIndex: 40,
            background: 'color-mix(in srgb, var(--workspace-accent) 75%, transparent)',
            boxShadow: '0 0 0 1px color-mix(in srgb, var(--workspace-accent) 25%, transparent)',
          }}
        />
        {dragHud.label ? (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: 'fixed',
              left:
                typeof window !== 'undefined'
                  ? Math.max(8, Math.min(dragHud.pointerX + 10, window.innerWidth - 208))
                  : dragHud.pointerX + 10,
              top: dragHud.clampedY + 14,
              maxWidth: 200,
              pointerEvents: 'none',
              zIndex: 41,
              padding: '3px 6px',
              borderRadius: 5,
              fontSize: 10,
              fontWeight: 500,
              lineHeight: 1.3,
              color: 'var(--workspace-text)',
              background: 'var(--workspace-bg)',
              border: '1px solid var(--workspace-border)',
              boxShadow: '0 4px 14px color-mix(in srgb, #000 12%, transparent)',
            }}
          >
            {dragHud.label}
          </div>
        ) : null}
      </>,
      document.body,
    )

  return (
    <>
      {hud}
      <div
        data-cal-event="1"
        data-cal-draft={isDraft ? '1' : undefined}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        style={{
          position: 'relative',
          height: '100%',
          borderRadius: CT.radius_event,
          overflow: 'hidden',
          border: isDraft
            ? '1px dashed color-mix(in srgb, var(--workspace-accent) 40%, var(--workspace-border))'
            : '1px solid color-mix(in srgb, var(--workspace-accent) 28%, var(--workspace-border))',
          background: isDraft
            ? 'color-mix(in srgb, var(--workspace-accent) 8%, var(--workspace-bg))'
            : 'color-mix(in srgb, var(--workspace-accent) 12%, var(--workspace-bg))',
          display: 'flex',
          flexDirection: 'column',
          cursor: fieldType === 'date_time' ? 'grab' : 'default',
          userSelect: 'none',
          padding: '2px 5px 2px 7px',
        }}
      >
        {/* Dot + title chip — no Edit button, no time subtitle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            minHeight: 0,
            flex: 1,
          }}
        >
          {/* Accent dot */}
          <div
            aria-hidden
            style={{
              flexShrink: 0,
              width: CT.dot_size,
              height: CT.dot_size,
              borderRadius: '50%',
              background: isDraft
                ? 'color-mix(in srgb, var(--workspace-accent) 45%, transparent)'
                : 'var(--workspace-accent)',
              marginTop: 1,
            }}
          />
          <div
            style={{
              fontWeight: CT.weight_title,
              fontSize: CT.size_chipTitle,
              lineHeight: 1.15,
              color: 'var(--workspace-text)',
              letterSpacing: 0.01,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {external.title || 'Untitled'}
          </div>
        </div>

        {hasEndField && fieldType === 'date_time' && !isDraft ? (
          <div
            data-cal-resize="1"
            onPointerDown={onResizePointerDown}
            style={{
              flexShrink: 0,
              height: RESIZE_HIT_PX,
              cursor: 'ns-resize',
              background: 'color-mix(in srgb, var(--workspace-accent) 10%, transparent)',
            }}
          />
        ) : null}
      </div>
    </>
  )
}
