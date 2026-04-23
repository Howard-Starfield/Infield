import React, { type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowRight } from 'lucide-react'
import { HerOSButton } from './HerOS'

export const ONBOARDING_TOTAL_STEPS = 4

interface Props {
  stepIndex: number // 1-based: 1, 2, 3, 4
  icon: ReactNode
  title: string
  /** Disable the Continue button when the step isn't ready (e.g. waiting for permission). */
  canContinue: boolean
  /** Continue label (default "Continue"). */
  continueLabel?: string
  /** Show a Skip button to the left of Continue. */
  onSkip?: () => void
  skipLabel?: string
  onContinue: () => void
  children: ReactNode
}

export function OnboardingStepFrame({
  stepIndex,
  icon,
  title,
  canContinue,
  continueLabel = 'Continue',
  onSkip,
  skipLabel = 'Skip',
  onContinue,
  children,
}: Props) {
  return (
    <motion.div
      key={stepIndex}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="heros-glass-card onboarding-panel"
    >
      <header className="onboarding-header">
        <div className="onboarding-icon-badge">{icon}</div>
        <h2 className="onboarding-title">{title}</h2>
        <span className="onboarding-step-counter">
          {stepIndex} of {ONBOARDING_TOTAL_STEPS}
        </span>
      </header>

      <div className="onboarding-body">{children}</div>

      <footer className="onboarding-footer">
        <div className="onboarding-dots" aria-hidden>
          {Array.from({ length: ONBOARDING_TOTAL_STEPS }).map((_, i) => {
            const idx = i + 1
            const className =
              idx === stepIndex
                ? 'onboarding-dot onboarding-dot--active'
                : idx < stepIndex
                ? 'onboarding-dot onboarding-dot--complete'
                : 'onboarding-dot'
            return <span key={i} className={className} />
          })}
        </div>
        <div className="onboarding-actions">
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.55)',
                fontSize: 13,
                cursor: 'pointer',
                padding: '8px 12px',
              }}
            >
              {skipLabel}
            </button>
          )}
          <HerOSButton
            onClick={onContinue}
            disabled={!canContinue}
            icon={<ArrowRight size={16} />}
            style={{ minWidth: 120 }}
          >
            {continueLabel}
          </HerOSButton>
        </div>
      </footer>
    </motion.div>
  )
}
