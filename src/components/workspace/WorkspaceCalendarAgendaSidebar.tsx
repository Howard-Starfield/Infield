import type { CalendarEventExternal } from '@schedule-x/calendar'
import { CT } from './calendarTheme'
import { WorkspaceCalendarMiniMonth } from './WorkspaceCalendarMiniMonth'

function isZonedDateTime(
  v: Temporal.ZonedDateTime | Temporal.PlainDate,
): v is Temporal.ZonedDateTime {
  return typeof (v as Temporal.ZonedDateTime).timeZoneId === 'string'
}

function eventSortKey(ev: CalendarEventExternal): number {
  const s = ev.start
  if (isZonedDateTime(s)) return Number(s.toInstant().epochMilliseconds)
  const pd = s as Temporal.PlainDate
  return new Date(pd.year, pd.month - 1, pd.day).getTime()
}

function formatEventTime(ev: CalendarEventExternal): string {
  const s = ev.start
  if (isZonedDateTime(s)) {
    const p = s.toPlainDateTime()
    return `${p.hour.toString().padStart(2, '0')}:${p.minute.toString().padStart(2, '0')}`
  }
  return 'All day'
}

interface Props {
  events: CalendarEventExternal[]
  anchorDate: Temporal.PlainDate
  today: Temporal.PlainDate
  eventDayKeys: ReadonlySet<string>
  onAnchorDateChange: (d: Temporal.PlainDate) => void
  onPrevMonth: () => void
  onNextMonth: () => void
  onPickEvent: (ev: CalendarEventExternal) => void
  locale?: string
  firstDayOfWeek?: number
}

export function WorkspaceCalendarAgendaSidebar({
  events,
  anchorDate,
  today,
  eventDayKeys,
  onAnchorDateChange,
  onPrevMonth,
  onNextMonth,
  onPickEvent,
  locale = 'en-US',
  firstDayOfWeek = 0,
}: Props) {
  const sorted = [...events].sort((a, b) => eventSortKey(a) - eventSortKey(b))

  const label = `${anchorDate.toString()}`

  const go = (days: number) => {
    onAnchorDateChange(anchorDate.add({ days }))
  }

  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid var(--workspace-border)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: 'var(--workspace-bg)',
        fontFamily: CT.font,
      }}
    >
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--workspace-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <button
          type="button"
          aria-label="Previous day"
          onClick={() => go(-1)}
          style={{
            padding: '2px 8px',
            borderRadius: CT.radius_button,
            border: '1px solid var(--workspace-border)',
            background: 'transparent',
            color: 'var(--workspace-text-muted)',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          ‹
        </button>
        <span style={{ flex: 1, fontSize: CT.size_sidebarTitle, color: 'var(--workspace-text-muted)', textAlign: 'center' }}>
          {label}
        </span>
        <button
          type="button"
          aria-label="Next day"
          onClick={() => go(1)}
          style={{
            padding: '2px 8px',
            borderRadius: CT.radius_button,
            border: '1px solid var(--workspace-border)',
            background: 'transparent',
            color: 'var(--workspace-text-muted)',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          ›
        </button>
        <button
          type="button"
          onClick={() => onAnchorDateChange(Temporal.Now.plainDateISO())}
          style={{
            padding: '2px 8px',
            borderRadius: CT.radius_button,
            border: '1px solid var(--workspace-border)',
            background: 'var(--workspace-accent)',
            color: 'var(--workspace-bg)',
            cursor: 'pointer',
            fontSize: CT.size_sidebarTitle,
            fontWeight: CT.weight_title,
          }}
        >
          Today
        </button>
      </div>
      <WorkspaceCalendarMiniMonth
        anchorDate={anchorDate}
        today={today}
        eventDayKeys={eventDayKeys}
        onSelectDay={onAnchorDateChange}
        onPrevMonth={onPrevMonth}
        onNextMonth={onNextMonth}
        locale={locale}
        firstDayOfWeek={firstDayOfWeek}
      />
      <div style={{ fontSize: CT.size_miniMonthWeekday, color: 'var(--workspace-text-soft)', padding: '6px 10px' }}>
        Agenda (same rows as calendar)
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px 10px' }}>
        {sorted.length === 0 ? (
          <div style={{ fontSize: CT.size_sidebarEventTitle, color: 'var(--workspace-text-soft)', lineHeight: 1.45 }}>
            No events. Use the New event button, double-click empty space on the grid, or right-click the day column.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sorted.map(ev => (
              <li key={String(ev.id)}>
                <button
                  type="button"
                  onClick={() => onPickEvent(ev)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: CT.pad_sidebarEventRow,
                    borderRadius: CT.radius_event,
                    border: '1px solid var(--workspace-border)',
                    background: 'color-mix(in srgb, var(--workspace-accent) 8%, transparent)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flexShrink: 0,
                      width: CT.dot_sizeSmall,
                      height: CT.dot_sizeSmall,
                      borderRadius: '50%',
                      background: 'var(--workspace-accent)',
                      marginTop: 1,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: CT.size_sidebarEventTime, color: 'var(--workspace-text-soft)' }}>
                      {formatEventTime(ev)}
                    </div>
                    <div
                      style={{
                        fontSize: CT.size_sidebarEventTitle,
                        color: 'var(--workspace-text)',
                        fontWeight: CT.weight_body,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {ev.title || 'Untitled'}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
