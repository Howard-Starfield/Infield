/**
 * Schedule-X week/day time scale — keep in sync with `useCalendarApp` weekOptions + dayBoundaries
 * so empty-slot drag and event drag/resize use the same px ↔ minutes mapping as the grid.
 */
import type { DayBoundariesExternal } from '@schedule-x/calendar'

/** Full day (default Schedule-X boundaries) so overnight events are not clipped. */
export const CALENDAR_DAY_BOUNDARIES: DayBoundariesExternal = {
  start: '00:00',
  end: '24:00',
}

/** Total scroll height (px) for one day column — lower = denser hours (default library value is 1600). ~30% denser than prior 1152. */
export const CALENDAR_GRID_HEIGHT = 806

/** Must match `weekOptions.gridStep` (hourly grid lines). */
export const CALENDAR_GRID_STEP = 60 as const

export const CALENDAR_TIME_AXIS_FORMAT: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
}

const VISIBLE_MINUTES = 24 * 60

/** Pixels per minute within the visible day column (matches Schedule-X `gridHeight / hourRows`). */
export const CALENDAR_PX_PER_MINUTE = CALENDAR_GRID_HEIGHT / VISIBLE_MINUTES
