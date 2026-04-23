/**
 * Step 2 — Theme picker. Grid of presets; click to commit via
 * `themeStore.setPreset(id)` — theme module persists via its own
 * schema-versioned localStorage layer, so nothing to thread through
 * `onboarding_state`.
 *
 * Hover previews via a transient `themeStore.setPreset` call + revert
 * `onPointerLeave`. Uses symmetric pointer events (not timeouts) so a
 * rapid mouse-out on the same frame doesn't strand the transient preset.
 */
import { useState } from "react";

import { PRESETS } from "@/theme/presets";
import type { PresetId } from "@/theme/tokens";
import { useThemeStore } from "@/theme/themeStore";
import type { StepProps } from "./OnboardingShell";

const PRESET_ENTRIES = Object.values(PRESETS);

export function OnboardingStepTheme({ advance, isSubmitting, error }: StepProps) {
  const activePresetId = useThemeStore((s) => s.presetId);
  const setPreset = useThemeStore((s) => s.setPreset);
  // Cache the preset that was active when the user started hovering so
  // `onPointerLeave` restores it instead of sticking with a preview.
  const [hoverBase, setHoverBase] = useState<PresetId | null>(null);

  const handleEnter = (id: PresetId) => {
    if (hoverBase === null) setHoverBase(activePresetId);
    if (id !== activePresetId) setPreset(id);
  };

  const handleLeave = () => {
    if (hoverBase !== null && hoverBase !== activePresetId) {
      setPreset(hoverBase);
    }
    setHoverBase(null);
  };

  const handleCommit = (id: PresetId) => {
    // User clicked — that's the real selection, so reset the hover base
    // so leave doesn't revert it.
    setHoverBase(null);
    if (id !== activePresetId) setPreset(id);
  };

  return (
    <section className="onboarding-panel" aria-label="Choose a theme">
      <p className="onboarding-eyebrow">Step 2 of 6</p>
      <h1 className="onboarding-title">Pick a look</h1>
      <p className="onboarding-body">
        You can change this any time in Settings. Hover to preview, click to select.
      </p>
      <div className="onboarding-preset-grid">
        {PRESET_ENTRIES.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="onboarding-preset-card"
            data-active={preset.id === activePresetId}
            onPointerEnter={() => handleEnter(preset.id)}
            onPointerLeave={handleLeave}
            onClick={() => handleCommit(preset.id)}
            disabled={isSubmitting}
            aria-pressed={preset.id === activePresetId}
            style={
              {
                // Per-card swatch colors driven by the preset primitives so
                // the preview tile reflects the actual theme foundation.
                "--preset-preview-a": preset.primitives.brand,
                "--preset-preview-b": preset.primitives.surfaceBase,
              } as React.CSSProperties
            }
          >
            <div className="onboarding-preset-swatch" aria-hidden />
            <span className="onboarding-preset-name">{preset.name}</span>
          </button>
        ))}
      </div>
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

