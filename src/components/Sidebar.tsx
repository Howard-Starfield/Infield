import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import {
  AudioLines,
  BotMessageSquare,
  ChevronRight,
  Cog,
  Cpu,
  FlaskConical,
  History,
  Home,
  Info,
  LibraryBig,
  MessageSquare,
  NotebookPen,
  Search,
  Settings,
  Sparkles,
  Plus,
} from "lucide-react";
import {
  GeneralSettings, AdvancedSettings, HistorySettings, DebugSettings,
  AboutSettings, AiPromptsSettings, PostProcessingSettings, ModelsSettings,
} from "./settings";
import { SystemAudioSession } from "./settings/SystemAudioSession";
import { ChatProvidersSettings } from "./settings/ChatProvidersSettings";
import type { AppView } from "@/App";
import type { SettingsSectionId } from "@/lib/settingsSection";
import { WorkspaceTree } from "./workspace/WorkspaceTree";
import { AppSidebarChrome } from "./AppSidebarChrome";
import { useWorkspaceStore } from "@/stores/workspaceStore";

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

interface IconProps { width?: number | string; height?: number | string; size?: number | string; className?: string; [key: string]: any; }
interface SectionConfig { labelKey: string; icon: React.ComponentType<IconProps>; component: React.ComponentType; enabled: (settings: any) => boolean; }

export const SECTIONS_CONFIG = {
  general:       { labelKey: "sidebar.general",        icon: Cog,           component: GeneralSettings,         enabled: () => true },
  models:        { labelKey: "sidebar.models",         icon: Cpu,           component: ModelsSettings,          enabled: () => true },
  advanced:      { labelKey: "sidebar.advanced",       icon: Cog,           component: AdvancedSettings,        enabled: () => true },
  aiPrompts:     { labelKey: "sidebar.aiPrompts",      icon: MessageSquare, component: AiPromptsSettings,       enabled: () => true },
  history:       { labelKey: "sidebar.history",        icon: History,       component: HistorySettings,         enabled: () => true },
  systemAudio:   { labelKey: "sidebar.systemAudio",    icon: AudioLines,   component: SystemAudioSession,      enabled: () => true },
  postprocessing:{ labelKey: "sidebar.postProcessing", icon: Sparkles,      component: PostProcessingSettings,  enabled: (s: any) => s?.post_process_enabled ?? false },
  debug:         { labelKey: "sidebar.debug",          icon: FlaskConical,  component: DebugSettings,           enabled: (s: any) => s?.debug_mode ?? false },
  about:         { labelKey: "sidebar.about",          icon: Info,          component: AboutSettings,           enabled: () => true },
  llmProviders:  { labelKey: "sidebar.llmProviders",   icon: MessageSquare, component: ChatProvidersSettings,   enabled: () => true },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  appView: AppView;
  onNavigate: (view: AppView) => void;
  settingsSection: SettingsSectionId;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
  collapsed?: boolean;
  workspaceSidebar?: boolean;
}

const WORKSPACE_SIDEBAR_WIDTH_KEY = "handy-workspace-sidebar-width";
function loadWorkspaceSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(WORKSPACE_SIDEBAR_WIDTH_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) return Math.min(420, Math.max(200, n));
    }
  } catch { /* ignore */ }
  return 272;
}

// Shared nav-item renderer for both expanded and collapsed states
function NavItem({
  id, label, Icon, isActive, collapsed, onClick, animDelay = 0,
}: {
  id: string;
  label: string;
  Icon: LucideIcon;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
  animDelay?: number;
}) {
  const iconColor = isActive ? "var(--workspace-accent)" : "var(--workspace-text-soft)";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      title={label}
      className="sidebar-nav-btn sidebar-nav-item"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: 10,
        padding: collapsed ? "10px 0" : "8px 12px",
        background: isActive ? "var(--workspace-accent-soft)" : "transparent",
        color: isActive ? "var(--workspace-accent)" : "var(--workspace-text-muted)",
        cursor: "pointer",
        marginBottom: 2,
        animationDelay: `${animDelay}ms`,
      }}
    >
      <Icon size={17} color={iconColor} strokeWidth={1.75} style={{ flexShrink: 0 }} aria-hidden />
      {!collapsed && (
        <span style={{ fontSize: 11, fontFamily: "Inter, sans-serif", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".12em" }}>
          {label}
        </span>
      )}
    </div>
  );
}

export const Sidebar: React.FC<SidebarProps> = ({
  appView, onNavigate, settingsSection, onSettingsSectionChange, collapsed = false, workspaceSidebar = false,
}) => {
  const { t } = useTranslation();
  const createNode = useWorkspaceStore((state) => state.createNode);
  const navigateToWorkspaceNode = useWorkspaceStore((state) => state.navigateTo);
  const [workspaceSidebarWidth, setWorkspaceSidebarWidth] = useState(loadWorkspaceSidebarWidth);
  const [workspaceResizeActive, setWorkspaceResizeActive] = useState(false);
  const workspaceWidthRef = useRef(workspaceSidebarWidth);
  const isResizingWorkspace = useRef(false);
  useEffect(() => { workspaceWidthRef.current = workspaceSidebarWidth; }, [workspaceSidebarWidth]);

  const onWorkspaceSidebarResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (!workspaceSidebar || collapsed) return;
    e.preventDefault();
    isResizingWorkspace.current = true;
    setWorkspaceResizeActive(true);
    const startX = e.clientX;
    const startWidth = workspaceWidthRef.current;
    const onMove = (ev: MouseEvent) => {
      if (!isResizingWorkspace.current) return;
      const next = Math.min(420, Math.max(200, startWidth + (ev.clientX - startX)));
      setWorkspaceSidebarWidth(next);
    };
    const onUp = () => {
      isResizingWorkspace.current = false;
      setWorkspaceResizeActive(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      try {
        localStorage.setItem(WORKSPACE_SIDEBAR_WIDTH_KEY, String(workspaceWidthRef.current));
      } catch { /* ignore */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [workspaceSidebar, collapsed]);

  const topNavItems = [
    { id: "home", label: "Home", Icon: Home },
    { id: "workspace", label: "Workspace", Icon: NotebookPen },
    { id: "chat", label: "Chat", Icon: BotMessageSquare },
    { id: "search", label: "Search", Icon: LibraryBig },
    { id: "audio", label: "Audio", Icon: AudioLines },
  ] as const;

  const sidebarWidth = collapsed ? 56 : (workspaceSidebar ? workspaceSidebarWidth : 258);

  const handleQuickNewDocument = useCallback(async () => {
    const node = await createNode(null, "document", "Untitled");
    onNavigate({ tab: "notes", nodeId: node.id });
    await navigateToWorkspaceNode(node.id, { source: "tree" });
  }, [createNode, navigateToWorkspaceNode, onNavigate]);

  const handleQuickSearch = useCallback(() => {
    onNavigate({ tab: "search" });
  }, [onNavigate]);

  return (
    <div
      style={{
        position: "relative",
        width: sidebarWidth,
        height: "100%",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0.08)), var(--bg-sidebar)",
        backdropFilter: "blur(20px)",
        borderRight: "1px solid rgba(28, 28, 25, 0.08)",
        boxShadow: "inset -1px 0 0 rgba(255,255,255,.4)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflow: "hidden",
        transition: workspaceResizeActive ? "none" : "width 220ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      {/* Top zone — omitted on Workspace tab: tree has its own toolbar (no duplicate Handy / Knowledge header) */}
      {(!workspaceSidebar || collapsed) && (
      <div style={{ padding: collapsed ? "16px 8px 10px" : "16px 14px 10px", flexShrink: 0 }}>
        {/* Logo + title — hidden when rail is collapsed (notes) or when embedding workspace tree (workspace tab) */}
        {!collapsed && !workspaceSidebar && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(145deg, #fffef9, #efe7dd)", border: "1px solid rgba(28,28,25,0.08)", flexShrink: 0, boxShadow: "var(--workspace-shadow-soft)" }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--workspace-text)", lineHeight: 1.1, fontFamily: "Georgia, Iowan Old Style, Times New Roman, serif", letterSpacing: "-0.02em" }}>Infield</div>
              <div className="workspace-eyebrow" style={{ marginTop: 2 }}>{t("sidebar.workspaceLabel")}</div>
            </div>
          </div>
        )}

        {/* Main nav items */}
        {!workspaceSidebar && topNavItems.map((item, i) => (
          <NavItem
            key={item.id}
            id={item.id}
            label={item.label}
            Icon={item.Icon}
            isActive={appView.tab === item.id}
            collapsed={collapsed}
            onClick={() => onNavigate({ tab: item.id as AppView["tab"] })}
            animDelay={i * 35}
          />
        ))}
      </div>
      )}

      {/* Workspace tree or scroll spacer */}
      <div style={{ flex: 1, overflowY: "auto", padding: collapsed ? "0 8px 12px" : "0 12px 12px" }}>
        {workspaceSidebar ? (
          <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
            <div style={{ padding: "14px 10px 12px", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px 12px" }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 11,
                    background: "linear-gradient(145deg, rgba(255,255,255,0.7), rgba(239,231,221,0.9))",
                    border: "1px solid rgba(28,28,25,0.08)",
                    display: "grid",
                    placeItems: "center",
                    color: "var(--workspace-text-muted)",
                    fontSize: 13,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  M
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--workspace-text)",
                      lineHeight: 1.15,
                    }}
                  >
                    Mira Okonkwo
                  </div>
                  <div className="workspace-eyebrow" style={{ marginTop: 3 }}>
                    The Long Read
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <button
                  type="button"
                  onClick={handleQuickSearch}
                  style={workspaceQuickActionStyle(false)}
                >
                  <Search size={14} strokeWidth={1.8} />
                  <span style={{ flex: 1, textAlign: "left" }}>{t("tree.search", { defaultValue: "Search" })}</span>
                  <span style={{ fontSize: 10.5, color: "var(--workspace-text-soft)" }}>Ctrl K</span>
                </button>
                <button type="button" style={workspaceQuickActionStyle(true)}>
                  <Sparkles size={14} strokeWidth={1.8} />
                  <span style={{ flex: 1, textAlign: "left" }}>Ask Infield</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleQuickNewDocument()}
                  style={workspaceQuickActionStyle(false)}
                >
                  <Plus size={14} strokeWidth={1.8} />
                  <span style={{ flex: 1, textAlign: "left" }}>
                    {t("tree.newNote", { defaultValue: "New document" })}
                  </span>
                  <ChevronRight size={13} strokeWidth={1.8} />
                </button>
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0 }}>
              <WorkspaceTree
                onOpenSettings={() => onNavigate({ tab: "settings" })}
                onOpenHelp={() => onNavigate({ tab: "help" })}
                settingsTabActive={appView.tab === "settings"}
                helpTabActive={appView.tab === "help"}
              />
            </div>
          </div>
        ) : null}
      </div>

      {!workspaceSidebar && (
        <AppSidebarChrome
          variant="utility"
          onOpenSettings={() => onNavigate({ tab: "settings" })}
          onOpenHelp={() => onNavigate({ tab: "help" })}
          settingsActive={appView.tab === "settings"}
          helpActive={appView.tab === "help"}
        />
      )}

      {workspaceSidebar && !collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={onWorkspaceSidebarResizeMouseDown}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 5,
            height: "100%",
            cursor: "col-resize",
            zIndex: 5,
          }}
        />
      )}
    </div>
  );
};

function workspaceQuickActionStyle(accent: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    height: 32,
    padding: "0 10px",
    border: "none",
    borderRadius: 9,
    background: "transparent",
    color: accent ? "var(--workspace-accent)" : "var(--workspace-text-muted)",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  };
}
