/**
 * Step 1 — Welcome. Hero panel, single Continue CTA. No sign-in (OAuth
 * deferred to Phase G per D2a).
 */
import type { StepProps } from "./OnboardingShell";

export function OnboardingStepWelcome({ advance, isSubmitting, error }: StepProps) {
  return (
    <section className="onboarding-panel" aria-label="Welcome">
      <p className="onboarding-eyebrow">Welcome</p>
      <h1 className="onboarding-title">Infield</h1>
      <p className="onboarding-body">
        A local-first knowledge workspace for thinking, capture, and retrieval.
        Let's set it up — a handful of quick choices, no account needed.
      </p>
      {error && <div className="onboarding-error">{error}</div>}
      <div className="onboarding-actions">
        <button
          type="button"
          className="onboarding-cta"
          onClick={() => void advance()}
          disabled={isSubmitting}
        >
          Continue
        </button>
      </div>
    </section>
  );
}
