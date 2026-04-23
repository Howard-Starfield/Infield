import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface LlmGpuToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const LlmGpuToggle: React.FC<LlmGpuToggleProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("llm_gpu_enabled") ?? false;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(next) => updateSetting("llm_gpu_enabled", next)}
        isUpdating={isUpdating("llm_gpu_enabled")}
        label={t("settings.advanced.llmGpu.label")}
        description={t("settings.advanced.llmGpu.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);

LlmGpuToggle.displayName = "LlmGpuToggle";
