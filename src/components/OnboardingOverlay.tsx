import React from 'react'
import { AnimatePresence } from 'motion/react'
import { useVault } from '../contexts/VaultContext'
import { OnboardingStepMic } from './OnboardingStepMic'
import { OnboardingStepAccessibility } from './OnboardingStepAccessibility'
import { OnboardingStepModels } from './OnboardingStepModels'
import { OnboardingStepVault } from './OnboardingStepVault'
import { OnboardingStepExtensions } from './OnboardingStepExtensions'

export function OnboardingOverlay() {
  const { onboardingStep } = useVault()

  if (onboardingStep == null || onboardingStep === 'done') return null

  return (
    <div className="onboarding-overlay">
      {/* Drag region so the user can move the window during onboarding. */}
      <div
        data-tauri-drag-region
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 32 }}
      />
      <AnimatePresence mode="wait">
        {onboardingStep === 'mic' && <OnboardingStepMic key="mic" />}
        {onboardingStep === 'accessibility' && (
          <OnboardingStepAccessibility key="accessibility" />
        )}
        {onboardingStep === 'models' && <OnboardingStepModels key="models" />}
        {onboardingStep === 'vault' && <OnboardingStepVault key="vault" />}
        {onboardingStep === 'extensions' && (
          <OnboardingStepExtensions key="extensions" />
        )}
      </AnimatePresence>
    </div>
  )
}
