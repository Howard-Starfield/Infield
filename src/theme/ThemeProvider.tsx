/**
 * ThemeProvider — flushes the active theme's primitive CSS variables onto
 * `document.documentElement` and keeps them in sync with the store.
 *
 * ### Mount order (see CLAUDE.md → Theme Module)
 *
 * This provider MUST wrap the outermost app boundary — the LoadingScreen
 * depends on `--heros-brand` for its lemniscate background, so if Provider
 * only wrapped `WorkspaceLayout`, the LoadingScreen would ignore user
 * overrides and flash default colors before the workspace renders.
 *
 * ### Invariants
 *
 *   1. Every primitive write goes through a single rAF callback per change —
 *      one style recalc, not N. On a full workspace (~2-5k DOM nodes) this
 *      is the difference between 5-15ms and 40-400ms on density/zoom changes.
 *   2. localStorage writes are SYNCHRONOUS. The inline FOUT script in
 *      `index.html` depends on the `infield:theme:vars` key being present
 *      on next cold-start. Async-only persistence = visible flash.
 *   3. The `?theme=<id>` URL param short-circuits persistence. Used by QA /
 *      issue repros so screenshots don't pollute the real user state.
 *   4. Dev-only contrast warning fires on every resolved theme — catches
 *      "user made the text invisible" before they realize the app is broken.
 */

import { useEffect, useRef } from 'react'
import type { PresetId } from './tokens'
import {
  checkContrastWarning,
  checkDerivedContrastWarnings,
  deriveAttrs,
  deriveCssVars,
  resolveTheme,
} from './tokens'
import { DEFAULT_PRESET_ID, getPreset } from './presets'
import { loadTheme, saveTheme } from './themeStorage'
import { useThemeStore } from './themeStore'

/**
 * DEV kill-switch — when `true`, the provider ignores any persisted theme
 * state AND the inline FOUT overrides, forcing every boot to land on
 * `DEFAULT_PRESET_ID` with zero user overrides. Also stops writing to
 * localStorage, so anything the user does via the theme editor this
 * session is discarded at the next reload.
 *
 * Leave `false` in production. The themeStorage SCHEMA_VERSION gate
 * (currently v2) handles migration for returning users — bumping that
 * invalidates stale payloads without needing this flag.
 */
const FORCE_DEFAULT_THEME = false

interface ThemeProviderProps {
  children: React.ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const presetId = useThemeStore((s) => s.presetId)
  const overrides = useThemeStore((s) => s.overrides)
  const hydrate = useThemeStore((s) => s.hydrate)

  const hydratedRef = useRef(false)
  const rafRef = useRef<number | null>(null)

  // ─── Hydrate on mount ──────────────────────────────────────────────────────
  // Runs once. URL-param escape hatch takes precedence over any persisted
  // state — useful for screenshot automation (`?theme=heros-midnight`) and
  // issue repros that mustn't mutate the user's real settings.
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true

    // Kill-switch: ignore persisted state, strip any FOUT-applied vars the
    // inline script wrote before React mounted, force canonical preset.
    if (FORCE_DEFAULT_THEME) {
      try {
        localStorage.removeItem('infield:theme:vars')
        localStorage.removeItem('infield:theme:state')
        const root = document.documentElement
        for (let i = root.style.length - 1; i >= 0; i--) {
          const prop = root.style.item(i)
          if (prop.startsWith('--')) root.style.removeProperty(prop)
        }
      } catch {
        /* ignore */
      }
      hydrate({ presetId: DEFAULT_PRESET_ID, overrides: {} })
      return
    }

    let cancelled = false

    void (async () => {
      const urlOverride = readUrlPresetOverride()
      if (urlOverride) {
        if (!cancelled) {
          hydrate({ presetId: urlOverride, overrides: {} })
        }
        return
      }

      const loaded = await loadTheme()
      if (!cancelled) {
        hydrate(loaded)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [hydrate])

  // ─── Flush CSS vars on any state change ───────────────────────────────────
  // Batched via rAF so N primitive changes collapse into one style recalc.
  useEffect(() => {
    const preset = getPreset(presetId)
    const resolved = resolveTheme(preset, overrides)
    const cssVars = deriveCssVars(resolved)
    const attrs = deriveAttrs(resolved)
    const effectiveMode = resolveEffectiveMode(resolved.mode)

    // Cancel any in-flight flush so we always apply the latest state.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const root = document.documentElement

      // Primary tokens — one recalc for the whole batch.
      for (const [key, value] of Object.entries(cssVars)) {
        root.style.setProperty(key, value)
      }

      // Mode attribute drives `[data-theme-mode="dark"]` CSS rules + the
      // `color-scheme` hint for native form controls / scrollbars.
      root.setAttribute('data-theme-mode', effectiveMode)

      // Derived boolean attributes (e.g. contrast-boost). Written in the
      // SAME rAF as the vars so CSS rules keyed on them don't flicker
      // between states. See F5 / tokens.ts → deriveAttrs.
      for (const [key, value] of Object.entries(attrs)) {
        root.setAttribute(key, value)
      }
    })

    // Persist (localStorage sync + debounced DB async).
    // Guard against persisting a URL-param-driven state that the user didn't
    // explicitly choose — readUrlPresetOverride returns null when no param,
    // so normal use-case persists; with `?theme=X`, skip persistence.
    // Also skipped when FORCE_DEFAULT_THEME is on so test runs never
    // pollute the user's real saved theme.
    if (!FORCE_DEFAULT_THEME && readUrlPresetOverride() === null) {
      saveTheme(presetId, overrides, cssVars, effectiveMode)
    }

    // Dev-only contrast warnings. Ships as warning-only per CLAUDE.md plan;
    // block-with-toast is a v2 escalation. Checks both the primary onSurface/
    // surfaceBase pair AND the derived muted/soft text alphas composited over
    // the foundation — catches regressions where a well-intentioned muted
    // tone stops clearing AA on a particular preset.
    if (import.meta.env.DEV) {
      const primary = checkContrastWarning(resolved)
      if (primary) console.warn('[theme]', primary)
      for (const w of checkDerivedContrastWarnings(resolved)) {
        console.warn('[theme]', w)
      }
    }
  }, [presetId, overrides])

  // ─── System theme listener ────────────────────────────────────────────────
  // When `mode === 'system'`, re-flush whenever the OS toggles dark mode.
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      // Touch the store to trigger the flush effect. We don't change any
      // values — resolveEffectiveMode will re-read matchMedia on next flush.
      //
      // Guard on the RESOLVED mode (preset primitives + user overrides), not
      // just the preset's mode. Users can override mode via setOverride, and
      // a system-override on a non-system preset should still track the OS.
      const s = useThemeStore.getState()
      const resolved = resolveTheme(getPreset(s.presetId), s.overrides)
      if (resolved.mode !== 'system') return
      // Re-apply same state to force the flush effect to run (rAF-batched).
      useThemeStore.setState({ overrides: { ...s.overrides } })
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return <>{children}</>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the user's theme mode to the concrete mode the OS should render.
 * `'system'` consults `prefers-color-scheme`; everything else is pass-through.
 */
function resolveEffectiveMode(mode: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  if (mode !== 'system') return mode
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Read the `?theme=<preset-id>` URL param for QA / screenshot / issue-repro
 * flows. Returns the id if it matches a known preset, else null.
 */
function readUrlPresetOverride(): PresetId | null {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('theme')
    if (!raw) return null
    // Cheap validation — getPreset falls back to default on unknown ids, but
    // we want to know *up front* if the param is valid so we don't silently
    // do nothing.
    const KNOWN: ReadonlyArray<PresetId> = [
      'heros-terracotta',
      'heros-midnight',
      'heros-paper',
      'heros-high-contrast',
      'custom',
    ]
    if ((KNOWN as readonly string[]).includes(raw)) {
      return raw as PresetId
    }
    return null
  } catch {
    return null
  }
}
