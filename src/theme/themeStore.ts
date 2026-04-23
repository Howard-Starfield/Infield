/**
 * Zustand store for the user's active theme selection + their per-token overrides.
 *
 * Keep this store **small and pure** — no IO, no effects, no async. Every
 * mutation must be atomic: the preset-switch race (CLAUDE.md → Theme Module →
 * Senior-level notes #8) depends on `setPreset` clearing overrides in the same
 * `setState` call as the id change, otherwise ThemeProvider's effect can fire
 * twice and produce a one-frame composite.
 *
 * Persistence lives in `themeStorage.ts` (localStorage sync + Tauri durable);
 * this store is the live authority during a session.
 */

import { create } from 'zustand'
import type { PresetId, Primitives, ThemeOverrides } from './tokens'
import { DEFAULT_PRESET_ID } from './presets'

export interface ThemeState {
  presetId: PresetId
  overrides: ThemeOverrides

  /** Atomically swap preset and clear all user overrides (Senior note #8). */
  setPreset: (presetId: PresetId) => void

  /** Override a single primitive. Shallow-merges onto existing overrides. */
  setOverride: <K extends keyof Primitives>(key: K, value: Primitives[K]) => void

  /** Remove a single override (fall back to preset value for that field). */
  clearOverride: (key: keyof Primitives) => void

  /** Clear ALL overrides while keeping the current preset. */
  resetOverrides: () => void

  /**
   * Replace the entire state in one call — used by `themeStorage.load()` on
   * boot to hydrate from persistence atomically, and by JSON import.
   */
  hydrate: (next: { presetId: PresetId; overrides: ThemeOverrides }) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  presetId: DEFAULT_PRESET_ID,
  overrides: {},

  setPreset: (presetId) => {
    // Atomic: id + overrides in a single setState. See Senior note #8.
    set({ presetId, overrides: {} })
  },

  setOverride: (key, value) => {
    set((state) => ({
      overrides: { ...state.overrides, [key]: value },
    }))
  },

  clearOverride: (key) => {
    set((state) => {
      const next = { ...state.overrides }
      delete next[key]
      return { overrides: next }
    })
  },

  resetOverrides: () => {
    set({ overrides: {} })
  },

  hydrate: ({ presetId, overrides }) => {
    set({ presetId, overrides })
  },
}))
