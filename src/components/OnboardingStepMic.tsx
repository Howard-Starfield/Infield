import React, { useEffect, useState } from 'react'
import { Mic, AlertTriangle } from 'lucide-react'
import { commands } from '../bindings'
import { useVault } from '../contexts/VaultContext'
import { OnboardingStepFrame } from './OnboardingStepFrame'
import { HerOSButton } from './HerOS'

type Status = 'unknown' | 'granted' | 'denied' | 'requesting' | 'opened-settings'

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
const isWin = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win')

export function OnboardingStepMic() {
  const { completeStep } = useVault()
  const [status, setStatus] = useState<Status>('unknown')
  const [busy, setBusy] = useState(false)

  // Initial check on mount + on focus (so flipping permission in the OS
  // settings reflects when the user returns to Infield).
  useEffect(() => {
    const check = async () => {
      if (isMac) {
        try {
          // Plugin only present at runtime on macOS.
          // @ts-ignore — dynamic import; module is OS-conditional.
          const mod: any = await import('tauri-plugin-macos-permissions-api')
          const granted = await mod.checkMicrophonePermission()
          setStatus(granted ? 'granted' : 'denied')
        } catch {
          setStatus('granted')
        }
      } else if (isWin) {
        const result = await commands.getWindowsMicrophonePermissionStatus()
        setStatus(result.overall_access === 'allowed' ? 'granted' : 'denied')
      } else {
        // Linux — assume granted; cpal will surface a clean error at record time.
        setStatus('granted')
      }
    }
    void check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])

  const requestPermission = async () => {
    setBusy(true)
    try {
      if (isMac) {
        // @ts-ignore
        const mod: any = await import('tauri-plugin-macos-permissions-api')
        await mod.requestMicrophonePermission()
        const granted = await mod.checkMicrophonePermission()
        setStatus(granted ? 'granted' : 'denied')
      } else if (isWin) {
        const result = await commands.openMicrophonePrivacySettings()
        if (result.status === 'ok') {
          setStatus('opened-settings')
        }
      }
    } catch (err) {
      console.error('[OnboardingStepMic] permission request failed:', err)
      setStatus('denied')
    } finally {
      setBusy(false)
    }
  }

  const advance = async (perm: 'granted' | 'denied' | 'skipped') => {
    await completeStep({
      mic_permission: perm,
      current_step: 'accessibility',
      // Patch's other optional fields stay null/undefined.
      accessibility_permission: null,
      models_downloaded: null,
      vault_root: null,
      completed_at: null,
    })
  }

  return (
    <OnboardingStepFrame
      stepIndex={1}
      icon={<Mic size={20} />}
      title="Microphone access"
      canContinue={status === 'granted' || status === 'denied' || status === 'opened-settings'}
      continueLabel="Continue"
      onSkip={() => void advance('skipped')}
      skipLabel="Skip"
      onContinue={() => void advance(status === 'granted' ? 'granted' : 'denied')}
    >
      <p>
        Infield records your voice locally to capture transcribed memos. Audio
        never leaves your machine.
      </p>

      {status === 'granted' && (
        <div className="onboarding-banner onboarding-banner--info">
          Microphone access is enabled.
        </div>
      )}

      {status === 'denied' && (
        <div className="onboarding-banner onboarding-banner--warn">
          <AlertTriangle size={14} /> Permission denied. You can enable it later
          in Settings, but voice notes won't work until then.
        </div>
      )}

      {status === 'opened-settings' && (
        <div className="onboarding-banner onboarding-banner--info">
          Settings opened. After granting permission, return here and continue.
        </div>
      )}

      {(status === 'unknown' || status === 'denied' || status === 'opened-settings') && (
        <div>
          <HerOSButton onClick={() => void requestPermission()} loading={busy} disabled={busy}>
            {isMac ? 'Allow microphone' : 'Open Windows settings'}
          </HerOSButton>
        </div>
      )}
    </OnboardingStepFrame>
  )
}
