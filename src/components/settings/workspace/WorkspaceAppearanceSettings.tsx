import React from "react";
import { Palette, PanelTop, SlidersHorizontal, TableProperties } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { SettingContainer } from "@/components/ui/SettingContainer";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import {
  workspaceDensityPresets,
  workspaceThemePresets,
} from "@/lib/workspaceAppearance";
import { useWorkspaceAppearanceStore } from "@/stores/workspaceAppearanceStore";

function sliderTrack(value: number, min: number, max: number) {
  const percent = ((value - min) / (max - min)) * 100;
  return `linear-gradient(to right, var(--workspace-accent) 0%, var(--workspace-accent) ${percent}%, rgba(143,112,105,0.2) ${percent}%, rgba(143,112,105,0.2) 100%)`;
}

function RangeControl({
  title,
  description,
  min,
  max,
  step,
  value,
  onChange,
  format = (next: number) => String(next),
}: {
  title: string;
  description: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <SettingContainer
      title={title}
      description={description}
      descriptionMode="inline"
      grouped
      layout="stacked"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          onInput={(event) => onChange(Number(event.currentTarget.value))}
          style={{
            flex: 1,
            height: 8,
            borderRadius: 999,
            appearance: "none",
            cursor: "pointer",
            background: sliderTrack(value, min, max),
          }}
        />
        <div
          style={{
            minWidth: 56,
            fontSize: 12,
            color: "var(--workspace-text-muted)",
            textAlign: "right",
            fontFamily: "Space Grotesk, sans-serif",
          }}
        >
          {format(value)}
        </div>
      </div>
    </SettingContainer>
  );
}

function ColorControl({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <SettingContainer
      title={title}
      description={description}
      descriptionMode="inline"
      grouped
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, width: 230 }}>
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{
            width: 36,
            height: 28,
            border: "1px solid var(--workspace-border-strong)",
            borderRadius: 8,
            background: "transparent",
            cursor: "pointer",
          }}
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          maxLength={7}
          style={{ fontFamily: "Space Grotesk, sans-serif" }}
        />
      </div>
    </SettingContainer>
  );
}

function PreviewCard() {
  const appearance = useWorkspaceAppearanceStore((s) => s.resolved);

  return (
    <div
      style={{
        position: "relative",
        borderRadius: "calc(var(--workspace-panel-radius) + 6px)",
        padding: 20,
        background:
          "linear-gradient(180deg, var(--workspace-pane) 0%, color-mix(in srgb, var(--workspace-bg) 72%, transparent) 100%)",
        border: "1px solid var(--workspace-border)",
        boxShadow: "var(--workspace-shadow)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(circle at top right, var(--workspace-shell-glow-right), transparent 34%), radial-gradient(circle at bottom left, var(--workspace-shell-glow-top), transparent 42%)",
          opacity: 0.95,
        }}
      />
      <div style={{ position: "relative", display: "grid", gap: 16 }}>
        <div
          style={{
            display: "grid",
            gap: 10,
            padding: 18,
            borderRadius: "var(--workspace-panel-radius)",
            background: "var(--editor-bg)",
            boxShadow: "var(--workspace-shadow-soft)",
            border: "1px solid var(--workspace-border)",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--workspace-text)" }}>
            Workspace note readability
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.65, color: "var(--workspace-text-muted)" }}>
            This preview keeps the note surface solid and readable while moving the ambient glow
            and lifted shadow into the surrounding chrome.
          </div>
        </div>

        <div
          style={{
            borderRadius: "var(--workspace-panel-radius)",
            overflow: "hidden",
            border: "1px solid var(--workspace-border)",
            boxShadow: "var(--workspace-shadow-soft)",
            background: "var(--workspace-panel)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2.1fr 1fr 1fr",
              background: "var(--workspace-grid-bg-header)",
              borderBottom: "1px solid var(--workspace-grid-border)",
            }}
          >
            {["Name", "Board", "Updated"].map((label) => (
              <div
                key={label}
                style={{
                  padding: "10px 12px",
                  fontSize: 11,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "var(--workspace-text-soft)",
                  fontFamily: "Space Grotesk, sans-serif",
                }}
              >
                {label}
              </div>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2.1fr 1fr 1fr",
              background: "var(--workspace-grid-bg-cell)",
            }}
          >
            {[
              "Audio architecture notes",
              "Focused",
              `${appearance.metrics.gridRowHeight}px row`,
            ].map((label) => (
              <div
                key={label}
                style={{
                  padding: `${Math.max(8, appearance.metrics.gridCellPaddingV + 5)}px ${Math.max(
                    12,
                    appearance.metrics.gridCellPaddingH + 4,
                  )}px`,
                  fontSize: 13,
                  color:
                    label === "Focused"
                      ? "var(--workspace-accent)"
                      : "var(--workspace-text)",
                  borderTop: "1px solid var(--workspace-grid-border-soft)",
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export const WorkspaceAppearanceSettings: React.FC = () => {
  const settings = useWorkspaceAppearanceStore((s) => s.settings);
  const resolved = useWorkspaceAppearanceStore((s) => s.resolved);
  const patchOverrides = useWorkspaceAppearanceStore((s) => s.patchOverrides);
  const resetOverrides = useWorkspaceAppearanceStore((s) => s.resetOverrides);
  const resetAll = useWorkspaceAppearanceStore((s) => s.resetAll);
  const setThemePreset = useWorkspaceAppearanceStore((s) => s.setThemePreset);
  const setDensityPreset = useWorkspaceAppearanceStore((s) => s.setDensityPreset);

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup
        title="Workspace Appearance"
        description="Theme and layout controls stay presentation-only. Notes, tables, navigation, and database wiring keep using the same data paths."
      >
        <SettingContainer
          title="Live preview"
          description="Your changes apply immediately across the workspace and this preview."
          descriptionMode="inline"
          grouped
          layout="stacked"
        >
          <PreviewCard />
        </SettingContainer>
      </SettingsGroup>

      <SettingsGroup title="Presets">
        <SettingContainer
          title="Theme preset"
          description="Start from a visual direction, then tweak individual tokens below."
          descriptionMode="inline"
          grouped
        >
          <div style={{ width: 260 }}>
            <Select
              value={settings.themePresetId}
              options={workspaceThemePresets.map((preset) => ({
                value: preset.id,
                label: preset.label,
              }))}
              isClearable={false}
              onChange={(value) => {
                if (value) void setThemePreset(value as typeof settings.themePresetId);
              }}
            />
          </div>
        </SettingContainer>

        <SettingContainer
          title="Density preset"
          description="Adjust overall note width and database density without changing content."
          descriptionMode="inline"
          grouped
        >
          <div style={{ width: 260 }}>
            <Select
              value={settings.densityPresetId}
              options={workspaceDensityPresets.map((preset) => ({
                value: preset.id,
                label: preset.label,
              }))}
              isClearable={false}
              onChange={(value) => {
                if (value) void setDensityPreset(value as typeof settings.densityPresetId);
              }}
            />
          </div>
        </SettingContainer>
      </SettingsGroup>

      <SettingsGroup title="Color System">
        <ColorControl
          title="Workspace background"
          description="Main shell color behind notes, tables, and chrome."
          value={resolved.colors.bg}
          onChange={(value) => void patchOverrides({ bg: value })}
        />
        <ColorControl
          title="Panel surface"
          description="Cards, menus, settings groups, and lifted shells."
          value={resolved.colors.panel}
          onChange={(value) => void patchOverrides({ panel: value })}
        />
        <ColorControl
          title="Note surface"
          description="Document and row page reading surface."
          value={resolved.colors.editorBg}
          onChange={(value) => void patchOverrides({ editorBg: value })}
        />
        <ColorControl
          title="Primary text"
          description="Main readable text color across notes and database chrome."
          value={resolved.colors.text}
          onChange={(value) => void patchOverrides({ text: value })}
        />
        <ColorControl
          title="Muted text"
          description="Secondary labels, metadata, and helper copy."
          value={resolved.colors.textMuted}
          onChange={(value) => void patchOverrides({ textMuted: value })}
        />
        <ColorControl
          title="Accent"
          description="Primary interactive color for highlights and active states."
          value={resolved.colors.accent}
          onChange={(value) => void patchOverrides({ accent: value })}
        />
        <ColorControl
          title="Secondary accent"
          description="Supporting accent for ambient color and secondary emphasis."
          value={resolved.colors.accentSecondary}
          onChange={(value) => void patchOverrides({ accentSecondary: value })}
        />
        <ColorControl
          title="Border tone"
          description="Separators, outlines, and low-contrast structure lines."
          value={settings.overrides.border ?? resolved.colors.border}
          onChange={(value) => void patchOverrides({ border: value })}
        />
      </SettingsGroup>

      <SettingsGroup title="Atmosphere">
        <RangeControl
          title="Ambient glow"
          description="Controls how much atmospheric color lives around the workspace shell."
          min={0}
          max={100}
          step={1}
          value={Math.round(resolved.ambientGlow * 100)}
          onChange={(value) => void patchOverrides({ ambientGlow: value / 100 })}
          format={(value) => `${value}%`}
        />
        <RangeControl
          title="Shadow depth"
          description="Stronger outer lift for panels, popovers, and ambient shells."
          min={0}
          max={100}
          step={1}
          value={Math.round(resolved.shadowDepth * 100)}
          onChange={(value) => void patchOverrides({ shadowDepth: value / 100 })}
          format={(value) => `${value}%`}
        />
        <RangeControl
          title="Panel blur"
          description="Backdrop blur used on translucent top bars and floating chrome."
          min={0}
          max={30}
          step={1}
          value={resolved.panelBlur}
          onChange={(value) => void patchOverrides({ panelBlur: value })}
          format={(value) => `${value}px`}
        />
        <RangeControl
          title="Corner radius"
          description="Shared rounding for workspace panels and settings groups."
          min={6}
          max={32}
          step={1}
          value={resolved.panelRadius}
          onChange={(value) => void patchOverrides({ panelRadius: value })}
          format={(value) => `${value}px`}
        />
      </SettingsGroup>

      <SettingsGroup title="Layout">
        <RangeControl
          title="Base font size"
          description="Override the fluid CSS base. Leave at Auto for responsive scaling."
          min={11}
          max={20}
          step={1}
          value={settings.overrides.fontSize ?? 15}
          onChange={(value) =>
            void patchOverrides({ fontSize: value === 15 ? null : value })
          }
          format={(value) =>
            settings.overrides.fontSize === undefined
              ? "Auto"
              : value === 15
                ? "Auto"
                : `${value}px`
          }
        />
        <RangeControl
          title="Table row height"
          description="Changes table density while preserving database behavior."
          min={22}
          max={36}
          step={1}
          value={resolved.metrics.gridRowHeight}
          onChange={(value) => void patchOverrides({ gridRowHeight: value })}
          format={(value) => `${value}px`}
        />
        <RangeControl
          title="Cell padding horizontal"
          description="Left and right space inside database cells."
          min={4}
          max={16}
          step={1}
          value={resolved.metrics.gridCellPaddingH}
          onChange={(value) => void patchOverrides({ gridCellPaddingH: value })}
          format={(value) => `${value}px`}
        />
        <RangeControl
          title="Cell padding vertical"
          description="Top and bottom breathing room inside database cells."
          min={1}
          max={8}
          step={1}
          value={resolved.metrics.gridCellPaddingV}
          onChange={(value) => void patchOverrides({ gridCellPaddingV: value })}
          format={(value) => `${value}px`}
        />
        <RangeControl
          title="Note max width"
          description="Controls reading column width for workspace note pages."
          min={760}
          max={1240}
          step={20}
          value={resolved.metrics.editorMaxWidth}
          onChange={(value) => void patchOverrides({ editorMaxWidth: value })}
          format={(value) => `${value}px`}
        />
      </SettingsGroup>

      <SettingsGroup title="Reset">
        <SettingContainer
          title="Appearance reset"
          description="Clear custom tweaks or restore the full workspace look to the default starting point."
          descriptionMode="inline"
          grouped
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Button variant="secondary" size="sm" onClick={() => void resetOverrides()}>
              Clear custom tweaks
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void resetAll()}>
              Reset preset and layout
            </Button>
          </div>
        </SettingContainer>
      </SettingsGroup>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        {[
          {
            icon: Palette,
            title: "Theme-safe",
            text: "Colors, shadows, blur, and spacing stay separated from workspace data and navigation.",
          },
          {
            icon: TableProperties,
            title: "Table-readable",
            text: "Note and table surfaces remain solid for readability while the ambient depth lives around them.",
          },
          {
            icon: PanelTop,
            title: "Preset-first",
            text: "Users can switch looks quickly, then fine tune the result without rewriting components.",
          },
          {
            icon: SlidersHorizontal,
            title: "User-editable",
            text: "The controls here persist through workspace preferences and apply immediately.",
          },
        ].map(({ icon: Icon, title, text }) => (
          <div
            key={title}
            style={{
              padding: 14,
              borderRadius: "var(--workspace-panel-radius)",
              border: "1px solid var(--workspace-border)",
              background: "var(--workspace-panel)",
              boxShadow: "var(--workspace-shadow-soft)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Icon size={14} style={{ color: "var(--workspace-accent)" }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--workspace-text)" }}>
                {title}
              </div>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.55, color: "var(--workspace-text-muted)" }}>
              {text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
