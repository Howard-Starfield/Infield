import type { CalendarApp, CalendarEventExternal } from '@schedule-x/calendar'
import { viewDay, viewMonthGrid, viewWeek } from '@schedule-x/calendar'
import { ScheduleXCalendar, useCalendarApp } from '@schedule-x/react'
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { CALENDAR_PX_PER_MINUTE, CALENDAR_DAY_BOUNDARIES, CALENDAR_GRID_HEIGHT, CALENDAR_GRID_STEP, CALENDAR_TIME_AXIS_FORMAT } from './calendarTimeGridScale'
import { CALENDAR_SNAP_MIN as SNAP_MIN, snapZonedToSlotMinutes as snapZdt } from './calendarSlotSnap'
import { WorkspaceTimeGridEvent } from './WorkspaceTimeGridEvent'
import { useWorkspaceCalendarInteraction } from './workspaceCalendarInteractionContext'

/** Matches Schedule-X `CalendarAppSingleton` fields used to mirror date-picker + range state. */
type ScheduleXAppShell = {
  datePickerState: {
    selectedDate: { value: Temporal.PlainDate }
    datePickerDate: { value: Temporal.PlainDate }
  }
  calendarState: { setRange: (d: Temporal.PlainDate) => void }
}

/** Week/day time cells use `data-time-grid-date`; month grid and week headers use `data-date` (YYYY-MM-DD). */
export function plainDateFromScheduleXDomTarget(target: EventTarget | null, fallback: Temporal.PlainDate): Temporal.PlainDate {
  const el = target instanceof Element ? target : null
  if (!el) return fallback
  const timeGrid = el.closest('[data-time-grid-date]')
  if (timeGrid) {
    const raw = timeGrid.getAttribute('data-time-grid-date')
    if (raw) {
      try {
        return Temporal.PlainDate.from(raw)
      } catch {
        /* ignore */
      }
    }
  }
  const dated = el.closest('[data-date]')
  if (dated) {
    const raw = dated.getAttribute('data-date')
    if (raw) {
      try {
        return Temporal.PlainDate.from(raw)
      } catch {
        /* ignore */
      }
    }
  }
  return fallback
}

/** `useCalendarApp` only applies config on first mount; keep week/day in sync when sidebar date changes without remounting. */
function syncScheduleXSelectedPlainDate(calendar: CalendarApp, selectedPlainDate: Temporal.PlainDate) {
  const $app = (calendar as unknown as { $app?: ScheduleXAppShell }).$app
  if (!$app) return
  const cur = $app.datePickerState.selectedDate.value
  if (Temporal.PlainDate.compare(selectedPlainDate, cur) === 0) return
  $app.datePickerState.selectedDate.value = selectedPlainDate
  $app.datePickerState.datePickerDate.value = selectedPlainDate
  $app.calendarState.setRange(selectedPlainDate)
}

const MIN_DRAG_PX = 6
/** Delay single-click create so double-click does not create two rows (ms). */
const SLOT_SINGLE_CLICK_MS = 280

interface Props {
  selectedPlainDate: Temporal.PlainDate
  onCalendarSelectedDate: (d: Temporal.PlainDate) => void
  events: CalendarEventExternal[]
  calendarAppRef: MutableRefObject<CalendarApp | null>
  dateFieldType: 'date' | 'date_time'
  onCreateTimedRange: (start: Temporal.ZonedDateTime, end: Temporal.ZonedDateTime) => Promise<void>
  onDoubleClickDate: (d: Temporal.PlainDate) => void
  onDoubleClickDateTime: (dt: Temporal.ZonedDateTime) => void
  /** Single-click empty slot (debounced; skipped when user double-clicks). */
  onSingleClickDateTime?: (dt: Temporal.ZonedDateTime) => void
  onSingleClickDate?: (d: Temporal.PlainDate) => void
  onEventUpdate: (e: CalendarEventExternal) => void
  onEventClick: (e: CalendarEventExternal, nativeEvent: UIEvent) => void
}

export function WorkspaceCalendarScheduleBody({
  selectedPlainDate,
  onCalendarSelectedDate,
  events,
  calendarAppRef,
  dateFieldType,
  onCreateTimedRange,
  onDoubleClickDate,
  onDoubleClickDateTime,
  onSingleClickDateTime,
  onSingleClickDate,
  onEventUpdate,
  onEventClick,
}: Props) {
  const { openGridContextMenu } = useWorkspaceCalendarInteraction()
  const dateFieldTypeRef = useRef(dateFieldType)
  dateFieldTypeRef.current = dateFieldType
  const singleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearPendingSingleClick = () => {
    if (singleClickTimerRef.current) {
      clearTimeout(singleClickTimerRef.current)
      singleClickTimerRef.current = null
    }
  }
  const [draft, setDraft] = useState<CalendarEventExternal | null>(null)
  const dragRef = useRef<{
    start: Temporal.ZonedDateTime
    startY: number
  } | null>(null)
  const rangeRef = useRef<{ start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime } | null>(null)

  const cleanupRef = useRef<(() => void) | null>(null)

  const endDragCreate = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    const r = rangeRef.current
    dragRef.current = null
    rangeRef.current = null
    setDraft(null)
    if (!r) return
    const durMs = Number(r.end.toInstant().epochMilliseconds) - Number(r.start.toInstant().epochMilliseconds)
    if (durMs >= SNAP_MIN * 60 * 1000) {
      void onCreateTimedRange(r.start, r.end)
    }
  }, [onCreateTimedRange])

  const onPointerMoveDrag = useCallback((ev: Pick<PointerEvent, 'clientY'>) => {
    const d = dragRef.current
    if (!d) return
    const dy = ev.clientY - d.startY
    if (Math.abs(dy) < MIN_DRAG_PX) {
      rangeRef.current = null
      setDraft(null)
      return
    }
    const deltaMin = Math.round((dy * CALENDAR_PX_PER_MINUTE) / SNAP_MIN) * SNAP_MIN
    const end = d.start.add({ minutes: Math.max(SNAP_MIN, deltaMin) })
    const snappedEnd = snapZdt(end)
    rangeRef.current = { start: d.start, end: snappedEnd }
    setDraft({
      id: '__draft_range',
      title: 'New event',
      start: d.start,
      end: snappedEnd,
    })
  }, [])

  const onMouseUp = useCallback(() => {
    endDragCreate()
  }, [endDragCreate])

  const onMouseDownDateTime = useCallback(
    (dt: Temporal.ZonedDateTime, e: MouseEvent) => {
      if (dateFieldType !== 'date_time') return
      if (e.button !== 0) return
      const start = snapZdt(dt)
      const startY = e.clientY
      rangeRef.current = null
      setDraft(null)
      dragRef.current = null

      /** Do not arm drag until the pointer moves; otherwise the first mousedown of a double-click blocks creating an event. */
      const removeArm = () => {
        window.removeEventListener('pointermove', onMoveArm)
        window.removeEventListener('pointerup', onUpOrCancelArm)
        window.removeEventListener('pointercancel', onUpOrCancelArm)
      }

      const onMoveArm = (ev: PointerEvent) => {
        if (Math.abs(ev.clientY - startY) < MIN_DRAG_PX) return
        removeArm()
        dragRef.current = { start, startY }
        const move = (me: PointerEvent) => onPointerMoveDrag(me)
        const upOrCancel = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', upOrCancel)
          window.removeEventListener('pointercancel', upOrCancel)
          onMouseUp()
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', upOrCancel)
        window.addEventListener('pointercancel', upOrCancel)
        cleanupRef.current = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', upOrCancel)
          window.removeEventListener('pointercancel', upOrCancel)
        }
        onPointerMoveDrag(ev)
      }

      const onUpOrCancelArm = () => {
        removeArm()
        cleanupRef.current = null
      }

      cleanupRef.current = removeArm
      window.addEventListener('pointermove', onMoveArm)
      window.addEventListener('pointerup', onUpOrCancelArm, { once: true })
      window.addEventListener('pointercancel', onUpOrCancelArm, { once: true })
    },
    [dateFieldType, onPointerMoveDrag, onMouseUp],
  )

  useEffect(
    () => () => {
      cleanupRef.current?.()
      clearPendingSingleClick()
    },
    [],
  )

  const mergedEvents = useMemo(() => {
    if (!draft) return events
    return [...events.filter(e => String(e.id) !== '__draft_range'), draft]
  }, [draft, events])

  const singleClickPropsRef = useRef({ onSingleClickDateTime, onSingleClickDate })
  singleClickPropsRef.current = { onSingleClickDateTime, onSingleClickDate }

  const callbacksRef = useRef({
    onEventUpdate,
    onDoubleClickDate,
    onDoubleClickDateTime,
    onEventClick,
    onMouseDownDateTime,
    onCalendarSelectedDate,
  })
  callbacksRef.current = {
    onEventUpdate,
    onDoubleClickDate,
    onDoubleClickDateTime,
    onEventClick,
    onMouseDownDateTime,
    onCalendarSelectedDate,
  }

  const calendar = useCalendarApp({
    views: [viewWeek, viewMonthGrid, viewDay],
    defaultView: viewWeek.name,
    selectedDate: selectedPlainDate,
    locale: 'en-US',
    /** Must match `CalendarView.rowToCalendarEvent` (`Temporal.Now.timeZoneId()`); default Schedule-X is UTC and misaligns layout vs event labels. */
    timezone: Temporal.Now.timeZoneId(),
    dayBoundaries: CALENDAR_DAY_BOUNDARIES,
    weekOptions: {
      gridHeight: CALENDAR_GRID_HEIGHT,
      gridStep: CALENDAR_GRID_STEP,
      timeAxisFormatOptions: CALENDAR_TIME_AXIS_FORMAT,
    },
    events: [],
    callbacks: {
      onSelectedDateUpdate: d => {
        callbacksRef.current.onCalendarSelectedDate(d)
      },
      onEventUpdate: e => {
        void callbacksRef.current.onEventUpdate(e)
      },
      onClickDate: (d, _e) => {
        if (dateFieldTypeRef.current !== 'date') return
        const fn = singleClickPropsRef.current.onSingleClickDate
        if (!fn) return
        clearPendingSingleClick()
        singleClickTimerRef.current = setTimeout(() => {
          singleClickTimerRef.current = null
          void fn(d)
        }, SLOT_SINGLE_CLICK_MS)
      },
      onClickDateTime: (dt, _e) => {
        if (dateFieldTypeRef.current !== 'date_time') return
        const fn = singleClickPropsRef.current.onSingleClickDateTime
        if (!fn) return
        clearPendingSingleClick()
        singleClickTimerRef.current = setTimeout(() => {
          singleClickTimerRef.current = null
          void fn(dt)
        }, SLOT_SINGLE_CLICK_MS)
      },
      onDoubleClickDate: (d, _e) => {
        clearPendingSingleClick()
        void callbacksRef.current.onDoubleClickDate(d)
      },
      onDoubleClickDateTime: (dt, _e) => {
        clearPendingSingleClick()
        if (dateFieldTypeRef.current === 'date') {
          void callbacksRef.current.onDoubleClickDate(dt.toPlainDate())
        } else {
          void callbacksRef.current.onDoubleClickDateTime(dt)
        }
      },
      onEventClick: (ev, e) => {
        callbacksRef.current.onEventClick(ev, e)
      },
      onMouseDownDateTime: (dt, e) => {
        callbacksRef.current.onMouseDownDateTime(dt, e)
      },
    },
  })

  useEffect(() => {
    calendarAppRef.current = calendar
    return () => {
      calendarAppRef.current = null
    }
  }, [calendar, calendarAppRef])

  useEffect(() => {
    if (!calendar) return
    calendar.events.set(mergedEvents)
  }, [calendar, mergedEvents])

  useEffect(() => {
    if (!calendar) return
    syncScheduleXSelectedPlainDate(calendar, selectedPlainDate)
  }, [calendar, selectedPlainDate])

  if (!calendar) return null

  const onWrapperContextMenu = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-cal-event]')) return
    e.preventDefault()
    const plain = plainDateFromScheduleXDomTarget(e.target, selectedPlainDate)
    openGridContextMenu(e.clientX, e.clientY, plain)
  }

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }} onContextMenu={onWrapperContextMenu}>
      <ScheduleXCalendar
        calendarApp={calendar}
        customComponents={{
          timeGridEvent: WorkspaceTimeGridEvent,
        }}
      />
    </div>
  )
}
