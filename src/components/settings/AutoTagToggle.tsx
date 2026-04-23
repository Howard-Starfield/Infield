import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface AutoTagToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AutoTagToggle: React.FC<AutoTagToggleProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("auto_tag_enabled") ?? false;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(next) => updateSetting("auto_tag_enabled", next)}
        isUpdating={isUpdating("auto_tag_enabled")}
        label={t("settings.advanced.autoTag.label")}
        description={t("settings.advanced.autoTag.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);

AutoTagToggle.displayName = "AutoTagToggle";
