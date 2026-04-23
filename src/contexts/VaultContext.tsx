/**
 * VaultContext — Handy-backed adapter (post wholesale-swap 2026-04-23).
 *
 * The third_party_selling_desktop frontend's original VaultContext was an
 * encrypted-vault password-unlock state machine for an eBay CRM. Handy
 * is a local-first markdown workspace — no encrypted vault, no boot
 * password gate (per D-H1 / CLAUDE.md → Entry Experience).
 *
 * This adapter preserves the EXACT interface shape that the ported view
 * components expect (`isBooting`, `isLocked`, `vaultData`, `lock`,
 * `unlock`, `updateUiPreferences`, plus eBay-specific stubs) while
 * sourcing the real state from Handy's app reality:
 *   - `isBooting` is a 2.5s wall-clock timer (matches LoadingScreen)
 *   - `isLocked` defaults to false on first boot (no encrypted vault);
 *     flips to true only when Cmd/Ctrl+L is pressed
 *   - `vaultData.uiPreferences` is in-memory for now (H6 wires to
 *     Handy's user_preferences table)
 *   - eBay methods (`queueAction`, `storeMedia`, `storeEvidence`)
 *     console.warn and return null per Cosmetic-Port Discipline #2
 *   - `vaultData.ebayAccounts/conversations/messages` always empty —
 *     dormant eBay views render their EmptyState fallbacks
 *
 * When H6 wires the Handy backend, this file becomes the wiring layer
 * (vaultData reads from Handy's settings + workspace state). The
 * interface stays stable so view components don't need updates.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { VaultData, VaultEnvelope, UiPreferences } from '../types'

interface VaultContextType {
  isLocked: boolean
  isBooting: boolean
  vaultData: VaultData | null
  envelope: VaultEnvelope | null
  error: string | null
  unlock: (password: string) => Promise<boolean>
  lock: () => Promise<void>
  updateVaultData: (newData: VaultData) => void
  queueAction: (accountId: string, actionType: string, payload: any) => Promise<void>
  storeMedia: (
    accountId: string,
    conversationId: string,
    fileName: string,
    mimeType: string,
    data: string,
    thumbnail?: string,
  ) => Promise<void>
  storeEvidence: (
    accountId: string,
    orderId: string | null,
    fileName: string,
    mimeType: string,
    data: string,
    notes?: string,
  ) => Promise<void>
  updateUiPreferences: (preferences: UiPreferences) => Promise<void>
}

const VaultContext = createContext<VaultContextType | undefined>(undefined)

/** Default uiPreferences shape — matches third_party expectations.
 *  H6 will replace this with Handy's user_preferences row. */
const DEFAULT_UI_PREFERENCES: UiPreferences = {
  themeColor: '#cc4c2b',
  enabledViews: ['inbox', 'dashboard', 'notes', 'audio', 'databases', 'search', 'settings'],
  uiScale: 1.0,
} as unknown as UiPreferences

/** Clamp uiScale to a sane range so users can't accidentally render
 *  an unusable UI. */
function clampScale(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 1.0
  return Math.max(0.5, Math.min(1.5, v))
}

/** Base window dimensions at scale 1.0 — must match the
 *  inner_size in src-tauri/src/lib.rs WebviewWindowBuilder. Window
 *  scales proportionally with UI scale so content density stays
 *  constant (just bigger/smaller of everything). */
const BASE_WINDOW = { width: 2016, height: 1200 }
/** Floor — never shrink below something usable even if user picks
 *  a tiny scale on a small base. */
const MIN_WINDOW = { width: 900, height: 540 }

/** Apply scale to both CSS custom properties (--app-zoom +
 *  --ui-scale) AND resize the OS window proportionally. Single
 *  source of write for everything scale-related. */
function applyUiScale(scale: number) {
  const clamped = clampScale(scale)
  const root = document.documentElement
  root.style.setProperty('--app-zoom', String(clamped))
  root.style.setProperty('--ui-scale', String(clamped))
  try {
    localStorage.setItem('ui-scale', String(clamped))
  } catch {
    /* private browsing / quota — silent */
  }
  void resizeWindowToScale(clamped)
}

/** Resize the Tauri window so its dimensions match BASE_WINDOW × scale,
 *  clamped against the user's actual monitor (95% of monitor logical
 *  size as a max so the window never overflows the screen). Called from
 *  applyUiScale on every scale change.
 *
 *  NOTE: this clobbers any manual window resize the user did. If that
 *  becomes annoying we can add a "lock window to scale" preference. */
async function resizeWindowToScale(scale: number) {
  try {
    const { getCurrentWindow, LogicalSize, currentMonitor } =
      await import('@tauri-apps/api/window')
    let width = BASE_WINDOW.width * scale
    let height = BASE_WINDOW.height * scale

    // Cap at 95% of the user's monitor so the chrome never overflows.
    const monitor = await currentMonitor()
    if (monitor) {
      const sf = monitor.scaleFactor || 1
      const monitorLogicalW = monitor.size.width / sf
      const monitorLogicalH = monitor.size.height / sf
      width = Math.min(width, monitorLogicalW * 0.95)
      height = Math.min(height, monitorLogicalH * 0.95)
    }

    width = Math.max(width, MIN_WINDOW.width)
    height = Math.max(height, MIN_WINDOW.height)

    await getCurrentWindow().setSize(new LogicalSize(width, height))
  } catch (e) {
    // Tauri API unavailable (e.g., vite preview) — silent fail; CSS
    // zoom still works.
    console.warn('[VaultContext] window resize for UI scale failed:', e)
  }
}

/** Empty Handy-friendly VaultData. eBay arrays empty so dormant views
 *  fall through to EmptyState. */
const EMPTY_VAULT_DATA: VaultData = {
  ebayAccounts: [],
  conversations: [],
  messages: [],
  uiPreferences: DEFAULT_UI_PREFERENCES,
} as unknown as VaultData

export function VaultProvider({ children }: { children: ReactNode }) {
  const [isBooting, setIsBooting] = useState(true)
  const [isLocked, setIsLocked] = useState(false) // D-H1: no boot password gate
  // Initial scale read from localStorage so vaultData reflects what
  // main.tsx already painted (avoids slider snap-back on first render).
  const initialScale = (() => {
    try {
      return clampScale(parseFloat(localStorage.getItem('ui-scale') ?? '1'))
    } catch {
      return 1.0
    }
  })()
  const [vaultData, setVaultData] = useState<VaultData | null>({
    ...EMPTY_VAULT_DATA,
    uiPreferences: { ...DEFAULT_UI_PREFERENCES, uiScale: initialScale } as UiPreferences,
  })
  const [error, setError] = useState<string | null>(null)

  // Whenever uiScale changes (slider, keybinding, programmatic), apply
  // to CSS vars + persist. Source of truth = vaultData.uiPreferences.uiScale.
  useEffect(() => {
    const scale = vaultData?.uiPreferences?.uiScale
    if (typeof scale === 'number') applyUiScale(scale)
  }, [vaultData?.uiPreferences?.uiScale])

  // Match copy/'s 2.5s LoadingScreen duration so the cinematic arc plays
  // through. H6 may swap this for real hydration signals.
  useEffect(() => {
    const t = window.setTimeout(() => setIsBooting(false), 2500)
    return () => window.clearTimeout(t)
  }, [])

  // Cmd/Ctrl+L lock keybinding — only fires when not booting and not
  // already locked. preventDefault stops the browser's address-bar focus
  // chord on the same keypress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() !== 'l') return
      if (isBooting || isLocked) return
      e.preventDefault()
      setIsLocked(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isBooting, isLocked])

  const unlock = useCallback(async (_password: string) => {
    // Handy has no encrypted vault — any password unlocks. H6 may add
    // a real check (encrypted vault is in CLAUDE.md → Deferred list).
    setError(null)
    setIsLocked(false)
    return true
  }, [])

  const lock = useCallback(async () => {
    setIsLocked(true)
  }, [])

  const updateVaultData = useCallback((newData: VaultData) => {
    setVaultData(newData)
  }, [])

  const updateUiPreferences = useCallback(async (preferences: UiPreferences) => {
    setVaultData((prev) =>
      prev ? ({ ...prev, uiPreferences: { ...prev.uiPreferences, ...preferences } } as VaultData) : prev,
    )
  }, [])

  // eBay stubs — dormant per Cosmetic-Port Discipline #2. Wrapped in
  // try/catch in the views; here we just warn loudly so devs know which
  // surfaces still need wiring.
  const queueAction = useCallback(async () => {
    console.warn('[VaultContext] queueAction is dormant — eBay backend not wired')
  }, [])
  const storeMedia = useCallback(async () => {
    console.warn('[VaultContext] storeMedia is dormant — eBay backend not wired')
  }, [])
  const storeEvidence = useCallback(async () => {
    console.warn('[VaultContext] storeEvidence is dormant — eBay backend not wired')
  }, [])

  const value = useMemo<VaultContextType>(
    () => ({
      isLocked,
      isBooting,
      vaultData,
      envelope: null,
      error,
      unlock,
      lock,
      updateVaultData,
      queueAction,
      storeMedia,
      storeEvidence,
      updateUiPreferences,
    }),
    [
      isLocked,
      isBooting,
      vaultData,
      error,
      unlock,
      lock,
      updateVaultData,
      queueAction,
      storeMedia,
      storeEvidence,
      updateUiPreferences,
    ],
  )

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

export function useVault() {
  const context = useContext(VaultContext)
  if (context === undefined) {
    throw new Error('useVault must be used within a VaultProvider')
  }
  return context
}
