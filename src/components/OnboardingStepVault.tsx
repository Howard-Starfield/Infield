/**
 * Step 6 — Vault location. Shows the resolved default (app_data/
 * infield-vault) and offers a folder-picker.
 *
 * ⚠ Integration note (D19, surfaced Phase B mid-execution 2026-04-22):
 * the Rust `resolve_vault_root` in `src-tauri/src/app_identity.rs`
 * computes its path from `app_data_dir` + a fixed subdirectory name —
 * it does NOT yet read a user-picked path from `user_preferences`.
 * That means the path the user picks here is recorded in
 * `onboarding_state.vault_root` (cosmetic, for audit/history) but the
 * actual vault root on next boot is still the default. Making the
 * backend honour a persisted user choice is tracked as a follow-up
 * inside Phase B or Phase I — see PLAN.md D19.
 *
 * Until that's wired, the step still serves an honest purpose: users
 * who want the default breeze through, and power users who want a
 * custom path surface that intent visibly so it's obvious when the
 * follow-up lands and their choice starts taking effect. No silent
 * lie: the copy says "this will be your vault path on the next
 * release" if the chosen path differs from the default.
 */
import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { commands } from "@/bindings";
import type { StepProps } from "./OnboardingShell";

// `Infield` vault directory name, mirroring `VAULT_DIR_NAME` in
// `src-tauri/src/app_identity.rs`. Duplicated here rather than invented
// on the fly — the mirror comment calls out the contract.
const VAULT_DIR_NAME = "infield-vault";

export function OnboardingStepVault({ advance, isSubmitting, error }: StepProps) {
  const [defaultPath, setDefaultPath] = useState<string | null>(null);
  const [chosenPath, setChosenPath] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Resolve the default path via the existing app-dir command + the
  // mirrored subdirectory name. Display-only; the Rust side uses its
  // own resolved path on boot.
  useEffect(() => {
    let cancelled = false;
    void commands
      .getAppDirPath()
      .then((res) => {
        if (cancelled) return;
        if (res.status === "ok") {
          // Forward-slash normalization so the displayed path is
          // consistent across platforms. Windows presents `\` natively;
          // the file dialog returns `/` on macOS + Linux. Join the two
          // via a consistent separator so the same UI code works.
          const sep = res.data.includes("\\") ? "\\" : "/";
          setDefaultPath(`${res.data}${sep}${VAULT_DIR_NAME}`);
        } else {
          setLocalError(
            "Couldn't resolve the default vault location. You can still finish setup and change it later.",
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[onboarding.vault] getAppDirPath threw:", err);
        setLocalError(
          "Couldn't resolve the default vault location. You can still finish setup and change it later.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePick = useCallback(async () => {
    setLocalError(null);
    setPicking(true);
    try {
      const result = await open({
        directory: true,
        multiple: false,
        title: "Choose a folder for your vault",
      });
      // `open` returns string on success, null on cancel. Array only
      // possible when `multiple: true`, which we don't request.
      if (typeof result === "string" && result.length > 0) {
        setChosenPath(result);
      }
    } catch (err) {
      console.warn("[onboarding.vault] folder pick failed:", err);
      setLocalError("Couldn't open the folder picker. Try again, or use the default.");
    } finally {
      setPicking(false);
    }
  }, []);

  const handleUseDefault = useCallback(() => {
    if (!defaultPath) return;
    void advance({ vault_root: defaultPath });
  }, [advance, defaultPath]);

  const handleUseChosen = useCallback(() => {
    if (!chosenPath) return;
    void advance({ vault_root: chosenPath });
  }, [advance, chosenPath]);

  const busy = picking || isSubmitting;
  const activePath = chosenPath ?? defaultPath;
  const isCustom = chosenPath !== null;

  return (
    <section className="onboarding-panel" aria-label="Vault location">
      <p className="onboarding-eyebrow">Step 6 of 6</p>
      <h1 className="onboarding-title">Where should your vault live?</h1>
      <p className="onboarding-body">
        Infield stores your notes as Markdown files — readable, backup-able,
        yours to move. By default we put them in a managed app folder; pick
        a location you already back up if you'd prefer.
      </p>

      <div
        style={{
          padding: "calc(12px * var(--ui-scale, 1)) calc(14px * var(--ui-scale, 1))",
          borderRadius: "var(--radius-container)",
          border: "1px solid color-mix(in srgb, var(--on-surface) 14%, transparent)",
          background: "color-mix(in srgb, var(--on-surface) 5%, transparent)",
          fontSize: "calc(13px * var(--ui-scale, 1))",
          lineHeight: 1.5,
          wordBreak: "break-all",
          fontFamily: "var(--font-mono, ui-monospace, 'SF Mono', monospace)",
          opacity: activePath ? 1 : 0.5,
        }}
      >
        {activePath ?? "Resolving…"}
      </div>

      {isCustom && (
        <p className="onboarding-body" style={{ fontSize: "calc(12px * var(--ui-scale, 1))", opacity: 0.62 }}>
          Custom locations land in a future release — for this build, your
          vault still uses the default path. Your choice is saved so it
          applies automatically once the integration ships.
        </p>
      )}

      {(error || localError) && (
        <div className="onboarding-error">{error ?? localError}</div>
      )}

      <div className="onboarding-actions">
        <button
          type="button"
          className="onboarding-cta"
          onClick={isCustom ? handleUseChosen : handleUseDefault}
          disabled={busy || !activePath}
        >
          {busy ? "Saving…" : isCustom ? "Use this folder" : "Use default"}
        </button>
        <button
          type="button"
          className="onboarding-cta onboarding-cta--secondary"
          onClick={() => void handlePick()}
          disabled={busy}
        >
          {isCustom ? "Pick different folder" : "Choose a folder…"}
        </button>
      </div>
    </section>
  );
}
