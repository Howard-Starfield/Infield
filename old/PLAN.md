# Infield — Plan & Status

> **This file tracks goals, phase status, and what's next.**
> For stable architecture rules and invariants that apply every session, see [CLAUDE.md](CLAUDE.md).
> For historical design context, see [PROJECT_HANDOVER.md](PROJECT_HANDOVER.md).
> For the visual target, see [`infield (1).html`](infield%20%281%29.html) and [`HerOS_UI_Kit/`](HerOS_UI_Kit/).

---

## Product Goals

What Infield is trying to be, phrased so every future decision can be checked against it:

1. **A local-first, offline-first unified workspace** — notes, databases, voice memos, and AI chat live in one vault on the user's machine. No cloud dependency. Opens instantly, works on a plane.
2. **Pixel-for-pixel HerOS "Liquid Glass"** — every surface matches the mockup at [`infield (1).html`](infield%20%281%29.html). Users who customize the brand color see the entire UI follow. Zero hardcoded literals in components.
3. **Vault-as-truth, never lose user data** — `.md` files are the source, SQLite is a derived index, every write path checks "did the file change on disk?" before overwriting. Conflict = ask the user, never auto-resolve by clobbering.
4. **AI-native from the ground up** — hybrid FTS + vector search, wikilinks, voice-to-doc routing, and future voice-to-database all flow through the same pipeline. AI writes go through the same `update_node` path as human writes.
5. **Under user control** — theme tokens govern every pixel; a customize mode will let users rearrange panels. Plugins can register panels post-Phase-2.

## Non-goals (v1)

Explicit carve-outs so we don't drift:
- Multi-device sync / CRDT (defer; vault-over-Syncthing is the workaround)
- Multi-workspace / vault switching (one vault per install)
- Graph view (data ready via `page_links`; UI deferred)
- Third-party plugin sandbox (Panel System Phase 3)
- Vault encryption at rest (follow-up to app-level lock)
- Wikilinks inside table rich-text cells (v2)

## Current Focus

**Phase**: Frontend UI polish — match the `infield (1).html` mockup.
**This session's target**: User is choosing between Entry Experience port, Editor Chrome polish, or Rail navigation. Recommendation: Entry Experience next (biggest first-impression payoff, unblocked except for one small decision).
**Blocker decision**: Entry Experience needs app-level lock vs vault-encryption choice — see Open Decisions below.

---

## Shipped

### M-data: Data integrity + vault foundation
| Capability | Where | Notes |
|---|---|---|
| `folder.db` UI removed | backend + frontend | Unified on `workspace_nodes` |
| `notes.db` merged into `workspace.db` | `open_shared_database` | FK-safe row copy; legacy file renamed |
| Vault write-through (DB → file) | `write_node_to_vault()` | YAML frontmatter; temp + rename atomic write |
| Read-from-file (file wins on mtime) | `get_node` | `file_mtime > updated_at + 1s` guard |
| Live file watcher removed (Rule 14) | — | Replaced by `window:focus` re-fetch + Rule 13 conflict guard |
| Vault process lock | `.infield.lock` at vault root | Prevents two instances corrupting usearch |
| Database import (vault → SQLite) | `commands/vault_sync.rs` | Round-trips databases |
| Rule 13 conflict guard | every vault write path | Prevents silent overwrite when doc is open |
| Board card vault write-back | `managers/workspace/vault/board.rs` | Card edits persist to `cards/<id>.md` |
| `window:focus` re-fetch of active node | Frontend | Catches external edits, no watcher |
| Rename → delete old slug file | cascade includes descendants | No orphans |
| Mic daily note ISO format (`YYYY-MM-DD`) | `actions.rs` | Filesystem-sortable; legacy migration in place |
| Cloud-sync file filter | `get_node` 0-byte guard | Ignores `.icloud`, `(conflict)`, empty files |
| Unicode NFC + case-insensitive slug collision | `compute_vault_rel_path` | macOS/Windows dupe protection |
| Embedding sidecar production fix | `resolve_sidecar_path(app_handle)` | Works in dev + bundle |
| FTS `BEGIN IMMEDIATE` | `replace_workspace_fts_row` | Serializes concurrent writes |

### M-theme: Theme Module Phase 1
| Component | File | Status |
|---|---|---|
| Types + derivation | [`src/theme/tokens.ts`](src/theme/tokens.ts) | 22 primitives, `resolveTheme`, `deriveCssVars`, `deriveAttrs`, WCAG contrast math |
| Built-in presets | [`src/theme/presets.ts`](src/theme/presets.ts) | Terracotta, Midnight, Paper, High Contrast — all pass contrast |
| Store | [`src/theme/themeStore.ts`](src/theme/themeStore.ts) | Zustand, atomic `setPreset`, per-field override |
| Persistence | [`src/theme/themeStorage.ts`](src/theme/themeStorage.ts) | localStorage-sync authoritative + `user_preferences` durable (200ms debounce) |
| Runtime provider | [`src/theme/ThemeProvider.tsx`](src/theme/ThemeProvider.tsx) | rAF-batched setProperty + setAttribute, URL `?theme=` escape, derived-contrast dev warnings |
| Semantic cascade | [`src/theme/semantic.css`](src/theme/semantic.css) | Every `--workspace-*` token derives from primitives via `color-mix()` / `calc()` |
| FOUT guard | [`index.html`](index.html) inline IIFE | Reads `infield:theme:vars` before React mounts |
| `@property` + reduced-motion | [`src/App.css`](src/App.css) | 6 slider-driven tokens typed; one global reduce-motion rule |
| Editor UI | [`src/theme/ThemeEditorPanel.tsx`](src/theme/ThemeEditorPanel.tsx) | Preset grid, color pickers, sliders, inline contrast warning, import/export |
| Hotkey | [`src/theme/useThemeEditorHotkey.ts`](src/theme/useThemeEditorHotkey.ts) | `Cmd/Ctrl+,` |
| Crash resilience | [`src/theme/AppCrashBoundary.tsx`](src/theme/AppCrashBoundary.tsx) | Editor stays reachable if main tree throws |
| Mount topology | [`src/main.tsx`](src/main.tsx) | ThemeProvider outer; AppCrashBoundary wraps App; ThemeEditorRoot sibling |
| Tests | `tokens.test.ts`, `themeEditorIO.test.ts`, `primitives.test.ts` | **149 tests green** |

**Invariants** (don't break these):
- `ThemeEditorRoot` is a sibling of `<App />`, not a child — crash-recovery depends on it.
- `AppCrashBoundary` must stay above `<App />` and below `<ThemeProvider>` / sibling to `<ThemeEditorRoot />`.
- `REGISTERED_SLIDER_TOKENS` in `tokens.ts` and `@property` blocks in `App.css` are parallel lists.
- Default preset's `onSurface` is `#ffffff` (not `#fdf9f3`) to clear AA body text on terracotta.
- localStorage keys (`infield:theme:state`, `infield:theme:vars`) appear in both `themeStorage.ts` and `index.html` inline script.

### M-db: Database polish (Phases A–G)
| Phase | Deliverable | Location |
|---|---|---|
| A | Semantic token cascade (color-mix derivations from primitives) | [`src/theme/semantic.css`](src/theme/semantic.css) |
| B | Primitives: `GlassCard`, `StatusTag`, `OwnerAvatar`, `MiniProgress`, `useDiffFlash` | [`src/components/workspace/primitives/`](src/components/workspace/primitives/) |
| C | `DatabaseShell` chrome, `ViewSwitcher` tabs, glass-wrapped body | [`DatabaseShell.tsx`](src/components/workspace/DatabaseShell.tsx), [`ViewSwitcher.tsx`](src/components/workspace/ViewSwitcher.tsx) |
| D | Table cell renderers — partial (canvas cells not yet themed) | `workspaceGlideHandy.tsx` — follow-up in M-editor |
| E | Kanban: BoardCard + BoardColumnHeader retheme; hover moved to CSS class | [`BoardCard.tsx`](src/components/workspace/BoardCard.tsx), [`BoardColumnHeader.tsx`](src/components/workspace/BoardColumnHeader.tsx) |
| F | Calendar skin (Schedule-X overrides) | [`calendarScheduleXOverrides.css`](src/components/workspace/calendarScheduleXOverrides.css) |
| G | Selective upgrades: diff-flash on cell edit, inset-accent row selector | via `.infield-diff-flash`, `.infield-row-selected` |

**Audit fixes shipped this session** (audit report + 7-group fix pass):
- B3 + Q6 + F4: Paper preset muted/soft alphas bumped (65→82%, 40→62%) to clear WCAG AA/AA-large; `checkDerivedContrastWarnings` + `composite` + `contrastOfAlphaText` helpers
- B2 + Q8: `inferStatusVariant` rewritten with `\b` anchors + review-before-blocked-before-done ordering + negation guard; 5 new adversarial test blocks
- B1: Tailwind utilities stripped from `BoardColumnHeader`
- Q3: matchMedia guard now reads resolved mode (preset + overrides)
- Q4: BoardCard hover moved to `.infield-board-card:hover` CSS class; `--infield-card-transform` CSS var composes with `:hover`
- Q1: Three hardcoded literals tokenized (DatabaseShell chip bg, ViewSwitcher hover, OwnerAvatar ink)
- F5: `deriveAttrs` + `data-contrast-boost` attribute; semantic.css switched from fragile `[style*=…]` selector

### M-tree-p1: Tree polish Phase 1
| Change | File |
|---|---|
| 9 tree-specific tokens | [`semantic.css`](src/theme/semantic.css) |
| Focused-row visual: neutral translucent ink + inset rim-light | [`WorkspaceTree.tsx:433-514`](src/components/workspace/WorkspaceTree.tsx) |
| DB badge (pink mono pill) on database nodes | [`WorkspaceTree.tsx:598-615`](src/components/workspace/WorkspaceTree.tsx) |
| Literal `rgba(255,255,255,0.52)` removed | [`WorkspaceTree.tsx:446`](src/components/workspace/WorkspaceTree.tsx) |

---

## Active

*Next: waiting on the user's pick between:*

1. **Entry Experience** (LoadingScreen + LoginPage port from kit) — 2–4 hours. Blocked on app-level-lock vs vault-encryption decision.
2. **Editor Chrome + Toolbar** — 2–3 hours. Self-contained.
3. **Rail navigation** — half a day+. Biggest structural change.

Recommendation: Entry Experience for biggest visible payoff first.

---

## Roadmap

### M-entry: Entry Experience
Port `HerOS_UI_Kit/components/LoadingScreen.tsx` + `LoginPage.tsx` into `src/entry/`. Wire `AppBootstrap` gate.
- Dependencies: `three`, `@react-three/fiber` (for lemniscate ribbon)
- New Tauri commands: `set_app_passphrase`, `verify_app_passphrase` (Argon2id hashed)
- Sequence: LoadingScreen (cold-start stages 1-4) → LoginPage (if passphrase set) → `WorkspaceLayout`
- **Blocked on**: decision between app-level lock (v1, recommended) and vault encryption (v2, bigger scope). See Open Decisions.

### M-editor: Editor chrome + toolbar
Match mockup's `.editor-chrome` / `.editor-toolbar` / `.breadcrumb` / `.tabstrip` (mockup lines 943-1102).
- Update [`MDXEditorView.tsx`](src/components/editor/MDXEditorView.tsx) chrome
- Browser-style tab strip for open notes (new surface)
- Breadcrumb shows doc ancestor chain + live chip when AI is indexing
- Accessibility: focus ring on every toolbar button

### M-rail: Rail navigation (icon tab sidebar)
New top-level surface. Mockup's leftmost strip (Home / Search / Import / Audio / Notes / Databases / Favorites / Trash).
- New `src/components/rail/Rail.tsx`
- Introduces tab-based navigation; today's app goes straight to workspace
- Needs tab state + routing decision (workspaceStore vs new railStore)
- Depends on the Panel System direction (M-panel) since Home/Search/Import/Audio will need their own screens

### M-tree-p2: Tree polish Phase 2
Data-shape changes + visual details deferred from M-tree-p1.
- Eyebrow-grouped sections ("FAVORITES" / "DAILY" / "WORKSPACE")
- Daily-note sub-text ("today" / "yesterday" / "Jan 18")
- Twisty glyph swap (lucide chevron → mockup's `▾` / `▸` / `·` text char) — optional
- Multi-select vs active visual distinction (both currently use same highlight)
- Trash panel literal cleanup (WorkspaceTree.tsx:1633, 1703, 1970, 1992, 2067, 2083)

### M-panel-0: Panel System Phase 0
Dockview foundation + one core panel port as proof of concept. Keeps existing `WorkspaceLayout` for everything else.
- Install `dockview`
- Build `src/panels/PanelRegistry.ts`, `PanelHost.tsx`, `PanelCard.tsx`
- Port `core.tree` as first panel
- Ship behind a feature flag

### M-panel-1: Panel System Phase 1
Customize mode MVP + all core panels ported + layout persistence.
- Customize button in titlebar
- `editMode` flag in `layoutStore`
- Core panels: tree, editor, backlinks, sidenotes, AI chat, comments, transcription history, search
- Layout persistence: localStorage (sync) + `user_preferences.layout` (durable)
- Migration function for version bumps

### M-theme-p2: Theme Module Phase 2 (typography & polish)
- UI / Content / Mono font pickers (bundle Inter, Georgia, JetBrains Mono)
- Base font size + line height sliders
- Max line width toggle + slider (editor body `max-width: Nch`)
- Shadow intensity slider
- Syntax highlighting theme (Shiki preset picker)
- Divider thickness segmented control

### M-theme-p3: Theme Module Phase 3 (platform)
- macOS vibrancy via `tauri-plugin-window-vibrancy`
- Win11 Mica / Win10 Acrylic fallback
- Linux webkitgtk `backdrop-filter` fallback + GPU warning
- Frame style toggle (requires restart)
- Scrollbar style preset

### M-theme-p4: Theme Module Phase 4 (editor polish)
- Selection color override
- Cursor color + caret width
- Focus/zen mode (Cmd+. toggle)
- High-contrast mode polish

### M-ai: AI & voice flagship features
- **Cmd+K fused ranking**: unite wikilinks + recent + FTS + vector results into one ranked picker
- **Voice → database routing**: voice memo transcript → typed row in a selected database (the category-defining feature)
- **Embedding markdown strip**: plain-text-only chunking for cleaner semantic vectors (Q1)
- **`::voice_memo_recording{}` directive** parsing on import (Q8)

### M-data-p0: Data integrity residuals
| Priority | Item | Notes |
|---|---|---|
| P0 | DB commit OK + vault write fails | Retry queue + "unsynced" badge |
| P0 | App killed mid-rename | Pending-rename journal row, reconcile on boot |
| P1 | Reserved chars in filename (Win: `<>:"/\|?*`, trailing space) | Aggressive slug sanitize + per-OS test matrix |
| P1 | Same DB edited in Obsidian + Handy concurrently | Merge by `_id` UUID, not position |
| P2 | Content-hash mtime tiebreaker | Clock-skew / FAT32 / VM-resume defensiveness |
| P2 | `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` on Windows | Atomic rename with existing target |
| P2 | Boot-time vault dirty-scan + missing-file badge | External rename/delete reconciliation |
| P2 | 100k-char body autosave every 300ms | Content-hash skip + separate vault flush debounce |
| P2 | Symlink at vault root | Canonicalize once at startup |
| P2 | Orphan board cards (row deleted, `cards/<id>.md` remains) | "Vault doctor" scrubber |
| P2 | Voice-memo audio file moved/deleted externally | Render "missing audio" pill |
| P2 | Windows MAX_PATH hit at runtime | Warn user + `\\?\` long-path prefix |
| P2 | System audio filename collision | UUID suffix (`YYYY-MM-DD-HH-MM-SS-<8hex>.md`) |
| P3 | Vault encryption (XChaCha20-Poly1305) | Follow-up to app-level lock |
| P3 | Mid-rename journal | Crash-safe rename across SQLite + vault |

### M-vault-rows: Row-per-file database storage migration
**Pin**: [CLAUDE.md → Vault Database Storage — Format Contract](CLAUDE.md#vault-database-storage--format-contract) is the authoritative spec. This milestone implements it.

**Why this matters**: Today, table/calendar/list databases serialize as a single `database.md` with the entire CSV body inline. That's fine at 10 rows, painful at 500, and wrong long-term (merge conflicts, no per-row history, no wikilinks into individual rows' body content). Board is already close to the target (`cards/<id>.md` per card). This milestone generalizes board's pattern to every layout.

**Scope**:
- **Export side** — rewrite `src-tauri/src/managers/workspace/vault/`:
  - `table.rs` → produce `databases/<slug>/database.md` (schema + default view in frontmatter) + `databases/<slug>/rows/<row-slug>.md` per row
  - `calendar.rs` → same rows dir, add `views/calendar.view.json` for the date-field + view config
  - `board.rs` → rename `cards/` dir to `rows/`, add explicit `database.md` frontmatter `fields:` schema block, ensure board cards write to `rows/<id>.md` (keep `cards/<id>.md` only as a legacy alias for one release cycle)
  - Every row file MUST declare `id` + `database_id` + typed frontmatter per field schema
- **Import side** — rewrite `src-tauri/src/managers/workspace/vault/import.rs` (split into per-layout importers mirroring the exporters):
  - Read `database.md` schema first; validate every row file's frontmatter against the schema; surface violations in a "Vault issues" panel
  - Orphan row files (no or invalid `database_id`) go into the issues panel, never silent-imported
  - Legacy-format compat: read old inline-CSV `database.md` format for one release, then auto-migrate the user's vault on next write (one-shot, logged)
- **Wikilink path updates**:
  - Relation cells in YAML: `[[databases/<db-slug>/rows/<target-slug>]]` — verified against target's `database_id` matching the relation's `target_database_id`
  - Row body wikilinks: unchanged (`node://<row-uuid>` path by UUID, not slug)
- **Round-trip tests** (required before shipping): for each layout, export → import → export must produce byte-identical output on a canonical fixture database
- **Schema evolution test**: add a field, remove a field, rename a field — all must non-destructively migrate existing row files

**Files**:
- Rust: `vault/table.rs`, `vault/calendar.rs`, `vault/board.rs`, `vault/format.rs`, `vault/import.rs` (split into per-layout), plus `vault/mod.rs` dispatcher
- Frontend: no UI changes required (`DatabaseShell` etc. read from DB, not vault); the migration only affects vault serialization
- Tests: `src-tauri/tests/vault_roundtrip.rs` (new) — fixture-based export-import-export equality

**Blocks**: D10 (migration timing — opt-in vs auto-migrate on next write).

**Risk**: high — touches the single most sensitive surface (vault data). Ship behind a feature flag for one release (new installs get new format; existing users stay on legacy until the auto-migrate lands). Required: before feature-flag is removed, implement a "vault doctor" scrubber that reports orphan files + schema violations.

**Non-goal**: this milestone does NOT change the DB schema, the view config columns on `node_views`, or any UI behavior. It only changes what bytes end up on disk.

### M-legacy: Legacy consolidation
Migrate all `notesStore`/`notesSpacesStore` callers to `workspaceStore`. After other phases because it touches many files.
- `NoteEditor.tsx` — rewrite `currentNote: Note` → `currentNode: WorkspaceNode`
- `BoardView.tsx` — clean up remaining `notesStore` refs
- `HomeTab.tsx` + widgets (`RecentNotesWidget`, `TodoWidget`, `StatsWidget`, `QuickCaptureWidget`, `HomeNotePreviewModal`)
- `TopBar.tsx` — notes count display
- `SearchTab.tsx`, `ImportTab.tsx`
- Delete: `notesStore.ts`, `notesSpacesStore.ts`, `notesStore.test.ts`, `DatabaseContainer.tsx`
- Add `sync_all_nodes_to_vault` UI button

### M-graph: Graph view (P3, deferred)
`page_links` table already populated. UI is the missing piece. Defer until panel system stable.

---

## Open Decisions

Answer these before implementing the related feature.

| # | Question | Recommended default | Blocks |
|---|---|---|---|
| D1 | App-level lock vs vault encryption at rest? | **App-level lock (Argon2id screen lock)** for v1; vault encryption is a follow-up | M-entry (LoginPage) |
| D2 | Rail navigation state owner: `workspaceStore` or new `railStore`? | Leaning `workspaceStore` (single nav source — matches Rule 2) | M-rail |
| D3 | Twisty glyph: lucide chevron or mockup text char (`▾` / `▸`)? | Keep lucide (themable, accessible) | M-tree-p2 |
| D4 | Embedding — raw markdown vs plain text? | **Strip to plain text** | M-ai (embedding strip) |
| D5 | Database vault format backward compat on import? | **Fail gracefully** — preserve SQLite state, show actionable error | Import robustness |
| D6 | Vault file vs SQLite conflict for databases? | **File wins on mtime** (consistent with documents) | — (already implemented) |
| D7 | Board card `title:` — YAML authoritative or derived from CSV? | **Derived from CSV** (single source of truth); YAML is display hint | Board import |
| D8 | `voice_memo_mirror.note_id` — self-referential intentional? | Unverified. Leave as-is until consumer is built | — |
| D9 | System audio filename collision | **UUID suffix** (`YYYY-MM-DD-HH-MM-SS-<8hex>.md`) | Voice work |
| D10 | `M-vault-rows` migration timing: opt-in or auto-migrate on next write? | **Auto-migrate on next write**, one-shot per database, logged. Keep legacy reader for one release cycle so downgrade works. | M-vault-rows |
| D11 | Row filename: human-readable slug (`helix-q3-retro.md`) or UUID (`row-7c2e.md`)? | **Slug with UUID collision suffix** — readable in external editors; UUID fallback on slug conflict. Wikilinks still resolve by UUID in frontmatter, so renames are safe. | M-vault-rows |
| D12 | When a row file is edited externally with an unknown field in frontmatter, drop it or keep it? | **Keep it.** Forward-compat discipline: unknown fields survive the round-trip untouched. Only `database.md` schema `fields:` changes delete keys. | M-vault-rows |

---

## Data-Integrity Edge Case Matrix

Live status tracker. Add a row before shipping any new write path.

| # | Threat | Mitigated by | Status |
|---|---|---|---|
| 1 | DB commit OK, vault write fails | Retry queue + "unsynced" badge | TODO (M-data-p0) |
| 2 | App killed mid-rename | Pending-rename journal row, reconcile on boot | TODO (M-data-p0) |
| 3 | Two Infield processes on same vault | `.infield.lock` at vault root | **Done** |
| 4 | Cloud placeholder files (iCloud/OneDrive) | Filter in scan + `len() == 0` guard | **Done** |
| 5 | Case-insensitive FS collision | Lowercase compare in slug path | **Done** |
| 6 | Reserved chars in filename | Slug sanitize + per-OS test matrix | TODO (M-data-p0) |
| 7 | Clock skew / NTP jump | Content-hash tiebreaker | TODO |
| 8 | Power loss mid-write on Windows | `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` | TODO |
| 9 | 100k-char body autosave every 300ms | Content-hash skip + separate vault flush debounce | TODO |
| 10 | Symlink at vault root | Canonicalize once at startup | TODO |
| 11 | Orphan board cards | "Vault doctor" scrubber | TODO |
| 12 | Voice-memo audio file moved externally | Render "missing audio" pill, don't crash | TODO |
| 13 | Unicode NFD vs NFC | Normalize to NFC on ingest | **Done** |
| 14 | Windows MAX_PATH hit at runtime | Warn user + `\\?\` long-path prefix | TODO |
| 15 | Same DB edited in Obsidian + Handy concurrently | Merge by `_id` UUID, not position | TODO (M-data-p0) |
| 16 | External edit while doc open in editor | Rule 13 conflict guard | **Done** |
| 17 | FTS rebuild under heavy write load | `BEGIN IMMEDIATE` | **Done** |
| 18 | Two users edit different rows of a 500-row database via Syncthing | Per-row file in `rows/<id>.md` so git / Syncthing diffs are per-row, not whole-database | TODO (M-vault-rows) |
| 19 | External editor adds unknown frontmatter key to a row file | Forward-compat: unknown keys survive round-trip (D12) | TODO (M-vault-rows) |
| 20 | `database.md` `fields:` renamed but row files still have old field key | Migration: one-pass rewrite when schema change detected; orphan keys surfaced in "Vault issues" panel | TODO (M-vault-rows) |
| 21 | Row file appears in `rows/` with no `database_id` frontmatter | Imported into "Vault issues" panel; user decides adopt / discard / move | TODO (M-vault-rows) |
| 22 | Legacy inline-CSV `database.md` read after `M-vault-rows` ships | Legacy reader stays one release cycle; auto-migrate on next write; logged | TODO (M-vault-rows) |

---

## Vault Architecture (Implemented)
- **Source of truth**: `.md` files in `<app_data>/handy-vault/`
- **DB role**: index of `vault_rel_path`, `updated_at`, metadata — not the body store
- **File naming**: human paths (slugified), not UUID filenames
- **Frontmatter dialect**: Obsidian-compatible YAML (`--- key: value ---`)
- **Conflict resolution**: file wins if mtime > `updated_at` + 1s; DB wins otherwise
- **External-edit strategy**: `window:focus` re-fetch + Rule 13 conflict guard (no watcher, see CLAUDE.md Rule 14)
- **Drop `body` column**: planned for after sustained confidence that vault-as-truth holds

---

## Summary
Build Infield into one AppFlowy-style workspace on top of `workspace_nodes` and
`node_views`, then hard-cut the legacy notes flow. The release differentiator is
**local-first speed** with a connected-knowledge baseline: unified
pages/databases/rows, wikilinks/backlinks, full-text search, daily notes, trash,
favorites/recents, import/export, and keyboard-first navigation.

> Historical note: the project was originally named "Handy" (and the repository
> directory `Handy-main` still reflects this). The app name is now **Infield**;
> treat any prose reference to "Handy" in PLAN.md / CLAUDE.md as naming drift —
> fix when touched. Identifiers that remain `handy-*` (e.g. `handy-vault/`,
> `handy-embedding-sidecar`) are paths / binaries where a rename has observable
> cost (vault migration, bundle reference changes); keep those as-is until a
> dedicated rename milestone.

---

## Technology Stack

| Layer | Library | Notes |
|---|---|---|
| UI framework | React 18 | `^18.3.1` |
| Language | TypeScript | `~5.6.3` |
| Build tool | Vite | `^6.4.1` |
| Desktop shell | Tauri | `@tauri-apps/api ^2.10.0` |
| Styling | Tailwind CSS v4 | `^4.1.16` with `@tailwindcss/vite` |
| State management | Zustand + Immer | `zustand ^5.0.8`, `immer ^11.1.3` |
| Rich editor | MDXEditor | `@mdxeditor/editor ^3.20.0` |
| Drag and drop | dnd-kit | `@dnd-kit/core ^6.3.1` |
| Table UI | Glide Data Grid | `@glideapps/glide-data-grid ^6.0.3` |
| Icons | Lucide React | `^0.542.0` |
| Toast notifications | Sonner | `^2.0.7` |
| Internationalization | react-i18next | `^16.4.1` |
| Schema validation | Zod | `^3.25.76` |
| Backend runtime | Tokio | async Rust runtime |
| Database | SQLite (rusqlite) | via `workspace_manager.rs` |
| Vector search | usearch | via `EmbeddingWorker` |
| File watching | notify | `v8`, vault interop |


---

Locked decisions:
- Canonical model: `workspace_nodes` + `node_views`
- Hard cutover, no legacy-note migration
- Shared editor: `MDXEditorView`
- Linked views appear under databases in the tree
- Wikilinks work across documents, databases, and row pages
- Wikilinks work in page editors only, not table rich-text cells in v1
- Navigation history is owned by `workspaceStore`, not `window.history`
- Pasted/dragged images in page editors are in scope
- v1 supports a single workspace only
- Dark mode SHIPPED (four presets — see theme module); originally deferred

---

## Data Location and Backup
- User data lives in the OS app data directory:
  - Windows: `%APPDATA%\handy\`
  - macOS: `~/Library/Application Support/handy/`
- That directory contains:
  - `workspace.db` — SQLite database (canonical name after the `notes.db → workspace.db` merge; earlier drafts said `handy.db`)
  - `handy-vault/` — the source-of-truth vault of markdown files + database row files
  - `assets/` — pasted and dragged images
  - `embeddings.usearch` — vector index
- Settings page must show:
  - full data path
  - `Reveal in Explorer / Finder` button
  - `Back up now` button
- `Back up now` copies `workspace.db`, `handy-vault/`, and `assets/` to a user-chosen location
  via a system save dialog.
- No cloud dependency. No account required.
- Multi-workspace support is deferred. The database path is fixed to the OS app
  data directory in v1.

---

## Navigation and UX Contracts
- `workspaceStore` owns navigation via:
  `navigateTo(nodeId, options?: { viewId?: string; source?: "tree" |
  "quick_open" | "wikilink" | "daily_note" | "back" })` and `goBack()`.
- `navigateTo` updates: active node, active linked view, recents, window title,
  in-memory history stack.
- Do NOT use `window.history.pushState` as the navigation mechanism; use the
  in-memory stack in `workspaceStore` only.
- `Cmd+W` calls `goBack()` to return to the previous workspace context.
- Sidebar sections (top to bottom): `Daily Note`, `Favorites`, `Recents`,
  `Pages`, `Trash`.
- Daily notes live only in `Daily Note`, never under `Pages`.
- `Pages` shows: `document`, `database`, `row` (paginated under databases),
  and linked view entries (indented under their database).
- Row children render under expanded databases — first 50 only; a `Show more
  rows` control paginates the next 50.
- Linked view entries are smaller and indented; selecting one opens the parent
  database with that view active.
- Sidebar is user-resizable; width is persisted in local app state.
- Favorites empty state: ghost text `Star a page to pin it here`.
- All page types (document, database, row) support icon + cover.
- Icon picker opens an emoji picker on click.
- Covers in v1 use preset gradients only. File upload is deferred.
- Tauri window title always mirrors the current page title.

---

## Tree Interaction
- Tree supports drag-and-drop reordering for pages and row children.
- Linked views reorder only within their database's view list.
- Right-clicking a tree node opens a context menu:
  - `Open`
  - `Add child page`
  - `Rename` — focuses the node label inline
  - `Duplicate` (documents only) — copies title as `{title} (Copy)`, same icon,
    same body content, no children
  - `Add to Favorites`
  - `Delete` — follows normal delete semantics (see Trash section)
- This context menu is the primary non-keyboard affordance for tree actions.
- `Cmd+N` creates a new document at the workspace root level with no parent.
- To create a nested page, use `Add child page` from the parent's context menu.

---

## Page and View Behavior

### Document page
- cover area (if set)
- breadcrumb / header
- icon + title
- MDX body editor
- backlinks section below body — collapsed by default, shows count badge

### Database page
- cover area (if set)
- icon + title
- linked-view tab strip
- toolbar row: `New`, `Filter`, `Sort`, `Fields`, `View`, `Export`
- active view content
- `Export` button opens a system save dialog; it does not silently download.
- `Filter` and `Sort` toolbar buttons show a count badge when rules are active.

### Row page
- same shell as document page
- breadcrumb back to parent database
- icon + title
- MDX body editor (left)
- properties panel (right) — fixed 240px in v1, collapses below on narrow widths
- backlinks section below body — collapsed by default
- **Implementation note**: `RowPageView.tsx` already has the MDX editor wired
  (see `MDXEditorView` import + usage). The "Body editing comes in Phase 2"
  placeholder mentioned in earlier drafts of this doc has been removed.

### New view creation
- `+ View` (or `View` in the toolbar) opens a layout picker:
  Table, List, Board, Calendar.
- Selecting a layout creates a new linked view with a default name matching the
  layout (e.g. `Board`, `Calendar`).
- The new view is immediately activated.
- Rename is available by double-clicking the view tab.

### Database defaults
New database creation always creates:
- `Name` — primary rich text field
- `Status` — single select with options `To do`, `In progress`, `Done`
- `Date` — date/datetime field
- one default `Table` linked view

### View rules
- Active layouts: `table`, `list`, `board`, `calendar`.
- `list` is only a compact presentation of the same database as `table`.
- Table: sticky header, primary field column frozen during horizontal scroll,
  inline cell editing, inline bottom-row creation, drag reorder only when no
  sort is active, virtualization above 500 rows.
- List: same data as table, primary field emphasized, compact metadata layout.
- Board: grouped by selected field (default `Status`), `Add group` creates a
  new select option, `New card` creates a row in that group, dragging a card
  updates its grouping field value. Card shows primary field as title plus up
  to 3 secondary fields configured from `Fields`.
- Calendar: bound to selected date field (default `Date`), unscheduled rows
  side panel, dragging an event updates the date field, creating from a day
  cell assigns that date. Date field is changeable from the `Fields` toolbar
  action.
- Invalid board/calendar config (missing or wrong field type) keeps the page
  mounted and shows a field-selection prompt instead of breaking.

---

## Keyboard and Save Contracts

### Global shortcuts
| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+K` | Quick open |
| `Cmd+Shift+J` | Open today's daily note |
| `Cmd+N` | New root-level document page |
| `Cmd+W` | Return to previous workspace context |
| `Cmd/Ctrl+S` | Immediate save |

### Tree shortcuts
- Arrow keys navigate the tree.
- Right arrow expands a database or enters the selected node.
- Left arrow collapses a database or moves to its parent.
- `Enter` opens the selected node.
- `Delete` deletes the selected node (normal delete semantics).

### Table shortcuts
- Arrow keys move cell focus when not editing.
- `Tab` / `Shift+Tab` move across cells.
- `Enter` starts editing the focused cell.
- `Escape` exits editing.
- `Cmd/Ctrl+Enter` opens the focused row's row page.
- `Enter` on the creation row at the bottom creates the next row.

### Autosave
- Page editors autosave **300ms** after the last keystroke (see `WorkspaceLayout.tsx:301`). Was 800ms in an earlier draft; codebase moved to 300ms. CLAUDE.md § Vault File Lifecycle is authoritative.
- `Cmd/Ctrl+S` triggers an immediate save outside the debounce window.
- Autosave respects [CLAUDE.md Rule 13](CLAUDE.md#rule-13--every-vault-write-must-pass-the-conflict-guard) conflict guard (pauses the editor if a modal is open after ExternalEditConflict).

---

## Daily Notes
- `Cmd+Shift+J` opens today's daily note, creating it if it does not exist.
- Pressing `Cmd+Shift+J` when already on today's note re-focuses the editor;
  no navigation occurs.
- A daily note is a normal document node with date metadata.
- The daily note page header includes: previous day arrow, next day arrow,
  mini date picker.
- Navigating to a different day opens or creates that day's note.
- Daily notes live only in the `Daily Note` sidebar section, not under `Pages`.

---

## Favorites, Recents, and Trash

### Favorites
- User-pinned pages or linked views shown in the `Favorites` sidebar section.
- Persisted to disk via `user_preferences` (key `"favorites"`).

### Recents
- Last 5 unique opened pages and views, ordered by most recent open.
- Persisted to disk via `user_preferences` (key `"recents"`).
- Updated by every `navigateTo` call.

### Trash
- All soft-deleted nodes remain here until restored or permanently deleted.
- **Row / document delete**: soft delete + undo toast.
- **Database delete**: confirmation dialog → soft delete + undo toast.
- **Linked view delete**: undo toast only; linked views do not enter Trash.
- Restore returns the node to its original position in the tree.
- Permanent delete removes the node and all its children from the database.
- Backlinks from trashed source nodes are excluded from backlink lists.
- Restored pages automatically reappear in backlinks.

---

## Search, Wikilinks, and Backlinks

### Quick open
- `Cmd/Ctrl+K` opens workspace quick open.
- The codebase already has a full hybrid search stack: SQLite FTS5
  (`notes_fts`), usearch vector index (`embeddings.usearch`), `EmbeddingWorker`
  for background indexing, and `SearchManager.hybrid_search()` merging results
  via Reciprocal Rank Fusion. Do NOT rebuild this from scratch.
- Extend the existing infrastructure to cover workspace nodes:
  - Create `workspace_fts` FTS5 table (same pattern as `notes_fts`) indexing
    `workspace_nodes` title + body for documents, rows, and database titles.
  - Feed workspace nodes through the existing `EmbeddingWorker` pattern on
    save and import.
  - Create a `search_workspace_hybrid` Tauri command (mirrors
    `search_notes_hybrid`) that queries `workspace_fts` + the vector index.
- Quick-open calls `search_workspace_hybrid`. Results are ranked by the
  existing RRF score (keyword rank + semantic rank merged).
- Results show: icon, title, parent context, highlighted matched terms.
- Databases are indexed by title only (empty body string in `workspace_fts`).

### Wikilinks
- Stored format: `[display title](node://uuid)` in MDX.
- UUID is permanent and never changes.
- Display title updates automatically when the target node is renamed.
- **Rename propagation**: rename is optimistic and instant; source-page display
  text updates run as a background task; show a subtle progress indicator only
  if more than 50 source pages are affected.
- **Create-new-page flow**: the `[[` picker offers existing nodes plus
  `Create new page`. Selecting `Create new page` creates the node, inserts the
  wikilink, and keeps focus in the source editor. No automatic navigation.
- **Click handling**: `node://` links must never fall through to browser default
  navigation. A custom MDX link renderer or document-level click interceptor
  routes all `node://uuid` clicks through `workspaceStore.navigateTo`.
- **Wikilink autocomplete**: title-only search, debounced 150ms, capped at 10
  results ranked by recency then title relevance.
- **Scope boundary**: wikilinks work in document and row body editors only.
  Table rich-text cells do not support wikilinks in v1.
- **On Markdown export**: `node://uuid` links are converted to
  `[[Display Title]]` (Obsidian-compatible format).

### Backlinks
- Every document page and row page shows a backlinks section below the body.
- Collapsed by default; shows a count badge (e.g. `Backlinks (3)`).
- Excludes source nodes with non-null `deleted_at`.
- Restored pages reappear automatically.

---

## Import / Export

### Export
- Document and row pages export to Markdown.
- Databases export to CSV using the active view's visible rows and fields.
- `Export` always opens a system save dialog.
- On Markdown export, `node://uuid` wikilinks are converted to
  `[[Display Title]]`.

### Import
- **Markdown folder import**: recursively creates document nodes; folder
  hierarchy maps to workspace tree structure.
- **CSV import**: creates a database from column headers (fields) and rows.
- All imports trigger immediate FTS indexing and backlink extraction.
- Notion import format is deferred.

---

## Performance Contracts
- **Cold start**: app shell visible in under 50ms; interactive in under 500ms.
- **Warm start**: last active page visible in under 150ms.
- **Runtime**: tree load under 100ms for 1,000 nodes; quick open under 50ms;
  page open under 200ms.
- **Virtualization**: table and list views should virtualize above 500 rows.
  `@glideapps/glide-data-grid` handles row virtualization internally for table views.
  List view and board view virtualization is deferred.
- **Local cached state** (not SQLite — read before DB opens):
  - last active node ID
  - last active view ID
  - sidebar width
  - sidebar expansion state
- **Optimistic UI** is required for: cell edits, checkbox toggles, row
  creation, node rename.
- **Rollback pattern**: update Zustand first → persist async via Tauri command
  → on failure, rollback Zustand state and show error toast.

### Speed implementation rules (required to hit the targets above)

**1. SQLite WAL mode — enable on first connection open**
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA cache_size   = -32000;   -- 32 MB page cache
PRAGMA temp_store   = MEMORY;
```
Without WAL mode, every 800ms autosave write locks the DB and blocks all
reads (tree load, quick open). WAL allows concurrent reads during writes.
This is the single highest-impact performance setting in the stack.

**2. Tree loading — one flat query, build tree in JS**
Do NOT load tree nodes recursively (one query per node = N+1 problem).
Use one flat query and assemble the tree in memory:
```sql
SELECT id, name, node_type, parent_id, position, icon, deleted_at
FROM   workspace_nodes
WHERE  deleted_at IS NULL
ORDER  BY parent_id, position;
```
Build the parent→children map in a single JS pass after the query returns.
This keeps tree load under 100ms even at 5,000 nodes.

**3. Lazy body loading — metadata only in the tree**
The tree fetch above loads NO body content. Body (MDX) is fetched only when
a node is opened via `navigateTo`. Never preload body content for unvisited
nodes. A workspace with 1,000 pages may have MBs of MDX — loading all of
it on startup will destroy cold-start time.

**4. Granular Zustand selectors — prevent cascade re-renders**
Every component must subscribe to the smallest slice of store state it needs:
```typescript
// Correct — only re-renders when activeNodeId changes
const activeNodeId = useWorkspaceStore(s => s.activeNode?.id)

// Wrong — re-renders on every store mutation
const store = useWorkspaceStore()
```
Subscribing to the whole store causes the entire workspace UI to re-render
on every autosave, every recents update, every optimistic cell edit.

**5. FTS5 snippet for search highlighting — use built-in, not JS**
Quick-open highlighted matches must use SQLite's built-in `snippet()`
function, not post-query string matching in JavaScript:
```sql
SELECT
  node_id,
  title,
  snippet(workspace_fts, 2, '<mark>', '</mark>', '...', 8) AS excerpt
FROM workspace_fts
WHERE workspace_fts MATCH ?
ORDER BY rank
LIMIT 20;
```
JS-side highlighting on 20 results across potentially large bodies is slow
and produces incorrect results. `snippet()` is O(1) per result.
The FTS table is named `workspace_fts` — never `page_fts`.

**6. Include database titles in FTS (title only)**
Index database titles in `workspace_fts` with an empty body string so all
quick-open queries use one unified FTS path. `LIKE '%query%'` is a full table
scan and will not meet the 50ms target above ~5,000 nodes.
```sql
-- On database node create/rename:
INSERT OR REPLACE INTO workspace_fts(node_id, title, body)
VALUES (?, ?, '');
```

**7. Navigation history stack — cap at 100 entries**
The in-memory history stack in `workspaceStore` must be capped:
```typescript
const MAX_HISTORY = 100
// On push: if stack.length >= MAX_HISTORY, drop the oldest entry
```
An uncapped stack in a long session (user opens 10,000 pages) is a memory
leak and makes `goBack()` unpredictably deep.

---

## Technical Addendum

### SQLite Schemas (new tables)
```sql
-- Wikilink edge index for backlink queries
CREATE TABLE IF NOT EXISTS page_links (
  source_node_id TEXT NOT NULL
    REFERENCES workspace_nodes(id) ON DELETE CASCADE,
  target_node_id TEXT NOT NULL
    REFERENCES workspace_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (source_node_id, target_node_id)
);
CREATE INDEX IF NOT EXISTS idx_page_links_target
  ON page_links(target_node_id);

-- Full-text search for workspace nodes (mirrors existing notes_fts pattern)
-- Do NOT name this page_fts — use workspace_fts to avoid collision with
-- the existing notes_fts table.
CREATE VIRTUAL TABLE IF NOT EXISTS workspace_fts USING fts5(
  node_id UNINDEXED,
  title,
  body
);

-- Favorites, recents, and other user preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

The project already has `usearch` (vector similarity), `EmbeddingWorker`
(background chunking + embedding), and `SearchManager` (hybrid FTS + vector
via RRF). New workspace search extends these — it does NOT replace them.

Confirm `node_views.position` exists in the current schema before implementing
DnD. If missing, add it in the same migration as the tables above.

### Persistence Rules
- `page_links` is fully replaced for the source page on every document/row
  save (delete all rows for that source, then insert current links).
- `workspace_fts` is manually synced on save and delete. Do NOT use
  external-content FTS wiring.
- **Eligible FTS nodes**: `workspace_nodes` where
  `node_type IN ('document', 'row', 'database') AND deleted_at IS NULL`.
  Documents and rows index both title and body. Databases index title only
  with body stored as an empty string `''`.
- FTS table is named `workspace_fts` (not `page_fts`) to avoid collision with
  the existing `notes_fts` table used by the legacy notes system.
- The embedding/vector pipeline reuses the existing `EmbeddingWorker` and
  `VectorStore` — workspace nodes are enqueued through the same worker that
  currently handles legacy notes. Do not create a second embedding pipeline.
- **Startup reindex**: if `COUNT(workspace_fts)` is lower than eligible node
  count, run a background full reindex. Silent for small workspaces; show a
  status indicator for reindexes above 100 nodes.
- **On soft-delete**: remove the node immediately from `workspace_fts`
  (`DELETE FROM workspace_fts WHERE node_id = ?`) and call
  `EmbeddingWorker.enqueue_delete(node_id)` to remove its vectors.
  Backlinks pointing to it are kept in `page_links` — they are filtered at
  query time by `deleted_at IS NULL` on the target.
- **Imports** trigger immediate `workspace_fts` indexing, backlink extraction,
  AND `EmbeddingWorker.enqueue_index(node_id, plain_text)` for every imported
  node so semantic search works immediately after import.
- Favorites and recents stored in `user_preferences` as JSON blobs under keys
  `"favorites"` and `"recents"`.

### View State Shape
The existing schema already has `filters`, `sorts`, and `view_options` columns
on `node_views`. Do NOT add a new `settings` column.

```typescript
interface ViewOptions {
  fieldVisibility?:     Record<string, boolean>  // fieldId → visible
  columnOrder?:         string[]                  // fieldIds in display order
  boardGroupFieldId?:   string
  boardCardFields?:     string[]                  // up to 3 fieldIds
  calendarDateFieldId?: string
}
```

Storage rules:
- `node_views.filters` → `FilterGroup[]` JSON
- `node_views.sorts` → `SortRule[]` JSON
- `node_views.view_options` → `ViewOptions` JSON
- Read `view_options` as `{}` when null. Never crash on a null field.
- No ad-hoc keys outside `ViewOptions`.

### Position Strategy
- `workspace_nodes.position` and `node_views.position` must be `REAL` / `f64`
  (fractional indexing, not sequential integers).
- **Migration required**: the current schema declares both columns as `INTEGER`.
  SQLite has no `ALTER COLUMN`; use a table-rebuild migration:

```sql
-- Run in the same migration that creates page_links / workspace_fts / user_preferences.

-- 1. Rebuild workspace_nodes with position REAL
CREATE TABLE workspace_nodes_v2 (
    id         TEXT PRIMARY KEY,
    parent_id  TEXT REFERENCES workspace_nodes_v2(id) ON DELETE CASCADE,
    node_type  TEXT NOT NULL,
    name       TEXT NOT NULL,
    icon       TEXT NOT NULL DEFAULT '📄',
    position   REAL NOT NULL DEFAULT 0.0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    properties TEXT NOT NULL DEFAULT '{}',
    body       TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO workspace_nodes_v2 SELECT
    id, parent_id, node_type, name, icon,
    CAST(position AS REAL),
    created_at, updated_at, deleted_at, properties, body
FROM workspace_nodes;
DROP TABLE workspace_nodes;
ALTER TABLE workspace_nodes_v2 RENAME TO workspace_nodes;

-- 2. Rebuild node_views with position REAL
CREATE TABLE node_views_v2 (
    id           TEXT PRIMARY KEY,
    node_id      TEXT NOT NULL REFERENCES workspace_nodes(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    layout       TEXT NOT NULL,
    position     REAL NOT NULL DEFAULT 0.0,
    color        TEXT,
    filters      TEXT NOT NULL DEFAULT '[]',
    sorts        TEXT NOT NULL DEFAULT '[]',
    view_options TEXT NOT NULL DEFAULT '{}',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
INSERT INTO node_views_v2 SELECT
    id, node_id, name, layout,
    CAST(position AS REAL),
    color, filters, sorts, view_options, created_at, updated_at
FROM node_views;
DROP TABLE node_views;
ALTER TABLE node_views_v2 RENAME TO node_views;
```

- New node/view: `position = max_sibling_position + 1.0`.
- Drop between A and B: `position = (A + B) / 2.0`.
- If gap narrows below `1e-9`, rebalance all siblings to evenly spaced integers
  and continue.
- Never reassign all positions on every drag.

### Search Extension Contracts

**`search_workspace_hybrid` Tauri command** (new, mirrors `search_notes_hybrid`):
```rust
// Return type — mirrors HybridSearchResult from managers/search.rs
#[derive(Serialize, Deserialize, Type)]
pub struct WorkspaceSearchResult {
    pub node_id:          String,
    pub node_type:        String,   // "document" | "row" | "database"
    pub title:            String,
    pub parent_name:      Option<String>,
    pub icon:             Option<String>,
    pub score:            f64,
    pub keyword_rank:     Option<usize>,
    pub semantic_rank:    Option<usize>,
    pub excerpt:          Option<String>,  // FTS5 snippet output
}
```
Do NOT modify `search_notes_hybrid` — it remains for the legacy notes system.
Do NOT call `search_notes_hybrid` for workspace quick-open.

**`EmbeddingWorker` call pattern for workspace nodes:**
```rust
// On every workspace node save (document or row body changed):
embedding_worker.enqueue_index(node_id.clone(), plain_text_from_mdx);

// On soft-delete:
embedding_worker.enqueue_delete(node_id.clone());
```
`plain_text_from_mdx` is the MDX body stripped of all markdown syntax to
bare text. Do NOT embed the raw MDX syntax — vectors should represent meaning,
not markup. Use a simple strip function; no external parser needed for v1.

**`workspaceStore.searchNodes()` — used by wikilink autocomplete:**
```typescript
// New function in workspaceStore — title-only, no body, no vectors
// This is NOT the same as search_workspace_hybrid (which is full hybrid)
searchNodes(query: string, options: { limit: number }): WorkspaceNodeSummary[]
// Queries workspace_fts WHERE title MATCH ? LIMIT n
// Returns id, name, node_type, icon, parent_name
// Used only by [[wikilink]] autocomplete — fast, title-only
```
This is distinct from quick-open. Wikilinks need instant title results, not
ranked hybrid results. Keep them separate.

### Wikilink Implementation Strategy
- Do NOT introduce ProseMirror node types directly.
- Intercept the `[[` character sequence from MDX editor input handling.
- Render a floating overlay portal anchored near the caret.
- Query `workspaceStore.searchNodes(query, { limit: 10 })` — title matches
  only, debounced 150ms.
- On selection, replace the `[[...` text fragment with
  `[display title](node://uuid)` in the MDX source.
- A custom link renderer wraps `node://` hrefs in a React component that calls
  `workspaceStore.navigateTo` on click and prevents browser default navigation.
- The `[[` autocomplete trigger is the hardest implementation task.
  The `node://` click interception is the second hardest.

### Field-Type Scope Guardrails
- `checklist` — renders as read-only checkbox-item text in table/list cells
  in v1. Do NOT build creation or edit UI.
- `media` — renders as a file-count badge in table/list cells in v1.
  Do NOT build creation or edit UI.
- Wikilinks are NOT supported inside table rich-text cells in v1.

### Image Support in Editors
- Pasted and dragged images are supported in document and row body editors.
- Storage path: `{app_data_dir}/assets/{uuid}.{ext}`
- MDX reference: `![alt](assets://{uuid}.{ext})`
- Register `assets://` as a custom Tauri protocol in `tauri.conf.json`,
  mapped to `{app_data_dir}/assets`. Without this registration, images return
  404 in production builds.
- Table and database cell image editing is deferred.

---

## What Not To Do
- Do NOT use `window.history.pushState` for navigation. Use
  `workspaceStore.navigateTo` and `goBack` only.
- **Fix existing violation**: `WorkspaceLayout.tsx` currently calls
  `window.history.pushState` for the RowPageView breadcrumb. Replace this call
  with `workspaceStore.navigateTo` as part of implementing the navigation stack.
  This is an existing bug to fix, not a future constraint to avoid.
- Do NOT add a new `node_views.settings` column. The schema already has
  `filters`, `sorts`, and `view_options`.
- Do NOT use sequential integers for `position`. Use fractional indexing.
- Do NOT store filter, sort, or view state anywhere except
  `node_views.filters`, `node_views.sorts`, and `node_views.view_options`.
- Do NOT build editing UI for `checklist` or `media` field types in v1.
- Do NOT make wikilink autocomplete run full-text search. Title-only,
  limit 10, debounce 150ms.
- Do NOT let `node://` links fall through to browser default navigation.
- Do NOT add dark-mode token sets in v1.
- Do NOT modify `src/bindings.ts` manually — it is auto-generated.
- Do NOT rename or remove the existing nested `database.calendar.*` i18n keys
  used by calendar toolbar components.
- Do NOT mix Tailwind into `workspace/` components that already use inline
  styles and CSS custom properties.
- Do NOT call `workspaceStore.loadNode()` inside any bridge or adapter
  component — it mutates global `activeNode`. Use `invoke('get_node', ...)`
  directly.
- Do NOT set both `overflow-x: auto` and `overflow-y: visible` on the same
  element. CSS coerces `visible` to `auto` and clips children. Use a nested
  div where only the inner element has `overflow-x: auto`.
- Do NOT use `LIKE '%query%'` for quick-open search. Use FTS5 for all node
  types (documents, rows, databases). `LIKE '%query%'` is a full table scan
  with no index and will not meet the 50ms quick-open target at scale.
- Do NOT load MDX body content during tree initialisation. Fetch body only
  when a node is opened. Loading all bodies at startup will destroy cold-start
  time for workspaces with many pages.
- Do NOT subscribe to the entire `workspaceStore` in a component. Use granular
  selectors (`useWorkspaceStore(s => s.activeNode?.id)`) to prevent cascade
  re-renders on every autosave and optimistic update.
- Do NOT skip enabling SQLite WAL mode. Add the four PRAGMAs on first
  connection open. Without WAL, autosave writes lock the DB and block reads.
- Do NOT rebuild the search stack from scratch. The project already has
  `usearch` (vector index), `EmbeddingWorker` (background embedding pipeline),
  `SearchManager` (hybrid FTS + vector via RRF), and `search_notes_hybrid`
  (Tauri command). Extend these — do not create parallel systems.
- Do NOT name the new FTS table `page_fts`. The correct name is `workspace_fts`
  to avoid collision with the existing `notes_fts` table.
- Do NOT modify `search_notes_hybrid` — it remains for the legacy notes system.
  Workspace quick-open uses `search_workspace_hybrid` (new command).
- Do NOT create a second `EmbeddingWorker` or `VectorStore` instance. Workspace
  nodes are enqueued into the same existing worker via `enqueue_index(node_id,
  plain_text)` and removed via `enqueue_delete(node_id)`.
- Do NOT use `workspaceStore.searchNodes()` for quick-open. It is title-only
  and is only for wikilink `[[` autocomplete. Quick-open uses the full hybrid
  `search_workspace_hybrid` command (FTS + vector + RRF).

---

## Test Plan

**Cutover**
- `Notes` lands in workspace shell only.
- Legacy notes flow no longer drives navigation.

**Navigation**
- Tree clicks, quick open, daily note, wikilink click, and back all route
  through `workspaceStore.navigateTo`.
- No browser history API is used for core navigation.

**Tree**
- Pages, linked views, and paginated row children render correctly.
- `Show more rows` loads the next page correctly.
- Right-click context menu works for all actions including `Add child page`.
- `Duplicate` produces a correct copy (title suffix, same body, no children).
- DnD persists order after app restart.

**Knowledge**
- Document → row wikilink: insert, save, click, verify navigation.
- Row → document wikilink: insert, save, click, verify navigation.
- `node://` click routes through `navigateTo`, never opens a browser tab.
- Rename target: verify displayed link text updates on all source pages.
- Deleted pages do not appear in backlink lists.
- Restored pages reappear in backlink lists.

**Search**
- `search_workspace_hybrid` returns results for a body-only keyword query
  (documents and rows via `workspace_fts`).
- `search_workspace_hybrid` returns results for a semantic query when the
  embedding model is available (vector hits via `usearch`).
- Databases are findable by title through `workspace_fts` (title-only index).
- Hybrid results are ranked by RRF score (keyword rank + semantic rank merged).
- `workspaceStore.searchNodes()` returns title-only results for `[[` autocomplete
  without triggering a full hybrid search.
- Soft-deleting a node removes it from `workspace_fts` and its vectors from
  the `usearch` index immediately.
- Startup reindex populates `workspace_fts` for all eligible nodes when the
  table is empty or count is below eligible node count.
- Import: all imported nodes appear in `workspace_fts` and are enqueued for
  embedding immediately after import completes.

**Daily Notes**
- Today shortcut creates and opens today's note.
- Pressing the shortcut again re-focuses the editor without navigating.
- Previous/next arrows and date picker navigate to the correct day's note,
  creating it if it does not exist.

**Favorites / Recents**
- Pinned pages and views persist across restart.
- Recents update on every `navigateTo` and persist across restart.
- Favorites empty state renders correctly.

**Trash**
- Row delete → soft delete → undo toast restores it.
- Database delete → confirmation dialog → soft delete → undo toast.
- Linked view delete → undo toast only, does not appear in Trash.
- Restore returns node to original tree position.
- Permanent delete removes node and all children.

**Database Views**
- Per-view filters, sorts, and `view_options` persist independently.
- Switching views reloads that view's saved state.
- Frozen first column works during horizontal scroll.
- Filter and sort badges show correct active rule counts.
- New view creation: layout picker appears, default name used, view activates.

**Import / Export**
- Markdown folder import preserves folder hierarchy as tree structure.
- CSV import creates a correct database with proper fields and rows.
- Markdown export converts `node://uuid` links to `[[Display Title]]`.
- Database CSV export includes only active view's visible rows and fields.
- Export opens a system save dialog.

**Images**
- Paste and drag-drop both store the asset and render via `assets://`.
- Image renders correctly after app restart (custom protocol resolves).

**Keyboard**
- All global shortcuts work as specified.
- `Cmd+N` creates a root-level document, not a nested one.
- All tree shortcuts work (arrows, enter, delete, expand/collapse).
- All table shortcuts work (arrows, tab, enter, escape, Cmd+Enter).
- Autosave fires 800ms after last keystroke.
- `Cmd/Ctrl+S` triggers an immediate save.

**Performance**
- Cold start: app shell visible < 50ms, interactive < 500ms.
- Warm start: last active page visible < 150ms.
- Tree of 1,000 nodes loads in < 100ms.
- Quick open returns results in < 50ms.
- Page open from selection to ready < 200ms.
- Table virtualization activates above 500 rows.

**Data Trust**
- Settings shows the correct platform data path.
- `Reveal in Explorer/Finder` opens the correct directory.
- `Back up now` copies `handy.db` and `assets/` to the chosen location.

---

## Deferred (do not implement in v1)
- Multi-workspace support
- Graph view (data is ready via `page_links`; visualization deferred)
- Slash commands in editor
- Inline database embeds inside document pages
- Bulk row selection and bulk actions
- Per-cell undo/redo history
- Version history / page history
- Relations, rollups, formulas
- Cross-database row moves
- Multi-pane / split view
- Multi-device sync
- Notion import format
- File upload for covers
- Wikilinks inside table rich-text cells
- Full editing UI for `checklist` and `media` field types
- Table/database cell image editing

---

## Assumptions
- Legacy notes can be discarded. No migration is required.
- Canonical implementation target: `C:\AI_knowledge_workspace\Handy-main` (repo directory; product name = Infield).
- AppFlowy is the UX reference for interaction quality, not a line-for-line clone.
- "Best in world" for this release means the fastest local-first notes +
  database workspace in this product class, with connected knowledge spanning
  documents and row pages.

---

## Known Drift / Audit Notes

Future maintainer: this section is the honest-broker log of things that drifted between doc and code. Each item is tagged with when it was verified, by whom (Claude vs human), and what the authoritative answer is. Don't trust prose in this doc blindly — cross-check against code when touching the related area.

### Verified accurate as of 2026-04-21 (this session)
- Autosave debounce = **300ms** (`src/components/workspace/WorkspaceLayout.tsx:301`). Earlier PLAN.md drafts said 800ms — fixed.
- SQLite filename = **`workspace.db`** (`src-tauri/src/managers/notes.rs:255`). Earlier PLAN.md said `handy.db` — fixed.
- `RowPageView.tsx` already has MDX editor wired (`MDXEditorView` at line 231). Earlier PLAN.md said "placeholder at lines 163-178" — fixed.
- Four theme presets shipped (`heros-terracotta`, `heros-midnight`, `heros-paper`, `heros-high-contrast`). Dark mode is NOT deferred.
- `motion@^12.38.0` installed (re-added after F1 audit), zero current imports. Will be wired in `M-db` Phase E follow-up + `M-entry` ActionBlade port.
- `@tanstack/react-virtual` NOT installed despite earlier planning claims; add when the first 500+ row table ships.
- Vault watcher removed per Rule 14 (`notify` crate may still be in `Cargo.toml` but is not spawned on startup).

### Suspected drift — verify before relying on
- [ ] **Sidebar section list** (line "Daily Note, Favorites, Recents, Pages, Trash"): current `WorkspaceTree.tsx` structure likely differs. The tree was reshaped for the M-tree-p1 polish pass and may not have explicit "Favorites" / "Recents" section headers yet. Re-verify when working on M-tree-p2 (eyebrow sections).
- [ ] **`assets://` custom Tauri protocol**: claimed registered in `tauri.conf.json`. Re-verify path mapping works in production bundle before shipping cover-image features.
- [ ] **`notes_fts` vs `workspace_fts`**: both tables may exist. `notes_fts` is legacy-path; `workspace_fts` is the target. Confirm the tree / quick-open uses `workspace_fts` exclusively before the `M-legacy` consolidation.
- [ ] **`WorkspaceLayout.tsx:918` `window.history.pushState`**: still present. Flagged for removal in "What Not To Do" section but no milestone tracks it explicitly. Either schedule (add to `M-rail` since routing is being redesigned there) or document the exception permanently.
- [ ] **Trash panel literals** (`WorkspaceTree.tsx:1633, 1703, 1970, 1992, 2067, 2083`): pre-existing Rule 12 violations. Tracked as follow-up under `M-tree-p2`.
- [ ] **Performance Contracts section numbers** (50ms shell, 500ms interactive, etc.): aspirational; no benchmarks run this session. Re-measure before claiming they hold.
- [ ] **`voice_memo_mirror.note_id` self-reference** (D8): flagged as unverified. No consumer currently reads it.

### Historical drift — intentionally kept
- Repo directory `Handy-main` and paths `handy-vault/`, `handy-embedding-sidecar` — product renamed to Infield but identifiers kept until a dedicated rename milestone (observable migration cost on existing installs).
- `workspaceGlideHandy.tsx` filename — part of the Glide Data Grid integration; rename scheduled with `M-editor` when canvas cells are themed.

### Cross-file authority (when in doubt, these win)
- Architecture rules / invariants / token contracts: [CLAUDE.md](CLAUDE.md)
- Current phase status / task tracking: this file (PLAN.md)
- Deep architecture reference with line numbers: [PROJECT_HANDOVER.md](PROJECT_HANDOVER.md)
- Visual target: `infield (1).html` + `HerOS_UI_Kit/`
- Actual behavior: **the code** — when prose and code disagree, code is truth; fix the prose.




### Pre-existing errors — ignore, do not fix
- `src/bindings.ts` TS2300 duplicates — auto-generated, overwritten on build
- `src/pages/UnifiedSettingsPage.tsx` — unrelated to workspace work

A task is clean when ONLY these files produce errors.



