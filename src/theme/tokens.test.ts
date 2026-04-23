import { describe, expect, it } from 'vitest'
import {
  REGISTERED_SLIDER_TOKENS,
  TEXT_MUTED_ALPHA,
  TEXT_SOFT_ALPHA,
  WCAG_AA_LARGE_RATIO,
  WCAG_AA_RATIO,
  checkContrastWarning,
  checkDerivedContrastWarnings,
  composite,
  contrastOfAlphaText,
  contrastRatio,
  deriveAttrs,
  deriveCssVars,
  hexToRgb,
  relativeLuminance,
  resolveTheme,
} from './tokens'
import { DEFAULT_PRESET_ID, PRESETS, getPreset, listPresets } from './presets'

// ─── resolveTheme ─────────────────────────────────────────────────────────────

describe('resolveTheme', () => {
  it('returns preset primitives unchanged when no overrides', () => {
    const preset = PRESETS['heros-terracotta']
    const resolved = resolveTheme(preset)
    expect(resolved).toEqual(preset.primitives)
  })

  it('applies scalar overrides on top of the preset', () => {
    const preset = PRESETS['heros-terracotta']
    const resolved = resolveTheme(preset, { brand: '#00ff00', uiScale: 1.3 })
    expect(resolved.brand).toBe('#00ff00')
    expect(resolved.uiScale).toBe(1.3)
    expect(resolved.surfaceBase).toBe(preset.primitives.surfaceBase)
  })

  it('ignores undefined and null override values (preset wins)', () => {
    const preset = PRESETS['heros-terracotta']
    const resolved = resolveTheme(preset, {
      brand: undefined,
      onSurface: undefined,
    })
    expect(resolved.brand).toBe(preset.primitives.brand)
    expect(resolved.onSurface).toBe(preset.primitives.onSurface)
  })

  it('is pure — does not mutate the preset', () => {
    const preset = PRESETS['heros-terracotta']
    const snapshot = JSON.stringify(preset.primitives)
    resolveTheme(preset, { brand: '#abcdef', uiScale: 1.3 })
    expect(JSON.stringify(preset.primitives)).toBe(snapshot)
  })
})

// ─── deriveCssVars ────────────────────────────────────────────────────────────

describe('deriveCssVars', () => {
  const theme = PRESETS[DEFAULT_PRESET_ID].primitives

  it('emits every required primitive variable', () => {
    const vars = deriveCssVars(theme)
    // Color primitives
    expect(vars).toHaveProperty('--heros-brand')
    expect(vars).toHaveProperty('--heros-bg-foundation')
    expect(vars).toHaveProperty('--on-surface')
    // Glass
    expect(vars).toHaveProperty('--heros-glass-fill-opacity')
    expect(vars).toHaveProperty('--heros-glass-blur')
    expect(vars).toHaveProperty('--heros-glass-saturate')
    expect(vars).toHaveProperty('--heros-grain-opacity')
    // Geometry
    expect(vars).toHaveProperty('--radius-scale')
    expect(vars).toHaveProperty('--divider-width')
    // Scaling (composed in CSS)
    expect(vars).toHaveProperty('--density-scale')
    expect(vars).toHaveProperty('--ui-scale')
    // Typography
    expect(vars).toHaveProperty('--font-ui')
    expect(vars).toHaveProperty('--font-content')
    expect(vars).toHaveProperty('--font-mono')
    expect(vars).toHaveProperty('--font-size-base')
    expect(vars).toHaveProperty('--line-height-base')
    expect(vars).toHaveProperty('--editor-max-ch')
    // Motion
    expect(vars).toHaveProperty('--duration-scale')
    expect(vars).toHaveProperty('--shadow-scale')
    // Accessibility
    expect(vars).toHaveProperty('--contrast-boost')
  })

  it('every emitted value is a valid CSS string (non-empty)', () => {
    const vars = deriveCssVars(theme)
    for (const [k, v] of Object.entries(vars)) {
      expect(v, `token ${k} should be non-empty`).not.toBe('')
      expect(typeof v).toBe('string')
    }
  })

  it('numeric primitives survive round-trip as parseable numbers', () => {
    const vars = deriveCssVars(theme)
    expect(Number(vars['--heros-glass-fill-opacity'])).toBeCloseTo(
      theme.glassFillOpacity,
      3,
    )
    expect(Number(vars['--ui-scale'])).toBeCloseTo(theme.uiScale, 3)
    expect(Number(vars['--density-scale'])).toBeCloseTo(theme.densityScale, 3)
  })

  it('maps animation speed "off" to duration-scale 0', () => {
    const vars = deriveCssVars({ ...theme, animationSpeed: 'off' })
    expect(vars['--duration-scale']).toBe('0.000')
  })

  it('maps animation speed "lively" to duration-scale > 1', () => {
    const vars = deriveCssVars({ ...theme, animationSpeed: 'lively' })
    expect(Number(vars['--duration-scale'])).toBeGreaterThan(1)
  })

  it('maps shadow intensity "none" to shadow-scale 0', () => {
    const vars = deriveCssVars({ ...theme, shadowIntensity: 'none' })
    expect(vars['--shadow-scale']).toBe('0.000')
  })

  it('divider thickness presets produce distinct pixel widths', () => {
    const thin = deriveCssVars({ ...theme, dividerWidth: 'thin' })['--divider-width']
    const medium = deriveCssVars({ ...theme, dividerWidth: 'medium' })['--divider-width']
    const thick = deriveCssVars({ ...theme, dividerWidth: 'thick' })['--divider-width']
    expect(thin).toBe('1px')
    expect(medium).toBe('2px')
    expect(thick).toBe('3px')
  })

  it('radius presets span sharp-to-pill', () => {
    expect(deriveCssVars({ ...theme, radiusScale: 'sharp' })['--radius-scale']).toBe('0px')
    expect(deriveCssVars({ ...theme, radiusScale: 'pill' })['--radius-scale']).toBe('24px')
  })

  it('null max-line-ch emits "none", keeping editor body unconstrained', () => {
    const vars = deriveCssVars({ ...theme, maxLineCh: null })
    expect(vars['--editor-max-ch']).toBe('none')
  })

  it('non-null max-line-ch emits a ch unit suitable for max-width', () => {
    const vars = deriveCssVars({ ...theme, maxLineCh: 72 })
    expect(vars['--editor-max-ch']).toBe('72ch')
  })

  it('contrast-boost toggle emits "0" / "1" for CSS conditional use', () => {
    expect(deriveCssVars({ ...theme, contrastBoost: false })['--contrast-boost']).toBe('0')
    expect(deriveCssVars({ ...theme, contrastBoost: true })['--contrast-boost']).toBe('1')
  })
})

// ─── REGISTERED_SLIDER_TOKENS ─────────────────────────────────────────────────

describe('deriveAttrs', () => {
  const base = PRESETS[DEFAULT_PRESET_ID].primitives

  it('emits data-contrast-boost="0" for default theme', () => {
    expect(deriveAttrs(base)['data-contrast-boost']).toBe('0')
  })

  it('emits data-contrast-boost="1" when contrast boost is on', () => {
    expect(deriveAttrs({ ...base, contrastBoost: true })['data-contrast-boost']).toBe(
      '1',
    )
  })

  it('high-contrast preset produces data-contrast-boost="1"', () => {
    expect(
      deriveAttrs(PRESETS['heros-high-contrast'].primitives)['data-contrast-boost'],
    ).toBe('1')
  })
})

describe('REGISTERED_SLIDER_TOKENS', () => {
  it('every slider token is an emitted primitive', () => {
    const emitted = new Set(Object.keys(deriveCssVars(PRESETS[DEFAULT_PRESET_ID].primitives)))
    for (const token of REGISTERED_SLIDER_TOKENS) {
      expect(emitted.has(token), `slider token ${token} must be emitted by deriveCssVars`).toBe(true)
    }
  })

  it('covers the slider-driven primitives named in CLAUDE.md', () => {
    expect(REGISTERED_SLIDER_TOKENS).toContain('--heros-glass-fill-opacity')
    expect(REGISTERED_SLIDER_TOKENS).toContain('--heros-grain-opacity')
    expect(REGISTERED_SLIDER_TOKENS).toContain('--ui-scale')
    expect(REGISTERED_SLIDER_TOKENS).toContain('--density-scale')
    // duration and shadow are also slider-driven (Animation speed, Shadow intensity)
    expect(REGISTERED_SLIDER_TOKENS).toContain('--duration-scale')
    expect(REGISTERED_SLIDER_TOKENS).toContain('--shadow-scale')
  })
})

// ─── Color math ──────────────────────────────────────────────────────────────

describe('hexToRgb', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0])
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255])
    expect(hexToRgb('#cc4c2b')).toEqual([204, 76, 43])
  })

  it('parses 3-digit hex (expands each nybble)', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255])
    expect(hexToRgb('#abc')).toEqual([170, 187, 204])
  })

  it('accepts with or without leading #', () => {
    expect(hexToRgb('ffffff')).toEqual([255, 255, 255])
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255])
  })

  it('returns null on malformed input', () => {
    expect(hexToRgb('')).toBeNull()
    expect(hexToRgb('not-a-hex')).toBeNull()
    expect(hexToRgb('#ggg')).toBeNull()
    expect(hexToRgb('#12345')).toBeNull()
  })
})

describe('relativeLuminance', () => {
  it('black = 0', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5)
  })

  it('white = 1', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5)
  })

  it('monotonic across grayscale', () => {
    const lums = [0, 64, 128, 192, 255].map((v) => relativeLuminance([v, v, v]))
    for (let i = 1; i < lums.length; i++) {
      expect(lums[i]).toBeGreaterThan(lums[i - 1])
    }
  })
})

describe('contrastRatio', () => {
  it('black on white = 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('white on black = 21 (symmetric)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1)
  })

  it('same-color = 1 (no contrast)', () => {
    expect(contrastRatio('#888888', '#888888')).toBeCloseTo(1, 5)
  })

  it('returns 1 on malformed inputs (safe default)', () => {
    expect(contrastRatio('not-a-hex', '#000000')).toBe(1)
    expect(contrastRatio('#000000', 'not-a-hex')).toBe(1)
  })
})

describe('composite', () => {
  it('alpha 1 returns the foreground unchanged', () => {
    expect(composite([255, 0, 0], [0, 0, 255], 1)).toEqual([255, 0, 0])
  })

  it('alpha 0 returns the background unchanged', () => {
    expect(composite([255, 0, 0], [0, 0, 255], 0)).toEqual([0, 0, 255])
  })

  it('alpha 0.5 midpoint blend', () => {
    expect(composite([200, 100, 0], [0, 100, 200], 0.5)).toEqual([100, 100, 100])
  })

  it('clamps alpha > 1', () => {
    expect(composite([255, 255, 255], [0, 0, 0], 2)).toEqual([255, 255, 255])
  })

  it('clamps negative alpha', () => {
    expect(composite([255, 255, 255], [0, 0, 0], -0.5)).toEqual([0, 0, 0])
  })
})

describe('contrastOfAlphaText', () => {
  it('alpha 1 matches contrastRatio', () => {
    const alpha1 = contrastOfAlphaText('#ffffff', '#000000', 1)
    const direct = contrastRatio('#ffffff', '#000000')
    expect(alpha1).toBeCloseTo(direct, 1)
  })

  it('lower alpha → text blends toward bg → lower ratio', () => {
    const high = contrastOfAlphaText('#ffffff', '#000000', 0.9)
    const low = contrastOfAlphaText('#ffffff', '#000000', 0.3)
    expect(high).toBeGreaterThan(low)
  })

  it('returns 1 on malformed inputs', () => {
    expect(contrastOfAlphaText('bogus', '#000000', 0.5)).toBe(1)
    expect(contrastOfAlphaText('#000000', 'bogus', 0.5)).toBe(1)
  })
})

describe('Paper preset: derived text alphas clear thresholds', () => {
  // These tests are the safety net for the B3/Q6 fix. If someone edits one
  // side (semantic.css OR tokens.ts) without the other, contrast drifts below
  // AA on Paper and the dev-warning fires — but nobody notices until a user
  // files a ticket. These tests break the build instead.
  const paper = PRESETS['heros-paper'].primitives

  it('muted text at TEXT_MUTED_ALPHA.light clears WCAG AA 4.5:1', () => {
    const ratio = contrastOfAlphaText(
      paper.onSurface,
      paper.surfaceBase,
      TEXT_MUTED_ALPHA.light,
    )
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_RATIO)
  })

  it('soft text at TEXT_SOFT_ALPHA.light clears WCAG AA-large 3:1', () => {
    const ratio = contrastOfAlphaText(
      paper.onSurface,
      paper.surfaceBase,
      TEXT_SOFT_ALPHA.light,
    )
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_LARGE_RATIO)
  })

  it('checkDerivedContrastWarnings returns empty for Paper', () => {
    // Paper preset declares mode: 'light', so resolveContrastMode → 'light'
    // and the AA alpha lookup picks the bumped values.
    expect(checkDerivedContrastWarnings(paper)).toEqual([])
  })
})

describe('checkDerivedContrastWarnings', () => {
  it('warns when muted alpha fails AA on a pathological theme', () => {
    const broken = {
      ...PRESETS['heros-paper'].primitives,
      // Off-white text on white bg — muted composition never clears AA.
      onSurface: '#e8e4dc',
    }
    const warnings = checkDerivedContrastWarnings(broken)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some((w) => w.includes('--workspace-text-muted'))).toBe(true)
  })

  it('high-contrast preset produces zero derived warnings', () => {
    // Pure black/white should clear both AA and AA-large trivially.
    expect(
      checkDerivedContrastWarnings(PRESETS['heros-high-contrast'].primitives),
    ).toEqual([])
  })
})

describe('checkContrastWarning', () => {
  it('passes the default HerOS Terracotta preset', () => {
    const warning = checkContrastWarning(PRESETS['heros-terracotta'].primitives)
    // #ffffff on #cc4c2b ≈ 5.17:1 — clears AA. The kit's cream `#fdf9f3`
    // lands at ~4.32:1, which is why we bumped to pure white in the preset.
    expect(warning).toBeNull()
  })

  it('passes the high-contrast preset (pure black/white)', () => {
    expect(checkContrastWarning(PRESETS['heros-high-contrast'].primitives)).toBeNull()
  })

  it('flags text that would be unreadable', () => {
    // surfaceBase is `#0a0b0f` (charcoal); `#1a1c22` is nearly the same
    // near-black tone, ~1.25:1 contrast — well below WCAG AA 4.5:1.
    const broken = {
      ...PRESETS['heros-terracotta'].primitives,
      onSurface: '#1a1c22',
    }
    const warning = checkContrastWarning(broken)
    expect(warning).not.toBeNull()
    expect(warning).toContain('WCAG AA')
  })

  it('threshold is exactly WCAG AA 4.5:1', () => {
    expect(WCAG_AA_RATIO).toBe(4.5)
  })
})

// ─── Preset registry ─────────────────────────────────────────────────────────

describe('preset registry', () => {
  it('every preset id in the PresetId union exists in PRESETS', () => {
    // The `as const satisfies` on PRESETS guarantees this structurally, but
    // a runtime sanity check catches drift between the enum and the registry.
    expect(PRESETS['heros-terracotta'].id).toBe('heros-terracotta')
    expect(PRESETS['heros-midnight'].id).toBe('heros-midnight')
    expect(PRESETS['heros-paper'].id).toBe('heros-paper')
    expect(PRESETS['heros-high-contrast'].id).toBe('heros-high-contrast')
  })

  it('getPreset falls back to default on unknown id', () => {
    expect(getPreset('does-not-exist').id).toBe(DEFAULT_PRESET_ID)
  })

  it('getPreset returns the requested preset when it exists', () => {
    expect(getPreset('heros-midnight').id).toBe('heros-midnight')
  })

  it('listPresets returns all four built-ins', () => {
    const list = listPresets()
    expect(list).toHaveLength(4)
    expect(list.map((p) => p.id)).toContain(DEFAULT_PRESET_ID)
  })

  it('every preset passes its own contrast check', () => {
    for (const preset of listPresets()) {
      const warning = checkContrastWarning(preset.primitives)
      expect(warning, `preset ${preset.id} fails contrast: ${warning}`).toBeNull()
    }
  })

  it('every preset fully populates Primitives (no missing fields)', () => {
    const requiredKeys = Object.keys(PRESETS['heros-terracotta'].primitives)
    for (const preset of listPresets()) {
      for (const key of requiredKeys) {
        expect(
          preset.primitives,
          `preset ${preset.id} missing primitive ${key}`,
        ).toHaveProperty(key)
      }
    }
  })

  it('every preset can be derived without throwing', () => {
    for (const preset of listPresets()) {
      expect(() => deriveCssVars(preset.primitives)).not.toThrow()
    }
  })
})
