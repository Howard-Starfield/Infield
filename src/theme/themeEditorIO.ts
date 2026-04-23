/**
 * Theme import / export — JSON serialization with strict validation.
 *
 * Exported files are human-readable and hand-editable. The validation is
 * strict-but-forgiving: a malformed file returns a structured error, never
 * partially applies. Unknown fields are stripped (forward-compat when a
 * future version adds new primitives).
 */

import type {
  AnimationSpeed,
  DividerThickness,
  PresetId,
  Primitives,
  RadiusScale,
  ShadowIntensity,
  ThemeMode,
  ThemeOverrides,
} from './tokens'

export interface ThemeExport {
  $schema: 'infield.theme.v1'
  presetId: PresetId
  overrides: ThemeOverrides
}

/** Current export version. Bumped when the serialized shape changes. */
export const EXPORT_SCHEMA = 'infield.theme.v1' as const

const KNOWN_PRESET_IDS: ReadonlySet<PresetId> = new Set<PresetId>([
  'heros-terracotta',
  'heros-midnight',
  'heros-paper',
  'heros-high-contrast',
  'custom',
])

const KNOWN_MODES: ReadonlySet<ThemeMode> = new Set<ThemeMode>([
  'light',
  'dark',
  'system',
])

const KNOWN_ANIMATION_SPEEDS: ReadonlySet<AnimationSpeed> =
  new Set<AnimationSpeed>(['off', 'subtle', 'normal', 'lively'])

const KNOWN_SHADOW_INTENSITIES: ReadonlySet<ShadowIntensity> =
  new Set<ShadowIntensity>(['none', 'soft', 'normal', 'deep'])

const KNOWN_DIVIDER_THICKNESS: ReadonlySet<DividerThickness> =
  new Set<DividerThickness>(['thin', 'medium', 'thick'])

const KNOWN_RADIUS_SCALES: ReadonlySet<RadiusScale> = new Set<RadiusScale>([
  'sharp',
  'subtle',
  'default',
  'rounded',
  'pill',
])

/** Strict hex `#rrggbb` or `#rgb` validator. */
export function isValidHex(v: unknown): v is string {
  if (typeof v !== 'string') return false
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim())
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isNumberIn(v: unknown, min: number, max: number): v is number {
  return isFiniteNumber(v) && v >= min && v <= max
}

/**
 * Validate one field of an imported overrides object. Returns the cleaned
 * value on success, or undefined to drop the override silently. Dropping is
 * preferable to rejecting the whole import — a future version may add fields
 * we don't recognize yet, and rejecting would make Infield forward-incompatible.
 */
function validateOverride<K extends keyof Primitives>(
  key: K,
  raw: unknown,
): Primitives[K] | undefined {
  switch (key) {
    case 'mode':
      return KNOWN_MODES.has(raw as ThemeMode)
        ? (raw as Primitives[K])
        : undefined

    case 'brand':
    case 'surfaceBase':
    case 'onSurface':
      return isValidHex(raw) ? (raw as Primitives[K]) : undefined

    case 'radiusScale':
      return KNOWN_RADIUS_SCALES.has(raw as RadiusScale)
        ? (raw as Primitives[K])
        : undefined

    case 'glassFillOpacity':
    case 'grainOpacity':
      return isNumberIn(raw, 0, 1) ? (raw as Primitives[K]) : undefined

    case 'glassBlur':
      return isNumberIn(raw, 0, 200) ? (raw as Primitives[K]) : undefined

    case 'glassSaturate':
      return isNumberIn(raw, 0, 300) ? (raw as Primitives[K]) : undefined

    case 'fontUI':
    case 'fontContent':
    case 'fontMono':
      return typeof raw === 'string' && raw.length > 0
        ? (raw as Primitives[K])
        : undefined

    case 'fontSizeBase':
      return isNumberIn(raw, 10, 24) ? (raw as Primitives[K]) : undefined

    case 'lineHeightBase':
      return isNumberIn(raw, 1, 2.5) ? (raw as Primitives[K]) : undefined

    case 'maxLineCh':
      if (raw === null) return null as Primitives[K]
      return isNumberIn(raw, 40, 200) ? (raw as Primitives[K]) : undefined

    case 'densityScale':
      return isNumberIn(raw, 0.7, 1.4) ? (raw as Primitives[K]) : undefined

    case 'dividerWidth':
      return KNOWN_DIVIDER_THICKNESS.has(raw as DividerThickness)
        ? (raw as Primitives[K])
        : undefined

    case 'translucencyEnabled':
      return typeof raw === 'boolean' ? (raw as Primitives[K]) : undefined

    case 'animationSpeed':
      return KNOWN_ANIMATION_SPEEDS.has(raw as AnimationSpeed)
        ? (raw as Primitives[K])
        : undefined

    case 'shadowIntensity':
      return KNOWN_SHADOW_INTENSITIES.has(raw as ShadowIntensity)
        ? (raw as Primitives[K])
        : undefined

    case 'uiScale':
      return isNumberIn(raw, 0.5, 2) ? (raw as Primitives[K]) : undefined

    case 'contrastBoost':
      return typeof raw === 'boolean' ? (raw as Primitives[K]) : undefined

    default:
      // Unknown key — strip silently for forward compat.
      return undefined
  }
}

export type ImportResult =
  | { ok: true; value: ThemeExport }
  | { ok: false; error: string }

/**
 * Parse + validate a theme export JSON string. Returns a clean `ThemeExport`
 * or a structured error. Unknown override keys are stripped; unknown preset
 * ids become `'custom'`.
 */
export function parseThemeImport(raw: string): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Top-level value must be an object.' }
  }

  const obj = parsed as Record<string, unknown>

  if (obj.$schema !== EXPORT_SCHEMA) {
    return {
      ok: false,
      error: `Unknown schema version: ${String(obj.$schema)}. Expected ${EXPORT_SCHEMA}.`,
    }
  }

  const rawPresetId = obj.presetId
  let presetId: PresetId = 'custom'
  if (typeof rawPresetId === 'string' && KNOWN_PRESET_IDS.has(rawPresetId as PresetId)) {
    presetId = rawPresetId as PresetId
  }

  const rawOverrides = obj.overrides
  if (!rawOverrides || typeof rawOverrides !== 'object') {
    return { ok: false, error: '`overrides` must be an object.' }
  }

  const cleaned: ThemeOverrides = {}
  const rawOv = rawOverrides as Record<string, unknown>
  for (const key of Object.keys(rawOv) as (keyof Primitives)[]) {
    const validated = validateOverride(key, rawOv[key])
    if (validated !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cleaned as any)[key] = validated
    }
  }

  return {
    ok: true,
    value: { $schema: EXPORT_SCHEMA, presetId, overrides: cleaned },
  }
}

/** Serialize the current selection for export. */
export function serializeThemeExport(
  presetId: PresetId,
  overrides: ThemeOverrides,
): string {
  const payload: ThemeExport = {
    $schema: EXPORT_SCHEMA,
    presetId,
    overrides,
  }
  return JSON.stringify(payload, null, 2)
}
