# Legacy Wiring Map

> **Purpose**: backup reference of what each retirement-candidate frontend file connects to. Used during [frontendplan.md](../../frontendplan.md) Phases 3–7 to avoid dropping connections on the floor when legacy shell files are deleted.
>
> **Scope**: only files marked for retirement in the overhaul. Files being *re-chromed* (e.g. `HomeTab.tsx`, `SearchTab.tsx`, `ImportTab.tsx`, `WorkspaceLayout.tsx`) are not in this map — their connections stay live.
>
> **Written**: 2026-04-21, Phase 0. Covers code state at that date. Re-verify any entry before acting on it in Phase 7.

---

## Retirement Matrix

| File | LOC | Retired in | Replaced by |
|---|---|---|---|
| `src/App.tsx` | 606 | Phase 3 (partial rewrite, not deletion) | New unified shell composition |
| `src/components/TopBar.tsx` | 383 | Phase 7 | New titlebar + glass icon rail + utility chrome (Phase 3) |
| `src/components/BottomBar.tsx` | 246 | Phase 7 | Status indicators in utility chrome / Home widgets (Phase 3–4) |
| `src/components/Sidebar.tsx` | 349 | Phase 7 (non-workspace pieces); workspace tree folds into Notes | Rail + Phase 5 Notes tree |
| `src/components/workspace/chrome/WorkspaceShell.tsx` | 73 | Phase 7 | Phase 3 unified shell + Phase 5/6 Notes/Databases surfaces |
| `src/components/chat/ChatWindow.tsx` | unknown | Phase 7 | Absorbed into Home composer (Phase 4) |

**Rule for Phase 7**: before deleting, grep for any remaining imports. If a non-retired file still imports from these, migrate the caller first.

---

## App.tsx

**Purpose**: root shell. Orchestrates onboarding, tab dispatch, lifecycle init (settings, models, notes, workspace), event wiring.

**Mounts**:
- Lazy: `HomeTab`, `WorkspaceLayout`, `SearchTab`, `ImportTab`, `TopBar`, `BottomBar`, `ChatWindow`
- Eager: `Onboarding`, `AccessibilityOnboarding`, `SystemAudioSession`, `UnifiedSettingsPage`, `Sidebar`, `WorkspaceShell`, `Toaster` (sonner)

**Reads from stores**:
- `useSettings()` → whole settings (via hook contract — verify Rule 4 when rewriting)
- `useSettingsStore()` → `refreshAudioDevices`, `refreshOutputDevices`, `settings`
- `useNotesStore()` → `initialize`, `notes`
- `useModelStore()` → `initialize`
- `useWorkspaceAppearanceStore()` → `initialize`
- `useWorkspaceStore.getState()` → `navigateTo`, `loadRootNodes`, `bumpWorkspaceTreeRevision`, `applyExternalNodeBodyPatch`

**Calls `invoke(...)`** (all paths must survive into new shell):
- `initializeEnigo()` — line 166
- `initializeShortcuts()` — line 167
- `runWorkspaceMigration()` — line 172
- `showMainWindowCommand()` — line 373
- `hasAnyModelsAvailable()` — line 382
- `getWindowsMicrophonePermissionStatus()` — line 419
- `get_or_create_daily_note({ date: today })` — line 233 (called by `Ctrl+Shift+J` hotkey)

**Event listeners** (all must re-wire into new shell):
- `import-recovery-pending` — line 194
- `recording-error` — line 252
- `model-state-changed` — line 279
- `workspace-transcription-synced` — line 299
- `workspace-import-synced` — line 327
- `workspace-node-body-updated` — line 350
- `chat-provider-changed` — line 365
- DOM: `window.addEventListener("handy-open-settings", ...)` — line 146

**Props / callbacks**: none (root component).

**Navigation calls**:
- `setAppView(...)` — lines 141, 313, 563, 575, 587
- `useWorkspaceStore.getState().navigateTo(node.id, ...)` — lines 235, 312

**Replacement**: Phase 3 rewrites the shell conditional. Core responsibilities that survive:
- Onboarding gate
- Lifecycle init (all seven `invoke` calls above)
- All seven event listeners
- Root store initialization calls
- Tab dispatch (moved into new rail + stage)

**What must not regress**: every `invoke` and every event listener above must exist in the new shell.

---

## TopBar.tsx

**Purpose**: top chrome — back/forward, tab pills, system audio toggle, semantic-context toggle for search.

**Mounts**:
- `AudioWaveform` (eager)
- Inline navigation buttons + tab pills

**Reads from stores**:
- `useNavigationStore()` → `canGoBack()`, `canGoForward()`, `navigateBack`, `navigateForward`

**Calls `invoke(...)`**:
- `isSystemAudioCapturing()` — line 69
- `getSystemAudioCaptureElapsedSecs()` — line 73
- `stopSystemAudioCapture()` — line 161
- `startSystemAudioCapture()` — line 166

**Event listeners**:
- `system-audio-stop` — line 103

**Props / callbacks**:
- `appView: AppView`
- `onNavigate(view: AppView)`
- `settingsSection`, `onSettingsSectionChange`
- `viewMode?`, `onViewModeChange?`
- `semanticPanelOpen?`, `onSemanticPanelToggle?`

**Navigation calls**:
- `onNavigate({ tab: tab.id })` — line 251
- `onNavigate({ tab: "workspace", noteId: id })` — lines 139, 146 (back/forward nav)

**Replacement**:
- Back/forward buttons → new titlebar utility chrome
- Tab pills → new glass icon rail (left)
- System audio toggle → utility chrome indicator
- Semantic-context toggle → moves into Search page header (Phase 4)

**What must not regress**: all four `invoke` calls above must wire into new shell.

---

## BottomBar.tsx

**Purpose**: footer status — transcription status, provider, notes count, database + embedding health badges.

**Mounts**:
- `FooterStatusBadge` (internal)
- `StatusGlyph` (internal SVG)

**Reads from stores**:
- `useTranscriptionStatus()` hook
- `useFooterSystemStatus()` hook

**Calls `invoke(...)`**: none.

**Event listeners**: none.

**Props / callbacks**:
- `notesCount: number`
- `activeProvider?: string`

**Navigation calls**: none.

**Replacement**:
- Transcription + provider status → utility chrome indicators in new shell
- Notes count → Home widget (Activity card)
- Database + embedding health badges → utility chrome popover

**What must not regress**: `useTranscriptionStatus` and `useFooterSystemStatus` hooks must still drive a visible indicator somewhere.

---

## Sidebar.tsx

**Purpose**: dual-mode sidebar. In non-workspace mode: app-level tabs + quick-action buttons. In workspace mode: wraps `WorkspaceTree` + settings sections.

**Mounts**:
- `WorkspaceTree` (conditional, eager) — NOT retired; folds into Phase 5 Notes
- `AppSidebarChrome` (utility buttons) — check import count in Phase 7
- Inline nav + quick-action buttons

**Reads from stores**:
- `useWorkspaceStore()` → `createNode`, `navigateTo`

**Calls `invoke(...)`**: none.

**Event listeners**: none.

**Props / callbacks**:
- `appView: AppView`
- `onNavigate(view: AppView)`
- `settingsSection: SettingsSectionId`
- `onSettingsSectionChange(section)`
- `collapsed?: boolean`
- `workspaceSidebar?: boolean`

**Navigation calls**:
- `onNavigate({ tab: item.id })` — line 216 (app tabs)
- `onNavigate({ tab: "workspace", noteId: node.id })` — line 167 (tree click)
- `onNavigate({ tab: "settings" })` — line 293
- `onNavigate({ tab: "help" })` — line 294
- `navigateToWorkspaceNode(node.id, { source: "tree" })` — line 168

**Replacement**:
- App tabs + quick actions → new rail + utility chrome (Phase 3)
- Workspace tree wrapper → new Notes sidebar (Phase 5)
- Settings sections → moved into `UnifiedSettingsPage` as its own route (Phase 4–5)

**What must not regress**:
- `WorkspaceTree` still renders in Notes surface
- `createNode` + `navigateTo` still reachable from a "new document" button
- Settings section state still synchronized with the settings route

---

## WorkspaceShell.tsx

**Purpose**: container wrapping `Sidebar` (workspace mode) + `WorkspaceWindowChrome` + `WorkspaceTabStrip` + children.

**Mounts**:
- `Sidebar` with `workspaceSidebar={true}`
- `WorkspaceWindowChrome` — NOT retired directly, check import count
- `WorkspaceTabStrip` — NOT retired; reused in Phase 5 Notes surface
- `children`

**Reads from stores**: none.

**Calls `invoke(...)`**: none.

**Event listeners**: none.

**Props / callbacks**:
- `appView: AppView`
- `onNavigate(view: AppView)`
- `settingsSection`, `onSettingsSectionChange`
- `children: ReactNode`

**Navigation calls**: none (delegates to `Sidebar`).

**Replacement**: dissolves. Its three children reappear in:
- `WorkspaceTabStrip` → stays, re-chromed in Phase 5
- `WorkspaceWindowChrome` → merges into new titlebar (Phase 3)
- `Sidebar` (workspace mode) → replaced by Phase 5 Notes tree chrome

**What must not regress**: `WorkspaceTabStrip` tab behavior + `WorkspaceWindowChrome` window controls.

---

## ChatWindow.tsx

**Purpose**: standalone chat tab — message transcript, composer, attachments, provider switcher, workspace-draft preview, streaming.

**Mounts**:
- `ChatComposer` (eager)
- `ChatContextDrawer` (eager, conditional)
- `ChatMessageBubble` (eager, repeated)
- `WorkspaceDraftPreviewCard` (conditional)

**Reads from stores**:
- `useChatStore()` → `messages`, `isLoading`, `streamingContent`, `activeSessionId`, `startSession`, `sendMessage`, `pendingWorkspaceDraft`, `pendingWorkspaceDraftError`, `dismissPendingWorkspaceDraft`

**Calls `invoke(...)`**:
- `getChatProviders()` — line 51
- `setChatProvider(config)` — line 155

**Event listeners**:
- `chat-provider-changed` — line 60 (also listened in `App.tsx:365`)

**Props / callbacks**: none.

**Navigation calls**: none.

**Replacement**: entire component absorbed into Home composer (Phase 4). Child components (`ChatComposer`, `ChatContextDrawer`, `ChatMessageBubble`, `WorkspaceDraftPreviewCard`) stay — they get mounted by the Home page instead of `ChatWindow.tsx`.

**What must not regress**:
- Chat store remains the source of truth
- `chat-provider-changed` listener survives (App.tsx handles it too, so no single point of failure)
- Streaming cursor behavior
- Workspace-draft preview card still appears when `pendingWorkspaceDraft` is set

---

## Cross-cutting Concerns

### All Tauri commands invoked across these six files
Every entry below must remain reachable from the new shell:

| Command | Source file |
|---|---|
| `get_or_create_daily_note` | App.tsx:233 |
| `getChatProviders` | ChatWindow.tsx:51 |
| `getSystemAudioCaptureElapsedSecs` | TopBar.tsx:73 |
| `getWindowsMicrophonePermissionStatus` | App.tsx:419 |
| `hasAnyModelsAvailable` | App.tsx:382 |
| `initializeEnigo` | App.tsx:166 |
| `initializeShortcuts` | App.tsx:167 |
| `isSystemAudioCapturing` | TopBar.tsx:69 |
| `runWorkspaceMigration` | App.tsx:172 |
| `setChatProvider` | ChatWindow.tsx:155 |
| `showMainWindowCommand` | App.tsx:373 |
| `startSystemAudioCapture` | TopBar.tsx:166 |
| `stopSystemAudioCapture` | TopBar.tsx:161 |

### All events listened across these six files

| Event | Source file(s) |
|---|---|
| `chat-provider-changed` | App.tsx:365, ChatWindow.tsx:60 |
| `import-recovery-pending` | App.tsx:194 |
| `model-state-changed` | App.tsx:279 |
| `recording-error` | App.tsx:252 |
| `system-audio-stop` | TopBar.tsx:103 |
| `workspace-import-synced` | App.tsx:327 |
| `workspace-node-body-updated` | App.tsx:350 |
| `workspace-transcription-synced` | App.tsx:299 |
| `handy-open-settings` (DOM custom event) | App.tsx:146 |

### Global hotkeys registered in these files

| Hotkey | Action | File:line |
|---|---|---|
| `Ctrl/Cmd+Shift+D` | Toggle debug mode | App.tsx:212–222 |
| `Ctrl/Cmd+Shift+J` | Open today's daily note | App.tsx:225–238 |

### `window.history.*` calls in these files
None found. Navigation is 100% state-driven via `setAppView()` + `workspaceStore.navigateTo()`. Good — Rule 2 compliance in these six files.

(Note: `WorkspaceLayout.tsx` still uses `window.history.pushState` per CLAUDE.md, but that file is NOT in this retirement set — tracked by milestone `M-rail`.)

### Helper components referenced but NOT retired

These get imported by retiring files but stay in the codebase. Verify zero-import status before Phase 7 deletion only if explicitly targeted.

| Component | Imported by | Status |
|---|---|---|
| `WorkspaceTree` | Sidebar.tsx:30 | Survives — folds into Phase 5 Notes |
| `WorkspaceTabStrip` | WorkspaceShell.tsx:5 | Survives — re-chromed in Phase 5 |
| `WorkspaceWindowChrome` | WorkspaceShell.tsx:6 | Merges into new titlebar in Phase 3 |
| `AppSidebarChrome` | Sidebar.tsx:31 | Check import count in Phase 7; likely retired |
| `ChatComposer` | ChatWindow.tsx | Survives — mounts from Home in Phase 4 |
| `ChatContextDrawer` | ChatWindow.tsx | Survives — mounts from Home in Phase 4 |
| `ChatMessageBubble` | ChatWindow.tsx | Survives — mounts from Home in Phase 4 |
| `WorkspaceDraftPreviewCard` | ChatWindow.tsx | Survives — mounts from Home in Phase 4 |
| `AudioWaveform` | TopBar.tsx | Check import count in Phase 7 |
| `FooterStatusBadge`, `StatusGlyph` | BottomBar.tsx | Internal to BottomBar; deleted with it |

---

## Verification Checklist (before Phase 7 deletions)

Run this checklist in Phase 7 before deleting any file in the Retirement Matrix.

1. For every Tauri command in the cross-cutting table — confirm it is still invoked by at least one surviving file. Grep: `invoke("<name>"` and `commands.<name>(`.
2. For every event in the cross-cutting table — confirm at least one surviving `listen("<name>"` call exists, OR confirm the event is safe to drop (user approval).
3. For every global hotkey — confirm it's re-registered in the new shell. Default replacement location: `src/shell/useGlobalHotkeys.ts` (to be created in Phase 3).
4. For helper components marked "Survives" — confirm they have at least one non-retired importer.
5. For helper components marked "Check import count" — if grep shows zero imports, queue for deletion.
6. Run `bun run build` — any broken import from a retiring file will surface here.
7. Run `bunx vitest run` — 149 tests must stay green.
8. Tauri smoke: walk every page once, confirm no console errors.

---

## Change log

- **2026-04-21**: initial map written during Phase 0.
