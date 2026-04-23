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
import { commands, type OnboardingState, type OnboardingStep, type OnboardingStatePatch } from '../bindings'

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
  // Onboarding (W0) — additive. Null while initial state loads from Rust.
  onboardingStep: OnboardingStep | null
  onboardingState: OnboardingState | null
  completeStep: (patch: OnboardingStatePatch) => Promise<void>
  refreshOnboarding: () => Promise<void>
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

/** Apply scale via THREE channels: native webview zoom (the real
 *  browser-level zoom via src-tauri set_app_zoom command, handles
 *  every pixel including inline px literals with proper reflow),
 *  the --ui-scale token (for token-aware surfaces), and localStorage
 *  persistence. Also resizes the OS window per asymmetric policy
 *  (scale >= 1.0 → window grows; scale < 1.0 → window stays so
 *  zoom-out actually gives more visible content). */
function applyUiScale(scale: number) {
  const clamped = clampScale(scale)
  // Keep --ui-scale CSS var in sync for any token-driven consumers.
  // --app-zoom is no longer used as a CSS `zoom` driver; kept as an
  // informational token in case future CSS rules want to read it.
  document.documentElement.style.setProperty('--ui-scale', String(clamped))
  document.documentElement.style.setProperty('--app-zoom', String(clamped))
  try {
    localStorage.setItem('ui-scale', String(clamped))
  } catch {
    /* private browsing / quota — silent */
  }
  void setWebviewZoom(clamped)
  void resizeWindowToScale(clamped)
}

/** Invokes the Rust-side `set_app_zoom` Tauri command which calls
 *  the webview's native browser zoom (WebView2 SetZoomFactor /
 *  WebKit setPageZoom / webkit2gtk set_zoom_level). This is the
 *  CORRECT global zoom — matches Ctrl/Cmd + = / - behaviour in any
 *  Chromium browser, reflows layout, handles every pixel including
 *  inline px literals copy/'s components author verbatim. */
async function setWebviewZoom(scale: number) {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_app_zoom', { scale })
  } catch (e) {
    // Tauri API unavailable (vite preview) or Rust command not
    // registered yet (before rebuild) — silent fail; --ui-scale
    // token still scales token-aware surfaces as a partial fallback.
    console.warn('[VaultContext] set_app_zoom failed:', e)
  }
}

/** Resize the Tauri window ASYMMETRICALLY with UI scale per user
 *  browser-zoom semantic:
 *
 *    scale < 1.0 → window does NOT shrink. User gets smaller text +
 *                   more content visible (standard Ctrl/Cmd + "-").
 *    scale = 1.0 → window returns to BASE_WINDOW.
 *    scale > 1.0 → window grows proportionally to prevent content
 *                   clipping at larger text sizes. Capped at 95% of
 *                   the user's monitor so chrome never overflows.
 *
 *  The goal: scale-down = "more view", scale-up = "same view, bigger
 *  text." Net effect is true browser zoom behavior plus an auto-grow
 *  for the zoom-in side so users don't have to manually resize. */
async function resizeWindowToScale(scale: number) {
  try {
    const { getCurrentWindow, LogicalSize, currentMonitor } =
      await import('@tauri-apps/api/window')

    // Only resize when scale >= 1.0 (or equals 1.0 to reset).
    // For scale < 1.0 we leave the window alone so the zoom-out
    // actually buys visible content density.
    if (scale < 1.0) return

    let width = BASE_WINDOW.width * scale
    let height = BASE_WINDOW.height * scale

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
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null)
  const onboardingStep = onboardingState?.current_step ?? null

  const refreshOnboarding = useCallback(async () => {
    const result = await commands.getOnboardingState()
    if (result.status === 'ok') {
      setOnboardingState(result.data)
    } else {
      console.error('[VaultContext] getOnboardingState failed:', result.error)
    }
  }, [])

  const completeStep = useCallback(async (patch: OnboardingStatePatch) => {
    const result = await commands.updateOnboardingState(patch)
    if (result.status === 'ok') {
      setOnboardingState(result.data)
    } else {
      console.error('[VaultContext] updateOnboardingState failed:', result.error)
      throw new Error(result.error)
    }
  }, [])

  // Load initial onboarding state once on mount. Runs in parallel with
  // the 2.5s boot timer; the overlay won't mount until both isBooting
  // is false and onboardingStep is non-null and !== 'done'.
  useEffect(() => {
    void refreshOnboarding()
  }, [refreshOnboarding])

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
      onboardingStep,
      onboardingState,
      completeStep,
      refreshOnboarding,
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
      onboardingStep,
      onboardingState,
      completeStep,
      refreshOnboarding,
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
