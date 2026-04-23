import { createContext, useContext, type MutableRefObject, type ReactNode } from 'react'
import type { CalendarApp } from '@schedule-x/calendar'
import type { CalendarEventExternal } from '@schedule-x/calendar'

export type WorkspaceCalendarInteraction = {
  calendarAppRef: MutableRefObject<CalendarApp | null>
  persistEventUpdate: (event: CalendarEventExternal) => Promise<void>
  openEventEditor: (event: CalendarEventExternal) => void
  fieldType: 'date' | 'date_time'
  /** True when a mapped End `date_time` column persists duration (enables bottom-edge resize). */
  hasEndField: boolean
  openEventContextMenu: (clientX: number, clientY: number, event: CalendarEventExternal) => void
  openGridContextMenu: (clientX: number, clientY: number, plainDate: Temporal.PlainDate) => void
}

const Ctx = createContext<WorkspaceCalendarInteraction | null>(null)

export function WorkspaceCalendarInteractionProvider({
  value,
  children,
}: {
  value: WorkspaceCalendarInteraction
  children: ReactNode
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWorkspaceCalendarInteraction(): WorkspaceCalendarInteraction {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspaceCalendarInteraction outside provider')
  return v
}
