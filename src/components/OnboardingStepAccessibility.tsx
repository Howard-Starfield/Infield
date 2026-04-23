/**
 * Step 4 — Accessibility permission (macOS only). On non-macOS the shell
 * auto-advances before this ever renders (D13). If somehow it does mount
 * on Windows / Linux, we render a short "not required" message and
 * continue silently; never surface the step as blocking.
 *
 * macOS needs Accessibility permission for system-wide keyboard shortcuts
 * (push-to-talk, global hotkeys) to work. The plugin's
 * `requestAccessibilityPermission` opens the permission prompt / pane.
 */
import { useCallback, useState } from "react";
import { platform } from "@tauri-apps/plugin-os";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
} from "tauri-plugin-macos-permissions-api";

import type { StepProps } from "./OnboardingShell";
import type { PermissionState } from "./onboardingBridge";

export function OnboardingStepAccessibility({
  advance,
  isSubmitting,
  error,
}: StepProps) {
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const os = platform();

  const handleGrant = useCallback(async () => {
    setLocalError(null);
    setPending(true);
    try {
      await requestAccessibilityPermission();
      // macOS won't block on the system pane — user may not have
      // resolved it by the time this returns. Poll once for the
      // immediate state; if still denied we record `skipped` and the
      // app re-checks on focus.
      const ok = await checkAccessibilityPermission();
      const result: PermissionState = ok ? "granted" : "skipped";
      await advance({ accessibility_permission: result });
    } catch (err) {
      console.warn("[onboarding] accessibility request failed:", err);
      setLocalError(
        "We couldn't open System Settings. Try again, or skip — you can grant access later.",
      );
    } finally {
      setPending(false);
    }
  }, [advance]);

  const handleSkip = useCallback(() => {
    void advance({ accessibility_permission: "skipped" });
  }, [advance]);

  const busy = pending || isSubmitting;

  // Defensive: non-macOS renders should have been short-circuited by the
  // shell's auto-advance effect. If this ever paints, give the user a
  // useful message instead of the macOS-specific one.
  if (os !== "macos") {
    return (
      <section className="onboarding-panel" aria-label="Accessibility">
        <p className="onboarding-eyebrow">Step 4 of 6</p>
        <h1 className="onboarding-title">Not required on this platform</h1>
        <p className="onboarding-body">
          Accessibility permissions are a macOS concept. You're all set on
          this system.
        </p>
        <div className="onboarding-actions">
          <button
            type="button"
            className="onboarding-cta"
            onClick={() => void advance({ accessibility_permission: "not_applicable" })}
            disabled={busy}
          >
            Continue
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="onboarding-panel" aria-label="Accessibility permission">
      <p className="onboarding-eyebrow">Step 4 of 6</p>
      <h1 className="onboarding-title">Accessibility access</h1>
      <p className="onboarding-body">
        macOS requires this to send global keyboard shortcuts — push-to-talk,
        quick-open, any hotkey that works outside the app window. Open System
        Settings, tick the box next to Infield, then come back.
      </p>
      {(error || localError) && (
        <div className="onboarding-error">{error ?? localError}</div>
      )}
      <div className="onboarding-actions">
        <button
          type="button"
          className="onboarding-cta"
          onClick={() => void handleGrant()}
          disabled={busy}
        >
          {busy ? "Opening…" : "Open System Settings"}
        </button>
        <button
          type="button"
          className="onboarding-cta onboarding-cta--secondary"
          onClick={handleSkip}
          disabled={busy}
        >
          Skip
        </button>
      </div>
    </section>
  );
}
