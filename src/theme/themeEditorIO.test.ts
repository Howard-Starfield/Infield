import { describe, expect, it } from 'vitest'
import {
  EXPORT_SCHEMA,
  isValidHex,
  parseThemeImport,
  serializeThemeExport,
} from './themeEditorIO'
import { PRESETS, DEFAULT_PRESET_ID } from './presets'

describe('isValidHex', () => {
  it('accepts 6-digit hex with hash', () => {
    expect(isValidHex('#cc4c2b')).toBe(true)
    expect(isValidHex('#FFFFFF')).toBe(true)
  })

  it('accepts 3-digit hex with hash', () => {
    expect(isValidHex('#fff')).toBe(true)
    expect(isValidHex('#abc')).toBe(true)
  })

  it('rejects hex without hash', () => {
    expect(isValidHex('cc4c2b')).toBe(false)
  })

  it('rejects malformed input', () => {
    expect(isValidHex('')).toBe(false)
    expect(isValidHex('#ggg')).toBe(false)
    expect(isValidHex('#12345')).toBe(false)
    expect(isValidHex('rgb(0,0,0)')).toBe(false)
    expect(isValidHex(null)).toBe(false)
    expect(isValidHex(42)).toBe(false)
    expect(isValidHex({})).toBe(false)
  })
})

describe('parseThemeImport — structural errors', () => {
  it('rejects non-JSON input with parse error', () => {
    const result = parseThemeImport('{not json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Invalid JSON/)
  })

  it('rejects non-object top level', () => {
    expect(parseThemeImport('"string"').ok).toBe(false)
    expect(parseThemeImport('42').ok).toBe(false)
    expect(parseThemeImport('null').ok).toBe(false)
  })

  it('rejects unknown schema version', () => {
    const result = parseThemeImport(
      JSON.stringify({ $schema: 'infield.theme.v2', overrides: {} }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/schema version/)
  })

  it('rejects missing overrides', () => {
    const result = parseThemeImport(
      JSON.stringify({ $schema: EXPORT_SCHEMA, presetId: 'heros-terracotta' }),
    )
    expect(result.ok).toBe(false)
  })

  it('rejects non-object overrides', () => {
    const result = parseThemeImport(
      JSON.stringify({
        $schema: EXPORT_SCHEMA,
        presetId: 'heros-terracotta',
        overrides: 'not an object',
      }),
    )
    expect(result.ok).toBe(false)
  })
})

describe('parseThemeImport — preset id handling', () => {
  it('accepts a known preset id', () => {
    const result = parseThemeImport(
      JSON.stringify({
        $schema: EXPORT_SCHEMA,
        presetId: 'heros-midnight',
        overrides: {},
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.presetId).toBe('heros-midnight')
  })

  it('degrades unknown preset id to "custom" (forward-compat)', () => {
    const result = parseThemeImport(
      JSON.stringify({
        $schema: EXPORT_SCHEMA,
        presetId: 'plugin.some-future-preset',
        overrides: {},
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.presetId).toBe('custom')
  })

  it('degrades missing preset id to "custom"', () => {
    const result = parseThemeImport(
      JSON.stringify({ $schema: EXPORT_SCHEMA, overrides: {} }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.presetId).toBe('custom')
  })
})

describe('parseThemeImport — override validation', () => {
  it('accepts valid hex colors', () => {
    const result = parseThemeImport(
      JSON.stringify({
        $schema: EXPORT_SCHEMA,
        presetId: 'heros-terracotta',
        overrides: { brand: '#00ff00', surfaceBase: '#123456', onSurface: '#fff' },
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.overrides.brand).toBe('#00ff00')
      expect(result.value.overrides.surfaceBase).toBe('#123456')
      expect(result.value.overrides.onSurface).toBe('#fff')
    }
  })

  it('strips invalid hex colors silently', () => {
    const result = parseThemeImport(
      JSON.stringify({
        $schema: EXPORT_SCHEMA,
        presetId: 'heros-terracotta',
        overrides: { brand: 'not-a-color', surfaceBase: '#abcdef' },
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.overrides.brand).toBeUndefined()
      expect(result.value.overrides.surfaceBase).toBe('#abcdef')
    }
  })

  it('accepts numeric primitives within range', () => {
    const result = parseThemeImport(
      JSON.stringify({
        $schema: EXPORT_SCHEMA,
        presetId: 'heros-terracotta',
        overrides: {
          glassFillOpacity: 0.5,
          glassBlur: 32,
          uiScale: 1.3,
          densityScale: 0.85,
          fontSizeBase: 14,
          lineHeightBase: 1.6,
        },
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.overrides.glassFillOpacity).toBe(0.5)
      expect(result.value.overrides.uiScale).toBe(1.3)
    }
  })

  it('rejects out-of-range numeric primitives', () => {
    const result = parseThemeImport(
      JSON.stringify({
        $schema: EXPORT_SCHEMA,
        presetId: 'heros-terracotta',
        overrides: {
          glassFillOpacity: 2,       // > 1
          uiScale: 10,               // > 2
          fontSizeBase: 100,         // > 24
          lineHeightBase: 3,         // > 2.5
        },
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.overrides.glassFillOpacity).toBeUndefined()
      expect(result.value.overrides.uiScale).toBeUndefined()
      expect(result.value.overrides.fontSizeBase).toBeUndefined()
      expect(result.value.overrides.lineHeightBase).toBeUndefined()
    }
  })

  it('rejects NaN / Infinity as numeric values', () => {
    const result = parseThemeImport(
      JSON.stringify({
        $schema: EXPORT_SCHEMA,
        presetId: 'heros-terracotta',
        overrides: { glassFillOpacity: 'NaN' },
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.overrides.glassFillOpacity).toBeUndefined()
  })

  it('accepts valid enum values', () => {
    const result = parseThemeImport(
      JSON.stringify({
        $schema: EXPORT_SCHEMA,
        presetId: 'heros-terracotta',
        overrides: {
          mode: 'dark',
          radiusScale: 'pill',
          animationSpeed: 'lively',
          shadowIntensity: 'deep',
          dividerWidth: 'thick',
        },
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.overrides.mode).toBe('dark')
      expect(result.value.overrides.radiusScale).toBe('pill')
      expect(result.value.overrides.animationSpeed).toBe('lively')
    }
  })

  it('strips unknown enum values', () => {
    const result = parseThemeImport(
      JSON.stringify({
        $schema: EXPORT_SCHEMA,
        presetId: 'heros-terracotta',
        overrides: {
          mode: 'plaid',
          radiusScale: 'diamond',
          animationSpeed: 'frenetic',
        },
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.overrides.mode).toBeUndefined()
      expect(result.value.overrides.radiusScale).toBeUndefined()
      expect(result.value.overrides.animationSpeed).toBeUndefined()
    }
  })

  it('accepts null for maxLineCh (explicit unbounded)', () => {
    const result = parseThemeImport(
      JSON.stringify({
        $schema: EXPORT_SCHEMA,
        presetId: 'heros-terracotta',
        overrides: { maxLineCh: null },
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.overrides.maxLineCh).toBe(null)
  })

  it('rejects non-boolean for boolean fields', () => {
    const result = parseThemeImport(
      JSON.stringify({
        $schema: EXPORT_SCHEMA,
        presetId: 'heros-terracotta',
        overrides: { contrastBoost: 'yes', translucencyEnabled: 1 },
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.overrides.contrastBoost).toBeUndefined()
      expect(result.value.overrides.translucencyEnabled).toBeUndefined()
    }
  })

  it('strips unknown keys silently (forward-compat)', () => {
    const result = parseThemeImport(
      JSON.stringify({
        $schema: EXPORT_SCHEMA,
        presetId: 'heros-terracotta',
        overrides: {
          brand: '#00ff00',
          futureFieldName: 'probably-matters-in-v2',
          anotherOne: 42,
        },
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.overrides.brand).toBe('#00ff00')
      expect(
        (result.value.overrides as Record<string, unknown>).futureFieldName,
      ).toBeUndefined()
    }
  })
})

describe('serializeThemeExport', () => {
  it('produces valid JSON with the current schema version', () => {
    const json = serializeThemeExport('heros-terracotta', { brand: '#00ff00' })
    const parsed = JSON.parse(json) as Record<string, unknown>
    expect(parsed.$schema).toBe(EXPORT_SCHEMA)
    expect(parsed.presetId).toBe('heros-terracotta')
    expect(parsed.overrides).toEqual({ brand: '#00ff00' })
  })

  it('round-trips through parseThemeImport', () => {
    const original = {
      presetId: 'heros-midnight' as const,
      overrides: {
        brand: '#abcdef',
        uiScale: 1.15,
        animationSpeed: 'subtle' as const,
      },
    }
    const json = serializeThemeExport(original.presetId, original.overrides)
    const result = parseThemeImport(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.presetId).toBe(original.presetId)
      expect(result.value.overrides).toEqual(original.overrides)
    }
  })

  it('every preset exported and re-imported matches identity', () => {
    for (const preset of Object.values(PRESETS)) {
      const json = serializeThemeExport(preset.id, {})
      const result = parseThemeImport(json)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.presetId).toBe(preset.id)
        expect(result.value.overrides).toEqual({})
      }
    }
  })

  it('default preset id always round-trips', () => {
    const json = serializeThemeExport(DEFAULT_PRESET_ID, {})
    const result = parseThemeImport(json)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.presetId).toBe(DEFAULT_PRESET_ID)
  })
})
