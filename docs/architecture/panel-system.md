# Modular Panel System — Customizable Workspace Plan

> **Context**: Stable rule is in [CLAUDE.md → Panel System](../../CLAUDE.md#modular-panel-system--summary). Phase status (shipped vs pending) is in [PLAN.md → M-panel-0 / M-panel-1](../../PLAN.md). This file is the **full design spec** — read it before implementing panels, dockview wiring, or Customize mode.

## Vision

Every visible region of the app — tree, editor, backlinks, sidenotes, AI chat, comments, grid toolbar, board, calendar, transcription history — is a **panel**. Users click a **Customize** button in the window chrome and the whole workspace flips into layout-edit mode: panels become draggable cards with resize handles on their edges. Users rearrange, resize, hide, and show panels freely. The resulting layout persists per user. Plugins register new panel types at runtime.

Think Obsidian / VS Code / Arc Spaces — but with Infield's card-and-glass aesthetic: every panel is a "card" with its own header, icon, and optional overflow menu.

## Library choice

**Primary: `dockview` (react-dockview).** Production-grade IDE-style docking: tab groups, split panes, floating panels, serializable layouts, keyboard accessibility, TypeScript throughout. ~100KB gzipped — acceptable for this scope. Used by Azure Data Studio and VS Code forks.

Rejected alternatives:
- `react-grid-layout` — dashboard-style grid with snapping. Good for Grafana-like tools but wrong mental model for a document workspace. Panels snap to grid cells, feels rigid.
- `flexlayout-react` — mature but verbose API, dated patterns, less active.
- `rc-dock` — older, smaller community.
- Rolling our own with `dnd-kit` + `react-resizable-panels` — would take weeks to match dockview's tab/split/float semantics. Not worth it.

Legacy: the existing `react-resizable-panels` usage becomes Panel System Phase 0 (outer shell only). Inner layouts migrate to dockview as each region is reified as a panel.

## Architecture

```
src/panels/
  PanelRegistry.ts          Runtime map: panelType → { component, defaultTitle,
                            icon, minSize, capabilities, plugin? }
                            Core panels register at startup; plugins register
                            via registerPanel() at load time.
  panels.ts                 Typed PanelType enum + PanelMetadata interface.
  PanelHost.tsx             Top-level dockview container. Consumes layoutStore.
  PanelCard.tsx             Card chrome wrapping a panel's body (header, icon,
                            overflow menu, drag handle).
  layoutStore.ts            Zustand store: current layout tree, editMode flag,
                            hidden-panel set, per-panel state.
  layoutStorage.ts          Rust bridge: get_layout_preference /
                            set_layout_preference (persisted per user).
  CustomizeToggle.tsx       The Customize button in window chrome; flips
                            editMode on/off.
  PanelPicker.tsx           Drawer shown in editMode listing all registered
                            panels + "hidden" panels for re-adding.

src/panels/core/
  TreePanel.tsx             Wraps WorkspaceTree.
  EditorPanel.tsx           Wraps the MDX editor shell.
  BacklinksPanel.tsx        Wraps BacklinksSection as a standalone panel.
  SidenotesPanel.tsx        Wraps SidenoteRail.
  AIChatPanel.tsx           Wraps the chat UI.
  CommentsPanel.tsx         Wraps node comments.
  TranscriptionHistoryPanel.tsx   Voice-memo feed.
  SearchPanel.tsx           Dedicated quick-open / hybrid search.

src-tauri/src/commands/
  layout.rs                 get_layout_preference, set_layout_preference,
                            reset_layout_to_default
```

## Panel registration contract

```typescript
interface PanelMetadata {
  id: PanelType                                   // stable string, plugin-namespaced: 'core.tree' / 'plugin.spotify.now-playing'
  title: string                                   // default header label (i18n key preferred)
  icon: LucideIcon | string                       // visual identity
  component: React.FC<PanelProps>                 // render function
  minSize: { width: number; height: number }      // pixels; dockview enforces
  defaultSize?: { width?: number; height?: number }
  singleton: boolean                              // can only one instance exist? (true for tree, false for editor)
  placement?: 'left' | 'center' | 'right' | 'bottom' | 'floating'  // default slot
  capabilities?: PanelCapability[]                // e.g. ['reads:node', 'writes:node'] — Phase 3 plugin sandbox
  plugin?: PluginManifest                         // null for core panels
}

interface PanelProps {
  panelId: string           // instance id (panel type + uuid for non-singletons)
  nodeId?: string           // when contextually bound to a workspace node
  state: unknown            // per-instance panel state (serialized + restored)
  setState: (next: unknown) => void
}
```

**Invariants:**
- Every panel MUST declare `minSize` — preventing zero-width panels that can't be grabbed to resize back.
- Singleton panels can't be duplicated. Non-singletons (editor, chat) can open multiple instances.
- Panel `id` is plugin-namespaced (`core.tree`, `plugin.spotify.now-playing`) so plugin panels never collide with core.
- Panel state is serialized as part of the layout. State objects MUST be JSON-serializable.

## Customize mode UX

1. User clicks **Customize** button (top-right of window chrome, next to Settings gear).
2. `layoutStore.editMode = true` → every panel renders with:
   - Dashed outline (`var(--ghost-border)`)
   - Drag handle overlay on the header
   - Resize handles visible on every edge
   - `X` close button (hide, not delete) on the header
   - Overlay `⋯` menu: Duplicate (if non-singleton) / Move to Tab / Float / Close
3. Bottom drawer shows **PanelPicker** with:
   - All hidden panels (drag into layout to restore)
   - All plugin panels available to register
   - "Reset layout to defaults" button
4. Clicking **Done** (or pressing Escape) exits editMode; layout saves.

## Persistence

Dockview gives a serializable layout tree. Schema:

```typescript
{
  version: 2,
  layout: SerializedDockview,     // dockview's own format — tree of splits/groups/panels
  hidden: string[],               // panel ids the user closed
  panelState: Record<string, unknown>  // per-instance state by panel id
}
```

Stored via:
- localStorage (sync, authoritative for next boot's initial render)
- `user_preferences.layout` (durable, mirrored on change via debounced Tauri call)

Layout versioning: bump `version` when we add required migrations. On load, if `version < current`, run migration functions in sequence.

## Plugin-ready architecture — what to build NOW, what to defer

**Phase 1 (ship with core panels only):**
- `PanelRegistry.register()` API exists and is called at startup for core panels
- Layout persistence works
- Customize mode works
- Panels are strictly typed via `PanelMetadata` interface
- Core panels only — no plugin loading

**Phase 2 (enable trusted first-party plugins):**
- `registerPanel()` callable after startup from an extension manifest
- Plugin manifests declare panels they contribute
- Plugins run in-process (same React tree) — trust model: first-party only

**Phase 3 (third-party plugin sandbox):**
- Plugins run in sandboxed iframes with postMessage IPC
- Capability declarations enforced (`reads:node`, `writes:node`, `reads:vault`)
- Plugin signing + marketplace
- DEFERRED — substantial scope.

## Edge cases — will-bite-you list

1. **Tab-group collapse → resize breaks.** If user drags every panel out of a group, the empty group pane still occupies space. Dockview has `api.removeGroup()` — hook it on group-empty event.

2. **Minimum size violation during rapid drag.** User drags a divider faster than layout recomputes → panel can momentarily shrink below `minSize` → content wraps weirdly. Throttle divider drag via rAF; clamp sizes in the same tick.

3. **Panel registered after layout loaded.** User's saved layout references `plugin.foo.bar` but the plugin isn't loaded this session (uninstalled, failed to load). Current dockview default = crash. Solution: a **missing-panel placeholder** component that renders a dashed outline with "Panel 'plugin.foo.bar' unavailable. [Install] [Remove from layout]".

4. **Customize mode ↔ keyboard shortcuts.** In editMode, all workspace shortcuts (Cmd+K, Cmd+N, Cmd+S) must be suppressed. User's typing targets the layout, not the editor. Gate shortcut handlers on `layoutStore.editMode`.

5. **Dragging a singleton that's already visible.** User drags `core.tree` from PanelPicker into the layout while it already exists → dockview creates a duplicate. Registry must enforce singleton by checking `api.getPanel(id)` before `addPanel()`. If exists, focus it instead.

6. **Layout migration across versions.** Adding a new required panel (e.g. Phase 2 adds AI Chat) to a user who already has a saved layout → new panel never appears unless migration runs. Migration function per version bump: `v1 → v2 = {if (!layout.includes('core.ai-chat')) append to right sidebar}`.

7. **Floating panel at window edge.** User drags a panel off-screen (multi-monitor disconnect, window resize). Must clamp floating panel positions into the visible window rect on every mount.

8. **State round-trip for non-trivial panel contents.** EditorPanel's MDX state includes cursor position, selection, scroll offset. These can't all be JSON-serialized cheaply. Panel state JSON should store only the panel's *meta* (which note is open, which tab is active) — not the editor's live state, which the MDX editor manages internally.

9. **Drag-reorder in a tab group.** Tab reorder within a group is a different gesture than panel reorder between groups. Dockview handles both but gestures can overlap. Test: drag a tab 10px left vs 200px left-and-down — first must reorder within group, second must pop it out into a new group.

10. **CLAUDE.md Rule 3 + Rule 12 apply to panel chrome.** Panel headers, dividers, and drag shadows are all styled via theme tokens only. Every `PanelCard` consumes `--surface-container-high`, `--ghost-border`, `--radius-container`, etc. — never literal colors.

11. **Panel capabilities vs Vault access (Phase 3).** When a plugin declares `reads:node`, it gets a scoped API wrapping `invoke('get_node')`. It MUST NOT be given direct access to the Tauri `invoke` function or it can call anything. The sandbox boundary is the single most security-critical decision — do it right in Phase 3.

12. **Customize button placement in framed vs frameless modes.**
    - Framed (native title bar): Customize button goes in a toolbar row just below the title bar.
    - Frameless (custom title bar): Customize button is part of the custom title bar, next to the window controls.
    - Both modes MUST have the button in a visually consistent position so users don't "lose" the affordance when toggling frame style.

13. **Perf under 20+ panels.** Dockview's virtual DOM scales well, but React reconciliation across 20 panels each with their own subscriptions can stutter. Every panel must use granular Zustand selectors (Rule 4). Any panel that does `useWorkspaceStore()` without a selector is a latent bug.

14. **Collision with `@dnd-kit`.** Dockview uses its own pointer-event DnD system. If a panel's body uses `@dnd-kit` (e.g. tree reorder, board column drag), the two systems must be gesture-scoped: dockview drag starts on header only, panel-body drag starts on non-header region. Test: drag-from-tree-body in editMode must reorder the tree (dnd-kit), drag-from-header must move the panel (dockview).

15. **Focus/Zen mode × customize mode.** Entering Focus mode hides all chrome including the Customize button. Escaping Focus mode restores chrome including whatever editMode state was held. These two modes MUST NOT both be active simultaneously; enter one and the other is suppressed.

## Integration with existing code

- `WorkspaceLayout.tsx` becomes thin: it resolves `activeNode` and delegates rendering to `<PanelHost />`. The hard-coded `DocumentView` / `DatabaseView` / `RowView` branches move into their respective panels' internal logic (each panel reads `activeNode` itself).
- The existing `react-resizable-panels` usage stays as-is in Phase 0. Dockview wraps it from the outside. As panels migrate into dockview, resizable-panels usage shrinks.
- `workspaceStore.navigateTo` keeps working unchanged — it updates `activeNode`, which panels subscribe to.
- Existing sidenote rail / backlinks / comments sections are reified as panels without changing their internal components. A thin wrapper adapts them to `PanelProps`.

## Phasing — shipping order

**Phase 0 (foundation — next session):** Install dockview, build `PanelRegistry`, port ONE core panel (`core.tree`) into the system as a proof of concept. Keep existing `WorkspaceLayout` for everything else.

**Phase 1 (customize MVP):** Port all core panels, Customize button + editMode, layout persistence, reset-to-defaults. No plugins yet.

**Phase 2 (first-party plugins):** `registerPanel` API callable post-boot, plugin manifest loader, first plugin (e.g. calendar widget, Spotify now-playing for vibe).

**Phase 3 (third-party plugin sandbox):** iframe isolation, capability API, plugin signing, marketplace. Substantial scope — defer until 1 and 2 are stable.
