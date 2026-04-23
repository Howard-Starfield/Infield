import { useMemo } from 'react'
import { CT } from './calendarTheme'

function plainDateKey(d: Temporal.PlainDate): string {
  return d.toString()
}

/** Sunday-first column index for the first of month (ISO: Mon=1 … Sun=7). */
function sundayFirstOffsetFromMondayIso(dow: number): number {
  return dow % 7
}

/**
 * Build locale-aware short weekday headers starting from firstDayOfWeek.
 * e.g. US (firstDayOfWeek=0) → ['S','M','T','W','T','F','S']
 *      ISO (firstDayOfWeek=1) → ['M','T','W','T','F','S','S']
 */
function buildWeekdayHeaders(locale: string, firstDayOfWeek: number): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  // A known Sunday to anchor the reference week
  const ref = Temporal.PlainDate.from('2026-04-05')
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const offset = (firstDayOfWeek + i) % 7
    const d = ref.add({ days: offset })
    days.push(fmt.format(new Date(d.year, d.month - 1, d.day)))
  }
  return days
}

interface Props {
  anchorDate: Temporal.PlainDate
  today: Temporal.PlainDate
  eventDayKeys: ReadonlySet<string>
  onSelectDay: (d: Temporal.PlainDate) => void
  onPrevMonth: () => void
  onNextMonth: () => void
  /** BCP-47 locale string, e.g. 'en-US'. Defaults to 'en-US'. */
  locale?: string
  /** 0=Sunday-first, 1=Monday-first (ISO). Defaults to 0. */
  firstDayOfWeek?: number
}

export function WorkspaceCalendarMiniMonth({
  anchorDate,
  today,
  eventDayKeys,
  onSelectDay,
  onPrevMonth,
  onNextMonth,
  locale = 'en-US',
  firstDayOfWeek = 0,
}: Props) {
  const weekDays = useMemo(() => buildWeekdayHeaders(locale, firstDayOfWeek), [locale, firstDayOfWeek])

  const { cells, title } = useMemo(() => {
    const y = anchorDate.year
    const m = anchorDate.month
    const first = Temporal.PlainDate.from({ year: y, month: m, day: 1 })
    const dim = first.daysInMonth
    const off = sundayFirstOffsetFromMondayIso(first.dayOfWeek)
    const cells: (Temporal.PlainDate | null)[] = []
    for (let i = 0; i < off; i++) cells.push(null)
    for (let d = 1; d <= dim; d++) {
      cells.push(Temporal.PlainDate.from({ year: y, month: m, day: d }))
    }
    while (cells.length % 7 !== 0) cells.push(null)
    while (cells.length < 42) cells.push(null)
    const title = first.toLocaleString(locale, { month: 'short', year: 'numeric' })
    return { cells, title }
  }, [anchorDate.year, anchorDate.month, locale])

  return (
    <div
      style={{
        padding: '8px 8px 10px',
        borderBottom: '1px solid var(--workspace-border)',
        fontFamily: CT.font,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          aria-label="Previous month"
          onClick={onPrevMonth}
          style={{
            padding: CT.pad_sidebarNav,
            borderRadius: CT.radius_button,
            border: '1px solid var(--workspace-border)',
            background: 'transparent',
            color: 'var(--workspace-text-muted)',
            cursor: 'pointer',
            fontSize: CT.size_miniMonthTitle,
          }}
        >
          ‹
        </button>
        <span style={{ fontSize: CT.size_miniMonthTitle, fontWeight: CT.weight_title, color: 'var(--workspace-text)' }}>
          {title}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={onNextMonth}
          style={{
            padding: CT.pad_sidebarNav,
            borderRadius: CT.radius_button,
            border: '1px solid var(--workspace-border)',
            background: 'transparent',
            color: 'var(--workspace-text-muted)',
            cursor: 'pointer',
            fontSize: CT.size_miniMonthTitle,
          }}
        >
          ›
        </button>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: CT.miniMonth_gap,
          textAlign: 'center',
          fontSize: CT.size_miniMonthWeekday,
          color: 'var(--workspace-text-soft)',
          marginBottom: 4,
        }}
      >
        {weekDays.map((d, i) => (
          <div key={i} style={{ fontWeight: CT.weight_title }}>
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: CT.miniMonth_gap }}>
        {cells.map((cell, i) => {
          if (!cell) {
            return <div key={`e-${i}`} style={{ height: CT.miniMonth_cellH }} />
          }
          const isAnchor = Temporal.PlainDate.compare(cell, anchorDate) === 0
          const isToday = Temporal.PlainDate.compare(cell, today) === 0
          const hasDot = eventDayKeys.has(plainDateKey(cell))
          return (
            <button
              type="button"
              key={plainDateKey(cell)}
              onClick={() => onSelectDay(cell)}
              style={{
                position: 'relative',
                height: CT.miniMonth_cellH,
                padding: 0,
                borderRadius: CT.radius_button,
                border: isAnchor ? '1px solid var(--workspace-accent)' : '1px solid transparent',
                background: isAnchor
                  ? 'color-mix(in srgb, var(--workspace-accent) 22%, transparent)'
                  : isToday
                    ? 'color-mix(in srgb, var(--workspace-accent) 10%, transparent)'
                    : 'transparent',
                color: 'var(--workspace-text)',
                cursor: 'pointer',
                fontSize: CT.size_miniMonthDay,
                fontWeight: isAnchor ? CT.weight_titleBold : CT.weight_body,
              }}
            >
              <span>{cell.day}</span>
              {hasDot ? (
                <span
                  style={{
                    position: 'absolute',
                    left: '50%',
                    bottom: 3,
                    transform: 'translateX(-50%)',
                    width: CT.dot_sizeSmall,
                    height: CT.dot_sizeSmall,
                    borderRadius: '50%',
                    background: 'var(--workspace-accent)',
                    opacity: 0.85,
                  }}
                />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
