/**
 * Theme token system — the canonical contract for every visual value in Infield.
 *
 * This file is **pure data + pure functions**. No React, no DOM, no Tauri. That's
 * deliberate: the derivation math is unit-testable in isolation, and any future
 * surface (print preview, PDF export, email template) can consume the same
 * derivations without pulling in the rest of the app.
 *
 * ### Layering (see CLAUDE.md → Theme Module)
 *
 *   Tier 1  PRIMITIVES  — user-editable. ~20 knobs. Picked in Settings.
 *   Tier 2  SEMANTIC    — derived in CSS (color-mix / calc) from primitives.
 *                         Components consume these.
 *   Tier 3  COMPONENT   — derived in CSS from semantic. Rarely touched.
 *
 * This module defines Tier 1 only. Tiers 2 and 3 live in `src/App.css` and
 * read the primitives as CSS custom properties. That split keeps:
 *   - The contract tight: consumers don't import this file, they read
 *     `var(--heros-brand)`.
 *   - Live preview cheap: we set ~20 primitive CSS vars, and the browser's CSS
 *     engine does the O(n) semantic recalc for us.
 *
 * ### Live preview path (see CLAUDE.md → Theme Module → Senior-level notes)
 *
 *   user changes slider
 *     → themeStore.update(overrides)
 *     → ThemeProvider effect
 *     → deriveCssVars(preset + overrides)
 *     → rAF batch setProperty on document.documentElement
 *     → CSS engine recalculates semantic tokens
 *     → paint
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark' | 'system'

export type AnimationSpeed = 'off' | 'subtle' | 'normal' | 'lively'

export type ShadowIntensity = 'none' | 'soft' | 'normal' | 'deep'

export type DividerThickness = 'thin' | 'medium' | 'thick'

export type RadiusScale = 'sharp' | 'subtle' | 'default' | 'rounded' | 'pill'

/**
 * Built-in preset ids. `custom` is reserved for users who import a JSON theme
 * that doesn't match any built-in.
 */
export type PresetId =
  | 'heros-terracotta'
  | 'heros-midnight'
  | 'heros-paper'
  | 'heros-high-contrast'
  | 'custom'

// ─── Primitives ───────────────────────────────────────────────────────────────

/**
 * The exhaustive set of user-editable primitive tokens. Every Settings control
 * MUST map to exactly one field here. Everything else (semantic, component) is
 * derived from these — either in CSS (color-mix, calc) or at the edges of this
 * module (contrast checks, font-availability warnings).
 */
export interface Primitives {
  // ── Appearance ────────────────────────────────────────────────────────────
  mode: ThemeMode
  /** Hex `#rrggbb`. Drives accent, selection highlight, links, active states. */
  brand: string
  /** Hex `#rrggbb`. Base of the surface hierarchy (container-lowest..bright). */
  surfaceBase: string
  /** Hex `#rrggbb`. Primary text color. Muted/variant derived in CSS. */
  onSurface: string
  /** Radius preset — user-facing is 5 steps (sharp..pill). */
  radiusScale: RadiusScale

  // ── Glass / depth ─────────────────────────────────────────────────────────
  glassFillOpacity: number   // 0..1
  glassBlur: number          // px
  glassSaturate: number      // % (e.g. 120 for 120%)
  grainOpacity: number       // 0..1

  // ── Typography ────────────────────────────────────────────────────────────
  fontUI: string             // CSS font-family stack
  fontContent: string        // CSS font-family stack (editor body)
  fontMono: string           // CSS font-family stack (code blocks)
  fontSizeBase: number       // px; text-* scale derives modularly
  lineHeightBase: number     // unitless (e.g. 1.5)
  /** When non-null, editor body gets `max-width: <N>ch`. */
  maxLineCh: number | null

  // ── Layout ────────────────────────────────────────────────────────────────
  densityScale: number       // 0.85 compact, 1.0 normal, 1.15 comfortable
  dividerWidth: DividerThickness
  /** If true, request native vibrancy from the window shell (macOS/Win11). */
  translucencyEnabled: boolean

  // ── Motion ────────────────────────────────────────────────────────────────
  animationSpeed: AnimationSpeed
  shadowIntensity: ShadowIntensity

  // ── Accessibility ─────────────────────────────────────────────────────────
  uiScale: number            // 0.85, 1.0, 1.15, 1.3 — scales both space AND typography
  contrastBoost: boolean
}

export type ThemeOverrides = Partial<Primitives>

export interface ThemePreset {
  id: PresetId
  name: string
  description: string
  primitives: Primitives
}

/**
 * A resolved theme is a preset's primitives merged with the user's overrides.
 * This is what `deriveCssVars` takes as input.
 */
export type ResolvedTheme = Primitives

/**
 * The output of derivation: a flat map of CSS variable names to their string
 * values. This is what `ThemeProvider` writes to `document.documentElement`.
 *
 * Keys are always in `--kebab-case` form, matching the CSS syntax.
 */
export type CssVars = Record<string, string>

// ─── Merge ────────────────────────────────────────────────────────────────────

/**
 * Merge user overrides onto a preset. Null/undefined override values fall back
 * to the preset. Unknown keys are stripped (type-narrowed by TS at the caller).
 *
 * This is a **single-pass** merge — call it once per theme change and never
 * partially apply overrides, otherwise ThemeProvider's effect can fire twice
 * and produce a one-frame composite (CLAUDE.md: atomic preset switch).
 */
export function resolveTheme(
  preset: ThemePreset,
  overrides: ThemeOverrides = {},
): ResolvedTheme {
  const merged: Primitives = { ...preset.primitives }
  for (const key of Object.keys(overrides) as (keyof Primitives)[]) {
    const value = overrides[key]
    if (value === undefined || value === null) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(merged as any)[key] = value
  }
  return merged
}

// ─── Derivation ───────────────────────────────────────────────────────────────

const DURATION_SCALE: Record<AnimationSpeed, number> = {
  off: 0,
  subtle: 0.5,
  normal: 1,
  lively: 1.5,
}

const SHADOW_SCALE: Record<ShadowIntensity, number> = {
  none: 0,
  soft: 0.5,
  normal: 1,
  deep: 1.6,
}

const DIVIDER_PX: Record<DividerThickness, number> = {
  thin: 1,
  medium: 2,
  thick: 3,
}

const RADIUS_PX: Record<RadiusScale, number> = {
  sharp: 0,
  subtle: 4,
  default: 8,
  rounded: 14,
  pill: 24,
}

/**
 * Produce the flat CSS-variable map for a resolved theme.
 *
 * Contract:
 *   - Returns ONLY primitive-level variables. Semantic/component vars are
 *     derived in `src/App.css` from these via `color-mix()` and `calc()`.
 *   - All values are valid CSS syntax strings. Consumers can apply them
 *     without further processing.
 *   - `--ui-scale` and `--density-scale` compose multiplicatively — the CSS
 *     layer does `calc(base * var(--density-scale) * var(--ui-scale))`.
 *
 * See CLAUDE.md → Theme Module for the full token taxonomy.
 */
export function deriveCssVars(theme: ResolvedTheme): CssVars {
  const durationScale = DURATION_SCALE[theme.animationSpeed]
  const shadowScale = SHADOW_SCALE[theme.shadowIntensity]
  const dividerPx = DIVIDER_PX[theme.dividerWidth]
  const radiusPx = RADIUS_PX[theme.radiusScale]

  return {
    // ── Color primitives ─────────────────────────────────────────────────────
    '--heros-brand': theme.brand,
    '--heros-bg-foundation': theme.surfaceBase,
    '--on-surface': theme.onSurface,

    // ── Glass / depth ────────────────────────────────────────────────────────
    '--heros-glass-fill-opacity': theme.glassFillOpacity.toFixed(3),
    '--heros-glass-blur': `${theme.glassBlur}px`,
    '--heros-glass-saturate': `${theme.glassSaturate}%`,
    '--heros-grain-opacity': theme.grainOpacity.toFixed(3),

    // ── Geometry ─────────────────────────────────────────────────────────────
    '--radius-scale': `${radiusPx}px`,
    '--divider-width': `${dividerPx}px`,

    // ── Density + zoom (multiplicative, CSS composes via calc) ───────────────
    '--density-scale': theme.densityScale.toFixed(3),
    '--ui-scale': theme.uiScale.toFixed(3),

    // ── Typography ───────────────────────────────────────────────────────────
    '--font-ui': theme.fontUI,
    '--font-content': theme.fontContent,
    '--font-mono': theme.fontMono,
    '--font-size-base': `${theme.fontSizeBase}px`,
    '--line-height-base': theme.lineHeightBase.toFixed(3),
    '--editor-max-ch': theme.maxLineCh !== null ? `${theme.maxLineCh}ch` : 'none',

    // ── Motion ───────────────────────────────────────────────────────────────
    '--duration-scale': durationScale.toFixed(3),
    '--shadow-scale': shadowScale.toFixed(3),

    // ── Accessibility ────────────────────────────────────────────────────────
    '--contrast-boost': theme.contrastBoost ? '1' : '0',
  }
}

/**
 * Non-variable DOM attributes derived from a resolved theme. Written to
 * `document.documentElement` by ThemeProvider in the same rAF as CssVars, so
 * CSS rules that select on these attributes (e.g.
 * `html[data-contrast-boost="1"] { ... }`) stay atomic with the var flush.
 *
 * Why attributes instead of another CSS var: attribute substring selectors
 * like `[style*="--contrast-boost: 1"]` are fragile (they'd match
 * `--contrast-boost: 10` too if that ever appeared). Booleans and small enums
 * with dedicated selectors are the right tool. See F5 in the audit.
 */
export function deriveAttrs(theme: ResolvedTheme): Record<string, string> {
  return {
    'data-contrast-boost': theme.contrastBoost ? '1' : '0',
  }
}

/**
 * The set of CSS custom properties that MUST be registered with `@property` in
 * `src/App.css`. Without `@property` registration, CSS transitions on these
 * vars animate as `discrete` — sliders will snap, not tween. (MDN confirms.)
 *
 * Keep this list in sync with `src/App.css` @property blocks. The tests check
 * that every entry here is a numeric-typed primitive.
 */
export const REGISTERED_SLIDER_TOKENS = [
  '--heros-glass-fill-opacity',
  '--heros-grain-opacity',
  '--ui-scale',
  '--density-scale',
  '--duration-scale',
  '--shadow-scale',
] as const

// ─── Color math (contrast validation only; CSS engine handles color-mix) ─────

/** Parse `#rrggbb` or `#rgb` to `[r, g, b]` in 0-255. Returns null on malformed. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const h = m[1]
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ]
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/** Relative luminance per WCAG 2.1 §1.4.3. Input 0-255 sRGB; output 0..1. */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const srgb = [r, g, b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
}

/**
 * WCAG contrast ratio between two hex colors. Returns 1.0 on parse failure so
 * callers don't trip on malformed input — they should sanity-check the ratio
 * separately. Range: 1.0 (no contrast) to 21.0 (black on white).
 */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const fg = hexToRgb(fgHex)
  const bg = hexToRgb(bgHex)
  if (!fg || !bg) return 1
  const lFg = relativeLuminance(fg)
  const lBg = relativeLuminance(bg)
  const lighter = Math.max(lFg, lBg)
  const darker = Math.min(lFg, lBg)
  return (lighter + 0.05) / (darker + 0.05)
}

/** WCAG AA threshold for body text (4.5:1). */
export const WCAG_AA_RATIO = 4.5

/** WCAG AAA threshold for body text (7:1). */
export const WCAG_AAA_RATIO = 7

/**
 * Return a dev-time warning string when a theme's primary text on its base
 * surface falls below WCAG AA. Returns null when the combination passes.
 *
 * Used by ThemeProvider in dev builds to surface "you made the text
 * unreadable" before the user realizes the app is broken. See CLAUDE.md
 * Theme Module → Senior-level notes.
 */
export function checkContrastWarning(theme: ResolvedTheme): string | null {
  const ratio = contrastRatio(theme.onSurface, theme.surfaceBase)
  if (ratio >= WCAG_AA_RATIO) return null
  return (
    `Theme contrast ratio ${ratio.toFixed(2)} fails WCAG AA (${WCAG_AA_RATIO}). ` +
    `Text (${theme.onSurface}) may be unreadable on surface (${theme.surfaceBase}).`
  )
}

// ─── Derived-token contrast (muted / soft text composited over surface) ──────
//
// `--workspace-text-muted` and `--workspace-text-soft` are defined in
// semantic.css as `color-mix(in srgb, var(--on-surface) N%, transparent)`. The
// browser composites partial-alpha ink against whatever surface is painted
// behind the text. This module's job is to answer: "does the EFFECTIVE
// displayed color clear WCAG AA against the surface it sits on?"
//
// The alphas below MUST stay in sync with semantic.css. When you change one
// side, update the other — the presets tests enforce AA on the CSS alphas via
// these constants.
//
// Dark presets keep lower alphas because higher chroma surfaces (terracotta,
// indigo) eat contrast fast and hitting AA requires near-solid text that
// defeats the "muted" distinction. Accept as a design tradeoff; warning still
// fires in dev so regressions surface.

/** Per-mode alpha used for `--workspace-text-muted` in `semantic.css`. */
export const TEXT_MUTED_ALPHA = { dark: 0.65, light: 0.82 } as const

/** Per-mode alpha used for `--workspace-text-soft` in `semantic.css`. */
export const TEXT_SOFT_ALPHA = { dark: 0.40, light: 0.62 } as const

/** AA-large / UI-component contrast threshold (3:1, WCAG 1.4.11). */
export const WCAG_AA_LARGE_RATIO = 3

/**
 * Composite two sRGB colors with straight alpha — the same math browsers use
 * when a partially-transparent foreground paints over an opaque background.
 */
export function composite(
  fg: [number, number, number],
  bg: [number, number, number],
  alpha: number,
): [number, number, number] {
  const a = Math.max(0, Math.min(1, alpha))
  return [
    Math.round(a * fg[0] + (1 - a) * bg[0]),
    Math.round(a * fg[1] + (1 - a) * bg[1]),
    Math.round(a * fg[2] + (1 - a) * bg[2]),
  ]
}

/**
 * Contrast ratio of partial-alpha text against an opaque background. Same
 * output shape as `contrastRatio`. Returns 1.0 on parse failure.
 */
export function contrastOfAlphaText(
  fgHex: string,
  bgHex: string,
  alpha: number,
): number {
  const fg = hexToRgb(fgHex)
  const bg = hexToRgb(bgHex)
  if (!fg || !bg) return 1
  const effective = composite(fg, bg, alpha)
  const lFg = relativeLuminance(effective)
  const lBg = relativeLuminance(bg)
  const lighter = Math.max(lFg, lBg)
  const darker = Math.min(lFg, lBg)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Resolve the concrete display mode for contrast checks. `'system'` tracks
 * `prefers-color-scheme`; falls back to `'dark'` when matchMedia is unavailable
 * (SSR, test runner) so the check uses the higher-chroma baseline.
 */
function resolveContrastMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/**
 * Check whether the theme's derived muted/soft text tokens clear their
 * applicable thresholds against the foundation surface.
 *
 *   - muted → AA body text (4.5:1). Used for list counts, labels, helper
 *     copy. Failing this means a sighted user with normal vision will strain.
 *   - soft  → AA-large / UI component (3:1). Used for decorative scaffolding
 *     (secondary icons, ghost dividers). Lower bar, matches intent.
 *
 * Returns an empty array when both pass.
 */
export function checkDerivedContrastWarnings(theme: ResolvedTheme): string[] {
  const mode = resolveContrastMode(theme.mode)
  const mutedAlpha = TEXT_MUTED_ALPHA[mode]
  const softAlpha = TEXT_SOFT_ALPHA[mode]

  const warnings: string[] = []

  const mutedRatio = contrastOfAlphaText(
    theme.onSurface,
    theme.surfaceBase,
    mutedAlpha,
  )
  if (mutedRatio < WCAG_AA_RATIO) {
    warnings.push(
      `--workspace-text-muted contrast ${mutedRatio.toFixed(2)} fails WCAG AA ` +
        `(${WCAG_AA_RATIO}) at alpha ${mutedAlpha} in ${mode} mode. ` +
        `Bump TEXT_MUTED_ALPHA.${mode} in tokens.ts and the matching alpha in semantic.css.`,
    )
  }

  const softRatio = contrastOfAlphaText(
    theme.onSurface,
    theme.surfaceBase,
    softAlpha,
  )
  if (softRatio < WCAG_AA_LARGE_RATIO) {
    warnings.push(
      `--workspace-text-soft contrast ${softRatio.toFixed(2)} fails WCAG AA-large ` +
        `(${WCAG_AA_LARGE_RATIO}) at alpha ${softAlpha} in ${mode} mode. ` +
        `Bump TEXT_SOFT_ALPHA.${mode} in tokens.ts and the matching alpha in semantic.css.`,
    )
  }

  return warnings
}
