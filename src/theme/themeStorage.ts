/**
 * Theme persistence: localStorage-sync authoritative, Tauri-durable backup.
 *
 * ### Why localStorage is authoritative for sync reads
 *
 * Tauri `invoke('set_user_preference')` is async IPC. If the user tweaks a
 * slider and quits within 50ms, the DB roundtrip may not complete before
 * process exit — the DB would hold the PREVIOUS theme on next boot. The
 * localStorage write is synchronous and lands before any subsequent code
 * runs, guaranteeing the next cold-start's inline FOUT script sees the
 * latest value.
 *
 * The DB is still written (debounced) so:
 *   - New devices / fresh installs restoring from workspace backup inherit
 *     the theme.
 *   - Eventual cross-device sync (post-v1) has a durable source.
 *
 * Read path on boot:
 *   1. Inline FOUT script (in `index.html`) reads `LOCAL_VARS_KEY` and sets
 *      `:root` CSS vars BEFORE React mounts. No flash.
 *   2. React mounts, ThemeProvider calls `loadTheme()`.
 *   3. `loadTheme()` reads `LOCAL_STATE_KEY` (preset + overrides), calls
 *      `useThemeStore.hydrate()`.
 *   4. If localStorage is empty (first launch / cleared storage), falls back
 *      to the DB (`invoke('get_user_preference')`) and writes to localStorage
 *      for future cold-starts.
 *
 * Write path:
 *   - Every theme change: localStorage is updated SYNCHRONOUSLY by the
 *     ThemeProvider effect (both the state blob and the flat CSS vars blob).
 *   - Tauri `set_user_preference` is called via a 200ms-debounced scheduler
 *     so rapid slider drag doesn't flood IPC.
 */

import { invoke } from '@tauri-apps/api/core'
import type { CssVars, PresetId, ThemeOverrides } from './tokens'
import { DEFAULT_PRESET_ID } from './presets'

// ─── Storage keys ────────────────────────────────────────────────────────────

/** User's full theme selection (preset + overrides). Consumed by `loadTheme`. */
export const LOCAL_STATE_KEY = 'infield:theme:state'

/** Pre-derived flat CSS-var map. Consumed by the inline FOUT script. */
export const LOCAL_VARS_KEY = 'infield:theme:vars'

/** DB preference key. Value is a JSON-stringified `PersistedState`. */
const DB_KEY = 'theme'

// ─── Persisted schema ────────────────────────────────────────────────────────

/**
 * Persisted schema version. Bump when:
 *   - Preset defaults change in a way that would leave returning users on
 *     a stale appearance (e.g. Sovereign Glass rewrite, 2026-04 — v1 users
 *     had `heros-terracotta.surfaceBase = #cc4c2b`; v2 sets it to charcoal).
 *   - Override token names are renamed or removed.
 *
 * Any payload with a different `version` field is rejected by
 * `isPersistedState` → `loadTheme` falls through to the default preset and
 * the next write persists a v2 payload, migrating the user transparently.
 */
const SCHEMA_VERSION = 2 as const

interface PersistedState {
  version: typeof SCHEMA_VERSION
  presetId: PresetId
  overrides: ThemeOverrides
}

function isPersistedState(v: unknown): v is PersistedState {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    o.version === SCHEMA_VERSION &&
    typeof o.presetId === 'string' &&
    typeof o.overrides === 'object' &&
    o.overrides !== null
  )
}

// ─── Load ────────────────────────────────────────────────────────────────────

export interface LoadedTheme {
  presetId: PresetId
  overrides: ThemeOverrides
}

/**
 * Load theme state on boot. Order:
 *   1. localStorage (sync, authoritative)
 *   2. Tauri `get_user_preference('theme')` (durable fallback, re-seeds
 *      localStorage)
 *   3. Default preset (first launch or all storage cleared)
 *
 * Never throws. Returns the default preset with empty overrides if every
 * source fails — better to show the default theme than a broken app.
 */
export async function loadTheme(): Promise<LoadedTheme> {
  // (1) localStorage
  const local = readLocalState()
  if (local) return local

  // (2) DB fallback
  try {
    const raw = await invoke<string | null>('get_user_preference', { key: DB_KEY })
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (isPersistedState(parsed)) {
        // Re-seed localStorage for next cold-start's inline script.
        writeLocalState({
          version: 2,
          presetId: parsed.presetId,
          overrides: parsed.overrides,
        })
        return { presetId: parsed.presetId, overrides: parsed.overrides }
      }
    }
  } catch {
    // Non-fatal — Tauri may not be ready or user_preferences table may be empty.
  }

  // (3) Default
  return { presetId: DEFAULT_PRESET_ID, overrides: {} }
}

function readLocalState(): LoadedTheme | null {
  try {
    const raw = localStorage.getItem(LOCAL_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isPersistedState(parsed)) return null
    return { presetId: parsed.presetId, overrides: parsed.overrides }
  } catch {
    return null
  }
}

// ─── Save ────────────────────────────────────────────────────────────────────

/**
 * Persist the current theme.
 *
 * Writes localStorage synchronously (both the state blob AND the derived CSS
 * vars — the latter is what the inline FOUT script reads). Schedules a
 * debounced Tauri write for durability.
 */
export function saveTheme(
  presetId: PresetId,
  overrides: ThemeOverrides,
  cssVars: CssVars,
  mode: 'light' | 'dark',
): void {
  const state: PersistedState = { version: 2, presetId, overrides }
  writeLocalState(state)
  writeLocalVars(cssVars, mode)
  scheduleDbWrite(state)
}

function writeLocalState(state: PersistedState): void {
  try {
    localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state))
  } catch {
    // Storage full / disabled — not fatal, live store still works in-memory.
  }
}

function writeLocalVars(vars: CssVars, mode: 'light' | 'dark'): void {
  try {
    // Version-stamped so the inline FOUT script in index.html can reject
    // a stale blob left over from a prior schema. Keep the top-level shape
    // (`{ version, vars, mode }`) in sync with the FOUT script — it reads
    // these fields by name, not by typed contract.
    localStorage.setItem(
      LOCAL_VARS_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, vars, mode }),
    )
  } catch {
    // Non-fatal
  }
}

// ─── Debounced DB write ──────────────────────────────────────────────────────

const DB_WRITE_DEBOUNCE_MS = 200

let dbWriteTimer: number | null = null
let pendingDbState: PersistedState | null = null

function scheduleDbWrite(state: PersistedState): void {
  pendingDbState = state
  if (dbWriteTimer !== null) {
    window.clearTimeout(dbWriteTimer)
  }
  dbWriteTimer = window.setTimeout(() => {
    dbWriteTimer = null
    const toWrite = pendingDbState
    pendingDbState = null
    if (!toWrite) return
    void invoke('set_user_preference', {
      key: DB_KEY,
      value: JSON.stringify(toWrite),
    }).catch((e) => {
      // DB failure is non-fatal — localStorage is the source of truth for
      // next boot. Log in dev; swallow in prod.
      if (import.meta.env.DEV) {
        console.warn('[theme] DB persistence failed:', e)
      }
    })
  }, DB_WRITE_DEBOUNCE_MS)
}

/**
 * Flush any pending debounced DB write immediately.  Call this before
 * known-imminent process exit (e.g. window close handler, Tauri close event)
 * so the DB doesn't lag localStorage by up to 200ms.
 */
export async function flushThemeDbWrite(): Promise<void> {
  if (dbWriteTimer !== null) {
    window.clearTimeout(dbWriteTimer)
    dbWriteTimer = null
  }
  const toWrite = pendingDbState
  pendingDbState = null
  if (!toWrite) return
  try {
    await invoke('set_user_preference', {
      key: DB_KEY,
      value: JSON.stringify(toWrite),
    })
  } catch {
    // Same non-fatal policy.
  }
}
