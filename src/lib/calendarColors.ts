/**
 * Calendar event category colors — single source for UI + --workspace-cal-* CSS vars.
 */
export type CalendarEventColor =
  | "purple"
  | "pink"
  | "green"
  | "blue"
  | "orange"
  | "yellow";

export const CALENDAR_EVENT_COLOR_MAP: Record<CalendarEventColor, string> = {
  purple: "#8b7355",
  pink: "#ec407a",
  green: "#66bb6a",
  blue: "#42a5f5",
  orange: "#ffa726",
  yellow: "#ffee58",
};
