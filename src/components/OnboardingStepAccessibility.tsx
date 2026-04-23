import React, { useEffect, useRef, useState } from 'react'
import { Shield } from 'lucide-react'
import { useVault } from '../contexts/VaultContext'
import { OnboardingStepFrame } from './OnboardingStepFrame'
import { HerOSButton } from './HerOS'

type Status = 'unknown' | 'granted' | 'denied' | 'requesting'

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

export function OnboardingStepAccessibility() {
  const { completeStep } = useVault()
  const [status, setStatus] = useState<Status>('unknown')
  const [busy, setBusy] = useState(false)
  // Guard so the auto-skip on non-mac runs exactly once even under StrictMode.
  const autoSkipped = useRef(false)

  // Non-macOS: auto-skip on mount.
  useEffect(() => {
    if (isMac) return
    if (autoSkipped.current) return
    autoSkipped.current = true
    void completeStep({
      accessibility_permission: 'not_applicable',
      current_step: 'models',
      mic_permission: null,
      models_downloaded: null,
      vault_root: null,
      completed_at: null,
    })
  }, [completeStep])

  // macOS: poll on mount + on window focus.
  useEffect(() => {
    if (!isMac) return
    const check = async () => {
      try {
        // @ts-ignore
        const mod: any = await import('tauri-plugin-macos-permissions-api')
        const granted = await mod.checkAccessibilityPermission()
        setStatus(granted ? 'granted' : 'denied')
      } catch {
        setStatus('granted') // Plugin missing — don't block.
      }
    }
    void check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])

  if (!isMac) {
    // Render nothing while the auto-skip resolves; the overlay swaps in
    // OnboardingStepModels on the next tick.
    return null
  }

  const requestPermission = async () => {
    setBusy(true)
    try {
      // @ts-ignore
      const mod: any = await import('tauri-plugin-macos-permissions-api')
      await mod.requestAccessibilityPermission()
      const granted = await mod.checkAccessibilityPermission()
      setStatus(granted ? 'granted' : 'denied')
    } catch (err) {
      console.error('[OnboardingStepAccessibility] request failed:', err)
    } finally {
      setBusy(false)
    }
  }

  const advance = async (perm: 'granted' | 'denied' | 'skipped') => {
    await completeStep({
      accessibility_permission: perm,
      current_step: 'models',
      mic_permission: null,
      models_downloaded: null,
      vault_root: null,
      completed_at: null,
    })
  }

  return (
    <OnboardingStepFrame
      stepIndex={2}
      icon={<Shield size={20} />}
      title="Accessibility access"
      canContinue={status !== 'unknown'}
      continueLabel="Continue"
      onSkip={() => void advance('skipped')}
      skipLabel="Skip"
      onContinue={() => void advance(status === 'granted' ? 'granted' : 'denied')}
    >
      <p>
        macOS requires Accessibility access for global keyboard shortcuts (e.g.
        push-to-talk recording). Without it, you can still use the in-app mic
        button — keybindings just won't reach across other apps.
      </p>

      {status === 'granted' && (
        <div className="onboarding-banner onboarding-banner--info">
          Accessibility access is enabled.
        </div>
      )}

      {status === 'denied' && (
        <div className="onboarding-banner onboarding-banner--warn">
          Permission denied. Open System Settings → Privacy & Security →
          Accessibility to enable.
        </div>
      )}

      <div>
        <HerOSButton onClick={() => void requestPermission()} loading={busy} disabled={busy}>
          Open System Settings
        </HerOSButton>
      </div>
    </OnboardingStepFrame>
  )
}
