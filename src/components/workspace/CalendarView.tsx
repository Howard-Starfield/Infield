import '@schedule-x/theme-default/dist/index.css'
import './calendarScheduleXOverrides.css'

import type { CalendarEventExternal } from '@schedule-x/calendar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import {
  parseDatabaseProperties,
  parseRowProperties,
  parseViewOptions,
  type Field,
  type NodeView,
  type WorkspaceNode,
} from '../../types/workspace'
import { snapZonedToSlotMinutes } from './calendarSlotSnap'
import { extractCellValue } from './GridCell'
import { WorkspaceCalendarAgendaSidebar } from './WorkspaceCalendarAgendaSidebar'
import { WorkspaceCalendarContextMenu } from './WorkspaceCalendarContextMenu'
import { WorkspaceCalendarEventOverlay } from './WorkspaceCalendarEventOverlay'
import { WorkspaceCalendarEventModal } from './WorkspaceCalendarEventModal'
import { WorkspaceCalendarScheduleBody } from './WorkspaceCalendarScheduleBody'
import {
  WorkspaceCalendarInteractionProvider,
  type WorkspaceCalendarInteraction,
} from './workspaceCalendarInteractionContext'

interface Props {
  databaseNode: WorkspaceNode
  viewId: string
  filteredRows: WorkspaceNode[]
  activeView: NodeView | undefined
}

function isZonedDateTime(
  v: Temporal.ZonedDateTime | Temporal.PlainDate,
): v is Temporal.ZonedDateTime {
  return typeof (v as Temporal.ZonedDateTime).timeZoneId === 'string'
}

function rowToCalendarEvent(
  row: WorkspaceNode,
  dateField: Field,
  endDateField: Field | undefined,
  primaryField: Field | undefined,
): CalendarEventExternal | null {
  const cells = parseRowProperties(row).cells ?? {}
  const raw = cells[dateField.id]
  const dateValue = extractCellValue(raw) as string | null | undefined
  if (!dateValue || typeof dateValue !== 'string') return null
  const d = new Date(dateValue)
  if (Number.isNaN(d.getTime())) return null

  const titleRaw = primaryField ? extractCellValue(cells[primaryField.id]) : undefined
  const title =
    (typeof titleRaw === 'string' ? titleRaw : titleRaw != null ? String(titleRaw) : '') ||
    row.name ||
    'Untitled'

  if (dateField.field_type === 'date') {
    const pd = Temporal.PlainDate.from({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
    })
    return { id: row.id, title, start: pd, end: pd }
  }

  const tz = Temporal.Now.timeZoneId()
  const zdtStart = Temporal.Instant.fromEpochMilliseconds(d.getTime()).toZonedDateTimeISO(tz)

  if (endDateField?.field_type === 'date_time' && endDateField.id !== dateField.id) {
    const rawEnd = cells[endDateField.id]
    const endVal = extractCellValue(rawEnd) as string | null | undefined
    if (endVal && typeof endVal === 'string') {
      const dEnd = new Date(endVal)
      if (!Number.isNaN(dEnd.getTime())) {
        const zdtEnd = Temporal.Instant.fromEpochMilliseconds(dEnd.getTime()).toZonedDateTimeISO(tz)
        if (Temporal.Instant.compare(zdtEnd.toInstant(), zdtStart.toInstant()) > 0) {
          return { id: row.id, title, start: zdtStart, end: zdtEnd }
        }
      }
    }
  }

  const end = zdtStart.add({ hours: 1 })
  return { id: row.id, title, start: zdtStart, end }
}

/** `view_options` historically used `calendarDateFieldId`; canonical key is `date_field_id`. */
function storedCalendarDateFieldId(viewOptions: Record<string, unknown>): string {
  const primary = viewOptions.date_field_id
  if (typeof primary === 'string' && primary.trim()) return primary.trim()
  const legacy = viewOptions.calendarDateFieldId
  if (typeof legacy === 'string' && legacy.trim()) return legacy.trim()
  return ''
}

/** Optional timed end column; legacy `calendarEndFieldId`. */
function storedCalendarEndFieldId(viewOptions: Record<string, unknown>): string {
  const v = viewOptions.end_field_id
  if (typeof v === 'string' && v.trim()) return v.trim()
  const legacy = viewOptions.calendarEndFieldId
  if (typeof legacy === 'string' && legacy.trim()) return legacy.trim()
  return ''
}

type CalendarContextMenuState =
  | { kind: 'event'; x: number; y: number; event: CalendarEventExternal; anchorX: number; anchorY: number }
  | { kind: 'grid'; x: number; y: number; plainDate: Temporal.PlainDate }

function eventStartToIso(
  start: Temporal.ZonedDateTime | Temporal.PlainDate,
  fieldType: Field['field_type'],
): string {
  if (fieldType === 'date') {
    if (isZonedDateTime(start)) {
      const plain = start.toPlainDate()
      return new Date(plain.year, plain.month - 1, plain.day).toISOString()
    }
    const pd = start as Temporal.PlainDate
    return new Date(pd.year, pd.month - 1, pd.day).toISOString()
  }
  if (isZonedDateTime(start)) {
    const ms = Number(start.toInstant().epochMilliseconds)
    return new Date(ms).toISOString()
  }
  const pd = start as Temporal.PlainDate
  return new Date(pd.year, pd.month - 1, pd.day).toISOString()
}

export function CalendarView({
  databaseNode,
  viewId,
  filteredRows,
  activeView,
}: Props) {
  const { loadNodeChildren, createNode, updateCell, updateView, deleteNode } = useWorkspaceStore()

  const databaseId = databaseNode.id

  useEffect(() => {
    void loadNodeChildren(databaseId)
  }, [databaseId, loadNodeChildren])

  const fields = useMemo(() => {
    return parseDatabaseProperties(databaseNode).fields.sort((a, b) => a.position - b.position)
  }, [databaseNode])

  const dateCandidates = useMemo(
    () => fields.filter(f => f.field_type === 'date' || f.field_type === 'date_time'),
    [fields],
  )

  const dateTimeCandidates = useMemo(() => fields.filter(f => f.field_type === 'date_time'), [fields])

  const viewOptions = useMemo(() => {
    if (!activeView) return {} as Record<string, unknown>
    try {
      return parseViewOptions(activeView)
    } catch {
      return {}
    }
  }, [activeView])

  const selectedDateFieldId = useMemo(
    () => storedCalendarDateFieldId(viewOptions),
    [viewOptions],
  )

  const selectedEndFieldId = useMemo(
    () => storedCalendarEndFieldId(viewOptions),
    [viewOptions],
  )

  const dateField = useMemo(() => {
    if (selectedDateFieldId) {
      const found = fields.find(f => f.id === selectedDateFieldId)
      if (found && (found.field_type === 'date' || found.field_type === 'date_time')) {
        return found
      }
    }
    return dateCandidates[0]
  }, [fields, dateCandidates, selectedDateFieldId])

  const endDateField = useMemo(() => {
    if (dateField?.field_type !== 'date_time') return undefined
    if (selectedEndFieldId) {
      const found = fields.find(f => f.id === selectedEndFieldId)
      if (found?.field_type === 'date_time' && found.id !== dateField.id) {
        return found
      }
    }
    return undefined
  }, [fields, dateField, selectedEndFieldId])

  const primaryField = useMemo(() => fields.find(f => f.is_primary), [fields])

  const databaseIdRef = useRef(databaseId)
  databaseIdRef.current = databaseId

  const dateFieldRef = useRef<Field | undefined>(undefined)
  dateFieldRef.current = dateField

  const endDateFieldRef = useRef<Field | undefined>(undefined)
  endDateFieldRef.current = endDateField

  const filteredRowsRef = useRef(filteredRows)
  filteredRowsRef.current = filteredRows

  const primaryFieldRef = useRef(primaryField)
  primaryFieldRef.current = primaryField

  const createNodeRef = useRef(createNode)
  createNodeRef.current = createNode

  const updateCellRef = useRef(updateCell)
  updateCellRef.current = updateCell

  const loadNodeChildrenRef = useRef(loadNodeChildren)
  loadNodeChildrenRef.current = loadNodeChildren

  const deleteNodeRef = useRef(deleteNode)
  deleteNodeRef.current = deleteNode

  const persistEventUpdateRef = useRef<(event: CalendarEventExternal) => Promise<void>>(async () => {})

  const [sidebarAnchorDate, setSidebarAnchorDate] = useState(() => Temporal.Now.plainDateISO())
  const [editorEvent, setEditorEvent] = useState<CalendarEventExternal | null>(null)
  const [overlayAnchor, setOverlayAnchor] = useState({ x: 0, y: 0 })
  const [contextMenu, setContextMenu] = useState<CalendarContextMenuState | null>(null)

  const callbacksRef = useRef({
    onEventUpdate: (_event: CalendarEventExternal) => {
      /* set below */
    },
    onDoubleClickDate: (_date: Temporal.PlainDate) => {
      /* set below */
    },
    onDoubleClickDateTime: (_dateTime: Temporal.ZonedDateTime) => {
      /* set below */
    },
  })

  callbacksRef.current.onEventUpdate = async (event: CalendarEventExternal) => {
    await persistEventUpdateRef.current(event)
  }

  callbacksRef.current.onDoubleClickDate = async (date: Temporal.PlainDate) => {
    try {
      const field = dateFieldRef.current
      if (!field) return
      const title = 'New event'
      const row = await createNodeRef.current(databaseIdRef.current, 'row', title)
      if (!row) {
        toast.error('Could not create row')
        return
      }
      const iso = new Date(date.year, date.month - 1, date.day).toISOString()
      await updateCellRef.current(row.id, field.id, field.field_type, iso)
      await loadNodeChildrenRef.current(databaseIdRef.current)
      setEditorEvent({ id: row.id, title, start: date, end: date })
    } catch (e) {
      toast.error('Could not create event', { description: String(e) })
    }
  }

  callbacksRef.current.onDoubleClickDateTime = async (dateTime: Temporal.ZonedDateTime) => {
    try {
      const field = dateFieldRef.current
      if (!field || field.field_type !== 'date_time') return
      const endF = endDateFieldRef.current
      const title = 'New event'
      const row = await createNodeRef.current(databaseIdRef.current, 'row', title)
      if (!row) {
        toast.error('Could not create row')
        return
      }
      const ms = Number(dateTime.toInstant().epochMilliseconds)
      await updateCellRef.current(row.id, field.id, field.field_type, new Date(ms).toISOString())
      if (endF?.field_type === 'date_time') {
        await updateCellRef.current(row.id, endF.id, 'date_time', new Date(ms + 60 * 60 * 1000).toISOString())
      }
      await loadNodeChildrenRef.current(databaseIdRef.current)
      const endEv = endF
        ? Temporal.Instant.fromEpochMilliseconds(ms + 60 * 60 * 1000).toZonedDateTimeISO(dateTime.timeZoneId)
        : dateTime.add({ hours: 1 })
      setEditorEvent({ id: row.id, title, start: dateTime, end: endEv })
    } catch (e) {
      toast.error('Could not create event', { description: String(e) })
    }
  }

  const events = useMemo(() => {
    if (!dateField) return []
    return filteredRows
      .map(row => rowToCalendarEvent(row, dateField, endDateField, primaryField))
      .filter((e): e is CalendarEventExternal => e != null)
  }, [filteredRows, dateField, endDateField, primaryField])

  const calendarAppRef = useRef<import('@schedule-x/calendar').CalendarApp | null>(null)

  const todayPlain = useMemo(() => Temporal.Now.plainDateISO(), [])

  const eventDayKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const ev of events) {
      const s = ev.start
      const d = isZonedDateTime(s) ? s.toPlainDate() : (s as Temporal.PlainDate)
      keys.add(d.toString())
    }
    return keys
  }, [events])

  const openEventContextMenu = useCallback((clientX: number, clientY: number, event: CalendarEventExternal) => {
    if (String(event.id) === '__draft_range') return
    // anchorX/Y = event chip position for overlay placement; x/y = cursor for context menu
    setContextMenu({ kind: 'event', x: clientX, y: clientY, event, anchorX: clientX, anchorY: clientY })
  }, [])

  const openGridContextMenu = useCallback((clientX: number, clientY: number, plainDate: Temporal.PlainDate) => {
    setContextMenu({ kind: 'grid', x: clientX, y: clientY, plainDate })
  }, [])

  const handleDeleteEventFromMenu = useCallback(
    async (ev: CalendarEventExternal) => {
      if (!confirm('Delete this row?')) return
      await deleteNodeRef.current(String(ev.id))
      void loadNodeChildrenRef.current(databaseIdRef.current)
      setEditorEvent(cur => (cur && String(cur.id) === String(ev.id) ? null : cur))
    },
    [],
  )

  const shiftSidebarMonth = useCallback((deltaMonths: number) => {
    setSidebarAnchorDate(d => d.add({ months: deltaMonths }))
  }, [])

  const persistEventUpdate = useCallback(async (event: CalendarEventExternal) => {
    const startF = dateFieldRef.current
    if (!startF) return
    if (String(event.id) === '__draft_range') return
    const rowId = String(event.id)
    const endF = endDateFieldRef.current

    if (startF.field_type === 'date_time') {
      if (!isZonedDateTime(event.start)) return
      let endZ: Temporal.ZonedDateTime
      if (isZonedDateTime(event.end)) {
        endZ = event.end
        if (Temporal.Instant.compare(endZ.toInstant(), event.start.toInstant()) <= 0) {
          endZ = event.start.add({ hours: 1 })
        }
      } else {
        endZ = event.start.add({ hours: 1 })
      }
      const startIso = eventStartToIso(event.start, 'date_time')
      await updateCellRef.current(rowId, startF.id, 'date_time', startIso)
      if (endF?.field_type === 'date_time') {
        const endIso = eventStartToIso(endZ, 'date_time')
        await updateCellRef.current(rowId, endF.id, 'date_time', endIso)
      }
      void loadNodeChildrenRef.current(databaseIdRef.current)
      return
    }

    const iso = eventStartToIso(event.start, 'date')
    await updateCellRef.current(rowId, startF.id, 'date', iso)
    void loadNodeChildrenRef.current(databaseIdRef.current)
  }, [])

  persistEventUpdateRef.current = persistEventUpdate

  const handleToolbarNewEvent = useCallback(() => {
    const field = dateFieldRef.current
    if (!field) return
    if (field.field_type === 'date') {
      void callbacksRef.current.onDoubleClickDate(sidebarAnchorDate)
      return
    }
    const tz = Temporal.Now.timeZoneId()
    const pdt = Temporal.PlainDateTime.from({
      year: sidebarAnchorDate.year,
      month: sidebarAnchorDate.month,
      day: sidebarAnchorDate.day,
      hour: 9,
      minute: 0,
    })
    void callbacksRef.current.onDoubleClickDateTime(pdt.toZonedDateTime(tz))
  }, [sidebarAnchorDate])

  const createTimedRange = useCallback(async (start: Temporal.ZonedDateTime, end: Temporal.ZonedDateTime) => {
    try {
      const startF = dateFieldRef.current
      if (!startF || startF.field_type !== 'date_time') return
      let endZ = end
      if (Temporal.Instant.compare(endZ.toInstant(), start.toInstant()) <= 0) {
        endZ = start.add({ hours: 1 })
      }
      const endF = endDateFieldRef.current
      const title = 'New event'
      const row = await createNodeRef.current(databaseIdRef.current, 'row', title)
      if (!row) {
        toast.error('Could not create row')
        return
      }
      const startMs = Number(start.toInstant().epochMilliseconds)
      await updateCellRef.current(row.id, startF.id, 'date_time', new Date(startMs).toISOString())
      if (endF?.field_type === 'date_time') {
        const endMs = Number(endZ.toInstant().epochMilliseconds)
        await updateCellRef.current(row.id, endF.id, 'date_time', new Date(endMs).toISOString())
      }
      await loadNodeChildrenRef.current(databaseIdRef.current)
      const endEv = endF ? endZ : start.add({ hours: 1 })
      setEditorEvent({ id: row.id, title, start, end: endEv })
    } catch (e) {
      toast.error('Could not create event', { description: String(e) })
    }
  }, [])

  const handleSingleClickDateTime = useCallback(
    async (dt: Temporal.ZonedDateTime) => {
      const start = snapZonedToSlotMinutes(dt)
      const end = start.add({ minutes: 30 })
      await createTimedRange(start, end)
    },
    [createTimedRange],
  )

  const handleSingleClickDate = useCallback(async (d: Temporal.PlainDate) => {
    const field = dateFieldRef.current
    if (!field || field.field_type !== 'date') return
    try {
      const title = 'New event'
      const row = await createNodeRef.current(databaseIdRef.current, 'row', title)
      if (!row) {
        toast.error('Could not create row')
        return
      }
      const iso = new Date(d.year, d.month - 1, d.day).toISOString()
      await updateCellRef.current(row.id, field.id, field.field_type, iso)
      await loadNodeChildrenRef.current(databaseIdRef.current)
      setEditorEvent({ id: row.id, title, start: d, end: d })
    } catch (e) {
      toast.error('Could not create event', { description: String(e) })
    }
  }, [])

  const interaction = useMemo((): WorkspaceCalendarInteraction => {
    return {
      calendarAppRef,
      persistEventUpdate,
      openEventEditor: ev => {
        if (String(ev.id) === '__draft_range') return
        setEditorEvent(ev)
      },
      fieldType: dateField?.field_type === 'date_time' ? 'date_time' : 'date',
      hasEndField: !!endDateField,
      openEventContextMenu,
      openGridContextMenu,
    }
  }, [dateField?.field_type, endDateField, openEventContextMenu, openGridContextMenu, persistEventUpdate])

  const agendaEvents = useMemo(() => {
    return events.filter(ev => {
      const s = ev.start
      const d = isZonedDateTime(s) ? s.toPlainDate() : (s as Temporal.PlainDate)
      return Temporal.PlainDate.compare(d, sidebarAnchorDate) === 0
    })
  }, [events, sidebarAnchorDate])

  useEffect(() => {
    setSidebarAnchorDate(Temporal.Now.plainDateISO())
  }, [databaseId])

  const handleDateFieldChange = useCallback(
    async (fieldId: string) => {
      if (!activeView) return
      let opts: Record<string, unknown> = {}
      try {
        opts = parseViewOptions(activeView)
      } catch {
        opts = {}
      }
      opts.date_field_id = fieldId
      delete opts.calendarDateFieldId
      if (opts.end_field_id === fieldId) {
        delete opts.end_field_id
      }
      delete opts.calendarEndFieldId
      await updateView(
        activeView.id,
        activeView.name,
        activeView.color,
        activeView.filters,
        activeView.sorts,
        JSON.stringify(opts),
      )
    },
    [activeView, updateView],
  )

  const handleEndFieldChange = useCallback(
    async (fieldId: string) => {
      if (!activeView) return
      let opts: Record<string, unknown> = {}
      try {
        opts = parseViewOptions(activeView)
      } catch {
        opts = {}
      }
      if (fieldId) {
        opts.end_field_id = fieldId
      } else {
        delete opts.end_field_id
      }
      delete opts.calendarEndFieldId
      await updateView(
        activeView.id,
        activeView.name,
        activeView.color,
        activeView.filters,
        activeView.sorts,
        JSON.stringify(opts),
      )
    },
    [activeView, updateView],
  )

  if (dateCandidates.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 8,
          color: 'var(--workspace-text-muted)',
          fontSize: 13,
          fontFamily: 'Space Grotesk, sans-serif',
          textAlign: 'center',
          padding: '0 32px',
        }}
      >
        <span style={{ fontSize: 28 }}>📅</span>
        <span>
          Add a <strong>Date</strong> or <strong>Date & time</strong> field to this database to use Calendar
          view.
        </span>
        <span style={{ fontSize: 11, color: 'var(--workspace-text-soft)' }}>
          Right-click any column header in Grid view → click [+] to add a field.
        </span>
      </div>
    )
  }

  if (!dateField) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: 'var(--workspace-text-muted)' }}>
        Saved date field is missing. Pick another column below.
        <select
          style={{ marginLeft: 8, fontFamily: 'Space Grotesk, sans-serif' }}
          value=""
          onChange={e => {
            if (e.target.value) void handleDateFieldChange(e.target.value)
          }}
        >
          <option value="">Select…</option>
          {dateCandidates.map(f => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div
      data-testid="workspace-calendar-panel"
      key={`${viewId}-${databaseId}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--workspace-bg)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '6px 12px',
          borderBottom: '1px solid var(--workspace-border)',
          fontSize: 11,
          fontFamily: 'Space Grotesk, sans-serif',
          color: 'var(--workspace-text-muted)',
        }}
      >
          {dateCandidates.length > 1 ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Start column
              <select
                value={dateField.id}
                onChange={e => void handleDateFieldChange(e.target.value)}
                style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 11 }}
              >
                {dateCandidates.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.field_type === 'date' ? 'date' : 'date & time'})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span style={{ color: 'var(--workspace-text-soft)' }}>
              Start: <strong style={{ color: 'var(--workspace-text-muted)' }}>{dateField.name}</strong>
              {dateField.field_type === 'date_time' ? ' (date & time)' : ' (date)'}
            </span>
          )}
          {dateField.field_type === 'date_time' && dateTimeCandidates.filter(f => f.id !== dateField.id).length > 0 ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              End column
              <select
                value={endDateField?.id ?? ''}
                onChange={e => void handleEndFieldChange(e.target.value)}
                style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 11 }}
              >
                <option value="">None (1h display)</option>
                {dateTimeCandidates
                  .filter(f => f.id !== dateField.id)
                  .map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : dateField.field_type === 'date_time' ? (
            <span style={{ color: 'var(--workspace-text-soft)', fontSize: 10 }}>
              Add another <strong>Date & time</strong> column in Grid to persist duration (End).
            </span>
          ) : null}
        <button
          type="button"
          onClick={() => void handleToolbarNewEvent()}
          style={{
            padding: '4px 10px',
            borderRadius: 8,
            border: '1px solid var(--workspace-border)',
            background: 'var(--workspace-bg)',
            color: 'var(--workspace-text-muted)',
            fontSize: 11,
            fontFamily: 'Space Grotesk, sans-serif',
            cursor: 'pointer',
          }}
        >
          New event
        </button>
        <span style={{ color: 'var(--workspace-text-soft)' }}>
          Single-click empty time for a 30-minute block (timed). Double-click or drag after a small move. Right-click picks
          the day column. <strong>New event</strong> uses the selected calendar day (timed → 9:00).
        </span>
      </div>
      <WorkspaceCalendarInteractionProvider value={interaction}>
        <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
          <WorkspaceCalendarAgendaSidebar
            events={agendaEvents}
            anchorDate={sidebarAnchorDate}
            today={todayPlain}
            eventDayKeys={eventDayKeys}
            onAnchorDateChange={setSidebarAnchorDate}
            onPrevMonth={() => shiftSidebarMonth(-1)}
            onNextMonth={() => shiftSidebarMonth(1)}
            onPickEvent={ev => {
              const s = ev.start
              const d = isZonedDateTime(s) ? s.toPlainDate() : (s as Temporal.PlainDate)
              setSidebarAnchorDate(d)
              setEditorEvent(ev)
            }}
            locale="en-US"
            firstDayOfWeek={0}
          />
          <div
            className="sx-react-calendar-wrapper"
            style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}
          >
            <WorkspaceCalendarScheduleBody
              key={`${databaseId}-${viewId}`}
              selectedPlainDate={sidebarAnchorDate}
              onCalendarSelectedDate={setSidebarAnchorDate}
              events={events}
              calendarAppRef={calendarAppRef}
              dateFieldType={dateField.field_type === 'date_time' ? 'date_time' : 'date'}
              onCreateTimedRange={createTimedRange}
              onDoubleClickDate={d => {
                void callbacksRef.current.onDoubleClickDate(d)
              }}
              onDoubleClickDateTime={dt => {
                void callbacksRef.current.onDoubleClickDateTime(dt)
              }}
              onSingleClickDateTime={
                dateField.field_type === 'date_time' ? dt => void handleSingleClickDateTime(dt) : undefined
              }
              onSingleClickDate={dateField.field_type === 'date' ? d => void handleSingleClickDate(d) : undefined}
              onEventUpdate={e => {
                void callbacksRef.current.onEventUpdate(e)
              }}
              onEventClick={(ev, e) => {
                if (String(ev.id) === '__draft_range') return
                const el = (e.target as HTMLElement)?.closest('[data-cal-event]')
                const rect = el?.getBoundingClientRect()
                const anchorX = rect ? rect.right + 8 : (e as unknown as MouseEvent).clientX
                const anchorY = rect ? rect.top : (e as unknown as MouseEvent).clientY
                setEditorEvent(ev)
                setOverlayAnchor({ x: anchorX, y: anchorY })
              }}
            />
          </div>
        </div>
      </WorkspaceCalendarInteractionProvider>
      {contextMenu?.kind === 'event' ? (
        <WorkspaceCalendarContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Edit',
              onSelect: () => {
                setOverlayAnchor({ x: contextMenu.x, y: contextMenu.y })
                setEditorEvent(contextMenu.event)
                setContextMenu(null)
              },
            },
            {
              label: 'Delete',
              danger: true,
              onSelect: () => void handleDeleteEventFromMenu(contextMenu.event),
            },
          ]}
        />
      ) : null}
      {contextMenu?.kind === 'grid' ? (
        <WorkspaceCalendarContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={
            dateField.field_type === 'date'
              ? [
                  {
                    label: 'New event (this day)',
                    onSelect: () => void callbacksRef.current.onDoubleClickDate(contextMenu.plainDate),
                  },
                ]
              : [
                  {
                    label: 'New timed event (9:00)',
                    onSelect: () => {
                      const tz = Temporal.Now.timeZoneId()
                      const pdt = Temporal.PlainDateTime.from({
                        year: contextMenu.plainDate.year,
                        month: contextMenu.plainDate.month,
                        day: contextMenu.plainDate.day,
                        hour: 9,
                        minute: 0,
                      })
                      const zdt = pdt.toZonedDateTime(tz)
                      void callbacksRef.current.onDoubleClickDateTime(zdt)
                    },
                  },
                ]
          }
        />
      ) : null}
      {editorEvent ? (
        <WorkspaceCalendarEventOverlay
          event={editorEvent}
          anchorX={overlayAnchor.x}
          anchorY={overlayAnchor.y}
          dateField={dateField}
          endDateField={endDateField}
          primaryField={primaryField}
          onClose={() => setEditorEvent(null)}
          onSaveTitleAndTime={async (rowId, title, payload) => {
            if (primaryField) {
              await updateCell(rowId, primaryField.id, primaryField.field_type, title, true)
            }
            await updateCell(rowId, dateField.id, dateField.field_type, payload.startIso)
            if (endDateField && payload.endIso) {
              await updateCell(rowId, endDateField.id, 'date_time', payload.endIso)
            }
            void loadNodeChildren(databaseId)
          }}
          onDeleteRow={async rowId => {
            await deleteNode(rowId)
            void loadNodeChildren(databaseId)
            setEditorEvent(null)
          }}
        />
      ) : null}
    </div>
  )
}
