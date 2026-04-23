import { CALENDAR_EVENT_COLOR_MAP } from "@/lib/calendarColors";

/** Mirrors WorkspaceThemePresetId — kept local to avoid circular imports with workspaceAppearance. */
export type WorkspaceSurfaceThemePresetId =
  | "paper-warm"
  | "system-audio"
  | "graphite-focus";

/** Home tab widget ids — matches CSS var suffixes --workspace-widget-* */
export type WorkspaceWidgetId =
  | "todo"
  | "calendar"
  | "recent"
  | "quickcapture"
  | "aiinsights"
  | "notifications"
  | "stats"
  | "voicememos";

const WIDGET_IDS: WorkspaceWidgetId[] = [
  "todo",
  "calendar",
  "recent",
  "quickcapture",
  "aiinsights",
  "notifications",
  "stats",
  "voicememos",
];

/** Per-theme accent dots on home widgets (readable on each shell). */
const WIDGET_PALETTES: Record<
  WorkspaceSurfaceThemePresetId,
  Record<WorkspaceWidgetId, string>
> = {
  "paper-warm": {
    todo: "#c45a3e",
    calendar: "#b8956a",
    recent: "#7a8f72",
    quickcapture: "#c9a227",
    aiinsights: "#8b7355",
    notifications: "#b87a7a",
    stats: "#6d7b8b",
    voicememos: "#b72301",
  },
  "system-audio": {
    todo: "#fb923c",
    calendar: "#fcd34d",
    recent: "#86efac",
    quickcapture: "#fde047",
    aiinsights: "#fde68a",
    notifications: "#fca5a5",
    stats: "#93c5fd",
    voicememos: "#ff9254",
  },
  "graphite-focus": {
    todo: "#c45a3e",
    calendar: "#a8906e",
    recent: "#6d8a66",
    quickcapture: "#b8962e",
    aiinsights: "#7d6b58",
    notifications: "#a67272",
    stats: "#5c6b7a",
    voicememos: "#d97745",
  },
};

const STATUS_COLORS = {
  recording: "#ef4444",
  transcribing: "#f59e0b",
  ready: "#4ade80",
} as const;

export interface WorkspaceSurfaceTokens {
  widgets: Record<WorkspaceWidgetId, string>;
  calendar: typeof CALENDAR_EVENT_COLOR_MAP;
  status: typeof STATUS_COLORS;
}

export function buildWorkspaceSurfaceTokens(
  themePresetId: WorkspaceSurfaceThemePresetId,
): WorkspaceSurfaceTokens {
  const widgets =
    WIDGET_PALETTES[themePresetId] ?? WIDGET_PALETTES["paper-warm"];
  return {
    widgets: { ...widgets },
    calendar: { ...CALENDAR_EVENT_COLOR_MAP },
    status: { ...STATUS_COLORS },
  };
}

/** Apply preset-specific surfaces that cannot be expressed purely in static CSS. */
export function applyWorkspaceSurfaceCssVars(
  root: HTMLElement,
  themePresetId: WorkspaceSurfaceThemePresetId,
): void {
  const { widgets, calendar, status } = buildWorkspaceSurfaceTokens(themePresetId);

  for (const id of WIDGET_IDS) {
    root.style.setProperty(`--workspace-widget-${id}`, widgets[id]);
  }

  for (const key of Object.keys(calendar) as (keyof typeof calendar)[]) {
    root.style.setProperty(`--workspace-cal-${key}`, calendar[key]);
  }

  root.style.setProperty("--workspace-status-recording", status.recording);
  root.style.setProperty("--workspace-status-transcribing", status.transcribing);
  root.style.setProperty("--workspace-status-ready", status.ready);
}
