/**
 * Typed bridge between the frontend onboarding surfaces and the Rust
 * `onboarding_state` table.
 *
 * Uses `invoke()` directly instead of the `commands.*` specta wrappers —
 * the Phase B Rust commands are registered but `bindings.ts` regenerates
 * only on next `bun run tauri dev`. Swap to `commands.*` once that lands
 * (trivial; types already match).
 *
 * ⚠ Centralizes the **await-before-advance** pattern called out in the
 * Phase B commit 2 review: every state mutation must await the Rust
 * write and surface failure to the caller so the UI can stay on the
 * current step and show an error instead of silently advancing.
 */
import { invoke } from "@tauri-apps/api/core";

export type OnboardingStepId =
  | "welcome"
  | "theme"
  | "mic"
  | "accessibility"
  | "models"
  | "vault"
  | "done";

export type PermissionState =
  | "granted"
  | "denied"
  | "skipped"
  | "not_applicable";

export interface OnboardingState {
  current_step: OnboardingStepId;
  mic_permission: PermissionState | null;
  accessibility_permission: PermissionState | null;
  models_downloaded: string[];
  vault_root: string | null;
  started_at: number;
  completed_at: number | null;
}

export interface OnboardingStatePatch {
  current_step?: OnboardingStepId;
  mic_permission?: PermissionState;
  accessibility_permission?: PermissionState;
  models_downloaded?: string[];
  vault_root?: string;
  completed_at?: number;
}

export async function getOnboardingState(): Promise<OnboardingState> {
  return invoke<OnboardingState>("get_onboarding_state");
}

export async function updateOnboardingState(
  patch: OnboardingStatePatch,
): Promise<OnboardingState> {
  return invoke<OnboardingState>("update_onboarding_state", { patch });
}

export async function resetOnboarding(): Promise<void> {
  await invoke("reset_onboarding");
}
