/**
 * Built-in theme presets. Each is a fully-populated `Primitives` object; users
 * pick one in Settings → Appearance → Preset, then layer per-token overrides on
 * top via sliders/pickers.
 *
 * Adding a preset:
 *   1. Add an entry here with a unique id prefixed `heros-` (or new brand prefix).
 *   2. Add its id to `PresetId` in `tokens.ts`.
 *   3. Add a registration row in `PRESETS` at the bottom.
 *   4. That's it — the Settings panel auto-picks it up via `listPresets()`.
 *
 * Picking values:
 *   - `brand` drives the accent color only. Keep it visible on `surfaceBase`
 *     (contrast >= 3.0 for UI components per WCAG 1.4.11).
 *   - `surfaceBase` is the foundation color. All three background tiers
 *     (primary/secondary/tertiary) are `color-mix()`-derived from it in
 *     `src/App.css`.
 *   - `onSurface` must contrast >= 4.5 against `surfaceBase` (WCAG AA body
 *     text). The dev-time `checkContrastWarning` will flag you otherwise.
 */

import type { Primitives, ThemePreset } from './tokens'

// ─── Common baselines (reused across presets) ────────────────────────────────

/**
 * Shared non-color primitives. Presets override the chromatic fields (brand,
 * surfaceBase, onSurface, mode) and the glass fill opacity, keeping geometry
 * and typography consistent across all four.
 */
const BASE_GEOMETRY = {
  radiusScale: 'default' as const,
  glassBlur: 32,
  glassSaturate: 220,
  grainOpacity: 1,

  fontUI: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
  fontContent:
    "'Georgia', 'Iowan Old Style', 'Times New Roman', serif",
  fontMono:
    "'JetBrains Mono', 'Menlo', 'Consolas', 'Courier New', monospace",
  fontSizeBase: 14,
  lineHeightBase: 1.5,
  maxLineCh: 72,

  densityScale: 1.0,
  dividerWidth: 'thin' as const,
  translucencyEnabled: true,

  animationSpeed: 'normal' as const,
  shadowIntensity: 'normal' as const,

  // Default uiScale at 0.95 produces a tighter "premium hardware" density
  // across every surface (everything scales multiplicatively via
  // `calc(Npx * var(--ui-scale, 1))`). 1.0 is available via the theme
  // editor for users who prefer larger targets.
  uiScale: 0.95,
  contrastBoost: false,
} satisfies Omit<
  Primitives,
  'mode' | 'brand' | 'surfaceBase' | 'onSurface' | 'glassFillOpacity'
>

// ─── Preset definitions ──────────────────────────────────────────────────────

/**
 * HerOS Terracotta — the canonical Sovereign Glass DNA. Cinematic charcoal
 * foundation with warm terracotta kinetic blobs behind liquid-glass panels.
 * This is what the LoadingScreen, LoginPage, and first-launch experience use.
 *
 * Foundation is the deep charcoal `#0a0b0f` — the brand `#cc4c2b` drives
 * only the atmospheric blob clusters, rail indicator, chips, and selection
 * highlights. Making both the same flattened everything into uniform
 * terracotta, destroying the contrast-driven cinematic depth.
 */
const HEROS_TERRACOTTA: ThemePreset = {
  id: 'heros-terracotta',
  name: 'HerOS Terracotta',
  description:
    'Cinematic charcoal foundation, terracotta kinetic blobs, liquid glass. Default.',
  primitives: {
    mode: 'dark',
    brand: '#cc4c2b',
    surfaceBase: '#0a0b0f',
    onSurface: '#ffffff',
    glassFillOpacity: 0.12,
    ...BASE_GEOMETRY,
  },
}

/**
 * HerOS Midnight — same architecture, deep indigo foundation. For late-night
 * writing sessions where warm tones feel too aggressive.
 */
const HEROS_MIDNIGHT: ThemePreset = {
  id: 'heros-midnight',
  name: 'HerOS Midnight',
  description: 'Deep-indigo foundation for low-light writing. Same glass layer.',
  primitives: {
    mode: 'dark',
    brand: '#8083ff',
    surfaceBase: '#0f1025',
    onSurface: '#e3e1e9',
    glassFillOpacity: 0.06,
    ...BASE_GEOMETRY,
  },
}

/**
 * HerOS Paper — light-mode variant. Off-white foundation, warm accent, higher
 * glass opacity because blur over white can wash out.
 */
const HEROS_PAPER: ThemePreset = {
  id: 'heros-paper',
  name: 'HerOS Paper',
  description: 'Light-mode. Off-white foundation, warm accent, firm glass.',
  primitives: {
    mode: 'light',
    brand: '#b8431f',
    surfaceBase: '#faf6ee',
    onSurface: '#1c1c19',
    glassFillOpacity: 0.55,
    ...BASE_GEOMETRY,
  },
}

/**
 * HerOS High Contrast — accessibility preset. Pure black/white, solid accent,
 * no glass, thick dividers, animations off. Use as a baseline for users who
 * need maximum legibility or have motion sensitivity.
 */
const HEROS_HIGH_CONTRAST: ThemePreset = {
  id: 'heros-high-contrast',
  name: 'HerOS High Contrast',
  description:
    'Pure black/white, solid accent, no glass. WCAG AAA compliant.',
  primitives: {
    mode: 'dark',
    brand: '#ffcc33',
    surfaceBase: '#000000',
    onSurface: '#ffffff',
    glassFillOpacity: 0,
    ...BASE_GEOMETRY,
    glassBlur: 0,
    grainOpacity: 0,
    dividerWidth: 'thick',
    translucencyEnabled: false,
    animationSpeed: 'off',
    shadowIntensity: 'none',
    contrastBoost: true,
  },
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * All built-in presets, keyed by id for O(1) lookup. The Settings panel enumerates
 * this map to render the preset picker.
 *
 * Order of insertion = display order in the picker.
 */
export const PRESETS = {
  'heros-terracotta': HEROS_TERRACOTTA,
  'heros-midnight': HEROS_MIDNIGHT,
  'heros-paper': HEROS_PAPER,
  'heros-high-contrast': HEROS_HIGH_CONTRAST,
} as const satisfies Record<string, ThemePreset>

/**
 * Default preset used on first launch and when a stored `activeThemeId`
 * references a preset that no longer exists (plugin uninstalled, import from
 * foreign source). Intentionally a const reference — if you change this you're
 * changing the Infield default appearance.
 */
export const DEFAULT_PRESET_ID = 'heros-terracotta' as const

export function getPreset(id: string): ThemePreset {
  const preset = (PRESETS as Record<string, ThemePreset>)[id]
  return preset ?? PRESETS[DEFAULT_PRESET_ID]
}

export function listPresets(): ThemePreset[] {
  return Object.values(PRESETS)
}
