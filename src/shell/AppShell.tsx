import type { ReactNode } from 'react'
import { Titlebar } from './Titlebar'
import { IconRail } from './IconRail'
import { AtmosphericStage } from './AtmosphericStage'
import { AtmosphericBackground, GrainOverlay } from './primitives'
import type { AppTab, AppView } from '../App'

/**
 * Root unified shell — Phase 3 of `frontendplan.md`. Composes the new
 * titlebar, glass icon rail, and atmospheric stage into a single frame
 * that every tab renders into. Replaces the legacy TopBar + Sidebar +
 * BottomBar split and the `WorkspaceShell` branch.
 *
 * The shell itself owns no routing state — the parent `App` passes the
 * current `AppView` and a navigation callback. This keeps `workspaceStore`
 * as the single source of truth for workspace navigation while the shell
 * stays a pure presentation layer.
 *
 * Rule 2 (navigation through workspaceStore): the IconRail's `onNavigate`
 * prop delegates to the parent, which in turn may call
 * `workspaceStore.navigateTo` when switching to notes/databases with a
 * specific node.
 */
export interface AppShellProps {
  appView: AppView
  onNavigate: (view: AppView) => void
  vaultLabel?: string
  onOpenSettings?: () => void
  onOpenNotifications?: () => void
  onRefresh?: () => void
  children: ReactNode
}

export function AppShell({
  appView,
  onNavigate,
  vaultLabel,
  onOpenSettings,
  onOpenNotifications,
  onRefresh,
  children,
}: AppShellProps) {
  const handleRailNavigate = (tab: AppTab) => {
    // Preserve nodeId when rail target is the current tab (no-op scroll
    // to top is the caller's choice). Otherwise reset nodeId since rail
    // clicks mean "take me to the tab's root", not "keep my current doc".
    onNavigate({ tab })
  }

  return (
    <div
      className="infield-app-shell"
      style={{
        position: 'relative',
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        color: 'var(--on-surface)',
        overflow: 'hidden',
        isolation: 'isolate',
      }}
    >
      {/* Window-wide atmospheric canvas — matches the LoadingScreen /
          LoginPage recipe. Mesh + grain sit at zIndex 0/1; titlebar, rail,
          and stage all float above on zIndex ≥ 2, so the shell reads as
          one continuous terracotta atmosphere rather than an opaque
          foundation bezel with the mesh trapped inside the stage. */}
      <AtmosphericBackground style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
      <GrainOverlay zIndex={1} />

      <div style={{ position: 'relative', zIndex: 2, flexShrink: 0 }}>
        <Titlebar
          vaultLabel={vaultLabel}
          onSettings={onOpenSettings ?? (() => onNavigate({ tab: 'settings' }))}
          onNotifications={onOpenNotifications}
          onRefresh={onRefresh}
        />
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 2,
          flex: 1,
          minHeight: 0,
          display: 'flex',
          gap: 'var(--shell-stage-gap, 10px)',
          padding: `0 var(--shell-stage-inset, 14px) var(--shell-stage-inset, 14px)`,
        }}
      >
        <IconRail activeTab={appView.tab} onNavigate={handleRailNavigate} />
        <AtmosphericStage>{children}</AtmosphericStage>
      </div>
    </div>
  )
}
