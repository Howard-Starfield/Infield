import React, { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { useVault } from '../contexts/VaultContext'
import { OnboardingStepFrame } from './OnboardingStepFrame'
import { HerOSButton } from './HerOS'

const DEFAULT_VAULT_LABEL = '~/Documents/Infield'

export function OnboardingStepVault() {
  const { completeStep } = useVault()
  const [chosenPath, setChosenPath] = useState<string | null>(null)

  const pickFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const result = (await open({
        directory: true,
        multiple: false,
        title: 'Pick vault folder',
      })) as string | null
      if (result) setChosenPath(result)
    } catch (err) {
      console.error('[OnboardingStepVault] folder pick failed:', err)
    }
  }

  const finish = async () => {
    const now = Math.floor(Date.now() / 1000)
    await completeStep({
      vault_root: chosenPath ?? DEFAULT_VAULT_LABEL,
      current_step: 'done',
      completed_at: now,
      mic_permission: null,
      accessibility_permission: null,
      models_downloaded: null,
    })
  }

  return (
    <OnboardingStepFrame
      stepIndex={4}
      icon={<FolderOpen size={20} />}
      title="Vault location"
      canContinue
      continueLabel="Finish setup"
      onContinue={() => void finish()}
    >
      <p>
        Infield will store your markdown notes at{' '}
        <strong style={{ color: '#fff' }}>{chosenPath ?? DEFAULT_VAULT_LABEL}</strong>.
        Custom locations land in a future release — your choice is saved now so it
        applies automatically once the integration ships.
      </p>

      <div>
        <HerOSButton onClick={() => void pickFolder()}>Choose a folder…</HerOSButton>
      </div>

      {chosenPath && (
        <div className="onboarding-banner onboarding-banner--info">
          Custom path saved: {chosenPath}
        </div>
      )}
    </OnboardingStepFrame>
  )
}
