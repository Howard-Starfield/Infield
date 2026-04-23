/**
 * ThemeEditorPanel — Phase 1 customization UI.
 *
 * Edge cases covered:
 *   - URL-param preview mode shows a non-dismissable banner and blocks the
 *     Export button (exported state would reflect QA overrides, not real user
 *     state).
 *   - Invalid hex text input shows inline error; the color is not applied
 *     until the field parses.
 *   - Contrast warning fires inline below the accent picker whenever the
 *     current onSurface × surfaceBase fails WCAG AA.
 *   - Per-control reset (`↺`) only renders when an override exists for that
 *     key; keeps the UI clean and reinforces which settings the user
 *     personally touched.
 *   - All controls are keyboard-accessible. Escape closes the modal; Tab
 *     cycles through controls in DOM order.
 *   - Live preview: onChange handlers update the store immediately (ThemeProvider
 *     rAF-batches the DOM flush). `onValueCommit`-style semantics happen
 *     implicitly via the store subscription, no flushSync gymnastics needed.
 *
 * See CLAUDE.md → Theme Module → User-facing settings taxonomy for the
 * control list. Controls deferred to Phase 2+ (fonts, blur, frame style,
 * syntax highlighting) are intentionally NOT rendered here.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useThemeStore } from './themeStore'
import { DEFAULT_PRESET_ID, PRESETS, getPreset, listPresets } from './presets'
import {
  checkContrastWarning,
  resolveTheme,
  type AnimationSpeed,
  type DividerThickness,
  type PresetId,
  type Primitives,
  type RadiusScale,
  type ShadowIntensity,
  type ThemeMode,
} from './tokens'
import { parseThemeImport, serializeThemeExport } from './themeEditorIO'
import './themeEditor.css'

// ─── Shared option lists ─────────────────────────────────────────────────────

const MODES: Array<{ id: ThemeMode; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
]

const RADIUS_OPTIONS: Array<{ id: RadiusScale; label: string }> = [
  { id: 'sharp', label: '0' },
  { id: 'subtle', label: '4' },
  { id: 'default', label: '8' },
  { id: 'rounded', label: '14' },
  { id: 'pill', label: '24' },
]

const DENSITY_OPTIONS: Array<{ id: number; label: string }> = [
  { id: 0.85, label: 'Compact' },
  { id: 1.0, label: 'Normal' },
  { id: 1.15, label: 'Cozy' },
]

const UI_SCALE_OPTIONS: Array<{ id: number; label: string }> = [
  { id: 0.85, label: '85%' },
  { id: 1.0, label: '100%' },
  { id: 1.15, label: '115%' },
  { id: 1.3, label: '130%' },
]

const ANIMATION_OPTIONS: Array<{ id: AnimationSpeed; label: string }> = [
  { id: 'off', label: 'Off' },
  { id: 'subtle', label: 'Subtle' },
  { id: 'normal', label: 'Normal' },
  { id: 'lively', label: 'Lively' },
]

const SHADOW_OPTIONS: Array<{ id: ShadowIntensity; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'soft', label: 'Soft' },
  { id: 'normal', label: 'Normal' },
  { id: 'deep', label: 'Deep' },
]

const DIVIDER_OPTIONS: Array<{ id: DividerThickness; label: string }> = [
  { id: 'thin', label: 'Thin' },
  { id: 'medium', label: 'Medium' },
  { id: 'thick', label: 'Thick' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hasUrlPreviewMode(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).has('theme')
  } catch {
    return false
  }
}

// ─── Segmented control (shared primitive) ────────────────────────────────────

interface SegmentedProps<T extends string | number> {
  options: ReadonlyArray<{ id: T; label: string }>
  value: T
  onChange: (next: T) => void
  ariaLabel: string
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div
      className="theme-editor-segmented"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <button
          key={String(opt.id)}
          type="button"
          className="theme-editor-segmented-btn"
          aria-pressed={opt.id === value}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ─── Color field ─────────────────────────────────────────────────────────────

interface ColorFieldProps {
  value: string
  onChange: (hex: string) => void
  ariaLabel: string
}

function ColorField({ value, onChange, ariaLabel }: ColorFieldProps) {
  const [text, setText] = useState(value)
  const [invalid, setInvalid] = useState(false)

  // Sync external value changes (preset switch / reset) into the text field.
  useEffect(() => {
    setText(value)
    setInvalid(false)
  }, [value])

  const commit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim()
      if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
        setInvalid(false)
        onChange(trimmed.toLowerCase())
      } else {
        setInvalid(true)
      }
    },
    [onChange],
  )

  return (
    <div className="theme-editor-color">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(text)
        }}
        aria-invalid={invalid}
        aria-label={`${ariaLabel} hex input`}
      />
    </div>
  )
}

// ─── Slider field ────────────────────────────────────────────────────────────

interface SliderFieldProps {
  value: number
  onChange: (next: number) => void
  min: number
  max: number
  step: number
  unit?: string
  ariaLabel: string
  format?: (v: number) => string
}

function SliderField({
  value,
  onChange,
  min,
  max,
  step,
  unit,
  ariaLabel,
  format,
}: SliderFieldProps) {
  return (
    <div className="theme-editor-slider-wrap">
      <input
        type="range"
        className="theme-editor-slider"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
      />
      <span className="theme-editor-slider-value" aria-hidden="true">
        {format ? format(value) : `${value}${unit ?? ''}`}
      </span>
    </div>
  )
}

// ─── Reset button ────────────────────────────────────────────────────────────

function ResetButton({
  active,
  onReset,
  title,
}: {
  active: boolean
  onReset: () => void
  title: string
}) {
  return (
    <button
      type="button"
      className="theme-editor-reset"
      disabled={!active}
      onClick={onReset}
      title={title}
      aria-label={title}
    >
      ↺
    </button>
  )
}

// ─── Row wrapper ─────────────────────────────────────────────────────────────

function Row({
  label,
  sub,
  control,
  reset,
}: {
  label: string
  sub?: string
  control: React.ReactNode
  reset: React.ReactNode
}) {
  return (
    <div className="theme-editor-row">
      <div>
        <div className="theme-editor-label">{label}</div>
        {sub ? <div className="theme-editor-label-sub">{sub}</div> : null}
      </div>
      <div className="theme-editor-control">{control}</div>
      {reset}
    </div>
  )
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export interface ThemeEditorPanelProps {
  onClose?: () => void
}

export function ThemeEditorPanel({ onClose }: ThemeEditorPanelProps) {
  const presetId = useThemeStore((s) => s.presetId)
  const overrides = useThemeStore((s) => s.overrides)
  const setPreset = useThemeStore((s) => s.setPreset)
  const setOverride = useThemeStore((s) => s.setOverride)
  const clearOverride = useThemeStore((s) => s.clearOverride)
  const resetOverrides = useThemeStore((s) => s.resetOverrides)
  const hydrate = useThemeStore((s) => s.hydrate)

  const titleId = useId()
  const [importError, setImportError] = useState<string | null>(null)
  const previewMode = useMemo(() => hasUrlPreviewMode(), [])

  const preset = getPreset(presetId)
  const resolved = useMemo(
    () => resolveTheme(preset, overrides),
    [preset, overrides],
  )

  const contrastWarning = useMemo(
    () => checkContrastWarning(resolved),
    [resolved],
  )

  // Helper: get current effective value for a primitive.
  function eff<K extends keyof Primitives>(key: K): Primitives[K] {
    return resolved[key]
  }

  // Helper: is the user currently overriding this field?
  function isOverridden(key: keyof Primitives): boolean {
    return Object.prototype.hasOwnProperty.call(overrides, key)
  }

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const json = serializeThemeExport(presetId, overrides)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `infield-theme-${presetId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [presetId, overrides])

  // ── Import ────────────────────────────────────────────────────────────────
  const handleImport = useCallback(() => {
    setImportError(null)
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      file.text().then((raw) => {
        const result = parseThemeImport(raw)
        if (!result.ok) {
          setImportError(result.error)
          return
        }
        hydrate({
          presetId: result.value.presetId,
          overrides: result.value.overrides,
        })
      })
    }
    input.click()
  }, [hydrate])

  // ── Escape closes the modal ───────────────────────────────────────────────
  useEffect(() => {
    if (!onClose) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="theme-editor-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="theme-editor-header">
        <div>
          <h2 className="theme-editor-title" id={titleId}>
            Appearance
          </h2>
          <div className="theme-editor-subtitle">
            Customize presets, colors, typography, density, and motion.
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            className="theme-editor-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        ) : null}
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="theme-editor-body">
        {/* URL preview banner */}
        {previewMode ? (
          <div className="theme-editor-banner" role="status">
            <strong>Preview mode</strong> — theme loaded from the URL query.
            Changes won't persist; close and revisit without{' '}
            <code>?theme=</code> to edit your real settings.
          </div>
        ) : null}

        {/* ── Preset picker ─────────────────────────────────────────────── */}
        <section className="theme-editor-section">
          <h3 className="theme-editor-section-title">Preset</h3>
          <div className="theme-editor-preset-grid">
            {listPresets().map((p) => (
              <button
                key={p.id}
                type="button"
                className="theme-editor-preset-card"
                aria-pressed={p.id === presetId}
                onClick={() => setPreset(p.id)}
              >
                <div className="theme-editor-preset-swatches">
                  <span
                    className="theme-editor-preset-swatch"
                    style={{ background: p.primitives.surfaceBase }}
                  />
                  <span
                    className="theme-editor-preset-swatch"
                    style={{ background: p.primitives.brand }}
                  />
                  <span
                    className="theme-editor-preset-swatch"
                    style={{ background: p.primitives.onSurface }}
                  />
                </div>
                <span className="theme-editor-preset-name">{p.name}</span>
                <span className="theme-editor-preset-desc">
                  {p.description}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Appearance ─────────────────────────────────────────────────── */}
        <section className="theme-editor-section">
          <h3 className="theme-editor-section-title">Appearance</h3>

          <Row
            label="Base mode"
            sub="Light, Dark, or follow the OS."
            control={
              <Segmented<ThemeMode>
                options={MODES}
                value={eff('mode')}
                onChange={(v) => setOverride('mode', v)}
                ariaLabel="Theme mode"
              />
            }
            reset={
              <ResetButton
                active={isOverridden('mode')}
                onReset={() => clearOverride('mode')}
                title="Reset to preset mode"
              />
            }
          />

          <Row
            label="Accent"
            sub="Drives selection, links, and active states."
            control={
              <ColorField
                value={eff('brand')}
                onChange={(hex) => setOverride('brand', hex)}
                ariaLabel="Accent color"
              />
            }
            reset={
              <ResetButton
                active={isOverridden('brand')}
                onReset={() => clearOverride('brand')}
                title="Reset accent to preset"
              />
            }
          />

          <Row
            label="Surface"
            sub="Base color of the workspace foundation."
            control={
              <ColorField
                value={eff('surfaceBase')}
                onChange={(hex) => setOverride('surfaceBase', hex)}
                ariaLabel="Surface color"
              />
            }
            reset={
              <ResetButton
                active={isOverridden('surfaceBase')}
                onReset={() => clearOverride('surfaceBase')}
                title="Reset surface to preset"
              />
            }
          />

          <Row
            label="Text"
            sub="Primary text color. Muted text derives via color-mix."
            control={
              <ColorField
                value={eff('onSurface')}
                onChange={(hex) => setOverride('onSurface', hex)}
                ariaLabel="Text color"
              />
            }
            reset={
              <ResetButton
                active={isOverridden('onSurface')}
                onReset={() => clearOverride('onSurface')}
                title="Reset text color to preset"
              />
            }
          />

          {contrastWarning ? (
            <div className="theme-editor-warning" role="alert">
              ⚠ {contrastWarning}
            </div>
          ) : null}

          <Row
            label="Border radius"
            sub="0 is sharp, 24 is pill."
            control={
              <Segmented<RadiusScale>
                options={RADIUS_OPTIONS}
                value={eff('radiusScale')}
                onChange={(v) => setOverride('radiusScale', v)}
                ariaLabel="Border radius"
              />
            }
            reset={
              <ResetButton
                active={isOverridden('radiusScale')}
                onReset={() => clearOverride('radiusScale')}
                title="Reset radius to preset"
              />
            }
          />
        </section>

        {/* ── Typography ─────────────────────────────────────────────────── */}
        <section className="theme-editor-section">
          <h3 className="theme-editor-section-title">Typography</h3>

          <Row
            label="Base size"
            sub="px. Scale derives modularly."
            control={
              <SliderField
                value={eff('fontSizeBase')}
                onChange={(v) => setOverride('fontSizeBase', v)}
                min={11}
                max={20}
                step={1}
                unit="px"
                ariaLabel="Base font size"
              />
            }
            reset={
              <ResetButton
                active={isOverridden('fontSizeBase')}
                onReset={() => clearOverride('fontSizeBase')}
                title="Reset font size"
              />
            }
          />

          <Row
            label="Line height"
            sub="Unitless multiplier."
            control={
              <SliderField
                value={eff('lineHeightBase')}
                onChange={(v) => setOverride('lineHeightBase', v)}
                min={1.2}
                max={2}
                step={0.05}
                ariaLabel="Line height"
                format={(v) => v.toFixed(2)}
              />
            }
            reset={
              <ResetButton
                active={isOverridden('lineHeightBase')}
                onReset={() => clearOverride('lineHeightBase')}
                title="Reset line height"
              />
            }
          />

          <Row
            label="Max line width"
            sub="Restrict editor body in characters; null = full width."
            control={
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <label className="theme-editor-toggle">
                  <input
                    type="checkbox"
                    checked={eff('maxLineCh') !== null}
                    onChange={(e) =>
                      setOverride(
                        'maxLineCh',
                        e.target.checked ? 72 : (null as never),
                      )
                    }
                  />
                  <span>Limit</span>
                </label>
                {eff('maxLineCh') !== null ? (
                  <SliderField
                    value={eff('maxLineCh') as number}
                    onChange={(v) => setOverride('maxLineCh', v)}
                    min={50}
                    max={120}
                    step={2}
                    unit="ch"
                    ariaLabel="Max line width"
                  />
                ) : null}
              </div>
            }
            reset={
              <ResetButton
                active={isOverridden('maxLineCh')}
                onReset={() => clearOverride('maxLineCh')}
                title="Reset line width"
              />
            }
          />
        </section>

        {/* ── Layout & Motion ────────────────────────────────────────────── */}
        <section className="theme-editor-section">
          <h3 className="theme-editor-section-title">Layout &amp; Motion</h3>

          <Row
            label="Density"
            sub="Padding scale across the UI."
            control={
              <Segmented<number>
                options={DENSITY_OPTIONS}
                value={eff('densityScale')}
                onChange={(v) => setOverride('densityScale', v)}
                ariaLabel="Density"
              />
            }
            reset={
              <ResetButton
                active={isOverridden('densityScale')}
                onReset={() => clearOverride('densityScale')}
                title="Reset density"
              />
            }
          />

          <Row
            label="UI zoom"
            sub="Accessibility scale. Composes with density."
            control={
              <Segmented<number>
                options={UI_SCALE_OPTIONS}
                value={eff('uiScale')}
                onChange={(v) => setOverride('uiScale', v)}
                ariaLabel="UI zoom"
              />
            }
            reset={
              <ResetButton
                active={isOverridden('uiScale')}
                onReset={() => clearOverride('uiScale')}
                title="Reset UI zoom"
              />
            }
          />

          <Row
            label="Divider"
            sub="Pane separator thickness."
            control={
              <Segmented<DividerThickness>
                options={DIVIDER_OPTIONS}
                value={eff('dividerWidth')}
                onChange={(v) => setOverride('dividerWidth', v)}
                ariaLabel="Divider thickness"
              />
            }
            reset={
              <ResetButton
                active={isOverridden('dividerWidth')}
                onReset={() => clearOverride('dividerWidth')}
                title="Reset divider"
              />
            }
          />

          <Row
            label="Animation"
            sub="Off respects prefers-reduced-motion globally."
            control={
              <Segmented<AnimationSpeed>
                options={ANIMATION_OPTIONS}
                value={eff('animationSpeed')}
                onChange={(v) => setOverride('animationSpeed', v)}
                ariaLabel="Animation speed"
              />
            }
            reset={
              <ResetButton
                active={isOverridden('animationSpeed')}
                onReset={() => clearOverride('animationSpeed')}
                title="Reset animation"
              />
            }
          />

          <Row
            label="Shadow"
            sub="Depth of panel + menu shadows."
            control={
              <Segmented<ShadowIntensity>
                options={SHADOW_OPTIONS}
                value={eff('shadowIntensity')}
                onChange={(v) => setOverride('shadowIntensity', v)}
                ariaLabel="Shadow intensity"
              />
            }
            reset={
              <ResetButton
                active={isOverridden('shadowIntensity')}
                onReset={() => clearOverride('shadowIntensity')}
                title="Reset shadow"
              />
            }
          />
        </section>

        {/* ── Accessibility ──────────────────────────────────────────────── */}
        <section className="theme-editor-section">
          <h3 className="theme-editor-section-title">Accessibility</h3>

          <Row
            label="High contrast"
            sub="Forces solid text, thick dividers, no glass."
            control={
              <label className="theme-editor-toggle">
                <input
                  type="checkbox"
                  checked={eff('contrastBoost')}
                  onChange={(e) =>
                    setOverride('contrastBoost', e.target.checked)
                  }
                />
                <span>Enabled</span>
              </label>
            }
            reset={
              <ResetButton
                active={isOverridden('contrastBoost')}
                onReset={() => clearOverride('contrastBoost')}
                title="Reset high contrast"
              />
            }
          />
        </section>

        {importError ? (
          <div className="theme-editor-warning" role="alert">
            ⚠ Import failed: {importError}
          </div>
        ) : null}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="theme-editor-footer">
        <div className="theme-editor-footer-actions">
          <button
            type="button"
            className="theme-editor-btn"
            onClick={handleImport}
            disabled={previewMode}
            title={
              previewMode
                ? 'Disabled in URL preview mode'
                : 'Load theme from JSON'
            }
          >
            Import JSON
          </button>
          <button
            type="button"
            className="theme-editor-btn"
            onClick={handleExport}
            disabled={previewMode}
            title={
              previewMode
                ? 'Disabled in URL preview mode'
                : 'Download current theme'
            }
          >
            Export JSON
          </button>
        </div>
        <div className="theme-editor-footer-actions">
          <button
            type="button"
            className="theme-editor-btn"
            onClick={() => setPreset(DEFAULT_PRESET_ID)}
            title="Switch to HerOS Terracotta and clear all overrides"
          >
            Reset to default
          </button>
          <button
            type="button"
            className="theme-editor-btn theme-editor-btn-danger"
            onClick={resetOverrides}
            disabled={Object.keys(overrides).length === 0}
            title="Keep the current preset but clear every override"
          >
            Clear overrides
          </button>
        </div>
      </footer>
    </div>
  )
}

// ─── Modal wrapper ───────────────────────────────────────────────────────────

export function ThemeEditorModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  if (!open) return null
  return (
    <div
      className="theme-editor-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <ThemeEditorPanel onClose={onClose} />
    </div>
  )
}

// Also expose the preset registry so other surfaces (future Customize drawer,
// status-bar indicator) can enumerate built-ins without importing `presets.ts`
// directly.
export { PRESETS, listPresets, type PresetId }
