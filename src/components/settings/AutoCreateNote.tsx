import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface AutoCreateNoteProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AutoCreateNote: React.FC<AutoCreateNoteProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const autoCreateNote = getSetting("auto_create_note") ?? false;

    return (
      <ToggleSwitch
        checked={autoCreateNote}
        onChange={(enabled) => updateSetting("auto_create_note", enabled)}
        isUpdating={isUpdating("auto_create_note")}
        label={t("settings.advanced.autoCreateNote.label")}
        description={t("settings.advanced.autoCreateNote.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
        tooltipPosition="bottom"
      />
    );
  },
);
