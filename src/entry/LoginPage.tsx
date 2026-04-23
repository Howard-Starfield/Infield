/**
 * LoginPage — verbatim port of copy/src/App.tsx login section
 * (lines 169-240). Uses H2.1's HerOS primitives (HerOSPanel,
 * HerOSInput, HerOSButton). Per D-H1, Handy renders this only as
 * the Cmd/Ctrl+L lock surface — it is NOT a boot password gate
 * (no encrypted vault).
 *
 * Cosmetic-port discipline (CLAUDE.md):
 *   - Biometric button is dormant (no Tauri biometric API wired);
 *     onBiometric callback optional, no-op toast if absent.
 *   - "Forgot Password?" / "Create New Vault" footer links are
 *     dormant (preventDefault on click); included for visual parity
 *     with copy/. H6 wires them to real flows.
 *   - Master password is opaque to the lock layer here — caller
 *     decides what to do with it (Handy's no-encryption default
 *     accepts any value and unlocks).
 *
 * Atmosphere (Handy three-layer split — copy/ bundles in HerOSBackground):
 *   - AtmosphericBackground (blobs, z 0)
 *   - GrainOverlay (film grain, z 1)
 *   - RadiantGlow (centred bloom, z 5, behind the panel)
 *
 * The `.login-mode` class on the outer wrapper applies copy/'s
 * brightness/saturation shift to the blob field (defined in
 * src/styles/heros.css per H1).
 */
import { useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { Lock as LockIcon, Key, ArrowRight, Loader, Fingerprint } from 'lucide-react'
import { AtmosphericBackground } from '../shell/primitives/AtmosphericBackground'
import { GrainOverlay } from '../shell/primitives/GrainOverlay'
import { RadiantGlow } from '../shell/primitives/RadiantGlow'
import { HerOSPanel, HerOSInput, HerOSButton } from '../shell/primitives'
import { WindowControls } from '../shell/WindowControls'

export interface LoginPageProps {
  /** Called when the user submits the unlock form. Receives the password
   *  string. Caller decides validation; Handy's no-encryption default
   *  accepts any value. */
  onUnlock: (password: string) => Promise<void> | void
  /** Optional inline error displayed above the form. */
  error?: string | null
  /** Optional biometric handler. Dormant (no-op) if absent. */
  onBiometric?: () => void
  /** Optional "Forgot Password?" handler. Dormant (no-op) if absent. */
  onForgotPassword?: () => void
  /** Optional "Create New Vault" handler. Dormant (no-op) if absent. */
  onCreateNewVault?: () => void

  /** Backward-compat alias for callers that pre-date H2.4. Maps onEnter -> onUnlock. */
  onEnter?: (passphrase: string) => void
}

export function LoginPage({
  onUnlock,
  onEnter,
  error = null,
  onBiometric,
  onForgotPassword,
  onCreateNewVault,
}: LoginPageProps) {
  const [password, setPassword] = useState('')
  const [isUnlockingLocal, setIsUnlockingLocal] = useState(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isUnlockingLocal) return
    setIsUnlockingLocal(true)
    try {
      if (onUnlock) {
        await onUnlock(password)
      } else if (onEnter) {
        onEnter(password)
      }
    } finally {
      setIsUnlockingLocal(false)
    }
  }

  return (
    <motion.div
      key="lock"
      className="login-mode"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        overflow: 'hidden',
      }}
    >
      {/* Three-layer atmosphere (Handy split — copy/ bundles all three) */}
      <AtmosphericBackground style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
      <GrainOverlay zIndex={1} />

      {/* Tauri drag region + window controls (verbatim copy/'s height: 48 strip) */}
      <div
        data-tauri-drag-region
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 48,
          zIndex: 9999,
          cursor: 'grab',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          height: 48,
          display: 'flex',
          alignItems: 'center',
          zIndex: 10000,
        }}
      >
        <WindowControls />
      </div>

      <main
        style={{
          position: 'relative',
          zIndex: 10,
          width: '100%',
          maxWidth: '400px',
          padding: '0 24px',
        }}
      >
        {/* Bloom backdrop (copy/'s central light bloom — Handy uses RadiantGlow primitive) */}
        <RadiantGlow
          centered={false}
          style={{
            inset: '-16%',
            zIndex: 5,
          }}
        />

        <div style={{ position: 'relative', zIndex: 10 }}>
          <HerOSPanel>
            {/* Branding block — verbatim from copy/ */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                marginBottom: '40px',
              }}
            >
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '16px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '24px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
                }}
              >
                <LockIcon color="#f0d8d0" size={28} />
              </div>
              <h1
                style={{
                  fontSize: '28px',
                  fontWeight: 300,
                  letterSpacing: '0.02em',
                  color: '#fff',
                  marginBottom: '8px',
                  margin: 0,
                }}
              >
                OS<sup style={{ fontSize: '16px' }}>1</sup>
              </h1>
              <p
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.4em',
                  textTransform: 'uppercase',
                  color: 'rgba(240, 216, 208, 0.8)',
                  textAlign: 'center',
                  margin: 0,
                }}
              >
                Secure Volume
              </p>
            </div>

            {/* Error banner (verbatim) */}
            {error && (
              <div
                style={{
                  color: '#fff',
                  fontSize: '13px',
                  textAlign: 'center',
                  marginBottom: '16px',
                  padding: '10px',
                  background: 'rgba(255, 0, 0, 0.2)',
                  border: '1px solid rgba(255,0,0,0.3)',
                  borderRadius: '8px',
                }}
              >
                {error}
              </div>
            )}

            {/* Unlock form (verbatim) */}
            <form
              onSubmit={handleSubmit}
              style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
            >
              <HerOSInput
                type="password"
                placeholder="Master Password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                icon={<Key color="rgba(240, 216, 208, 0.5)" size={18} />}
              />

              <div style={{ display: 'flex', gap: '12px' }}>
                <HerOSButton
                  type="submit"
                  loading={isUnlockingLocal}
                  icon={
                    isUnlockingLocal ? (
                      <Loader className="spin" size={18} />
                    ) : (
                      <ArrowRight size={18} />
                    )
                  }
                  style={{
                    flex: 1,
                    padding: '16px',
                    borderRadius: '12px',
                    fontWeight: 600,
                    fontSize: '15px',
                    letterSpacing: '0.05em',
                  }}
                >
                  Unlock
                </HerOSButton>
                <HerOSButton
                  type="button"
                  title="Use Biometric Unlock"
                  onClick={() => onBiometric?.()}
                  style={{
                    width: '54px',
                    height: '54px',
                    borderRadius: '12px',
                    padding: 0,
                  }}
                >
                  <Fingerprint size={20} />
                </HerOSButton>
              </div>
            </form>

            {/* Footer links (dormant — verbatim layout from copy/) */}
            <div
              style={{
                marginTop: '36px',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '14px',
                fontWeight: 500,
              }}
            >
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  onForgotPassword?.()
                }}
                style={{
                  color: 'rgba(255, 255, 255, 0.75)',
                  textDecoration: 'none',
                  transition: 'color 0.2s',
                }}
              >
                Forgot Password?
              </a>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  onCreateNewVault?.()
                }}
                style={{
                  color: 'rgba(255, 255, 255, 0.75)',
                  textDecoration: 'none',
                  transition: 'color 0.2s',
                }}
              >
                Create New Vault
              </a>
            </div>
          </HerOSPanel>
        </div>
      </main>
    </motion.div>
  )
}
