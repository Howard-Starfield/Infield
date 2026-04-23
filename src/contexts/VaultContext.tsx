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
} as unknown as UiPreferences

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
  const [vaultData, setVaultData] = useState<VaultData | null>(EMPTY_VAULT_DATA)
  const [error, setError] = useState<string | null>(null)

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
