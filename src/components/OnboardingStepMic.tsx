/**
 * Step 3 — Microphone permission. Platform-specific:
 *   - macOS: `requestMicrophonePermission` from tauri-plugin-macos-permissions-api,
 *     then poll `checkMicrophonePermission` to detect user's choice.
 *   - Windows: open Settings → Privacy → Microphone via backend command.
 *   - Linux: no-op; treat as granted (PulseAudio/PipeWire handle per-session).
 *
 * Skip is always allowed — the voice-memo surface shows a "Grant access"
 * nudge if permission later turns out denied. We only record the outcome
 * in `onboarding_state.mic_permission`; never block advance.
 */
import { useCallback, useState } from "react";
import { platform } from "@tauri-apps/plugin-os";
import {
  checkMicrophonePermission,
  requestMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";

import { HerOSPanel, HerOSButton } from "@/shell/primitives";
import type { StepProps } from "./OnboardingShell";
import type { PermissionState } from "./onboardingBridge";

export function OnboardingStepMic({ advance, isSubmitting, error }: StepProps) {
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleGrant = useCallback(async () => {
    setLocalError(null);
    setPending(true);
    try {
      const os = platform();
      let result: PermissionState = "granted";

      if (os === "macos") {
        await requestMicrophonePermission();
        // macOS surfaces the OS dialog async — poll once to capture the
        // user's immediate choice. If they don't resolve synchronously,
        // we record `skipped` rather than lying; the runtime surface will
        // prompt again the first time they try to record.
        const ok = await checkMicrophonePermission();
        result = ok ? "granted" : "skipped";
      } else if (os === "windows") {
        // No direct API to request on Windows from within the app —
        // Settings → Privacy → Microphone is the canonical surface.
        // Users typically already have it on; record as granted and let
        // the runtime recording path show the usual denied-toast if not.
        result = "granted";
      } else {
        // Linux / unknown — nothing to request.
        result = "not_applicable";
      }

      await advance({ mic_permission: result });
    } catch (err) {
      console.warn("[onboarding] mic request failed:", err);
      setLocalError(
        "We couldn't open the microphone prompt. You can grant access later in Settings.",
      );
    } finally {
      setPending(false);
    }
  }, [advance]);

  const handleSkip = useCallback(() => {
    void advance({ mic_permission: "skipped" });
  }, [advance]);

  const busy = pending || isSubmitting;

  return (
    <HerOSPanel>
      <section aria-label="Microphone access">
        <p className="onboarding-eyebrow">Step 1 of 4</p>
        <h1 className="onboarding-title">Microphone access</h1>
        <p className="onboarding-body">
          Infield uses your microphone for voice memos and meeting transcripts,
          processed locally — nothing leaves your machine. You can grant this
          later in Settings.
        </p>
        {(error || localError) && (
          <div className="onboarding-error">{error ?? localError}</div>
        )}
        <div className="onboarding-actions">
          <HerOSButton
            type="button"
            className="heros-btn-brand"
            onClick={() => void handleGrant()}
            disabled={busy}
          >
            {busy ? "Requesting…" : "Grant access"}
          </HerOSButton>
          <HerOSButton type="button" onClick={handleSkip} disabled={busy}>
            Skip
          </HerOSButton>
        </div>
      </section>
    </HerOSPanel>
  );
}
