import type { ReactNode } from "react";
import type { AppView } from "@/App";
import type { SettingsSectionId } from "@/lib/settingsSection";
import { Sidebar } from "@/components/Sidebar";
import { WorkspaceTabStrip } from "./WorkspaceTabStrip";
import { WorkspaceWindowChrome } from "./WorkspaceWindowChrome";

interface WorkspaceShellProps {
  appView: AppView;
  onNavigate: (view: AppView) => void;
  settingsSection: SettingsSectionId;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
  children: ReactNode;
}

export function WorkspaceShell({
  appView,
  onNavigate,
  settingsSection,
  onSettingsSectionChange,
  children,
}: WorkspaceShellProps) {
  return (
    <div
      className="workspace-infield-shell"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <WorkspaceWindowChrome />

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Sidebar
          appView={appView}
          onNavigate={onNavigate}
          settingsSection={settingsSection}
          onSettingsSectionChange={onSettingsSectionChange}
          collapsed={false}
          workspaceSidebar
        />

        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0)), var(--bg-main)",
          }}
        >
          <WorkspaceTabStrip />
          <div
            style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
