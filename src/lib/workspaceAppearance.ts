import {
  applyWorkspaceSurfaceCssVars,
  buildWorkspaceSurfaceTokens,
  type WorkspaceSurfaceThemePresetId,
  type WorkspaceSurfaceTokens,
} from "@/lib/workspaceSurfaceTokens";

export type WorkspaceThemePresetId =
  | "paper-warm"
  | "system-audio"
  | "graphite-focus";

export type WorkspaceDensityPresetId =
  | "comfortable"
  | "compact"
  | "airy";

/**
 * Core workspace chrome colors. Additional themed surfaces (home widget dots,
 * calendar category colors, status lights) live on `WorkspaceResolvedAppearance.surfaces`
 * and as `--workspace-widget-*`, `--workspace-cal-*`, `--workspace-status-*` CSS vars.
 */
export interface WorkspaceThemeColors {
  bg: string;
  bgSoft: string;
  pane: string;
  panel: string;
  panelMuted: string;
  editorBg: string;
  text: string;
  textMuted: string;
  textSoft: string;
  accent: string;
  accentSecondary: string;
  border: string;
  gridCell: string;
  gridHeader: string;
}

export interface WorkspaceDensityMetrics {
  gridRowHeight: number;
  gridCellPaddingH: number;
  gridCellPaddingV: number;
  editorMaxWidth: number;
}

export interface WorkspaceThemePreset {
  id: WorkspaceThemePresetId;
  label: string;
  description: string;
  colors: WorkspaceThemeColors;
  ambientGlow: number;
  shadowDepth: number;
  panelBlur: number;
  panelRadius: number;
}

export interface WorkspaceDensityPreset {
  id: WorkspaceDensityPresetId;
  label: string;
  description: string;
  metrics: WorkspaceDensityMetrics;
}

export interface WorkspaceAppearanceOverrides {
  bg?: string;
  panel?: string;
  editorBg?: string;
  text?: string;
  textMuted?: string;
  accent?: string;
  accentSecondary?: string;
  border?: string;
  ambientGlow?: number;
  shadowDepth?: number;
  panelBlur?: number;
  panelRadius?: number;
  gridRowHeight?: number;
  gridCellPaddingH?: number;
  gridCellPaddingV?: number;
  editorMaxWidth?: number;
  /** Override the fluid CSS base font-size. null = use clamp() formula. */
  fontSize?: number | null;
}

export interface WorkspaceAppearanceSettings {
  themePresetId: WorkspaceThemePresetId;
  densityPresetId: WorkspaceDensityPresetId;
  overrides: WorkspaceAppearanceOverrides;
}

export interface WorkspaceResolvedAppearance {
  settings: WorkspaceAppearanceSettings;
  themePreset: WorkspaceThemePreset;
  densityPreset: WorkspaceDensityPreset;
  colors: WorkspaceThemeColors;
  /** Widget dots, calendar chip hex, status lights for the active preset (not persisted). */
  surfaces: WorkspaceSurfaceTokens;
  ambientGlow: number;
  shadowDepth: number;
  panelBlur: number;
  panelRadius: number;
  metrics: WorkspaceDensityMetrics;
  /** null = use the fluid CSS clamp() base; number = override with fixed px. */
  fontSize: number | null;
}

export const WORKSPACE_APPEARANCE_PREFERENCE_KEY =
  "workspace_appearance_v1";

export const workspaceThemePresets: WorkspaceThemePreset[] = [
  {
    id: "paper-warm",
    label: "Paper Warm",
    description: "Creamy workspace chrome with editorial contrast.",
    colors: {
      bg: "#fdf9f3",
      bgSoft: "#f7f3ee",
      pane: "#f5efe7",
      panel: "#fffef9",
      panelMuted: "#f4eee6",
      editorBg: "#f5f5f0",
      text: "#1c1c19",
      textMuted: "#5b403a",
      textSoft: "#856a62",
      accent: "#b72301",
      accentSecondary: "#6d4c3d",
      border: "#b29d93",
      gridCell: "#fdf9f3",
      gridHeader: "#f7f3ee",
    },
    ambientGlow: 0.34,
    shadowDepth: 0.26,
    panelBlur: 10,
    panelRadius: 10,
  },
  {
    id: "system-audio",
    label: "System Audio",
    description: "Ambient shadow, restrained glass, bright reading surfaces.",
    colors: {
      bg: "#090c11",
      bgSoft: "#11161f",
      pane: "#111720",
      panel: "#161d28",
      panelMuted: "#1d2633",
      editorBg: "#101721",
      text: "#f5f7fb",
      textMuted: "#9ca9bb",
      textSoft: "#66758a",
      accent: "#ff9254",
      accentSecondary: "#67e8f9",
      border: "#7d8da3",
      gridCell: "#101721",
      gridHeader: "#18212c",
    },
    ambientGlow: 0.86,
    shadowDepth: 0.78,
    panelBlur: 18,
    panelRadius: 10,
  },
  {
    id: "graphite-focus",
    label: "Graphite Focus",
    description: "Cool slate shell with quiet contrast and lifted surfaces.",
    colors: {
      bg: "#20252d",
      bgSoft: "#282e38",
      pane: "#262d37",
      panel: "#f2efe8",
      panelMuted: "#e4ddd2",
      editorBg: "#f7f3eb",
      text: "#1b1b19",
      textMuted: "#58534d",
      textSoft: "#7d756d",
      accent: "#d97745",
      accentSecondary: "#5d7fa3",
      border: "#938b83",
      gridCell: "#f2efe8",
      gridHeader: "#e7e0d5",
    },
    ambientGlow: 0.56,
    shadowDepth: 0.6,
    panelBlur: 14,
    panelRadius: 10,
  },
];

export const workspaceDensityPresets: WorkspaceDensityPreset[] = [
  {
    id: "comfortable",
    label: "Comfortable",
    description: "Balanced spacing for notes and databases.",
    metrics: {
      gridRowHeight: 26,
      gridCellPaddingH: 8,
      gridCellPaddingV: 3,
      editorMaxWidth: 1200,
    },
  },
  {
    id: "compact",
    label: "Compact",
    description: "Tighter tables and denser information display.",
    metrics: {
      gridRowHeight: 24,
      gridCellPaddingH: 7,
      gridCellPaddingV: 2,
      editorMaxWidth: 1080,
    },
  },
  {
    id: "airy",
    label: "Airy",
    description: "More whitespace for relaxed reading and scanning.",
    metrics: {
      gridRowHeight: 30,
      gridCellPaddingH: 10,
      gridCellPaddingV: 4,
      editorMaxWidth: 1280,
    },
  },
];

export const defaultWorkspaceAppearanceSettings: WorkspaceAppearanceSettings = {
  themePresetId: "paper-warm",
  densityPresetId: "comfortable",
  overrides: {},
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeHex(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  const trimmed = color.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : fallback;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  const int = Number.parseInt(normalized, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mix(hexA: string, hexB: string, weight: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const t = clamp(weight, 0, 1);
  const toHex = (value: number) =>
    Math.round(value).toString(16).padStart(2, "0");
  return `#${toHex(a.r + (b.r - a.r) * t)}${toHex(a.g + (b.g - a.g) * t)}${toHex(
    a.b + (b.b - a.b) * t,
  )}`;
}

export function getWorkspaceThemePreset(
  presetId: WorkspaceThemePresetId,
): WorkspaceThemePreset {
  return (
    workspaceThemePresets.find((preset) => preset.id === presetId) ??
    workspaceThemePresets[0]
  );
}

export function getWorkspaceDensityPreset(
  presetId: WorkspaceDensityPresetId,
): WorkspaceDensityPreset {
  return (
    workspaceDensityPresets.find((preset) => preset.id === presetId) ??
    workspaceDensityPresets[0]
  );
}

export function sanitizeWorkspaceAppearanceSettings(
  value: unknown,
): WorkspaceAppearanceSettings {
  if (!value || typeof value !== "object") {
    return defaultWorkspaceAppearanceSettings;
  }

  const maybe = value as Partial<WorkspaceAppearanceSettings>;
  const themePreset = getWorkspaceThemePreset(
    (maybe.themePresetId as WorkspaceThemePresetId) ??
      defaultWorkspaceAppearanceSettings.themePresetId,
  );
  const densityPreset = getWorkspaceDensityPreset(
    (maybe.densityPresetId as WorkspaceDensityPresetId) ??
      defaultWorkspaceAppearanceSettings.densityPresetId,
  );
  const overrides =
    maybe.overrides && typeof maybe.overrides === "object"
      ? (maybe.overrides as WorkspaceAppearanceOverrides)
      : {};

  return {
    themePresetId: themePreset.id,
    densityPresetId: densityPreset.id,
    overrides: {
      bg: sanitizeHex(overrides.bg, themePreset.colors.bg),
      panel: sanitizeHex(overrides.panel, themePreset.colors.panel),
      editorBg: sanitizeHex(overrides.editorBg, themePreset.colors.editorBg),
      text: sanitizeHex(overrides.text, themePreset.colors.text),
      textMuted: sanitizeHex(overrides.textMuted, themePreset.colors.textMuted),
      accent: sanitizeHex(overrides.accent, themePreset.colors.accent),
      accentSecondary: sanitizeHex(
        overrides.accentSecondary,
        themePreset.colors.accentSecondary,
      ),
      border: sanitizeHex(overrides.border, themePreset.colors.border),
      ambientGlow:
        typeof overrides.ambientGlow === "number"
          ? clamp(overrides.ambientGlow, 0, 1)
          : undefined,
      shadowDepth:
        typeof overrides.shadowDepth === "number"
          ? clamp(overrides.shadowDepth, 0, 1)
          : undefined,
      panelBlur:
        typeof overrides.panelBlur === "number"
          ? clamp(overrides.panelBlur, 0, 30)
          : undefined,
      panelRadius:
        typeof overrides.panelRadius === "number"
          ? clamp(overrides.panelRadius, 6, 32)
          : undefined,
      gridRowHeight:
        typeof overrides.gridRowHeight === "number"
          ? clamp(overrides.gridRowHeight, 22, 36)
          : undefined,
      gridCellPaddingH:
        typeof overrides.gridCellPaddingH === "number"
          ? clamp(overrides.gridCellPaddingH, 4, 16)
          : undefined,
      gridCellPaddingV:
        typeof overrides.gridCellPaddingV === "number"
          ? clamp(overrides.gridCellPaddingV, 1, 8)
          : undefined,
      editorMaxWidth:
        typeof overrides.editorMaxWidth === "number"
          ? clamp(overrides.editorMaxWidth, 760, 1400)
          : undefined,
      fontSize:
        typeof overrides.fontSize === "number"
          ? clamp(overrides.fontSize, 11, 20)
          : overrides.fontSize === null
            ? null
            : undefined,
    },
  };
}

export function resolveWorkspaceAppearance(
  settings: WorkspaceAppearanceSettings,
): WorkspaceResolvedAppearance {
  const clean = sanitizeWorkspaceAppearanceSettings(settings);
  const themePreset = getWorkspaceThemePreset(clean.themePresetId);
  const densityPreset = getWorkspaceDensityPreset(clean.densityPresetId);
  const accent = clean.overrides.accent ?? themePreset.colors.accent;
  const accentSecondary =
    clean.overrides.accentSecondary ?? themePreset.colors.accentSecondary;
  const bg = clean.overrides.bg ?? themePreset.colors.bg;
  const panel = clean.overrides.panel ?? themePreset.colors.panel;
  const editorBg = clean.overrides.editorBg ?? themePreset.colors.editorBg;
  const text = clean.overrides.text ?? themePreset.colors.text;
  const textMuted = clean.overrides.textMuted ?? themePreset.colors.textMuted;
  const border = clean.overrides.border ?? themePreset.colors.border;

  const colors: WorkspaceThemeColors = {
    ...themePreset.colors,
    bg,
    panel,
    editorBg,
    text,
    textMuted,
    accent,
    accentSecondary,
    border,
    bgSoft: mix(bg, panel, 0.28),
    pane: mix(bg, panel, 0.44),
    panelMuted: mix(panel, bg, 0.18),
    textSoft: mix(textMuted, bg, 0.36),
    gridCell: mix(panel, editorBg, 0.4),
    gridHeader: mix(panel, bg, 0.22),
  };

  return {
    settings: clean,
    themePreset,
    densityPreset,
    colors,
    surfaces: buildWorkspaceSurfaceTokens(
      themePreset.id as WorkspaceSurfaceThemePresetId,
    ),
    ambientGlow: clean.overrides.ambientGlow ?? themePreset.ambientGlow,
    shadowDepth: clean.overrides.shadowDepth ?? themePreset.shadowDepth,
    panelBlur: clean.overrides.panelBlur ?? themePreset.panelBlur,
    panelRadius: clean.overrides.panelRadius ?? themePreset.panelRadius,
    metrics: {
      gridRowHeight:
        clean.overrides.gridRowHeight ?? densityPreset.metrics.gridRowHeight,
      gridCellPaddingH:
        clean.overrides.gridCellPaddingH ??
        densityPreset.metrics.gridCellPaddingH,
      gridCellPaddingV:
        clean.overrides.gridCellPaddingV ??
        densityPreset.metrics.gridCellPaddingV,
      editorMaxWidth:
        clean.overrides.editorMaxWidth ?? densityPreset.metrics.editorMaxWidth,
    },
    fontSize:
      clean.overrides.fontSize === null
        ? null
        : (clean.overrides.fontSize ?? null),
  };
}

export function workspaceDataGridTheme(
  appearance: WorkspaceResolvedAppearance,
) {
  const colors = appearance.colors;
  return {
    accentColor: mix(colors.accent, colors.panel, 0.72),
    accentFg: colors.text,
    accentLight: rgba(colors.accent, 0.12),
    textDark: colors.text,
    textMedium: rgba(colors.textMuted, 0.82),
    textLight: rgba(colors.textMuted, 0.56),
    textBubble: colors.text,
    bgIconHeader: colors.gridHeader,
    fgIconHeader: rgba(colors.textMuted, 0.88),
    textHeader: colors.text,
    textGroupHeader: rgba(colors.textMuted, 0.78),
    textHeaderSelected: colors.text,
    bgCell: colors.gridCell,
    bgCellMedium: mix(colors.gridCell, colors.bg, 0.12),
    bgHeader: colors.gridHeader,
    bgHeaderHasFocus: mix(colors.gridHeader, colors.panel, 0.18),
    bgHeaderHovered: mix(colors.gridHeader, colors.panel, 0.08),
    bgBubble: colors.gridCell,
    bgBubbleSelected: colors.panel,
    bgSearchResult: mix(colors.accent, "#fff5cc", 0.2),
    borderColor: rgba(colors.text, 0.08),
    horizontalBorderColor: rgba(colors.text, 0.06),
    drilldownBorder: "rgba(0, 0, 0, 0)",
    linkColor: colors.accent,
    headerFontStyle: '600 11px "Space Grotesk", sans-serif',
    baseFontStyle: '13px "Space Grotesk", sans-serif',
    editorFontSize: "13px",
    fontFamily: '"Space Grotesk", "Inter", system-ui, sans-serif',
    cellHorizontalPadding: appearance.metrics.gridCellPaddingH,
    cellVerticalPadding: appearance.metrics.gridCellPaddingV,
    headerIconSize: 18,
    markerFontStyle: '600 9px "Space Grotesk", sans-serif',
    lineHeight: 1.35,
    roundingRadius: 4,
  } as const;
}

export function applyWorkspaceAppearanceToDocument(
  appearance: WorkspaceResolvedAppearance,
): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const colors = appearance.colors;
  const shadowBase = rgba("#000000", 0.08 + appearance.shadowDepth * 0.34);
  const shadowSoft = rgba("#000000", 0.05 + appearance.shadowDepth * 0.18);
  const noteTopbar = rgba(colors.panel, 0.82 + appearance.shadowDepth * 0.1);

  root.style.setProperty("--workspace-bg", colors.bg);
  root.style.setProperty("--workspace-bg-soft", colors.bgSoft);
  root.style.setProperty("--workspace-cream", colors.panelMuted);
  root.style.setProperty("--workspace-pane", rgba(colors.pane, 0.92));
  root.style.setProperty("--workspace-pane-strong", rgba(colors.pane, 0.97));
  root.style.setProperty("--workspace-panel", colors.panel);
  root.style.setProperty("--workspace-panel-muted", colors.panelMuted);
  root.style.setProperty("--workspace-border", rgba(colors.border, 0.22));
  root.style.setProperty("--workspace-border-strong", rgba(colors.border, 0.38));
  root.style.setProperty("--workspace-text", colors.text);
  root.style.setProperty("--workspace-text-muted", rgba(colors.textMuted, 0.82));
  root.style.setProperty("--workspace-text-soft", rgba(colors.textSoft, 0.7));
  root.style.setProperty("--workspace-accent", colors.accent);
  root.style.setProperty("--workspace-accent-soft", rgba(colors.accent, 0.1));
  root.style.setProperty("--workspace-accent-strong", rgba(colors.accent, 0.18));
  root.style.setProperty("--workspace-accent-secondary", colors.accentSecondary);
  root.style.setProperty("--workspace-tree-hover", rgba(colors.text, 0.06));
  root.style.setProperty("--workspace-tree-hover-strong", rgba(colors.text, 0.1));
  root.style.setProperty("--workspace-shadow", `0 24px 72px ${shadowBase}`);
  root.style.setProperty("--workspace-shadow-soft", `0 12px 28px ${shadowSoft}`);
  root.style.setProperty("--workspace-panel-blur", `${appearance.panelBlur}px`);
  root.style.setProperty("--workspace-panel-radius", `${appearance.panelRadius}px`);
  root.style.setProperty("--workspace-note-topbar-bg", noteTopbar);
  root.style.setProperty("--workspace-grid-bg-cell", colors.gridCell);
  root.style.setProperty("--workspace-grid-bg-header", colors.gridHeader);
  root.style.setProperty(
    "--workspace-grid-bg-header-hover",
    mix(colors.gridHeader, colors.panel, 0.08),
  );
  root.style.setProperty(
    "--workspace-grid-bg-header-focus",
    mix(colors.gridHeader, colors.panel, 0.18),
  );
  root.style.setProperty("--workspace-grid-border", rgba(colors.text, 0.08));
  root.style.setProperty("--workspace-grid-border-soft", rgba(colors.text, 0.06));
  root.style.setProperty("--workspace-grid-link", colors.accent);
  root.style.setProperty(
    "--workspace-grid-accent-light",
    rgba(colors.accent, 0.12),
  );
  root.style.setProperty(
    "--workspace-grid-cell-padding-h",
    `${appearance.metrics.gridCellPaddingH}px`,
  );
  root.style.setProperty(
    "--workspace-grid-cell-padding-v",
    `${appearance.metrics.gridCellPaddingV}px`,
  );
  root.style.setProperty(
    "--workspace-grid-row-height",
    `${appearance.metrics.gridRowHeight}px`,
  );
  root.style.setProperty(
    "--workspace-editor-max-width",
    `${appearance.metrics.editorMaxWidth}px`,
  );
  root.style.setProperty("--editor-bg", colors.editorBg);
  root.style.setProperty("--editor-text", colors.text);
  root.style.setProperty("--editor-muted", rgba(colors.textMuted, 0.78));
  root.style.setProperty(
    "--workspace-shell-glow-top",
    rgba(colors.accent, 0.08 + appearance.ambientGlow * 0.16),
  );
  root.style.setProperty(
    "--workspace-shell-glow-right",
    rgba(colors.accentSecondary, 0.05 + appearance.ambientGlow * 0.14),
  );
  root.style.setProperty(
    "--workspace-shell-glow-bottom",
    rgba(colors.accent, 0.03 + appearance.ambientGlow * 0.1),
  );

  root.style.setProperty(
    "--workspace-home-popup-overlay",
    rgba(mix(colors.bg, "#000000", 0.88), 0.96),
  );

  root.style.setProperty("--workspace-home-chart-bar", colors.accent);
  root.style.setProperty(
    "--workspace-home-chart-bar-muted",
    rgba(colors.textMuted, 0.38),
  );
  root.style.setProperty(
    "--workspace-home-chart-axis",
    rgba(colors.textSoft, 0.55),
  );

  const menuRadiusPx = clamp(
    Math.round(appearance.panelRadius * 0.55),
    8,
    16,
  );
  root.style.setProperty("--workspace-menu-radius", `${menuRadiusPx}px`);
  root.style.setProperty("--workspace-menu-danger-fg", colors.accent);
  root.style.setProperty(
    "--workspace-menu-danger-hover-bg",
    rgba(colors.accent, 0.12),
  );
  root.style.setProperty(
    "--workspace-menu-surface-bg",
    rgba(colors.panel, 0.97),
  );
  root.style.setProperty("--workspace-modal-z", "12030");
  root.style.setProperty("--workspace-tooltip-z", "12060");

  applyWorkspaceSurfaceCssVars(
    root,
    appearance.themePreset.id as WorkspaceSurfaceThemePresetId,
  );

  // Override: null = let CSS clamp() drive the fluid base; number = fixed px
  if (appearance.fontSize !== null) {
    root.style.setProperty("font-size", `${appearance.fontSize}px`);
  } else {
    root.style.removeProperty("font-size");
  }
}
