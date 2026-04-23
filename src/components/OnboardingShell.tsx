/**
 * Onboarding shell — mounts during `EntryStage === "onboarding"`, routes to
 * the active step component based on `onboarding_state.current_step`, and
 * owns the state-machine transitions (advance / skip).
 *
 * Design contract:
 *   - Every transition **awaits** the Rust write before updating local
 *     state or calling `finishOnboarding()`. If the write fails, the shell
 *     stays on the current step and surfaces an inline error banner — per
 *     review feedback on the Phase B commit 2 stub.
 *   - Steps are stateless function components receiving
 *     `{ state, advance, skip, isSubmitting, error }`. They own their own
 *     local input state (e.g. mic grant result) and hand the final patch
 *     up via `advance(patch)`.
 *   - Accessibility step (D13): if `platform() !== "macos"`, the shell
 *     auto-advances past it with `accessibility_permission: "not_applicable"`
 *     so the user never sees the screen.
 */
import { useCallback, useEffect, useState } from "react";
import { platform } from "@tauri-apps/plugin-os";

import { AtmosphericBackground } from "@/shell/primitives";
import {
  getOnboardingState,
  updateOnboardingState,
  type OnboardingState,
  type OnboardingStatePatch,
  type OnboardingStepId,
} from "./onboardingBridge";
import { OnboardingStepWelcome } from "./OnboardingStepWelcome";
import { OnboardingStepTheme } from "./OnboardingStepTheme";
import { OnboardingStepMic } from "./OnboardingStepMic";
import { OnboardingStepAccessibility } from "./OnboardingStepAccessibility";
import { OnboardingStepModels } from "./OnboardingStepModels";
import { OnboardingStepVault } from "./OnboardingStepVault";

/** Linear step progression. `done` is terminal. */
const STEP_ORDER: readonly OnboardingStepId[] = [
  "welcome",
  "theme",
  "mic",
  "accessibility",
  "models",
  "vault",
  "done",
] as const;

function nextStep(current: OnboardingStepId): OnboardingStepId {
  const idx = STEP_ORDER.indexOf(current);
  if (idx < 0 || idx >= STEP_ORDER.length - 1) return "done";
  return STEP_ORDER[idx + 1];
}

export interface StepProps {
  state: OnboardingState;
  /**
   * Advance to the next step, persisting any per-step patch fields first.
   * Awaits the Rust write; throws on failure so the caller can decide
   * whether to stay on the step (the shell wires this via `handleAdvance`
   * which catches and surfaces the error).
   */
  advance: (patch?: OnboardingStatePatch) => Promise<void>;
  /** True while a transition write is in flight — disables CTAs. */
  isSubmitting: boolean;
  /** Last transition error, if any. Rendered by the shell above the step. */
  error: string | null;
}

export interface OnboardingShellProps {
  /** Called after the final step persists `current_step: "done"`. */
  onComplete: () => void;
}

export function OnboardingShell({ onComplete }: OnboardingShellProps) {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load. If this fails, we can't render anything — surface the
  // error to the shell and let the user see it. Unlike App.tsx's
  // fail-open-to-"done" pattern, here we want explicit failure: at this
  // point EntryStage is already "onboarding", so the backend was reachable
  // at least once. A failure here is a real bug to show.
  useEffect(() => {
    let cancelled = false;
    getOnboardingState()
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[onboarding] initial get failed:", err);
          setError(String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAdvance = useCallback(
    async (patch: OnboardingStatePatch = {}) => {
      if (!state || isSubmitting) return;
      setIsSubmitting(true);
      setError(null);

      const target = nextStep(state.current_step);
      const fullPatch: OnboardingStatePatch = {
        ...patch,
        current_step: target,
        // Stamp `completed_at` exactly when we cross into the terminal
        // state — never before. Patching it mid-flow would lie to any
        // later consumer that reads "has the user finished onboarding?"
        ...(target === "done"
          ? { completed_at: Math.floor(Date.now() / 1000) }
          : {}),
      };

      try {
        const next = await updateOnboardingState(fullPatch);
        setState(next);
        if (next.current_step === "done") {
          onComplete();
        }
      } catch (err) {
        console.error("[onboarding] advance failed:", err);
        setError(
          typeof err === "string"
            ? err
            : err instanceof Error
              ? err.message
              : "Failed to save onboarding progress. Please try again.",
        );
        // Deliberately do NOT call onComplete — user stays on this step.
      } finally {
        setIsSubmitting(false);
      }
    },
    [state, isSubmitting, onComplete],
  );

  // Auto-skip the accessibility step on non-macOS (D13). Runs after the
  // initial fetch resolves and only if the user currently sits at the
  // accessibility step. Wraps `handleAdvance` so the same await-before-
  // advance safety applies.
  useEffect(() => {
    if (!state || state.current_step !== "accessibility") return;
    if (platform() === "macos") return;
    void handleAdvance({ accessibility_permission: "not_applicable" });
  }, [state, handleAdvance]);

  if (!state) {
    // Loading — nothing to render yet. The outer EntryContext stage is
    // already on "onboarding" at this point; keep the surface blank so we
    // don't flash stale copy. The initial fetch usually resolves in <50ms.
    return (
      <div className="onboarding-root">
        <AtmosphericBackground
          style={{ position: "absolute", inset: 0, zIndex: 0 }}
        />
      </div>
    );
  }

  const stepProps: StepProps = {
    state,
    advance: handleAdvance,
    isSubmitting,
    error,
  };

  const stepEl = renderStep(state.current_step, stepProps);

  return (
    <div className="onboarding-root">
      <AtmosphericBackground
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      />
      <div data-tauri-drag-region className="onboarding-drag-region" />
      <main
        className="onboarding-main onboarding-step-enter"
        key={state.current_step}
      >
        {stepEl}
      </main>
    </div>
  );
}

function renderStep(step: OnboardingStepId, props: StepProps) {
  switch (step) {
    case "welcome":
      return <OnboardingStepWelcome {...props} />;
    case "theme":
      return <OnboardingStepTheme {...props} />;
    case "mic":
      return <OnboardingStepMic {...props} />;
    case "accessibility":
      // On macOS the step renders; on other platforms the auto-skip effect
      // in the shell will advance past before this ever paints.
      return <OnboardingStepAccessibility {...props} />;
    case "models":
      return <OnboardingStepModels {...props} />;
    case "vault":
      return <OnboardingStepVault {...props} />;
    case "done":
      // Shouldn't be reached — the shell transitions to login via
      // `onComplete` the moment the write that set `done` resolves. If it
      // ever does render, keep it silent rather than flashing stale copy.
      return null;
  }
}
