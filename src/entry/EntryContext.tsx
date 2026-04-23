/**
 * Entry-experience context — owns the launch-stage state machine.
 *
 * Inspired by the VaultContext pattern from a companion project: the
 * LoadingScreen and LoginPage are pure presentation; the timer, progress
 * ramp, and stage transitions all live here so they can be tested and
 * reasoned about without pulling in React surface components.
 *
 * Stage machine:
 *   "loading"  → hydration in flight; LoadingScreen rendered
 *   "login"    → onboarding resolved; LoginPage rendered (presentation-only)
 *   "app"      → user entered; main shell mounted
 *
 * Progress ramp asymptotes toward milestone targets derived from observable
 * hydration signals (settingsLoading, onboardingStep). Reducing the bar's
 * coupling to wall-clock time keeps it honest on slow backends while
 * preventing it from ever looking stuck.
 *
 * Usage:
 *   <EntryProvider settingsLoading={…} onboardingStep={…}>
 *     {stage === "loading" ? <LoadingScreen … /> : …}
 *   </EntryProvider>
 *
 * Or via hook: `const { stage, progress, enterApp } = useEntry();`
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/**
 * Minimum wall-clock time the LoadingScreen stays on screen. Real
 * hydration often finishes in <1s on dev hardware, which would flash the
 * LoadingScreen past so fast the lemniscate never completes a full cycle.
 * The floor guarantees the cinematic arc always plays. Matches the
 * inline value in `App.tsx`.
 */
const DEFAULT_MIN_LOADING_MS = 3000

export type EntryStage = 'loading' | 'onboarding' | 'login' | 'app'

export interface EntryState {
  stage: EntryStage
  /** 0..100. Drives LoadingScreen progress bar + orb collapse phase. */
  progress: number
  /** Called from LoginPage when user activates the primary button. */
  enterApp: (passphrase?: string) => void
  /**
   * Called by `OnboardingShell` when the user finishes the final step.
   * Transitions `onboarding → login`; `LoginPage` then decides whether
   * to self-skip based on passphrase presence.
   */
  finishOnboarding: () => void
  /**
   * Optional manual override — consumers can push stage transitions
   * directly. Primarily for tests + future auto-lock wiring.
   */
  setStage: (stage: EntryStage) => void
}

const EntryCtx = createContext<EntryState | null>(null)

export interface EntryProviderProps {
  children: ReactNode
  /**
   * True while `useSettings()` is still resolving. First hydration
   * milestone; flipping to false bumps progress to 30%.
   */
  settingsLoading: boolean
  /**
   * Onboarding state read from the Rust `onboarding_state` table via
   * `get_onboarding_state`. `null` means "fetch in flight" (hold progress
   * at <60%); `"done"` means "fully complete — skip the onboarding stage
   * and hand off to login/app". Any other value (`"welcome"`, `"theme"`,
   * `"mic"`, `"accessibility"`, `"models"`, `"vault"`) drives the handoff
   * into the `onboarding` stage so `OnboardingShell` can render the
   * appropriate step.
   */
  onboardingStep: string | null
  /**
   * Optional callback fired when the user taps "Enter". Receives the
   * passphrase value so consumers can wire real auth later. The stage
   * transition happens regardless — callers can cancel by throwing.
   */
  onEnter?: (passphrase: string) => void | Promise<void>
  /**
   * Minimum milliseconds to hold the "loading" stage even if hydration
   * finishes sooner. Defaults to 3000ms — ribbon completes two rotations,
   * collapse phase plays visibly. Pass 0 to disable the artificial hold.
   */
  minLoadingMs?: number
}

export function EntryProvider({
  children,
  settingsLoading,
  onboardingStep,
  onEnter,
  minLoadingMs = DEFAULT_MIN_LOADING_MS,
}: EntryProviderProps) {
  const [stage, setStage] = useState<EntryStage>('loading')
  const [progress, setProgress] = useState(10)
  // Wall-clock when the provider mounted. Used to enforce minLoadingMs —
  // the handoff to "login" waits until at least this much time has
  // elapsed so the LoadingScreen's cinematic arc plays in full.
  const mountedAtRef = useRef<number>(Date.now())

  // ─── Progress ramp ────────────────────────────────────────────────
  // Reaches the current milestone target asymptotically at 4% per tick
  // every 120ms, so the bar keeps moving even on slow backends. When a
  // faster milestone is reached, progress is clamped up to the new
  // minimum — never backs off.
  useEffect(() => {
    if (stage !== 'loading') return
    const id = setInterval(() => {
      setProgress((p) => {
        const target = settingsLoading
          ? 30
          : onboardingStep === null
            ? 60
            : onboardingStep === 'done'
              ? 92
              : // A mid-onboarding step (welcome / theme / mic / … / vault)
                // is a "ready to hand off to the onboarding stage" signal.
                // Ramp to 92% so the bar reads full before the screen swap.
                92
        return p < target ? Math.min(target, p + 4) : p
      })
    }, 120)
    return () => clearInterval(id)
  }, [stage, settingsLoading, onboardingStep])

  // ─── Stage handoff ────────────────────────────────────────────────
  // Once onboarding state resolves, finish the bar visually and hand off.
  // Route:
  //   - `"done"` → `login` (skip onboarding stage entirely)
  //   - any other step → `onboarding` (OnboardingShell picks up there)
  // The handoff waits until the `minLoadingMs` floor has elapsed so the
  // ribbon always completes its full rotation + collapse-phase arc, even
  // on fast hardware. The fill is driven to 100% just before the handoff
  // so the user sees the 100% tick land precisely as the screen swaps.
  useEffect(() => {
    if (stage !== 'loading') return
    if (onboardingStep === null) return
    const nextStage: EntryStage =
      onboardingStep === 'done' ? 'login' : 'onboarding'
    const elapsed = Date.now() - mountedAtRef.current
    const remaining = Math.max(0, minLoadingMs - elapsed)
    const fillDelay = Math.max(0, remaining - 650)
    const fillTimer = setTimeout(() => setProgress(100), fillDelay)
    const handoffTimer = setTimeout(
      () => setStage(nextStage),
      Math.max(650, remaining),
    )
    return () => {
      clearTimeout(fillTimer)
      clearTimeout(handoffTimer)
    }
  }, [stage, onboardingStep, minLoadingMs])

  const enterApp = useCallback(
    (passphrase: string = '') => {
      try {
        const maybePromise = onEnter?.(passphrase)
        if (maybePromise && typeof maybePromise.then === 'function') {
          void maybePromise.catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('[EntryContext] onEnter rejected', err)
          })
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[EntryContext] onEnter threw', err)
      }
      setStage('app')
    },
    [onEnter],
  )

  const finishOnboarding = useCallback(() => setStage('login'), [])

  const value = useMemo<EntryState>(
    () => ({ stage, progress, enterApp, finishOnboarding, setStage }),
    [stage, progress, enterApp, finishOnboarding],
  )

  return <EntryCtx.Provider value={value}>{children}</EntryCtx.Provider>
}

/**
 * Hook — throws if called outside `EntryProvider`. Callers inside the
 * entry surfaces (LoadingScreen, LoginPage) can use this to read the
 * current stage / progress without prop-drilling through App.tsx.
 */
export function useEntry(): EntryState {
  const ctx = useContext(EntryCtx)
  if (!ctx) {
    throw new Error('useEntry must be used inside <EntryProvider>')
  }
  return ctx
}
