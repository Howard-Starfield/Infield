import React from "react";
import { SettingContainer } from "./SettingContainer";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  isUpdating?: boolean;
  label: string;
  description: string;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  tooltipPosition?: "top" | "bottom";
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  isUpdating = false,
  label,
  description,
  descriptionMode = "tooltip",
  grouped = false,
  tooltipPosition = "top",
}) => {
  const isOff = disabled || isUpdating;

  return (
    <SettingContainer
      title={label}
      description={description}
      descriptionMode={descriptionMode}
      grouped={grouped}
      disabled={disabled}
      tooltipPosition={tooltipPosition}
    >
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        {/* Custom toggle pill */}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={isOff}
          onClick={() => !isOff && onChange(!checked)}
          style={{
            position: "relative",
            width: 42,
            height: 24,
            border: "none",
            borderRadius: 12,
            background: checked
              ? "var(--workspace-accent-secondary)"
              : "rgba(143,112,105,.22)",
            cursor: isOff ? "not-allowed" : "pointer",
            opacity: isOff ? 0.5 : 1,
            transition: "background 200ms ease",
            outline: "none",
            flexShrink: 0,
          }}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow = "0 0 0 2px var(--workspace-accent-secondary)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          {/* Knob */}
          <span
            style={{
              position: "absolute",
              top: 2,
              left: checked ? 20 : 2,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#ffffff",
              boxShadow: "0 1px 4px rgba(0,0,0,.18)",
              transition: "left 200ms cubic-bezier(0.22,1,0.36,1)",
            }}
          />
        </button>

        {/* Spinner overlay when updating */}
        {isUpdating && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                border: "2px solid var(--workspace-accent)",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "spin 0.7s linear infinite",
              }}
            />
          </div>
        )}
      </div>
    </SettingContainer>
  );
};
