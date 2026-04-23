# Infield Frontend Overhaul Plan

> **Scope**: frontend only. No `src-tauri`, no schema, no backend commands, no migrations.
> **Target**: port `infield (1).html` + the HerOS Liquid Glass aesthetic into the existing React + Vite + Tauri app at `C:\AI_knowledge_workspace\Handy-main`.
> **Companion docs**: this plan OBEYS `CLAUDE.md` and tracks against `PLAN.md`. Where this plan disagrees with either, stop and raise it.
> **Replaces**: the previous `frontendplan.md` (copied from the Codex test workspace and stale — paths like `/C:/frontendchangefromcodex/infield/...` in the prior file referred to a different repo).

---

## 1. Ground Truth — Handy-main Frontend Today

Verified by audit on 2026-04-21 against real files.

### Runtime — current vs target
| Package | Current | Target (this overhaul) |
|---|---|---|
| react / react-dom | 18.3.1 | **19.1.1** (upgraded in Phase 1.5) |
| vite | 6.4.1 | 6.4.1 (unchanged) |
| @vitejs/plugin-react | 4.7.0 | 4.7.0 (unchanged) |
| @tauri-apps/api | 2.10.0 | 2.10.0 (unchanged) |
| motion | 12.38.0 | 12.38.0 (unchanged — `motion/react` entry) |
| three | — | **latest stable** (Phase 2) |
| @react-three/fiber | — | **9.x** (React-19 compatible line, Phase 2) |
| @floating-ui/react | — | **latest** (Phase 3 — tooltips + popovers) |
| @tanstack/react-virtual | — | **latest** (Phase 1 — wire early) |

- `framer-motion` remains **banned**. All motion goes through `motion/react` (v12 WAAPI backend).
- Installed libs we reuse: `lucide-react`, `zustand` + `immer`, `@dnd-kit/*`, `react-resizable-panels`, `sonner`, `@schedule-x/*`, `@glideapps/glide-data-grid`, `@mdxeditor/editor`, `i18next`, `recharts`, `temporal-polyfill`.
- Tailwind v4 stays for legacy/settings surfaces. Banned from `src/components/workspace/` per Rule 3.
- Still absent: `react-router*`, `@radix-ui/*`, `tiptap`, `dockview` (dockview deferred to separate Panel System milestone).

### Shell (current, split)
`src/App.tsx` (606 lines) conditionally renders:
- **Workspace view** (`appView.tab === "workspace"`): `<WorkspaceShell>` → `<Sidebar>` + `<WorkspaceTabStrip>` + `<WorkspaceLayout>`.
- **Everything else**: `<TopBar>` + `<Sidebar>` + content + `<BottomBar>`.

Shell file sizes: `TopBar.tsx` 383, `Sidebar.tsx` 349, `BottomBar.tsx` 246, `WorkspaceShell.tsx` 73.

### Routing contract
```ts
// src/App.tsx:71–84
export type AppTab = "home" | "chat" | "search" | "import" | "audio" | "settings" | "help" | "workspace";
export interface AppView { tab: AppTab; noteId?: string; }
```
- `setAppView({ tab: "workspace", noteId })` used in `App.tsx:313`, `HomeTab.tsx`, `SearchTab.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `ImportTab.tsx`.
- `workspaceStore.navigateTo()` is the document/database engine; it does NOT set the top-level tab. The two systems are currently split and must be reconciled during shell migration.

### Page surfaces (today)
| Tab | File |
|---|---|
| home | `src/components/home/HomeTab.tsx` |
| chat | `src/components/chat/ChatWindow.tsx` |
| search | `src/components/search/SearchTab.tsx` |
| import | `src/components/import/ImportTab.tsx` |
| audio | `src/components/settings/SystemAudioSession.tsx` |
| settings | `src/components/settings/UnifiedSettingsPage.tsx` |
| help | inline placeholder in `App.tsx:527–533` |
| workspace | `src/components/workspace/WorkspaceLayout.tsx` |

### Theme module — already substantial
`src/theme/` ships: `ThemeProvider.tsx`, `tokens.ts` + tests, `semantic.css`, `themeEditor.css`, `ThemeEditorPanel.tsx`, `ThemeEditorRoot.tsx`, `AppCrashBoundary.tsx`, `themeStorage.ts`, `themeStore.ts`, `themeEditorIO.ts` + tests, `presets.ts` (heros-terracotta, heros-midnight, heros-paper, heros-high-contrast), `useThemeEditorHotkey.ts`.

Topology (`src/main.tsx:35–42`):
```tsx
<ThemeProvider>
  <AppCrashBoundary>
    <App />
  </AppCrashBoundary>
  <ThemeEditorRoot />   {/* sibling — survives App crashes */}
</ThemeProvider>
```
All three token tiers (primitive → semantic → component) are implemented. **Do NOT rebuild this — bridge new HerOS surfaces into it.**

### Entry experience (today)
No LoadingScreen. No LoginPage. `App.tsx` shows an inline spinner while `onboardingStep === null`; then `AccessibilityOnboarding` or `Onboarding` (model selection); then main shell.

`HerOS_UI_Kit/components/LoadingScreen.tsx` and `LoginPage.tsx` exist in-repo but are **zero-imported**.

### Reference assets (in-repo, not runtime)
- `HerOS_UI_Kit/` — `styles.css` (53 KB), `components/` (ActionBlade, HerOS, LoadingScreen, LoginPage, SortableLayout), `docs/`. Zero imports from `src/`.
- `infield (1).html` — 4024-line mockup. Not loaded anywhere. Canonical visual target.

### Known pre-existing violations (tracked, not fixed in this overhaul unless we touch those files)
- `WorkspaceLayout.tsx` still uses `window.history.pushState` — Rule 2 legacy, tracked by `M-rail`.
- Hardcoded hex in `BoardColumnHeader.tsx`, `WorkspaceTabStrip.tsx`, `BoardView.tsx`, `BacklinksSection.tsx`, `ChildrenSection.tsx` — Rule 12 violations.
- Tailwind usage in `ColorPickerPopover.tsx` — Rule 3 violation.

New work must not add to these lists. Migrate violations in files we touch.

---

## 2. Locked Constraints (from CLAUDE.md — this plan cannot override)

- **Rule 2**: navigation through `workspaceStore.navigateTo` / `goBack`. No new `window.history.pushState` for workspace nav.
- **Rule 3**: no new Tailwind in `src/components/workspace/`.
- **Rule 12**: no hardcoded color / radius / shadow / spacing literals in `src/`. CSS vars only.
- **Rule 13**: every vault write passes the conflict guard.
- **No `src-tauri` changes** in this overhaul.
- **Do not import `HerOS_UI_Kit/styles.css` directly.** Translate patterns into `src/theme/presets.ts` + `src/theme/semantic.css`.
- **Do not copy HerOS components verbatim.** Rebuild inside existing theme/token architecture.
- **Login is presentation-only**: no password validation, no encryption, no secure-volume copy. Button enters the app.
- **Loading screen is real launch surface**, not a preview.
- **Delete legacy files only after replacement passes Tauri stop gate.**

---

## 3. Visual DNA Contract

Final UI must deliver all of the following; any phase that loses one is a regression:
- Terracotta atmospheric foundation (not neutral SaaS gray)
- Layered glass panels: fill + blur + saturation lift + rim light + restrained shadow
- Grain overlay (SVG `feTurbulence`, token-driven — not baked)
- Thin uppercase eyebrow labels, editorial headings, premium density
- Compact pill/capsule controls, not default app buttons
- Motion: calm, physical, staggered — via CSS transitions + `motion/react` for orchestration
- Titlebar + icon rail + atmospheric stage composition matching `infield (1).html`
- Notes and databases as first-class surfaces, not subpages of a generic "workspace"

---

## 4. Target IA (after overhaul)

| Current | Target | Notes |
|---|---|---|
| home | home | Absorbs `chat` (assistant-first two-column layout per mockup) |
| chat | — | Retired; merged into home |
| search | search | Re-chromed |
| import | import | Re-chromed |
| audio | audio | Re-chromed (preserves capture behavior) |
| settings | settings | Moves to utility chrome (profile menu), not primary rail |
| help | help | Moves to utility chrome |
| workspace | notes / databases | Split into two first-class tabs. `workspaceStore` still the engine. |

`AppView.noteId` renames to `nodeId` during Phase 3.

---

## 5. Phased Rollout (with human stop gates)

Each phase ends at a stop gate. Do not start the next phase until the gate passes.

### Phase 0 — Legacy Wiring Map (no code changes)
Produce `docs/frontend/legacy-wiring-map.md`. For every file listed in §1 "Shell" and §1 "Page surfaces":
- What stores it subscribes to
- What Tauri commands it invokes
- What events it emits / listens to
- What props/callbacks it exposes
- Its replacement in the new shell (blank for now if unknown)

This is the backup reference the user asked for. Once written, we can delete old files in Phase 7 without losing connection knowledge.

**Stop gate**: user reads the map, confirms it's complete for the files we'll retire.

### Phase 1 — Visual Foundation
Goal: make the new atmospheric language available everywhere without changing behavior.

Build in `src/shell/primitives/`:
- `AtmosphericBackground.tsx` — terracotta mesh via `radial-gradient` + `color-mix()`, driven by `--heros-brand` and related primitives.
- `GrainOverlay.tsx` — SVG `feTurbulence` overlay. Opacity from `--heros-grain-opacity` (already a registered slider token).
- `GlassPanel.tsx` / `GlassWell.tsx` / `GlassStage.tsx` — wrappers consuming `--heros-glass-fill`, `--heros-glass-blur`, `--heros-glass-saturate`, `--heros-rim-light`, `--heros-panel-shadow`.
- `PageHeader.tsx` / `Eyebrow.tsx` — editorial header + uppercase label primitives.
- `Chip.tsx` / `SegmentedControl.tsx` / `CompactButton.tsx` — premium control primitives.
- `VirtualList.tsx` — thin `@tanstack/react-virtual` wrapper (install dep here so it's wired from day one, per D4).

Add missing semantic tokens to `src/theme/semantic.css` (e.g. `--shell-glow`, `--stage-inset-shadow`). No new primitives unless a gap is real.

No page currently consumes these primitives yet. Nothing visible changes.

**Stop gate**:
- `bun run build` clean
- `bunx vitest run` green
- Theme editor (Cmd/Ctrl+,) still opens
- Primitives render correctly in a throwaway `/playground` route or Storybook-style dev page
- No regression in existing UI

### Phase 1.5 — React 19 Upgrade
Per D2, upgrade before touching entry/shell so every later phase builds on React 19.

Steps:
- Bump `react` + `react-dom` to `19.1.1`. Bump `@types/react` + `@types/react-dom` to matching majors.
- Run the React 19 codemod (`npx codemod@latest react/19/migration-recipe`) over `src/`.
- Verify each installed dep survives:
  - `motion@12.38.0` — claims React 19 support, but smoke-test animations.
  - `@dnd-kit/*` — verify board/tree/sortable still work.
  - `react-resizable-panels@2.1.7` — verify gutter drag.
  - `@glideapps/glide-data-grid@6.0.3` — verify grid mount + edit + overlay.
  - `@schedule-x/react@4.1.0` — verify calendar renders.
  - `@mdxeditor/editor@3.20.0` — verify markdown editor + toolbar.
  - `sonner@2.0.7`, `react-i18next@16.4.1`, `recharts@3.8.1`, `react-select@5.8.0` — verify.
- Any dep without R19 support → pin to latest pre-R19 fork or escalate before continuing.
- Keep Phase 1 primitives rendering in dev playground throughout.

**Stop gate**:
- `bun run build` clean
- `bunx vitest run` — 149 tests green
- Tauri smoke: every current tab loads, workspace editor types, grid edits, calendar renders, board drags
- Theme editor still opens on `Cmd/Ctrl+,`
- No hydration warnings or strict-mode errors in console

### Phase 2 — Entry Experience
Per D1, the 3D HerOS LoadingScreen ships as the real launch surface.

Install: `three` (latest stable) + `@react-three/fiber@9` (React 19 compatible).

Build under `src/entry/`:
- `LoadingScreen.tsx` — port the 3D lemniscate orb from `HerOS_UI_Kit/components/LoadingScreen.tsx` into `@react-three/fiber`. Rebuild, do NOT copy verbatim. Atmosphere (mesh + grain) comes from Phase 1 primitives. Progress stages: 0–30 Tauri + SQLite, 30–60 `workspace_fts`, 60–85 embedding sidecar, 85–100 `workspaceStore.hydrate`.
- 2D fallback: render when `@react-three/fiber` fails to mount or `prefers-reduced-motion: reduce`. Same atmosphere, static orb.
- `LoginPage.tsx` — presentation-only per locked constraints. Single "Enter Infield" button. No password field. No security copy. Uses `GlassPanel` from Phase 1.
- Launch sequence: **Loading → (existing onboarding if needed) → Login → App**. Onboarding preserved.

Wire into `main.tsx` / `App.tsx`. `AppCrashBoundary` stays between `ThemeProvider` and `App`.

**Stop gate**:
- App launches through 3D Loading in Tauri
- Reduced-motion users see the 2D fallback
- Login enters the app on click
- Accessibility + model onboarding still run when required
- Tauri drag regions + window controls work
- Theme editor still openable
- `bun run build` + `bunx vitest run` green

### Phase 3 — Root Shell + Route Hard Cutoff
Replace the split shell with unified Infield chrome:
- Custom titlebar (drag region, window controls, vault indicator)
- Glass icon rail (left): home, search, import, audio, notes, databases
- Utility/profile chrome (right): settings, help, profile menu — uses `@floating-ui/react` (D3a) for the profile popover and rail tooltips
- Atmospheric stage container wraps page content

Route contract — **hard cutoff per D5**:
- `AppTab` becomes `"home" | "search" | "import" | "audio" | "notes" | "databases" | "settings" | "help"`. `"chat"` and `"workspace"` are removed the same day.
- Rename `AppView.noteId` → `nodeId`.
- Migrate every caller in one pass. Per audit, the caller set is:
  - `src/App.tsx:313`
  - `src/components/home/HomeTab.tsx`
  - `src/components/search/SearchTab.tsx`
  - `src/components/Sidebar.tsx`
  - `src/components/TopBar.tsx` (being retired — rewrite as rail)
  - `src/components/import/ImportTab.tsx`
  - `src/components/workspace/WorkspaceLayout.tsx` (internal routing)
- Add a TypeScript-level guard: `AppTab` no longer includes `"workspace"` or `"chat"`, so the compiler catches any missed caller.
- `WorkspaceLayout` receives a new `mode: "notes" | "databases"` prop — derived from `activeNode.node_type` — and branches internally.

Do NOT delete `TopBar.tsx` / `BottomBar.tsx` / `WorkspaceShell.tsx` / `ChatWindow.tsx` yet. Leave them unreferenced-but-present until Phase 7 so we can git-revert if a smoke test fails.

**Stop gate**:
- Every caller in the list above compiles + runs
- Every user flow that used to navigate to `"workspace"` or `"chat"` now lands on `notes` / `databases` / `home` without regression
- TypeScript compile passes with no `as any` escapes
- Window controls + drag region work in Tauri
- `Cmd/Ctrl+,` still opens theme editor
- `workspaceStore.navigateTo` still works from every caller

### Phase 4 — Home, Search, Import, Audio
Rebuild these four surfaces in new chrome:
- **Home**: absorbs old `chat` tab. Two-column per mockup — assistant composer + chat transcript on left, widget stack on right.
  - **Drag-to-rearrange widgets (D3b-i)**: right-column widgets (Today/Calendar, Activity heatmap, Recents, and any future widgets) are reorderable via `@dnd-kit/sortable` (already installed). A "Customize" button top-right of Home toggles edit mode — dashed outlines + drag handles appear. Widget order persists via `user_preferences` (reuse existing key scheme). `react-virtual` wraps Recents.
  - NOT a full Panel System. Scope: Home page only. Full docking / floating / plugin panels deferred to `M-panel-*` milestone post-overhaul.
- **Search**: hero input + results list in stage composition. Results use `@tanstack/react-virtual`.
- **Import**: dropzone + source chips + queue panels. Preserve queue behavior.
- **Audio**: restyle `SystemAudioSession`. Preserve capture state machine.

Any "open document" action calls `setAppView({ tab: "notes", nodeId })` (or `databases`).

**Stop gate**:
- All four pages function end-to-end
- Home widget reorder works, persists across app restart, and respects reduced-motion
- `chat` behavior fully absorbed into Home composer
- No compat shim exists (hard cutoff already happened in Phase 3)

### Phase 5 — Notes Surface
Turn the document side of `WorkspaceLayout` into a first-class Notes experience:
- Notes tree (existing `WorkspaceTree` re-chromed)
- Browser-style tab strip (existing `WorkspaceTabStrip` re-chromed — Rule 12 migration)
- Split-capable editor stage (MDXEditorView unchanged internally)
- Right context rail: backlinks + children + sidenotes

Preserve: autosave, MDX editing, external-edit conflict (Rule 13), voice-memo pills, theme editor safety.

**Stop gate**:
- All existing workspace-document behavior verified in Tauri
- No regression in autosave or refresh behavior
- Rule 13 still enforced

### Phase 6 — Databases Surface
Recast database side of `WorkspaceLayout`:
- Left database list
- Database header (icon, title, cover)
- View tabs (existing `ViewSwitcher` re-chromed)
- Grid / board / calendar shells

Database engine, view switching, row-open flows untouched.

**Stop gate**:
- Parity with current database behavior verified in Tauri
- All existing grid/board/calendar interactions work

### Phase 7 — Retirement + Cleanup
`AppTab` was already hard-cut in Phase 3. This phase deletes the unreferenced legacy *files* left behind.

Delete, in order (each after its replacement has passed Tauri smoke across Phases 3–6):
- `src/components/chat/ChatWindow.tsx` (unreferenced since Phase 3)
- `src/components/TopBar.tsx`
- `src/components/BottomBar.tsx`
- `src/components/workspace/chrome/WorkspaceShell.tsx`
- Non-workspace behavior inside `src/components/Sidebar.tsx` — keep only the workspace tree piece if Phase 5 chose to reuse it
- Any component that is zero-imported per `docs/frontend/legacy-wiring-map.md`

Cross-check each deletion against the wiring map. If a file has connections not yet migrated, do NOT delete.

Final polish pass: motion tone, density, responsive behavior, Tauri window fidelity.

**Stop gate**: user reviews deleted-file list before merge.

---

## 6. Per-phase Verification Checklist

Run all of these at every stop gate:
- `bun run build` — no new errors beyond existing allowlist
- `bunx vitest run` — 149 existing tests green
- Tauri smoke on touched surfaces
- `Cmd/Ctrl+,` theme editor opens
- No new Tailwind in `src/components/workspace/`
- No new hardcoded colors / radii / shadows in `src/`
- No new whole-store Zustand subscriptions (Rule 4)
- No new `window.history.pushState` for workspace nav (Rule 2)

---

## 7. Locked Decisions (2026-04-21)

| # | Decision | Resolution |
|---|---|---|
| D1 | 3D orb in LoadingScreen | **3D, exact HerOS reference.** Add `three` + `@react-three/fiber@9` in Phase 2. 2D fallback for reduced-motion + mount failures. |
| D2 | React 19 upgrade | **Upgrade to 19.1.1 in a dedicated Phase 1.5.** Verify each third-party dep before continuing. |
| D3a | Tooltips / popovers library | **Add `@floating-ui/react`** in Phase 3 for rail tooltips + profile popover. |
| D3b | Drag-to-rearrange scope | **Home widgets only** — use existing `@dnd-kit/sortable`. "Customize" toggle top-right of Home. Order persists via `user_preferences`. Full Panel System deferred to separate `M-panel-*` milestone. |
| D4 | `@tanstack/react-virtual` | **Add in Phase 1.** Wire `VirtualList` primitive from day one; use in Home recents + search results. |
| D5 | Route migration strategy | **Hard cutoff at end of Phase 3.** `AppTab` loses `"workspace"` and `"chat"` same day; compiler enforces no stragglers. No shim. |

---

## 8. Out of Scope (do not attempt in this overhaul)

- `src-tauri` changes (commands, schema, migrations, Rust code)
- `framer-motion` (banned — use `motion/react`)
- Dark-mode tokens beyond existing heros-midnight preset
- Vault encryption at rest
- **Full Modular Panel System** (`M-panel-*` milestones) — separate track per CLAUDE.md § Modular Panel System. Home widget drag (D3b) is NOT the full system; it's a narrower, Home-page-only reorder.
- `dockview` dep (deferred with the Panel System)
- Fixing pre-existing Rule 2/3/12 violations in files we don't touch

---

## 9. First Concrete Actions

1. Write `docs/frontend/legacy-wiring-map.md` (Phase 0)
2. User reviews the wiring map
3. Start Phase 1 — visual foundation primitives + install `@tanstack/react-virtual`
4. Phase 1.5 — React 19 upgrade
5. Phase 2 — 3D LoadingScreen + LoginPage (install `three`, `@react-three/fiber@9`)
6. …continue through Phase 7
