/**
 * Presentation-only entry gate — matches the HerOS kit panel visual DNA:
 *   - Atmospheric mesh + grain behind everything
 *   - Centered glass panel (48px / 40px padding, 24px radius)
 *   - Lock icon in a rounded glass badge at top
 *   - Thin oversized wordmark
 *   - Wide-tracked uppercase subtitle
 *   - Tall primary button with brand-glass finish
 *   - Small uppercase "protected by" footer tag
 *
 * Copy is brand-neutral per frontendplan.md Phase 2 locked constraints
 * (no passphrase gate, no secure-volume messaging). The visual structure
 * is the kit's — colour/shape/geometry all drive from theme tokens.
 */
import { useState, type CSSProperties, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { Lock, Key } from 'lucide-react'
import { AtmosphericBackground } from '../shell/primitives/AtmosphericBackground'
import { GrainOverlay } from '../shell/primitives/GrainOverlay'
import { GlassWell } from '../shell/primitives/GlassWell'
import { RadiantGlow } from '../shell/primitives/RadiantGlow'
import { WindowControls } from '../shell/WindowControls'

export interface LoginPageProps {
  /**
   * Called when the user submits the form. Receives the passphrase string
   * so real auth can be wired in a later phase. Currently the value is
   * accepted and discarded — this screen remains presentation-only until
   * backend passphrase validation ships.
   */
  onEnter: (passphrase: string) => void
  /** Eyebrow above the title. Default "Welcome to". */
  greeting?: string
  /** Tag under the title. Default "Local-first workspace". */
  tagline?: string
  /** Brand name in the footer. Default "Infield". */
  brandName?: string
}

export function LoginPage({
  onEnter,
  greeting = 'Welcome to',
  tagline = 'Local-first workspace',
  brandName = 'Infield',
}: LoginPageProps) {
  const [passphrase, setPassphrase] = useState('')
  const [entering, setEntering] = useState(false)

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (entering) return
    setEntering(true)
    // Small delay so the pressed-state animation reads before the app
    // mounts its main shell.
    window.setTimeout(() => onEnter(passphrase), 180)
  }

  const rootStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--on-surface)',
    zIndex: 1000,
    overflow: 'hidden',
  }

  // Kit drag-region is a top-edge strip so Tauri window stays draggable.
  const dragRegionStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 'calc(var(--shell-titlebar-height, 36px) + 12px)',
    zIndex: 30,
  }

  // Tighter container — 340px max instead of 400px so the panel doesn't
  // dominate small app windows. `86vw` ceiling keeps it usable on very
  // narrow windows without edge-clipping.
  const mainStyle: CSSProperties = {
    position: 'relative',
    zIndex: 10,
    width: 'min(340px, 86vw)',
    padding: '0 calc(20px * var(--ui-scale, 1))',
  }

  // Panel — 32/28px padding (was 48/40), 22px radius. Proportionally
  // compact so it reads as a floating lockup, not a dialog.
  const panelStyle: CSSProperties = {
    background: 'var(--heros-glass-fill, color-mix(in srgb, var(--on-surface) 8%, transparent))',
    backdropFilter:
      'blur(var(--heros-glass-blur, 24px)) saturate(var(--heros-glass-saturate, 120%))',
    WebkitBackdropFilter:
      'blur(var(--heros-glass-blur, 24px)) saturate(var(--heros-glass-saturate, 120%))',
    borderRadius: 'calc(var(--radius-scale, 8px) + 14px)',
    padding: 'calc(32px * var(--ui-scale, 1)) calc(28px * var(--ui-scale, 1))',
    border: '1px solid color-mix(in srgb, var(--on-surface) 15%, transparent)',
    boxShadow:
      '0 12px 40px 0 color-mix(in srgb, black 15%, transparent), inset 0 1px 0 color-mix(in srgb, var(--on-surface) 20%, transparent)',
    position: 'relative',
  }

  // ─── Branding block (top of panel) ────────────────────────────────
  const brandingStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: 'calc(26px * var(--ui-scale, 1))',
  }
  // Lock icon badge — 52px (was 64) to match the tighter overall panel.
  const iconBadgeStyle: CSSProperties = {
    width: 'calc(52px * var(--ui-scale, 1))',
    height: 'calc(52px * var(--ui-scale, 1))',
    borderRadius: 'calc(var(--radius-scale, 8px) + 6px)',
    background: 'color-mix(in srgb, var(--on-surface) 8%, transparent)',
    border: '1px solid color-mix(in srgb, var(--on-surface) 15%, transparent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 'calc(18px * var(--ui-scale, 1))',
    boxShadow:
      '0 8px 24px color-mix(in srgb, black 10%, transparent), inset 0 1px 0 color-mix(in srgb, var(--on-surface) 18%, transparent)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    color: 'var(--heros-text-premium, #fdf9f3)',
  }
  // Title — 22px (was 28). Still thin, still proportional.
  const titleStyle: CSSProperties = {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontStyle: 'normal',
    fontSize: 'calc(22px * var(--ui-scale, 1))',
    fontWeight: 300,
    letterSpacing: '0.02em',
    color: 'var(--on-surface)',
    margin: 0,
    marginBottom: 'calc(6px * var(--ui-scale, 1))',
    textAlign: 'center',
  }
  // Eyebrow
  const greetingStyle: CSSProperties = {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontStyle: 'normal',
    fontSize: 'calc(10px * var(--ui-scale, 1))',
    fontWeight: 600,
    letterSpacing: '0.28em',
    textTransform: 'uppercase',
    color: 'color-mix(in srgb, var(--on-surface) 50%, transparent)',
    margin: 0,
    marginBottom: 'calc(14px * var(--ui-scale, 1))',
    textAlign: 'center',
  }
  // Subtitle — tiny, EXTRA wide-tracked
  const subtitleStyle: CSSProperties = {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontStyle: 'normal',
    fontSize: 'calc(10px * var(--ui-scale, 1))',
    fontWeight: 700,
    letterSpacing: '0.4em',
    textTransform: 'uppercase',
    color: 'color-mix(in srgb, var(--heros-text-premium, var(--on-surface)) 80%, transparent)',
    textAlign: 'center',
    margin: 0,
  }

  // Button — 11px vertical padding (was 14). Tighter but still tappable;
  // all hover / active / disabled behavior comes from `.infield-btn-brand`
  // in semantic.css (Kinetic Neumorphism).
  const buttonStyle: CSSProperties = {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontStyle: 'normal',
    marginTop: 'calc(10px * var(--ui-scale, 1))',
    padding: 'calc(11px * var(--ui-scale, 1)) calc(18px * var(--ui-scale, 1))',
    borderRadius: 'calc(var(--radius-scale, 8px) + 6px)',
    fontWeight: 700,
    fontSize: 'calc(13px * var(--ui-scale, 1))',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    width: '100%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'calc(8px * var(--ui-scale, 1))',
  }

  // Footer — small uppercase, very low opacity. Single line instead of
  // two to save vertical space.
  const footerStyle: CSSProperties = {
    marginTop: 'calc(22px * var(--ui-scale, 1))',
    textAlign: 'center',
  }
  const footerTextStyle: CSSProperties = {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontStyle: 'normal',
    fontSize: 'calc(9px * var(--ui-scale, 1))',
    fontWeight: 800,
    letterSpacing: '0.2em',
    color: 'color-mix(in srgb, var(--on-surface) 22%, transparent)',
    textTransform: 'uppercase',
    margin: 0,
  }

  return (
    <div style={rootStyle}>
      <AtmosphericBackground style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
      <GrainOverlay zIndex={1} />

      {/* Tauri drag region + window controls at top edge */}
      <div data-tauri-drag-region style={dragRegionStyle} />
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          height: 'calc(var(--shell-titlebar-height, 36px) + 8px)',
          display: 'flex',
          alignItems: 'center',
          zIndex: 31,
        }}
      >
        <WindowControls />
      </div>

      <main style={mainStyle}>
        {/* Radiant bloom behind the panel — third layer of the HerOS
            atmospheric recipe. Driven by `--heros-bloom-*` tokens so
            theme presets can retint or disable without touching this
            component. See semantic.css → "Radiant bloom backdrop". */}
        <RadiantGlow
          centered={false}
          style={{
            inset: 'calc(-12% * var(--ui-scale, 1))',
            zIndex: 5,
          }}
        />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1] }}
          style={{ position: 'relative', zIndex: 10 }}
        >
          <div style={panelStyle}>
            {/* Branding */}
            <div style={brandingStyle}>
              <div style={iconBadgeStyle} aria-hidden>
                <Lock size={28} strokeWidth={1.6} />
              </div>
              <p style={greetingStyle}>{greeting}</p>
              <h1 style={titleStyle}>Infield</h1>
              <p style={subtitleStyle}>{tagline}</p>
            </div>

            <form
              onSubmit={handleSubmit}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'calc(20px * var(--ui-scale, 1))',
              }}
            >
              {/* Passphrase field — cosmetic for now. Renders the kit's
                  pressed/carved input pattern via GlassWell. When real
                  auth ships, the value already flows up through onEnter. */}
              <GlassWell
                style={{
                  padding:
                    'calc(14px * var(--ui-scale, 1)) calc(16px * var(--ui-scale, 1))',
                  gap: 'calc(12px * var(--ui-scale, 1))',
                }}
              >
                <Key
                  size={18}
                  strokeWidth={1.6}
                  // `infield-input-icon` class drives the -15° rotation +
                  // brightening on the well's :focus-within, defined in
                  // semantic.css. No JS state needed.
                  className="infield-input-icon"
                  color="color-mix(in srgb, var(--heros-text-premium, var(--on-surface)) 50%, transparent)"
                  style={{ flexShrink: 0 }}
                />
                <input
                  type="password"
                  placeholder="Passphrase"
                  value={passphrase}
                  autoComplete="current-password"
                  onChange={(e) => setPassphrase(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: 'var(--heros-text-premium, var(--on-surface))',
                    fontSize: 'calc(15px * var(--ui-scale, 1))',
                    fontFamily: 'inherit',
                    width: '100%',
                    padding: 0,
                  }}
                />
              </GlassWell>

            <button
              type="submit"
              disabled={entering}
              autoFocus
              className="infield-btn-brand"
              style={buttonStyle}
            >
              {entering ? 'Entering…' : 'Enter Infield'}
            </button>
            </form>

            <div style={footerStyle}>
              <p style={footerTextStyle}>
                {brandName === 'Infield'
                  ? 'Local · Private · Yours'
                  : brandName.toUpperCase()}
              </p>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  )
}
