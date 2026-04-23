import React from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  Clock,
  HelpCircle,
  Settings,
  Star,
  Trash2,
} from "lucide-react";

export type WorkspaceBottomPanelKey = "daily" | "favorites" | "recents" | "trash";

const ICON_SIZE = 14;

const chromeStripStyle: React.CSSProperties = {
  borderTop: "1px solid var(--workspace-border)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-around",
  padding: "10px 8px 12px",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0)), var(--bg-sidebar)",
  flexShrink: 0,
};

const SIDEBAR_ICON_BTN_CLASS = "workspace-sidebar-icon-btn";

const iconButtonBase: React.CSSProperties = {
  position: "relative",
  border: "none",
  borderRadius: 999,
  cursor: "pointer",
  padding: "7px 10px",
  display: "flex",
  alignItems: "center",
  background: "none",
  transition: "background 80ms, color 80ms",
  boxSizing: "border-box",
  appearance: "none",
  WebkitAppearance: "none",
  outline: "none",
};

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      style={{
        position: "absolute",
        top: 2,
        right: 2,
        background: "var(--workspace-accent)",
        color: "#fff",
        borderRadius: 999,
        fontSize: 8,
        fontWeight: 700,
        padding: "0 4px",
        lineHeight: "12px",
        minWidth: 12,
        textAlign: "center",
      }}
    >
      {count}
    </span>
  );
}

export type AppSidebarChromeProps =
  | {
      variant: "workspace";
      onOpenSettings: () => void;
      onOpenHelp: () => void;
      bottomPanel: WorkspaceBottomPanelKey | null;
      onTogglePanel: (key: WorkspaceBottomPanelKey) => void;
      favoritesCount: number;
      recentsCount: number;
      trashCount: number;
      settingsActive?: boolean;
      helpActive?: boolean;
    }
  | {
      variant: "utility";
      onOpenSettings: () => void;
      onOpenHelp: () => void;
      settingsActive: boolean;
      helpActive: boolean;
    };

export function AppSidebarChrome(props: AppSidebarChromeProps) {
  const { t } = useTranslation();
  const { onOpenSettings, onOpenHelp } = props;

  const settingsActive =
    props.variant === "utility"
      ? props.settingsActive
      : !!props.settingsActive;
  const helpActive =
    props.variant === "utility" ? props.helpActive : !!props.helpActive;

  const settingsStyle: React.CSSProperties = {
    ...iconButtonBase,
    color: settingsActive ? "var(--workspace-accent)" : "var(--workspace-text-muted)",
    background: settingsActive ? "var(--workspace-accent-soft)" : "none",
  };
  const helpStyle: React.CSSProperties = {
    ...iconButtonBase,
    color: helpActive ? "var(--workspace-accent)" : "var(--workspace-text-muted)",
    background: helpActive ? "var(--workspace-accent-soft)" : "none",
  };

  if (props.variant === "utility") {
    return (
      <div style={{ ...chromeStripStyle, justifyContent: "center", gap: 20 }}>
        <button
          type="button"
          className={SIDEBAR_ICON_BTN_CLASS}
          onClick={onOpenSettings}
          title={t("sidebarChrome.settings", "Settings")}
          aria-label={t("sidebarChrome.settings", "Settings")}
          style={settingsStyle}
        >
          <Settings size={ICON_SIZE} aria-hidden />
        </button>
        <button
          type="button"
          className={SIDEBAR_ICON_BTN_CLASS}
          onClick={onOpenHelp}
          title={t("sidebarChrome.help", "Help")}
          aria-label={t("sidebarChrome.help", "Help")}
          style={helpStyle}
        >
          <HelpCircle size={ICON_SIZE} aria-hidden />
        </button>
      </div>
    );
  }

  const {
    bottomPanel,
    onTogglePanel,
    favoritesCount,
    recentsCount,
    trashCount,
  } = props;

  const treeItems = [
    {
      key: "daily" as const,
      icon: <CalendarDays size={ICON_SIZE} aria-hidden />,
      title: t("sidebarChrome.dailyNotes", "Daily Notes"),
    },
    {
      key: "favorites" as const,
      icon: <Star size={ICON_SIZE} aria-hidden />,
      title: t("sidebarChrome.favorites", "Favorites"),
      badge: favoritesCount,
    },
    {
      key: "recents" as const,
      icon: <Clock size={ICON_SIZE} aria-hidden />,
      title: t("sidebarChrome.recent", "Recent"),
      badge: recentsCount,
    },
    {
      key: "trash" as const,
      icon: <Trash2 size={ICON_SIZE} aria-hidden />,
      title: t("sidebarChrome.trash", "Trash"),
      badge: trashCount,
    },
  ];

  return (
    <div style={chromeStripStyle}>
      {treeItems.map((item) => (
        <button
          key={item.key}
          type="button"
          className={SIDEBAR_ICON_BTN_CLASS}
          onClick={() => onTogglePanel(item.key)}
          title={item.title}
          aria-label={item.title}
          style={{
            ...iconButtonBase,
            background:
              bottomPanel === item.key ? "var(--selected-bg)" : "none",
            color:
              bottomPanel === item.key
                ? "var(--workspace-accent)"
                : "var(--workspace-text-muted)",
          }}
        >
          {item.icon}
          {"badge" in item && typeof item.badge === "number" ? (
            <Badge count={item.badge} />
          ) : null}
        </button>
      ))}
      <div
        style={{
          width: 1,
          height: 16,
          background: "var(--workspace-border)",
        }}
      />
      <button
        type="button"
        className={SIDEBAR_ICON_BTN_CLASS}
        onClick={onOpenSettings}
        title={t("sidebarChrome.settings", "Settings")}
        aria-label={t("sidebarChrome.settings", "Settings")}
        style={settingsStyle}
      >
        <Settings size={ICON_SIZE} aria-hidden />
      </button>
      <button
        type="button"
        className={SIDEBAR_ICON_BTN_CLASS}
        onClick={onOpenHelp}
        title={t("sidebarChrome.help", "Help")}
        aria-label={t("sidebarChrome.help", "Help")}
        style={helpStyle}
      >
        <HelpCircle size={ICON_SIZE} aria-hidden />
      </button>
    </div>
  );
}
