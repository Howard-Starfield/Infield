import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import { toast } from "sonner";
import { useNavigationStore } from "@/stores/navigationStore";
import { commands } from "@/bindings";
import type { AppView, AppTab } from "@/App";
import { settingsSectionLabelKey } from "@/lib/settingsSection";
import type { SettingsSectionId } from "@/lib/settingsSection";
import { AudioWaveform } from "@/components/AudioWaveform";

interface TopBarProps {
  appView: AppView;
  onNavigate: (view: AppView) => void;
  settingsSection: SettingsSectionId;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
}

const NAV_TABS: { id: AppTab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "search", label: "Search" },
  { id: "import", label: "Import" },
  { id: "audio", label: "Audio" },
  { id: "notes", label: "Notes" },
  { id: "databases", label: "Databases" },
];

type ViewMode = "list" | "grid" | "gallery";

function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export const TopBar: React.FC<
  TopBarProps & {
    viewMode?: ViewMode;
    onViewModeChange?: (mode: ViewMode) => void;
    semanticPanelOpen?: boolean;
    onSemanticPanelToggle?: () => void;
  }
> = ({
  appView,
  onNavigate,
  settingsSection,
  onSettingsSectionChange: _onSettingsSectionChange,
  viewMode: _viewMode = "list",
  onViewModeChange: _onViewModeChange,
  semanticPanelOpen,
  onSemanticPanelToggle,
}) => {
  const { t } = useTranslation();
  const canGoBack = useNavigationStore((s) => s.canGoBack());
  const canGoForward = useNavigationStore((s) => s.canGoForward());
  const navigateBack = useNavigationStore((s) => s.navigateBack);
  const navigateForward = useNavigationStore((s) => s.navigateForward);

  const isWindows = useMemo(() => platform() === "windows", []);
  const [systemAudioCapturing, setSystemAudioCapturing] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const toggleBusyRef = useRef(false);

  const refreshCaptureState = useCallback(async () => {
    try {
      const capRes = await commands.isSystemAudioCapturing();
      const capturing = capRes.status === "ok" && capRes.data;
      setSystemAudioCapturing(capturing);
      if (capturing) {
        const el = await commands.getSystemAudioCaptureElapsedSecs();
        if (el.status === "ok" && el.data != null) {
          setElapsedSecs(Math.floor(el.data));
        }
      } else {
        setElapsedSecs(0);
      }
    } catch {
      // ignore poll errors
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await refreshCaptureState();
    };
    void tick();
    const id = setInterval(() => {
      void tick();
    }, 500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshCaptureState]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("system-audio-stop", () => {
      setSystemAudioCapturing(false);
      setElapsedSecs(0);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const settingsLabelKey = settingsSectionLabelKey(settingsSection);
  const activeTitle = (() => {
    switch (appView.tab) {
      case "search":
        return t("search.title", "Search");
      case "import":
        return t("import.title", "Import");
      case "audio":
        return t("sidebar.systemAudio", "System Audio");
      case "settings":
        return t(settingsLabelKey);
      case "home":
        return t("home.title");
      case "notes":
      case "databases":
        return t("workspace.title", "Workspace");
      default:
        return t("home.title");
    }
  })();

  const handleBack = () => {
    const id = navigateBack();
    if (id) {
      onNavigate({ tab: "notes", nodeId: id });
    }
  };

  const handleForward = () => {
    const id = navigateForward();
    if (id) {
      onNavigate({ tab: "notes", nodeId: id });
    }
  };

  const captureTitle = !isWindows
    ? t("systemAudio.windowsOnly")
    : systemAudioCapturing
      ? t("systemAudio.barStopCapture")
      : t("systemAudio.barStartCapture");

  const handleSystemAudioToggle = async () => {
    if (!isWindows || toggleBusyRef.current) return;
    toggleBusyRef.current = true;
    try {
      if (systemAudioCapturing) {
        const r = await commands.stopSystemAudioCapture();
        if (r.status === "error") {
          toast.error(t("systemAudio.barToggleError"), { description: r.error });
        }
      } else {
        const r = await commands.startSystemAudioCapture();
        if (r.status === "error") {
          toast.error(t("systemAudio.barToggleError"), { description: r.error });
        }
      }
      await refreshCaptureState();
    } finally {
      toggleBusyRef.current = false;
    }
  };

  return (
    <div
      style={{
        height: 56,
        background: "rgba(253,249,243,.86)",
        backdropFilter: "blur(18px)",
        borderBottom: "1px solid var(--workspace-border)",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 8,
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
      }}
    >
      {/* Back / Forward */}
      <button
        type="button"
        disabled={!canGoBack}
        onClick={handleBack}
        style={{
          background: "transparent",
          border: "none",
          color: canGoBack ? "var(--workspace-text-muted)" : "var(--workspace-text-soft)",
          cursor: canGoBack ? "pointer" : "default",
          padding: "6px 8px",
          borderRadius: 4,
          fontSize: 16,
          lineHeight: 1,
        }}
        aria-label={t("navigation.back")}
      >
        ‹
      </button>
      <button
        type="button"
        disabled={!canGoForward}
        onClick={handleForward}
        style={{
          background: "transparent",
          border: "none",
          color: canGoForward ? "var(--workspace-text-muted)" : "var(--workspace-text-soft)",
          cursor: canGoForward ? "pointer" : "default",
          padding: "6px 8px",
          borderRadius: 4,
          fontSize: 16,
          lineHeight: 1,
        }}
        aria-label={t("navigation.forward")}
      >
        ›
      </button>

      {/* Nav pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "rgba(241,237,232,.92)",
          borderRadius: 4,
          border: "1px solid var(--workspace-border)",
          padding: "3px",
          gap: 1,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {NAV_TABS.map((tab) => {
          const isActive = appView.tab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onNavigate({ tab: tab.id })}
              style={{
                background: isActive ? "var(--workspace-panel)" : "transparent",
                border: "none",
                color: isActive ? "var(--workspace-accent)" : "var(--workspace-text-muted)",
                borderRadius: 3,
                padding: "6px 12px",
                fontSize: 11,
                fontFamily: "Manrope, sans-serif",
                fontWeight: 700,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                cursor: "pointer",
                transition: "background 150ms, color 150ms",
                whiteSpace: "nowrap",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        style={{
          minWidth: 0,
          maxWidth: 240,
          paddingLeft: 4,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontFamily: "Manrope, sans-serif",
            fontWeight: 800,
            letterSpacing: ".02em",
            color: "var(--workspace-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {activeTitle}
        </div>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Semantic Context toggle on search tab */}
      {appView.tab === "search" && onSemanticPanelToggle && (
        <button
          type="button"
          onClick={onSemanticPanelToggle}
          aria-expanded={Boolean(semanticPanelOpen)}
          aria-controls="search-semantic-context-panel"
          title={t("search.semanticContext.title")}
          style={{
            background: semanticPanelOpen ? "var(--workspace-panel)" : "transparent",
            border: "1px solid var(--workspace-border)",
            color: semanticPanelOpen ? "var(--workspace-accent)" : "var(--workspace-text-muted)",
            borderRadius: 4,
            padding: "7px 10px",
            fontSize: 11,
            cursor: "pointer",
            fontFamily: "sans-serif",
          }}
        >
          <span className="ms">hub</span>
        </button>
      )}

      {/* System audio capture toggle */}
      <button
        type="button"
        className="topbar-sa-capture"
        data-active={systemAudioCapturing ? "true" : "false"}
        disabled={!isWindows}
        aria-pressed={systemAudioCapturing}
        aria-label={captureTitle}
        title={captureTitle}
        onClick={() => {
          void handleSystemAudioToggle();
        }}
        style={{
          minWidth: systemAudioCapturing ? 118 : 40,
          height: 34,
          padding: systemAudioCapturing ? "0 10px 0 8px" : "0 8px",
          borderRadius: 10,
          border: "1px solid var(--workspace-border)",
          background: systemAudioCapturing ? "rgba(183,35,1,.14)" : "rgba(241,237,232,.72)",
          color: systemAudioCapturing ? "var(--workspace-accent)" : "var(--workspace-text-muted)",
          cursor: !isWindows ? "not-allowed" : "pointer",
          opacity: !isWindows ? 0.45 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          flexShrink: 0,
          transition: "background 180ms ease, color 180ms ease, min-width 200ms ease, box-shadow 180ms ease",
          boxShadow: systemAudioCapturing ? "0 0 0 1px color-mix(in srgb, var(--workspace-accent) 22%, transparent)" : "none",
        }}
      >
        {systemAudioCapturing ? (
          <span className="topbar-sa-capture__wave" aria-hidden>
            <span className="topbar-sa-capture__bar" />
            <span className="topbar-sa-capture__bar" />
            <span className="topbar-sa-capture__bar" />
            <span className="topbar-sa-capture__bar" />
            <span className="topbar-sa-capture__bar" />
          </span>
        ) : (
          <AudioWaveform style={{ display: "block", flexShrink: 0 }} />
        )}
        {systemAudioCapturing ? (
          <span
            aria-live="polite"
            style={{
              fontVariantNumeric: "tabular-nums",
              fontSize: 11,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontWeight: 600,
              letterSpacing: "0.02em",
              color: "var(--workspace-accent)",
            }}
          >
            {formatHms(elapsedSecs)}
          </span>
        ) : null}
      </button>
    </div>
  );
};
