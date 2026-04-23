/**
 * LoadingScreen — ported verbatim from the IRS third-party-selling-desktop
 * reference (`copy/src/components/LoadingScreen.tsx`). Visual structure,
 * typography, progress bar, credits block, and drag-to-spin behaviour are
 * 1:1 with the source.
 *
 * Handy-specific adaptations (minimum necessary to keep the app functional):
 *   - `progress` prop drives the bar fill from real hydration staging
 *     (App.tsx `loadProgress`). IRS ran its own 2.5s interval; that would
 *     decouple the bar from SQLite / embedding-sidecar / workspaceStore
 *     readiness, which matters on slow first launches.
 *   - `CanvasBoundary` isolates WebGL init failures to a 2D no-op fallback
 *     so the entry flow can't crash into `AppCrashBoundary` if
 *     `@react-three/fiber` fails to mount.
 *   - `WindowControls` overlayed top-right because `decorations(false)`
 *     is set globally on the Tauri main window — without them, users
 *     can't minimise/close while the loader is visible.
 *   - Copy strings (greeting / wordmark / tagline / credits) accept
 *     props so the production text can be swapped without touching this
 *     file. Defaults are the IRS reference strings as placeholders.
 */
import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { motion } from 'motion/react'
import { AtmosphericBackground } from '../shell/primitives/AtmosphericBackground'
import { WindowControls } from '../shell/WindowControls'

const LemniscateOrb = lazy(async () => {
  const mod = await import('./LemniscateOrb')
  return { default: mod.LemniscateOrb }
})

export interface LoadingScreenProps {
  /** 0..100. Drives the progress bar fill and the orb's final-phase collapse. */
  progress: number
  /** Eyebrow above the wordmark. IRS default: "Welcome to Element Softaware's" */
  greeting?: string
  /** Main wordmark. IRS default: "OS1" (rendered with <sup>). */
  wordmark?: ReactNode
  /** Tag under the wordmark. IRS default: "Operating System" */
  tagline?: string
}

// ─── Error boundary — WebGL / r3f failures drop to a silent 2D fallback ─────

class CanvasBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    // eslint-disable-next-line no-console
    console.warn('[LoadingScreen] 3D canvas failed; falling back to 2D', err)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function LoadingScreen({
  progress,
  greeting = "Welcome to Element Softaware's",
  wordmark,
  tagline = 'Operating System',
}: LoadingScreenProps) {
  const clamped = Math.max(0, Math.min(100, progress))
  const reducedMotion = usePrefersReducedMotion()

  const rootStyle: CSSProperties = {
    height: '100vh',
    width: '100vw',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
    color: '#fff',
    touchAction: 'none',
    background: 'transparent',
    zIndex: 1000,
  }

  const canvasLayerStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 2,
  }

  const dragRegionStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    zIndex: 10,
    cursor: 'grab',
  }

  return (
    <div style={rootStyle}>
      {/* ── Kinetic atmosphere (blobs only — grain removed per IRS reference) ── */}
      <AtmosphericBackground style={{ position: 'absolute', inset: 0, zIndex: 0 }} />

      {/* ── 3D Canvas Layer ── */}
      <div style={canvasLayerStyle}>
        {!reducedMotion ? (
          <CanvasBoundary fallback={null}>
            <Suspense fallback={null}>
              <LemniscateOrb progress={clamped} />
            </Suspense>
          </CanvasBoundary>
        ) : null}
      </div>

      {/* ── Tauri drag region (top strip) + window controls ── */}
      <div data-tauri-drag-region style={dragRegionStyle} />
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          height: 'calc(var(--shell-titlebar-height, 48px) + 8px)',
          display: 'flex',
          alignItems: 'center',
          zIndex: 25,
        }}
      >
        <WindowControls />
      </div>

      {/* ── UI Layer (progress bar + wordmark) ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 2.5 }}
        style={{
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <div style={{ height: '240px', marginBottom: '80px' }} />
        <div
          style={{
            width: '420px',
            height: '10px',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: '100px',
            position: 'relative',
            marginBottom: '80px',
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(clamped)}
        >
          <motion.div
            animate={{ width: `${clamped}%` }}
            transition={{ ease: 'linear', duration: 0.1 }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              background: 'linear-gradient(90deg, rgba(255,255,255,0.4), #fff)',
              borderRadius: '100px',
            }}
          />
        </div>
        <div style={{ textAlign: 'center' }}>
          <p
            style={{
              fontSize: '24px',
              fontWeight: 400,
              letterSpacing: '0.15em',
              margin: '0 0 20px 0',
              color: 'rgba(255,255,255,0.4)',
            }}
          >
            {greeting}
          </p>
          <h1
            style={{
              fontSize: '112px',
              fontWeight: 100,
              letterSpacing: '0.04em',
              lineHeight: 1,
              margin: 0,
            }}
          >
            {wordmark ?? (
              <>
                OS<sup>1</sup>
              </>
            )}
          </h1>
          <p
            style={{
              fontSize: '20px',
              fontWeight: 800,
              letterSpacing: '0.45em',
              marginTop: '32px',
              textTransform: 'uppercase',
              opacity: 0.25,
            }}
          >
            {tagline}
          </p>
        </div>
      </motion.div>

      {/* ── Credits (bottom-right) ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.25 }}
        transition={{ delay: 1, duration: 2 }}
        style={{
          position: 'absolute',
          bottom: '80px',
          right: '120px',
          textAlign: 'right',
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        <p style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 8px 0' }}>
          Her
        </p>
        <p style={{ fontSize: '20px', fontStyle: 'italic', margin: '0 0 24px 0' }}>
          a Spike Jonze love story
        </p>
        <div
          style={{
            fontSize: '18px',
            lineHeight: 1.8,
            letterSpacing: '0.06em',
            color: 'rgba(255,255,255,0.7)',
          }}
        >
          Joaquin Phoenix
          <br />
          Scarlett Johansson
          <br />
          Amy Adams
          <br />
          Rooney Mara
        </div>
      </motion.div>
    </div>
  )
}
