# Infield — Rebuild Plan

> Source of truth for the current rebuild. Supersedes the phase roadmap
> in `old/PLAN.md` and `old/frontendplan.md`. `CLAUDE.md` carries the
> rules and invariants; this file carries the roadmap, per-phase
> blueprint, and open decisions.
>
> **Last updated:** 2026-04-25 (W3 ✅ SHIPPED)
> **Current phase:** Backend Wiring Phase (W) — W0/W1/W2/W2.5/W3 ✅, **W4 next** (Database views). W7 (URL Media Import) shipping in parallel; W8 (Visual Import) stub awaiting W4. Cleanup renumbered W7→W9.
> **Rust backend (Phase A):** ✅ complete 2026-04-22
> **Frontend port (H1-H6):** ✅ superseded by wholesale swap on
>   2026-04-23 (commit `49f0386`). Frontend is now 100% verbatim
>   from `third_party_selling_desktop/src/` with a Handy-backed
>   VaultContext adapter, native UI zoom via set_app_zoom command,
>   and asymmetric window-scale coupling.
>
> **What's still pending** lives in the Backend Wiring Phase
> (W) roadmap near the top of this file.

---

## Backend Wiring Phase (W) — current work

Frontend shell is 100% the ported third_party frontend. Rust backend
(Phase A) is stable and has every command/manager Handy needs
(workspace tree, MDX, transcription, system audio, hybrid search,
AI chat scaffolding, vault sync, onboarding state machine). The
remaining work is **connecting the two** so the dormant views
actually do something.

**W-phases** are listed roughly in user-visible-value order. Each
phase is a self-contained "wire this surface to that Rust command"
swap. The list below is a checklist; the ordering can change.

### W0 — Spotlight-style onboarding (first-run) ✅ SHIPPED 2026-04-23

Commits: `0759ee3` (overlay) + Rust enum prune.
Spec: [docs/superpowers/specs/2026-04-23-w0-w1-onboarding-and-voice-design.md](docs/superpowers/specs/2026-04-23-w0-w1-onboarding-and-voice-design.md).
4-step overlay (mic / accessibility / models / vault), no backdrop blur (kinetic blob layer visible through), VaultContext extended additively with `onboardingStep` + `completeStep`. Backend `OnboardingStep` enum pruned to `mic | accessibility | models | vault | done`; legacy rows self-heal to `mic` on read. Welcome + theme dropped per current direction.

---

### W0 — original brief (kept for context)

Copy/ ships no onboarding component (third_party starts with a
password unlock). Handy needs one: mic permission → accessibility
(macOS) → Whisper + bge-small download → vault path. Design it
using copy/'s `SpotlightOverlay` pattern so it feels native to the
rest of the app — a command-palette-like overlay that sweeps the
user through each step with minimal chrome. The Rust
`commands::onboarding::{get,update,reset}_onboarding_state` +
`get_settings / write_settings` commands are all registered and
ready; frontend just needs to call them through Spotlight-style
steps.

**Contract:** first-run detection via `get_onboarding_state()`
`current_step !== "done"`. Show Spotlight onboarding until
`current_step === "done"`, then boot into AppShell.

### W1 — Voice transcribe wire-up ✅ SHIPPED 2026-04-23 (+ extras)

Commits: `3f24fcf` (mic wire), `64fe8ba` (System Audio page), `7a7eb87` (per-day history + date selector), `69773f1` (per-memo play button), `a0cd046` (lazy vault reconciliation).

What landed:
- **AudioView (Audio Intelligence)** — mic button drives `start_ui_recording` / `stop_ui_recording` (new thin Tauri wrappers in `src-tauri/src/commands/audio.rs` over the existing `TranscribeAction` pipeline; binding id `"ui-mic"`). Live partials via `workspace-node-body-updated`, final lock via `workspace-transcription-synced` (filtered to `source = "voice_memo"`), errors via `recording-error` Sonner toasts. Today's voice memos load on mount by parsing every `::voice_memo_recording{path="…"}` block. Date picker dropdown lists every `Voice Memos — YYYY-MM-DD` doc found via `searchWorkspaceTitle`. Per-memo Play button uses `convertFileSrc` + a singleton `<audio>` element. Lazy reconciliation on date load: `pathsExist` (parallel `stat`s via `@tauri-apps/plugin-fs`) marks missing audio files as Unavailable proactively, and a vault-doc-missing banner appears if `vault_rel_path` is gone from disk.
- **SystemAudioView (new page)** — added below "Audio Intelligence" in the IconRail. Mirrors the layout but listens to `system-audio-chunk` events (paragraphs[] payload), wired to `startSystemAudioCapture` / `stopSystemAudioCapture`. Blue accent + Headphones icon to distinguish from mic. Clear-on-Start, persist-on-Stop UX.
- **Critical visibility issue NOT shipped:** none. Existing `recording-error` is the only error path; we don't yet poll the recording manager for live audio levels (waveform stays cosmetic).

What's still deferred (won't be picked up unless asked):
- Backend boot-time vault-doc-deletion scan (CLAUDE.md Rule 14 says lazy-on-load, which is what shipped).
- Real-time audio level meter in the waveform.

---

### W1 — original brief (kept for context)

Handy's Rust transcription (ORT sessions via `transcribe-rs`,
multiple engines: Whisper / Parakeet / Moonshine / SenseVoice /
GigaAM / Canary) is fully functional. The ported `AudioView` in
`src/components/AudioView.tsx` renders a mic UI but doesn't call
any command. Wire:
- Mic record button → `commands::audio::start_recording`
- Transcription stream → listen for backend events and render
- "Voice Memo" target doc → auto-create workspace document under
  "Mic Transcribe" folder per Rule 9 (ISO title "Voice Memos —
  YYYY-MM-DD") and append `::voice_memo_recording{...}` directives
  + transcript text
- Transcribe-rs live partials → stream into AudioView's waveform
  + caption area
- System audio capture → wire into the same pipeline behind a
  toggle (backend already supports via `system_audio::*`)

### W2 — Workspace tree + CodeMirror 6 editor ✅ SHIPPED 2026-04-24

Commits (18): `1460194` (CM6 deps), `276d672` (pathsExist util),
`60fa8d1` (HerOS theme), `cc7e7c8` (slash split), `bb43964` (wikilink
source), `aa2bb6e` (voice-memo pill), `aee64c8` (node:// mark),
`3cdee8a` (autosave), `35ae127` (conflict state machine), `6bb4043`
(MarkdownEditor integration), `e924917` (notes.css), `3a924d5` (Tree),
`5c96a63` (Tree tests), `073a644` (Tree drag-drop), `97438e2`
(BacklinksPane), `fc901ac` (NotesView rewrite), `a0b0699`
(AppShell Cmd+N / Cmd+Shift+J), `a0e97a3` (Tier 2 slash commands).

**What landed:**
- **Tree** (`src/components/Tree.tsx`): flat-map state reducer,
  case-insensitive substring filter, drag-drop reorder via
  `@dnd-kit/sortable` with midpoint position math, keyboard nav
  (↑↓←→ Enter Delete), lazy children load on caret expand, cycle
  guards in `flattenVisible`, `try/catch` on every `commands.*` call.
- **MarkdownEditor** (`src/components/MarkdownEditor.tsx`): CM6
  uncontrolled editor wrapping `@codemirror/lang-markdown` + GFM +
  slash-completion + wikilink-completion + voice-memo Lezer widget +
  `node://` mark decoration + 300ms debounced autosave. Inline
  conflict banner (Reload / Keep mine / Open diff disabled) driven
  by pure `conflictReducer` consuming `VAULT_CONFLICT:{json}` error
  prefix already emitted by Rust. Save-footer states idle / saving /
  saved h:MM / error-click-to-retry.
- **BacklinksPane** (`src/components/BacklinksPane.tsx`): renders
  `get_backlinks(activeNodeId)` with empty / loading / empty-results
  states.
- **NotesView** rewritten as three-column `.notes-split` layout; old
  eBay side-notes surface retired.
- **AppShell** shortcuts: Cmd+N (create new doc on notes page),
  Cmd+Shift+J (today's daily note from anywhere → navigates + opens).
- **Tier 2 slash commands** shipped: `/link` (triggers `[[`
  autocomplete), `/today` (inserts optimistic placeholder, swaps in
  real wikilink to today's daily note). `/voice`, `/database`,
  `/embed` deferred to W2.5 per PLAN.md.

**Spec:** [docs/superpowers/specs/2026-04-23-w2-notes-wiring-design.md](docs/superpowers/specs/2026-04-23-w2-notes-wiring-design.md).
**Plan:** [docs/superpowers/plans/2026-04-23-w2-notes-wiring.md](docs/superpowers/plans/2026-04-23-w2-notes-wiring.md).

**Test / build green on SHIPPED:**
- `bun run build` — passes, 2548 modules, ~7s.
- `bunx vitest run` — 50/50 across 9 files (up from 29 baseline;
  W2 added 21 new tests covering slash / wikilink / voice-memo /
  node-link / autosave / conflict-reducer / tree-flatten).
- `cargo test --lib` — 140 passed / 2 failed in
  `portable::tests::test_magic_string_with_whitespace_enables_portable`
  and `portable::tests::test_valid_magic_string_enables_portable`.
  These failures PREDATE W2 (`portable.rs` hasn't changed since the
  initial commit — `git log -1 src-tauri/src/portable.rs` confirms).
  Not in W2 scope. Worth a separate fix-up task.

**Manual E2E scenarios (ran OFFLINE — browser automation tools were
unavailable in the shipping session; walk through these via
`bun run tauri dev` before user testing):**

1. Navigate to Notes tab — Tree renders (empty state or existing
   nodes); empty right pane shows "Select a note or create one
   with ⌘N".
2. Press `Cmd+N` — a new "Untitled" doc appears in the tree, opens
   in the editor. Type a word.
3. Wait ~400ms — footer shows "Saving…" then "Saved h:MM".
4. Switch to a different tree row, then back — typed word persists
   from SQLite + vault .md.
5. Type `/table` on an empty line → completion menu opens → select
   "Table" → 2×2 markdown table inserts with caret in first cell.
6. Type `[[` on a new line → wikilink menu shows matching docs →
   select one → `[Name](node://<uuid>)` inserts → click the
   rendered link → tree active node switches to target doc.
7. Press `Cmd+Shift+J` — today's daily note opens (creates if
   missing) and Notes tab becomes active.
8. Select a tree row, press Delete → "Moved to trash" toast;
   row disappears.
9. Drag a tree row into a different sibling position → order
   updates; reload app to verify `move_node` persisted.
10. External-edit conflict: with app open, edit the underlying
    `.md` file in a plain-text editor and save. Return to Handy,
    click the doc in the tree (triggers `get_node` mtime sync),
    then type → inline conflict banner appears. "Reload" loads
    disk contents; "Keep mine" overwrites.
11. Voice-memo pill: create (via AudioView) or find a doc with a
    `::voice_memo_recording{path="…"}` directive; open it in
    Notes. Pill renders inline; clicking plays the audio. Delete
    the audio file externally, re-open → pill shows unavailable
    state immediately (pre-seeded via `pathsExist`).

**W2.5 follow-ups flagged during review (track in the W2.5 block):**
- Placeholder race guard in `/today` (decoration anchor rather
  than `doc.indexOf(placeholder)`).
- Local-date helper shared between `Cmd+Shift+J` and `/today` to
  avoid UTC-vs-local off-by-one day at timezone boundaries.
- Replace `window.confirm` tree context menu with a real
  `<HerOSMenu>` popover.
- Open-diff view in conflict banner.
- `.cm-activeLine` + focus-visible rings for accessibility.
- `@tanstack/react-virtual` on tree once 10k-node perf matters.

---

### W2 — original brief (kept for context)

The ported `NotesView` is an eBay note-list shell. Handy needs a
**tree + editor split pane** inside `NotesView`'s glass frame.

**Editor decision (locked — CLAUDE.md Rule 22):** CodeMirror 6 +
`@codemirror/lang-markdown` with GFM extensions enabled. Not
MDXEditor, not TipTap, not BlockNote — those treat markdown as an
export format and violate Rule 10 (body is raw markdown). CM6 is
markdown-native on disk + has a real Lezer AST for decorations
(table / task list / wikilink pill / voice-memo embed). Do NOT use
the `Agentz360/secure-lang-markdown` fork — it ships a telemetry
SDK that POSTs to a remote ingestionUrl, incompatible with
Invariant #1. Only use official `@codemirror/*` packages.

**Deliverables:**

- **Left pane — workspace tree** (new `src/components/Tree.tsx`,
  flat per Rule 5 of Definition of Done):
  - Drag/drop via `@dnd-kit`, fractional-indexed positions
  - Fed by `commands::workspace_nodes::list_children` (one flat
    query per SQLite Performance section, build hierarchy in JS)
  - Caret toggles open/closed; a document with ≥1 non-deleted child
    is itself the folder (Rule 11 — no `folder` node_type)
  - Soft-delete on Delete key per Keyboard Contracts
  - Windowed past ~1k nodes to hit perf target (10k nodes < 400ms)

- **Right pane — CodeMirror 6 editor** (new
  `src/components/MarkdownEditor.tsx`):
  - Extensions: `markdown({ base: markdownLanguage, extensions:
    [GFM] })` for tables / task lists / strikethrough / autolinks
  - `@codemirror/autocomplete` with TWO sources: `/` slash
    commands (Rule 23 — catalog already stubbed at
    `src/editor/slashCommands.ts`) and `[[` wikilink autocomplete
    (queries `searchNodes` with 150ms debounce, title-only)
  - Custom link renderer catches every `node://uuid` href and
    routes to `'notes'` + node id via the Rule 2 page-setter —
    never let the browser handle `node://`
  - Autosave: 300ms debounce → `update_node` with
    `last_read_mtime` for the Rule 13 conflict guard
  - External-edit conflict: inline banner (NOT modal) with
    Reload / Keep mine / Open diff — pauses autosave on the
    conflicted node until resolved
  - Voice-memo pill: Lezer decoration replaces each
    `::voice_memo_recording{path="…"}` directive with an inline
    "▶ Play" control that loads the audio file via
    `convertFileSrc()` + the shared singleton `<audio>` element
    already used by `AudioView`
  - No round-trip serialization — the CM6 doc IS the raw markdown
    body written to `workspace_nodes.body` and the vault `.md`
    file (Rule 10)

- **Slash commands** (Rule 23, stub at `src/editor/slashCommands.ts`):
  - Tier 1 (ship in W2): 10 block primitives already stubbed —
    `/h1` `/h2` `/h3` `/ul` `/ol` `/todo` `/quote` `/divider`
    `/code` `/table`
  - Tier 2 (defer to W2.5 if it stretches scope): Handy-native
    commands live in `src/editor/commands/` — `/link` (wikilink
    autocomplete trigger), `/today` (insert link to today's
    daily note, resolving via a new or existing Tauri command),
    `/voice` (inserts a `::voice_memo_recording` directive and
    starts a mic recording into the block on stop), `/database`
    (creates a child database node), `/embed` (transcludes
    another node's body at render time)
  - Line-start guard: completion source only fires when the text
    before `/` on the current line is whitespace-only
    (prevents triggering mid-sentence in `"go to /usr/bin"`)

- **`NotesView` shell wiring** — replace the eBay-style note list
  with the tree/editor split. Keep `NotesView`'s outer
  `.heros-page-container` + `.heros-glass-panel` wrapper intact;
  the split pane mounts inside. Use the HerOS primitives
  (`<HerOSInput>` for the tree filter / search input at the top
  of the left pane, `<HerOSButton>` for actions). No new visual
  primitives — everything stays on the HerOS Design System.

**Approach**: start with the brainstorming skill to surface open
questions (tree filtering UX, new-node keyboard flow, how to render
the voice-memo pill's "Unavailable" state when `pathsExist` returns
false, how to handle the conflict banner visually inside the glass
frame). Then write a plan via writing-plans. TDD the pure pieces
(slash source matching, `::voice_memo_recording` Lezer widget
parse, autosave debounce) in Vitest. Verify end-to-end through the
preview tools — open a node, type, switch nodes, reload, confirm
the body persists to both `workspace.db` and the `.md` file on
disk.

**Done when**: tree renders 1000+ nodes smoothly; clicking opens
a node in the right pane; typing autosaves under 200ms for bodies
≤50KB; `/table` + `[[` both trigger their completion menus; a
voice-memo pill renders for every `::voice_memo_recording` block
and plays the audio on click; external-edit conflict shows the
inline banner; `cargo test --lib` + `bunx vitest run` + `bun run
build` all green.

**Spec:** [docs/superpowers/specs/2026-04-23-w2-notes-wiring-design.md](docs/superpowers/specs/2026-04-23-w2-notes-wiring-design.md).

### W2.5 — Notes polish + tab system ✅ SHIPPED (2026-04-24)

**Spec:** [docs/superpowers/specs/2026-04-24-w2.5-notes-polish-tabs-design.md](docs/superpowers/specs/2026-04-24-w2.5-notes-polish-tabs-design.md).
**Plan:** [docs/superpowers/plans/2026-04-24-w2.5-notes-polish-tabs.md](docs/superpowers/plans/2026-04-24-w2.5-notes-polish-tabs.md).

**Shipped (20 tasks, commits `f035c2f..d0e2773`):**
- Token foundation: `--text-3xl`, `--radius-sm`, `--radius-pill`, `--transition-fast`,
  `--surface-1/2/hover/active`, `--border-subtle`, `--heros-text-faint`.
- Rule 12 backlog item I1 CLOSED: `notes.css` + `herosTheme.ts` swept; zero raw literals.
- Typography bump (tree 12→14, tree buttons 11→12, backlinks 13→14).
- Drag-offset fix on `SortableRow` (transform/transition suppressed while `isDragging`).
- Tab system: `tabsReducer` (9 actions, 17 tests), `<NotesTabs>` strip, preview/permanent
  semantics, compound-key remount, per-tab scroll restoration (in-memory only).
- `nodeLinkClick` carries `{ meta: boolean }` so Cmd-click in editor → new permanent tab.
- Editor chrome: `<EditorTitleBar>` (emoji picker + editable title, portalled picker with
  outside-click/Escape dismiss), `<Breadcrumb>` (ancestor walker + middle-collapse,
  4 tests), `<PropertiesPanel>` (collapsible; icon + tags editable; metadata read-only;
  portalled picker).
- CM6 placeholder `'Type / for commands · [[ for links'` via `@codemirror/view`.
- `<HerOSMenu>` context-menu primitive (replaces `window.confirm` in Tree; portal +
  keyboard nav + once-bind listeners via refs).
- Tree right-click → 4-item HerOSMenu (Open / Open in new tab / New child document /
  Delete) with drag-state guard.
- Keyboard: Cmd+T (new tab), Cmd+W (close tab, notes-only), Cmd+1..9 (switch tab,
  notes-only) — see CLAUDE.md Keyboard Contracts.

**Done criteria met:**
- `bun run build`: green, zero new errors.
- `bunx vitest run`: **81 tests / 12 files** (50 W2 baseline + 17 tabsReducer + 7
  ancestors + 4 Breadcrumb + 3 nodeLinkClick).
- `cargo test --lib`: **140 passed / 2 pre-existing failures** in `portable::tests`
  (unchanged from W2 baseline; not in W2.5 scope).

**E2E manual walk-through (spec §11.3) — deferred to user:**

The shipping session does not have browser automation tooling for `bun run tauri dev`.
Users should walk through these 10 scenarios after pulling:

1. **Preview-replace**: create docs A, B, C. Tree-click A → preview tab (italic).
   Click B → same tab id, label swaps to B (still italic). Type → label loses italic,
   gains leading dot in brand color. Click C → NEW preview tab (previous now permanent).
2. **Right-click → Open in new tab**: tree right-click → HerOSMenu opens; "Open in
   new tab" → permanent tab appended + activated.
3. **Cmd-click wikilink**: in a doc with `[Target](node://<id>)`, Cmd-click (Ctrl on
   Windows) → opens target in new permanent tab.
4. **Plain click wikilink**: same doc, plain-click → replaces current preview (or
   opens new preview if current is permanent/dirty).
5. **Cmd+T / Cmd+W / Cmd+1..9**: Cmd+T creates a fresh doc + tab. Cmd+1/3/9 switch
   to tab N (clamps to last). Cmd+W closes active; on last tab shows empty state
   (does NOT close window).
6. **Long titles**: 80-char title shows ellipsis when unfocused; horizontal scroll
   when focused. Tab label truncates at 180px with native tooltip on hover.
7. **Breadcrumb middle-collapse**: 8-deep nested chain renders `A › … › G › H`
   when total > 60 chars. Click `…` expands all.
8. **Properties panel persistence**: open doc, expand Properties, change icon, add
   tags ("research", "w2.5"), collapse, close app, reopen. Icon + tags persist.
   Vault `.md` frontmatter has `tags: [research, w2.5]`.
9. **Rule 20 typography sanity**: scale 1.0 = Obsidian-sized; 1.5 (`Cmd+=` ×2)
   scales everything proportionally; 0.75 the opposite.
10. **Drag offset**: drag a tree row onto another's slot. Source-row ghost stays
    under cursor (no 4-row offset); DragOverlay follows cursor exactly.

If any scenario fails, see plan §3.19 step 3 for typical regression sites.

**NOT in this pass (remains deferred):**
- Tab persistence across app restart (in-memory only).
- Drag-to-reorder tabs.
- Tab context menu (Close others / Pin / Move to new window).
- Pinned tabs; split-pane; rich emoji picker beyond 20-emoji curated palette.
- Breadcrumb sibling dropdown.
- Wikilink preview tooltip.
- `notes.css` concern-file split (currently 684 lines, above the 500-line soft
  ceiling per Rule 18). Split into per-component concern files in a polish phase.

### W2.5 — Remaining open items (post-ship)

- [ ] **`/voice` slash command** (`src/editor/commands/voice.ts`) —
  inserts a `::voice_memo_recording` directive placeholder and starts
  a mic recording that appends into the block on stop. Overlaps with
  the AudioView recording UX; needs a shared session manager so the
  two surfaces don't compete for the mic.
- [ ] **`/database` slash command** (`src/editor/commands/database.ts`)
  — creates a child database node under the current doc. Blocked on
  W4 (database views) shipping a usable embedded database renderer.
- [ ] **`/embed` slash command** (`src/editor/commands/embed.ts`) —
  transcludes another node's body at render time via a Lezer
  decoration. Blocked on deciding whether embeds are live
  (re-rendered on source change) or snapshot (copied once) — design
  call, not engineering.
- [ ] **Conflict banner "Open diff" view** — the third button in the
  external-edit conflict banner, disabled in W2. Side-by-side merge
  view comparing in-editor body vs. on-disk body.
- [ ] **Split-pane resize** in NotesView (left/editor/right column
  widths) — W2 ships static widths; add `react-resizable-panels`
  (already a dep) if manual resize becomes a friction point.
- [ ] **Delete / implement `.tree-row__rename` CSS** in
  `src/styles/notes.css`. W2 ships the class but the Tree component
  doesn't yet wire an inline-rename input. Either land the rename
  flow (`F2` / Enter-while-selected) or strip the dead CSS.
- [ ] **`BacklinksPane` should refresh after autosave** (not only
  on `activeNodeId` change) so a newly-inserted wikilink shows up
  in the pane without a navigation round-trip.
- [ ] **`refreshToken` in Tree** currently reloads roots only — make
  it accept an optional `parentId` so `handleCreateChild` surfaces
  the new child without requiring a collapse+expand of the parent.
- [ ] **Rule 13a cloud-sync `+3s` mtime buffer** — Rust currently uses
  `+1s` unconditionally at `workspace_manager.rs:1665`. Not a W2
  regression, but W2 is the phase that makes the conflict banner
  user-visible, so iCloud / OneDrive users will see more false
  positives than necessary. Add the `+3s` widen when the vault root
  matches a cloud-sync path (or a `user_preferences.vault.mtime_grace_ms`
  override).
- [ ] **Cmd+N scoping** decision: either make Cmd+N create-and-navigate
  from any page (consistent with Cmd+Shift+J + Cmd+T), or document in
  CLAUDE.md Keyboard Contracts that Cmd+N is notes-only. Today it's
  silently a no-op on other pages. Cmd+T partially addresses the
  "create and navigate" gap but Cmd+N remains unchanged.
- [ ] **Placeholder race guard in `/today`** (decoration anchor rather
  than `doc.indexOf(placeholder)`).
- [ ] **Local-date helper** shared between `Cmd+Shift+J` and `/today`
  to avoid UTC-vs-local off-by-one day at timezone boundaries.

### W3 — Hybrid search ✅ SHIPPED (2026-04-25)

**Spec:** [docs/superpowers/specs/2026-04-25-w3-hybrid-search-design.md](docs/superpowers/specs/2026-04-25-w3-hybrid-search-design.md).
**Plan:** [docs/superpowers/plans/2026-04-25-w3-hybrid-search.md](docs/superpowers/plans/2026-04-25-w3-hybrid-search.md).

**Shipped (21 tasks, first commit `ff19c1b`, last `ada5f78`):**
- Stage 4 cross-encoder reranker (`bge-reranker-v2-m3`) with new ORT session under Rules 16/16a/17/19, lazy-downloaded.
- LRU 128 rerank cache; 100 ms hard timeout; short-circuit when RRF top-1 dominates.
- Hybrid search filters: node_type, tags, date range, pagination (date filter is a v1 no-op — wired to SQL CTE deferred).
- `SpotlightOverlay` (Cmd+K) — debounced 200 ms, top-10, keyboard-driven, stale-response guard via `reqIdRef`, safe FTS5 `<mark>`-aware snippet renderer (returns React nodes only — no HTML-injection prop, satisfying W2.5 review M4).
- `SearchView` rewrite — sidebar filters (node-type checkboxes + tag chips + date radio) + paginated results + recent-query chips.
- Pure modules: `searchTokens` (date + tag parser, 7 tests), `searchSnippet` (safe `<mark>` React-node renderer, 6 tests), `recentQueries` (localStorage LRU, 7 tests), `SearchResultRow` (7 tests).
- New CSS concern file `src/styles/search.css` — 9-class group, fully tokenized except 4 deliberate literals (`max-width: 600px`, `max-height: 70vh`, `padding-top: 20vh`, `z-index: 1000`, `width: 200px` filter sidebar — flagged for a future `--spotlight-*` / `--filter-sidebar-width` token if it becomes friction).
- Result routing: Enter → preview tab; Cmd+Enter → permanent tab via existing W2.5 reducer actions (custom events `notes:open` / `notes:open-new-tab`).
- Score-debug overlay (Cmd+Shift+D).

**Done criteria met:**
- `bun run build`: green.
- `bunx vitest run`: 19 files, 118 tests passing (W2.5 baseline 81 + W3 27 + concurrent W7 additions).
- `cargo test --lib`: 186 passing / 2 pre-existing `portable::tests` failures (no W3 regressions; baseline matched).
- §11.3 E2E scenarios 1–12: deferred to user manual walk-through (browser automation unavailable in shipping session).

**E2E manual walk-through (12 scenarios — to be confirmed by user):**
1. Cmd+K opens Spotlight; Esc closes it.
2. Empty Spotlight shows recent queries chips.
3. Search "react" with mixed-type matches; both 🟢 (FTS) and 🟣 (vector) badges visible.
4. Cmd+Enter from Spotlight opens permanent tab in NotesView.
5. Plain Enter from Spotlight opens preview tab.
6. Spelling typo → "did you mean" suggestion (UI hooks shipped — backend Levenshtein lookup deferred).
7. Date token `today` filters to today's docs (UI parses it; SQL date filter is v1 no-op — visible only as the stripped query passed to FTS+vector).
8. Tag short-circuit `#research` returns matching tag results (Spotlight short-circuits when token is the entire query).
9. First search downloads the reranker model (~568 MB; Tauri command `download_reranker_model` triggered lazily).
10. Reranker timeout fallback: stage 4 returns null after 100 ms → caller falls back to RRF order silently.
11. SearchView filter sidebar refilters immediately on chip toggle (no debounce on filter clicks; debounce only on text input).
12. Score-debug overlay (Cmd+Shift+D) reveals `[fts:r=… · vec:r=… · score:0.500]` per row.

**Closed backlog items:**
- W2.5 backlog: "Local-date helper for Cmd+Shift+J / `/today`" → `src/editor/searchTokens.ts` provides it; future refactor of those callers will use it.
- W2 final-review M4: "no HTML injection in snippet rendering" → `searchSnippet.ts` returns React nodes only, never raw HTML.
- W2.5 final-review: "Rule 12 token sweep for new CSS" — `search.css` shipped fully tokenised (literal carve-outs flagged above).

**Carried into Search v2 / W6:**
- HyDE / generative query expansion (needs LLM infra).
- Personalised boosting (recency, click-through learning).
- Saved searches / smart folders.
- Reranker model toggle (v2-m3 ↔ v2-base) in Settings.
- Faceted search beyond type/tags/date.
- Tag-list backed by SQL aggregate view (currently scans live nodes per render via `getRootNodes`).
- Real `did-you-mean` Levenshtein lookup against `workspace_fts_v` vocab (UI hooks shipped, lookup backend deferred).
- Date-filter wired through to SQL CTE (Rust-side post-filter is a no-op in v1 — params underscored in `commands/search.rs`).
- Pinning real sha256 hashes for `bge-reranker-v2-m3` artefacts after first end-to-end download in dev (placeholder hashes in `reranker_download.rs`).
- ORT output tensor name assumed `"logits"` for the reranker — verify on first download.

### W4 — Databases views

`DatabasesView` renders a glass frame; internals are eBay mock-ups.
Replace with Handy's database system:
- Grid view (Glide Data Grid + `tokenBridge.ts` to consume tokens
  as hex strings per Rule 12 canvas exception)
- Board / Calendar / List / Gallery views
- Database files on disk per vault-database-storage.md contract

### W5 — Settings

`SettingsView` has Appearance (glass intensity, grain, bg, UI
scale slider ✅ already wired) + other sections dormant. Wire:
- Audio devices (input/output selection, PTT config)
- Models (Whisper size, bge-small status, download/delete)
- Keybindings (global shortcut config through shortcut commands)
- Accessibility (mic + a11y permission status + re-request)
- Vault location
- Advanced (reset onboarding, clear caches, debug log)

### W6 — AI chat (later)

Gemini/Vertex via user's Google OAuth (per Phase G from old plan).
Deferred until W1-W5 land and the base app is fully usable.

### W7 — URL Media Import 🟦 DESIGNED 2026-04-24

Spec: [docs/superpowers/specs/2026-04-24-w7-url-media-import-design.md](docs/superpowers/specs/2026-04-24-w7-url-media-import-design.md).

Wires the dormant `ImportView` to a new URL-paste pipeline that downloads media (audio or video), transcribes via the existing whisper pipeline, and lands a workspace document under `Web Clips/` with full source metadata, cached thumbnail, cached audio (default), and a `segments.json` sidecar for forward-compat with W2 click-to-seek.

**Key architecture decisions** (full detail in spec):
- Extends `import/mod.rs` (the shipped 939-line file-import pipeline) with a new `ImportJobKind::WebMedia` variant + two head states (`FetchingMeta`, `Downloading`). Existing pipeline runs unchanged from `Preparing` onward.
- yt-dlp is shipped as an **optional plugin** — not bundled in the installer. Three install entry points: Import-page banner, Settings → Extensions, optional Onboarding step. Installed to `<app_data>/handy/extensions/yt-dlp/`. Weekly auto-check + manual update button. SHA256 integrity verification against published checksums.
- New `OnboardingStep::Extensions` slot between `vault` and `done` (legacy `vault` rows self-heal).
- Storage layout: `<vault>/.handy-media/web/<node-id>/{audio.mp3, thumbnail.jpg, segments.json}`. Per-node subfolder = atomic cleanup on delete. Source-type namespace (`web/`, `voice/`, `images/`, `files/`) reserves slots for future phases.
- One textarea input auto-detects 1-vs-N URLs (preview card vs silent bulk enqueue). Playlist URLs open a virtualized multi-select modal.
- One unified queue surface — file imports and URL imports interleave in the existing Processing/Completed panels.
- Concurrency: 4 metadata fetches, 2 downloads, 1 transcription (single ORT lane, yields to mic per Rule 16a).

**Forward-compat hooks for W2 / W6 / W8:**
- `segments.json` sidecar (always written) → W2 click-to-seek without re-transcription.
- `::web_clip{...}` directive → W2 CM6 decoration as rich card.
- Frontmatter has reserved space for `summary:` / `chapters:[]` (W6).
- `OnboardingStep::Extensions` is the slot for W6 (LLM runtime), W8 (OCR engine).
- `ImportJobKind` and `.handy-media/<source-type>/` are extensible patterns W8 will reuse.

**Explicitly deferred:**
- Inline timestamps in markdown body (sidecar JSON instead — keeps body clean).
- Auto-summary / chapter detection / tag suggestions (W6 dependency).
- Authentication-required content (private / members-only / age-restricted) — deliberately out of scope.
- Live-stream capture, region-availability workarounds, mid-download pause/resume.
- Caption fallback (use yt-dlp captions when available instead of running whisper) — defer until v1 ships and we have platform-coverage data.

### W8 — Visual Import (OCR for images, receipts, screenshots) 📋 STUB

**Status:** Stub only. Awaits **W4 (Databases)** because the high-value use case (receipts → bookkeeping) wants Database-row output, not free-form markdown. Design proper after W4 lands.

**Pattern mirrors W7 exactly** — new `ImportJobKind::Image` variant, new `import/image_ocr.rs` sibling module, same state machine, same queue, same UI surface (ImportView dropzone already accepts any file type). The Onboarding `Extensions` step slot reserved for the OCR engine plugin.

**Storage**: `.handy-media/images/<node-id>/{original.jpg, ocr.txt}`.

**OCR engine — to research before designing W8:**

| Candidate | Notes | Fits Handy? |
|---|---|---|
| **Tesseract** (via `leptess` or `tesseract-rs` crate) | Mature, CPU-only, offline. Decent on printed receipts; weak on handwritten / stylized. | ✅ Easy; minimal deps. Fits Rule 17 (per-platform binaries). |
| **docTR** (Mindee, ONNX-exportable) | Detection + recognition pair, transformer-based. Better than Tesseract on real-world receipts. | ✅ Fits existing ORT infrastructure under Rule 16/16a. Need to evaluate model size and latency. |
| **Surya** (transformer OCR) | Modern, multilingual, ONNX-exportable. | ✅ Same fit as docTR. |
| **TrOCR** (Microsoft) | Transformer OCR via ORT. Strong on printed text. | ✅ Fits ORT pattern. |
| **PaddleOCR** | Good on Chinese / multilingual. | ⚠ Heavier deps, harder cross-platform. |
| **Apple Vision** (macOS) / **Windows OCR API** | Platform-native, zero install, very good for English. | ⚠ Linux has no equivalent → fallback engine still needed. |
| **Multimodal LLM** (Qwen2-VL / MiniCPM-V via llama.cpp/Ollama) | Best for unstructured receipts; outputs structured JSON directly. | ⚠ Heavy (4-8GB model); rides on W6 LLM infra. Gates on W6. |

**Decision matrix to fill in when W8 design starts:**
- Is W6 LLM infra already shipped? If yes, multimodal LLM becomes the primary engine, classical OCR (Tesseract / docTR) the fallback.
- Are receipts the dominant use case, or general OCR (handwritten notes, whiteboards)? Affects engine choice.
- Latency budget: receipts can tolerate seconds, real-time feedback can't.
- Cross-platform consistency vs platform-native quality: dual-engine design (native + fallback) is realistic.

**Gates W8 on:**
- W4 (Databases) — receipts need a `Receipts` database with structured columns (vendor, date, total, category) for the bookkeeping use case to be useful, not lossy text.
- W6 (LLM, optional) — for structured-extraction quality. Pure-OCR MVP without W6 is feasible but would only produce text notes, not structured rows.

### W9 — Cleanup (renamed from W7)

- Delete eBay-specific files that no Handy surface uses
  (`ebay-*.ts`, `crypto-vault.ts`, `vault-migration.ts`,
  `tauri-bridge.ts` eBay functions, `Resume_site/`). Keep the
  eBay view components as dormant cosmetic shells per
  Cosmetic-Port Discipline — they don't hurt anything at rest.
- Rebuild `src-tauri/src/overlay.rs` recording-overlay to work
  with new frontend structure (currently broken — references
  deleted `src/overlay/index.html`)
- Re-introduce frontend i18n for the wired surfaces if multi-
  language support is still a goal (copy/ hardcodes English;
  `src/i18n/locales/` files are preserved for Rust tray menu).

---

## Previous plan (Phase A, superseded Phases B-I)

Phase A (sqlite-vec migration) shipped as documented below and is
live in `src-tauri/`. Phases B-I were written against the pre-swap
frontend and are now **superseded by W0-W9 above**. They're kept
here for historical context — do not execute them.

---

## Vision

Infield is a **local-first knowledge workspace** for thinking, capture,
and retrieval. Voice memos, notes, databases, and semantic search —
all on one machine, offline-first, backed by a markdown vault the user
can read, edit, and back up without the app.

The rebuild adopts the **IRS "Sovereign Glass" aesthetic and frontend
organization** (flat `src/components/`, vanilla-CSS-first, single
`app.css` for tokens) while preserving Handy's **architectural
infrastructure**: typed token contracts, i18n via `react-i18next`,
granular Zustand stores, schema-versioned persistence, Tauri `invoke`
bridge, Rust backend.

Net: the app looks and feels like IRS; under the hood, it keeps
every Handy feature that already ships, rebuilt professionally.

---

## Scope summary

| Category | What's happening |
|---|---|
| **Keeps** | Rust backend (Tauri commands, SQLite, vault sync, transcription pipeline, mic + system audio capture), i18n, zustand, theme tokens, schema-versioned storage |
| **Replaces** | usearch + embedding sidecar → sqlite-vec in-DB vectors. Nested workspace domain UI → flat IRS-style components. Old onboarding → Apple-style 7-step with Google OAuth |
| **Rebuilds** | Workspace tree, MDX editor, database views (grid / board / calendar / list / gallery), hybrid search UI, AI chat UI |
| **Adds** | Google OAuth for Gemini/Vertex (AI chat auth), simplified tray glyph set, theme picker in onboarding |
| **Drops** | `old/` planning docs (historical), `src/components/workspace/chrome/` legacy shell (retired), TopBar / BottomBar / Sidebar / WorkspaceShell / ChatWindow (unreferenced, Phase I deletes) |

---

## Phase pipeline

Phases run sequentially. Each phase is detailed **at kickoff**, not
up front — this avoids stale blueprints when earlier phases surface
unknowns. When a phase kicks off, it gets filled into this file with:
**Goal**, **Blueprint** (files to create/modify), **Stop gate**,
**Risks**, **Decisions needed**.

| # | Phase | Intent |
|---|---|---|
| **A** | **Foundation — sqlite-vec migration** | Replace usearch + embedding sidecar with sqlite-vec in-DB vectors. Unblocks every search/embedding phase downstream. Backend-only. |
| B | Entry Experience | 7-step Apple-style onboarding, Google OAuth for Gemini, theme picker, vault location picker |
| C | Workspace Tree v2 | Fresh tree component — drag/drop, fractional-indexed positions, vault round-trip, list/databases tab split |
| D | MDX Editor v2 | Rebuilt editor — simpler toolbar, wikilinks, voice-memo pills, quieter external-edit conflict banner |
| E | Databases v2 | Unified `<DatabaseShell>` with Grid + Board + Calendar + List + Gallery views. Excel-style grid reskin. Field editor popover. |
| F | Search v2 | Hybrid FTS + vector in one SQL query. Quick-open overlay. |
| G | AI Chat v2 | Gemini/Vertex via user's Google OAuth. Chat in Home. |
| H | Audio v2 | Rebuilt mic transcribe + system audio UI in IRS style. Voice memo → workspace doc flow preserved. |
| I | Polish | Tray icon generation, settings page consolidation, i18n gap-fill, unused Tauri command prune |

---

## Phase A — Foundation: sqlite-vec migration

**Status:** ✅ complete (2026-04-22 → 2026-04-22)
**Start condition:** D1 (embedding runtime) locked
**Expected duration:** 5-8 days (was 3-5 — extended for edge cases below)
**Actual:** single day, nine reviewable commits + stop-gate validation pass

### Execution outcome (2026-04-22)

All 11 deliverables shipped. Rust tree compiles release-clean, frontend
compiles clean, 125 library tests pass, release build 12m 05s on Windows.
Full post-mortem in [REBUILD_RATIONALE.md §15a](REBUILD_RATIONALE.md).

- [x] 1. `sqlite-vec` static-linked; `vec0` auto-registered before any `Connection::open`
- [x] 2. Schema migration (`vec_embeddings` + `embedding_model_info` + `embed_backfill_queue`) — refined to `partition key` shape after spike
- [x] 3. `notes.db` / `NotesManager` / `notesStore.ts` deleted outright (D8)
- [x] 4. `EmbeddingWorker` rewrite — queue-driven drain against `embed_backfill_queue`
- [x] 5. `SearchManager` rewrite — single-table hybrid via `workspace_fts` + `vec_embeddings`
- [x] 6. `ModelInfo::MultiFile` variant + bge-small-en-v1.5 entry with pinned sha256s
- [x] 7. ORT session via `managers/embedding_ort.rs` — `InferenceHandle` worker thread + sentinel + `[CLS]` pooling + L2 normalization
- [x] 8. Rule 16a ORT concurrency mitigations (intra-thread cap, CPU-only for embeddings, transcription-active gate)
- [x] 9. `.handy.lock` acquire via `fs2` + `rfd` native dialog at pre-SQLite boot (Rule 15 / D11)
- [x] 10. Rule 19 reindex check — `rule_19_reindex_check` with mtime-keyed sha256 side-file, `OrphanVectorsRequeued` outcome added
- [x] 11. Sidecar trimmed to LLM-only (`SidecarModeDto::Embedding` variant + embed protocol stripped); `TODO(Phase G)` markers on retained files

**Howard's open runtime smokes (not blocking Phase B):**

- [ ] Real-machine DirectML benchmark — measure 10k-doc backfill wall time on the Ryzen 7 / Windows vault (spec says 8-20 min; validate before sharing perf claims)
- [ ] `.handy.lock` second-instance dialog — manual verification that the `rfd` dialog surfaces correctly on this Windows build (unit test covers lock rejection, dialog path is OS-integration)

### Original blueprint

### Goal

Eliminate the embedding sidecar binary + HTTP IPC + separate usearch
index file. All vectors live in the main SQLite DB via the `sqlite-vec`
extension. Hybrid FTS + vector search collapses to one SQL query
(prototype first — see Risk §3).

### Blueprint

- **Rust deps** (`src-tauri/Cargo.toml`)
  - Add `sqlite-vec = "0.1"` — static-links `vec0` into the binary
    via `sqlite3_auto_extension`. **Kills the dlopen / codesign /
    notarization path entirely for this extension.** Rule 17 still
    applies to future dlopen-required extensions (whisper, etc.);
    sqlite-vec is a carve-out.
  - Change `rusqlite` features: `["bundled", "load_extension"]` — the
    `bundled` feature alone does NOT expose
    `Connection::load_extension_enable()`; `load_extension` is a
    separate feature that must be explicit.
  - Add `fs2` (`.handy.lock` file locking per Rule 15)
  - Add `ort = "=2.0.0-rc.12"` — pinned to the exact version
    `transcribe-rs 0.3.5` uses transitively. **Zero new native lib
    shipping work** — the ONNX Runtime binary is already bundled
    with every build for transcription (6 of 7 transcribe-rs engines
    use ORT). Adding `ort` as a direct dep just exposes the API to
    our embedding code; it shares the same native lib transitively.
  - Add `tokenizers` (Rust HF tokenizers crate — reads the bundled
    `tokenizer.json` / `tokenizer_config.json`)
  - Add `crossbeam-channel` if not already pulled transitively
  - Remove `usearch` (deletion at end of Phase A)
  - **Not added**: `candle-core`, `candle-nn`, `candle-transformers`.
    D1 flipped Candle → ORT on 2026-04-22 (see REBUILD_RATIONALE §15).

- **Extension auto-registration**
  - `sqlite-vec::sqlite3_auto_extension()` called once at process
    start, before any `Connection::open()`. Registers vec0 with every
    subsequently-opened SQLite connection automatically. No per-
    connection load call needed.
  - No path resolution, no platform-specific binaries, no dev-vs-prod
    code paths, no graceful-fallback-if-load-fails — the extension is
    linked into the Rust binary. If it's missing, the build failed.

- **Schema migration** (`src-tauri/src/managers/workspace/workspace_manager.rs`)
  - **Test the virtual-table DDL in isolation first.** Some
    `rusqlite_migration` versions wrap migrations in nested
    transactions; `CREATE VIRTUAL TABLE ... USING vec0(...)` calls
    `xCreate` which can fail inside a wrapping transaction. Spike a
    standalone test that runs the DDL via `rusqlite_migration` exactly
    as Phase A would invoke it. If it fails, drop the migration into
    its own `Migration::up_from_sql` outside the nested block.
  - Schema (spike-validated 2026-04-22):
    ```sql
    CREATE VIRTUAL TABLE vec_embeddings USING vec0(
      node_id TEXT partition key,
      chunk_index INTEGER,
      embedding float[384] distance_metric=cosine
    );
    ```
    **Why partition key over PRIMARY KEY**: a node can produce many
    chunks (long documents split for embedding). `PRIMARY KEY` would
    fail with `UNIQUE constraint failed` on the second chunk for a
    node. `partition key` lets the same node_id repeat with different
    chunk_index values; vec0's implicit rowid handles row identity.
    **Why cosine metric**: bge-small produces L2-normalized vectors,
    for which cosine distance is the correct similarity measure and
    directly supported by vec0's KNN operator. **Partition-key bonus**:
    KNN queries scoped to a node (e.g. "find similar passages within
    this doc") pre-filter by partition — ~10× faster than full-table
    scan.
  - **Dim guard** — also add a regular table for model provenance:
    ```
    CREATE TABLE IF NOT EXISTS embedding_model_info (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      model_id TEXT NOT NULL,   -- "bge-small-en-v1.5"
      dimension INTEGER NOT NULL,
      model_hash TEXT NOT NULL  -- sha256 of the safetensors
    );
    ```
    On boot: compare stored `model_id` + `dimension` against the
    compiled-in values. Mismatch → refuse to start vector search,
    surface "Reindexing required after model change" banner, auto-
    enqueue the backfill, wipe `vec_embeddings` contents (not the
    table).
  - **Backfill queue table** — separate from the schema migration,
    this is the durable userspace job queue that survives crashes:
    ```
    CREATE TABLE IF NOT EXISTS embed_backfill_queue (
      node_id TEXT PRIMARY KEY,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL,       -- 'pending' | 'in_progress' | 'error'
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      enqueued_at INTEGER NOT NULL
    );
    ```
    Populated at migration time by `INSERT INTO embed_backfill_queue
    SELECT id, 0, 'pending', 0, NULL, strftime('%s','now') FROM
    workspace_nodes WHERE deleted_at IS NULL AND node_type IN
    ('document', 'row', 'database')`. EmbeddingWorker pulls from this
    table; boot re-enqueues any `'in_progress'` rows as `'pending'`
    so a crash mid-chunk resumes cleanly.
  - **WAL checkpoint** before migration:
    `PRAGMA wal_checkpoint(TRUNCATE)` so in-flight writes don't
    disappear on rollback.
  - **Backup protocol** for the old `embeddings.usearch`: rename to
    `embeddings.usearch.backup` at migration start; only delete after
    2 successful app starts with non-zero `vec_embeddings.rowcount`.

- **Delete `notes.db` + `NotesManager` outright**
  - Per user decision 2026-04-22: no data migration, no parallel
    surface during Phase A.
  - Files deleted after tests green:
    - `src-tauri/src/managers/notes.rs`
    - `src-tauri/src/commands/notes.rs` (if exists)
    - `src/stores/notesStore.ts`
    - Any component reading from `NotesManager`
  - `SearchManager` rewrite collapses to a single-table hybrid:
    `workspace_fts` + `vec_embeddings`. No two-DB union.
  - `HybridSearchResult` swaps `note: Note` field for `node:
    WorkspaceNode` (or a lean search-projection struct).
  - `probe_db_health` simplifies — only `workspace.db` to check.

- **Re-embed UX — background, not modal** (user decision 2026-04-22)
  - Migration completes in ≤100ms (schema + queue population).
  - Actual vectorization runs in `EmbeddingWorker` after app is
    interactive. Titlebar shows a thin progress banner:
    `Reindexing · 1,247 / 10,000 documents · search quality reduced`
    with a dismiss-for-session button + a "Why is this running?"
    popover.
  - Cancel not needed — worker respects Handy's existing pause/resume
    semantics. User can close the app; resumes on next launch.
  - **Realistic timing on Windows with ORT + DirectML**: 10k docs ≈
    **8-20 min**, 100k docs ≈ **1-3 hours**. (Adjusted downward from
    Candle estimates because ORT is typically 2-3× faster than
    Candle on CPU, and ORT-DirectML accelerates GPU-capable setups.)
    Benchmark early with a 5k-doc vault before committing.
  - **Search quality during backfill**: FTS-only path active for
    un-embedded nodes; semantic hits return for whatever's already
    indexed. Never block a query on incomplete backfill.

- **Embedding runtime — ONNX Runtime via `ort` crate** (locked per D1,
  flipped 2026-04-22 from original Candle recommendation)
  - New file: `src-tauri/src/managers/embedding_ort.rs`
  - Model: **bge-small-en-v1.5 ONNX** (384d, ~133MB fp32).
  - **Model storage: `<app_data>/models/bge-small-en-v1.5/`**
    (user-writable, alongside Whisper models — matches existing
    transcription-model pattern, NOT bundled in installer). Decision
    D1d locked 2026-04-22 — see table below.
  - **Downloaded via extended `ModelInfo` registry** in
    `src-tauri/src/managers/model.rs`.
    - `ModelCategory::Embedding` variant ALREADY exists (verified
      2026-04-22 by spike; currently used by the soon-to-delete
      bge-m3 + nomic-v1.5 GGUF sidecar entries at lines 610-664).
      No new variant needed — just a new entry.
    - **However, the registry's current download shape only supports
      single-file or single-archive (`is_directory: bool` tar.gz).
      bge-small requires 6 separate files from separate HF resolve
      URLs — structural extension required.** Per D1e locked
      2026-04-22, add a new `MultiFile` variant to the download spec:
      ```rust
      pub enum DownloadSpec {
          SingleFile { url, sha256, filename },
          SingleArchive { url, sha256, extract_to },  // existing is_directory path
          MultiFile { files: Vec<RemoteFile> },       // NEW
      }
      pub struct RemoteFile {
          pub url: String,        // HF resolve URL
          pub filename: String,   // destination name (flattened, no subdirs)
          pub sha256: String,     // expected hash
          pub required: bool,     // false allows graceful skip (e.g. LICENSE)
      }
      ```
    - New `ModelInfo` entry for bge-small:
      - `id: "bge-small-en-v1.5"`
      - `category: ModelCategory::Embedding`
      - `required: true` (cannot be skipped — semantic search depends
        on it, unlike Whisper where user picks a size)
      - `download: DownloadSpec::MultiFile { files: [...] }` with
        entries for each of the 6 files, all from
        `https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/`:
        - `onnx/model.onnx` → destination `model.onnx` (required)
        - `tokenizer.json` (required)
        - `tokenizer_config.json` (required)
        - `config.json` (required)
        - `vocab.txt` (required)
        - `README.md` (optional — source of attribution / license text)
    - SHA-256 hashes per file captured from HF resolve responses;
      verified at download end, reject + retry on mismatch.
    - Delete the bge-m3 + nomic-v1.5 GGUF entries at model.rs:610-664
      in the same commit (sidecar-dead registry noise). Keep any
      `ModelCategory::Llm` GGUF entries — they surface in Phase G
      for local LLM chat.
  - **Boot-time presence check**: on app startup,
    `EmbeddingManager::new` checks for `model.onnx` at the expected
    path.
    - Present → proceed to load ORT session
    - Missing → set `vector_search_available = false`, log once,
      surface a Settings banner ("Download semantic search model in
      Settings → Models"). FTS-only search remains fully functional.
  - **Phase A dev prep (Howard-specific)**: the existing files at
    `src-tauri/resources/models/{model.onnx,tokenizer.json,
    tokenizer_config.json}` are in the WRONG location for the new
    download-based flow. Before wiring the ORT session, move them to
    the expected app_data path (or run the download-manager code path
    once against the real HF URLs to populate app_data). The
    `resources/models/` files that remain (`silero_vad_v4.onnx`,
    `gigaam_vocab.txt`) are transcription assets — leave alone.
  - Tokenizer loaded from `tokenizer.json` via the `tokenizers` crate
    (same crate transcribe-rs uses internally; shared dep).
  - ORT session: `ort::Session::builder()?.commit_from_file(
    app_data.join("models/bge-small-en-v1.5/model.onnx"))?`.
    Input tensors: `input_ids`, `attention_mask`, `token_type_ids`
    (BERT-standard). Output: `last_hidden_state` — **take the [CLS]
    token's hidden state (row 0)** + L2 normalization to produce the
    final 384d vector.
  - **CLS over mean-pool — why, corrected 2026-04-22**: BGE's own
    model card recommends `[CLS]` for retrieval tasks; earlier PLAN
    version specified mean-pool (a common sentence-BERT default)
    which was wrong for this model family. Empirical spike measured
    a non-trivial delta on `cos_sim("hello world", "greetings earth")`:
    mean-pool → 0.6594, CLS → 0.7036. See pitfall.md → "Embedding
    model pooling convention" for the broader rule. When switching
    models, re-verify pooling against the new model's HF card.
  - **Attribution requirement** — BAAI requests attribution. Add to
    About panel / settings: "Semantic search powered by BGE (BAAI
    General Embedding) — bge-small-en-v1.5."

- **Tokio ↔ OS-thread bridge for ORT inference** (Rule 16 — concrete pattern)
  - Existing `EmbeddingWorker` stays tokio (I/O-bound queue + DB).
  - New `embedding_ort::InferenceHandle` owns a dedicated
    `std::thread::spawn` worker that owns the `ort::Session`.
  - Why a dedicated OS thread even though ORT is more stable than
    Candle: Rule 16 still applies — native ML libraries can panic in
    FFI code; `catch_unwind` across `no_mangle` is best-effort; we
    don't want a model panic poisoning the tokio runtime. ORT is
    production-grade but "more stable" ≠ "can never crash".
  - Protocol (pseudocode):
    ```rust
    // Handle (shared across tokio tasks)
    struct InferenceHandle {
        tx: crossbeam_channel::Sender<InferenceRequest>,
        // heartbeat + health monitoring omitted for brevity
    }
    struct InferenceRequest {
        text: String,
        respond: tokio::sync::oneshot::Sender<Result<Vec<f32>>>,
    }
    // Worker thread body (runs forever)
    fn worker(rx: crossbeam_channel::Receiver<InferenceRequest>) {
        let tokenizer = tokenizers::Tokenizer::from_file("tokenizer.json")
            .expect("ship broken");
        let session = ort::Session::builder()
            .unwrap()
            .commit_from_file("model.onnx")
            .expect("ship broken");
        while let Ok(req) = rx.recv() {
            let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
                let encoded = tokenizer.encode(&req.text, true)?;
                let outputs = session.run(ort::inputs![
                    "input_ids" => encoded.get_ids_tensor()?,
                    "attention_mask" => encoded.get_mask_tensor()?,
                    "token_type_ids" => encoded.get_types_tensor()?,
                ]?)?;
                let hidden = outputs["last_hidden_state"].try_extract_tensor()?;
                Ok(mean_pool_and_normalize(hidden, encoded.mask()))
            }));
            let _ = req.respond.send(
                result.unwrap_or_else(|_| Err(anyhow!("ORT panic")))
            );
        }
    }
    // Caller (tokio context)
    let (tx, rx) = tokio::sync::oneshot::channel();
    handle.tx.send(InferenceRequest { text, respond: tx })?;
    let vector = rx.await??;
    ```
  - **Sentinel + restart-once** (per Rule 16): main thread pings
    worker every 5s via a heartbeat channel; on missed beat, join
    the thread and respawn once. Second death → set
    `vector_search_available = false` and fall through to FTS-only.
  - **ORT execution providers**: on Windows enable DirectML via the
    `ort-directml` feature (already on in `transcribe-rs` features);
    on macOS enable CoreML; on Linux CPU only. Falls back to CPU
    automatically if GPU init fails. Keep provider selection code
    consistent with `transcribe-rs`'s pattern — see
    `managers/transcription.rs` line ~869 for the existing
    `accel::OrtAccelerator` usage as a reference.
  - **Concurrency with transcription sessions (Rule 16a — new)**:
    When a user records voice (mic or system audio), Handy may run a
    second ORT session for transcription — Parakeet, Moonshine,
    SenseVoice, GigaAM, or Canary — at the same time as the embedding
    session. Whisper is exempt (whisper.cpp, different runtime).
    To prevent CPU/GPU contention during the voice-memo → doc → embed
    flow:
    - Cap intra-op threads on both ORT sessions to `num_cpus / 2`
      via `ort::SessionBuilder::with_intra_threads(...)`. Prevents
      oversubscription when both sessions run concurrently.
    - `EmbeddingWorker` polls the existing
      `transcription_session_holds_model(app)` helper
      (`managers/transcription.rs`) before pulling items from
      `embed_backfill_queue`. If recording is active, sleep 500ms
      and retry. Transcription gets full resources during recording;
      embedding resumes the moment recording stops.
    - **Embedding runs CPU-only execution provider** — do NOT enable
      DirectML / CoreML for the bge-small session. bge-small is small
      enough (~10-20ms per chunk on a Ryzen 7 CPU) that GPU isn't
      needed, and reserving GPU for transcription eliminates
      DirectML command-queue serialization entirely.
    - The voice-memo → doc → embed flow is the canonical case this
      handles: user finishes recording → transcript text appears
      instantly → embedding of the resulting doc starts ~500ms later,
      invisible to the user.

- **`.handy.lock` — Phase A deliverable** (Rule 15)
  - On app boot, before opening any SQLite connection:
    ```
    let lock_path = vault_root.join(".handy.lock");
    let file = fs::OpenOptions::new().create(true).write(true).open(&lock_path)?;
    if file.try_lock_exclusive().is_err() {
      show_native_dialog(
        "Infield is already running for this vault",
        "Close the other window first, then try again."
      );
      std::process::exit(0);  // clean exit, not crash
    }
    // store `file` in AppState so lock outlives boot
    ```
  - Native dialog via `tauri::api::dialog::message` (sync variant).
  - No IPC, no focus-stealing — user manually resolves.

- **SearchManager rewrite** (`src-tauri/src/managers/search.rs`)
  - Drop `NotesManager` import + `Note` field.
  - **Prototype order** (committing to the simplest that hits perf):
    1. Single CTE with both MATCH subqueries + RRF via window fn
    2. Two subqueries, RRF computed in SQL with a JOIN
    3. Two separate queries, RRF merged in Rust
  - Perf target: <50ms at 10k docs, <200ms at 100k docs (warm cache).
  - Falls through to FTS-only when `vector_search_available = false`.

- **File deletions** (AFTER stop gate green)
  - `src-tauri/src/bin/handy-embedding-sidecar.rs`
  - `src-tauri/src/embedding_sidecar_protocol.rs`
  - `src-tauri/src/managers/embedding.rs` HTTP client portion
  - `src-tauri/src/managers/vector_store.rs` (usearch wrapper)
  - `src-tauri/src/managers/notes.rs`
  - `src/stores/notesStore.ts`
  - Any `probe_db_health` branch that references notes.db

- **EmbeddingWorker update** (`src-tauri/src/managers/embedding_worker.rs`)
  - Swap write target from usearch `idx.add()` to SQL INSERT into
    `vec_embeddings`
  - Read pending work from `embed_backfill_queue` + existing live-
    insert path (new node → enqueue)
  - Keep chunking logic, tokio scheduling, retry policy unchanged
  - Batch inserts (100 per transaction) to amortize overhead
  - On boot, re-enqueue `in_progress` rows as `pending`

### Stop gate

- `cargo build --release` green on Windows / macOS / Linux
- `bun run build` green, `bunx vitest run` green (149 tests still pass)
- Extension load succeeds on all three platforms; FTS-only fallback
  tested by intentionally corrupting the extension path
- **Correctness**: migration from a real `embeddings.usearch` produces
  top-5 semantic matches on a curated 10-query test set with ≥8/10
  overlapping a hand-curated baseline (allows model difference)
- **Perf benchmark**: query latency at 10k docs <50ms, at 100k docs
  <200ms (warm cache), on a mid-range laptop (M1 Air or Ryzen 7)
- **Concurrent writes**: manual test — run a semantic query while
  `EmbeddingWorker` is actively inserting 1000 new vectors. Query
  returns within 2× normal latency, no deadlock, no "database locked"
  errors
- **Cancellation**: interrupt the re-embed migration at 50% (Cmd+Q),
  reboot — progress resumes from last committed batch
- **Crash resilience**: kill the app mid-migration, reboot — DB is
  consistent, usearch.backup still present until 2 successful starts

### Risks (expanded)

1. **Cross-platform extension shipping + macOS notarization** — see
   "Extension bundling" above. First-time setup has the most unknowns.
2. **Embedding model choice + size** — bge-small (130MB, 384d) ships in
   installer; bge-base (440MB, 768d) likely needs lazy download. Affects
   vector column dimension at schema-creation time — changing dimension
   later requires full re-embed.
3. **Hybrid search SQL complexity** — window functions over double
   MATCH may not plan well. Fall back to app-side RRF acceptable; flag
   in PR review which path we took and why.
4. **IVF index timing** — at launch with ≤10k vectors, brute-force vec0
   is fast enough. At 100k+, need `CREATE VIRTUAL TABLE ... USING vec_ivf`
   with a cell count tuned to √N. Defer IVF setup to "we hit the perf
   wall" — don't pre-optimize. Add a migration for it when needed.
5. **Model crash crossing FFI** — `catch_unwind` doesn't cross
   `no_mangle` boundaries safely. Using a dedicated OS thread with
   sentinel + respawn-once gives us graceful degradation without
   promising "will never crash the app." Flag risk in release notes.
6. **Concurrent write contention** — sqlite-vec virtual table inserts
   may hold a write lock longer than regular SQL. Batch inserts +
   WAL mode mitigate; benchmark before declaring done.

### Open decisions within Phase A

All locked as of 2026-04-22. See the top-level "Open decisions"
tracker below for the canonical status (D1 — D11). Summary:

- D1 / D1a / D1b / D1c / D1d — **ONNX Runtime via `ort` crate,
  bge-small-en-v1.5 ONNX downloaded on first launch to
  `<app_data>/models/bge-small-en-v1.5/` via the existing `ModelInfo`
  registry, 384d, tokenizer bundled alongside model.** Reuses shared
  ORT infrastructure from `transcribe-rs`; zero new native lib work.
  Consistent with Whisper-download pattern.
- D8 — `notes.db` + `NotesManager` deleted outright in Phase A.
- D9 — Re-embed runs as a background job, not foreground modal.
- D10 — `sqlite-vec` static-linked via Rust crate.
- D11 — `.handy.lock` second-instance behavior: native dialog + clean exit.

---

## Phases B-I — kickoff blueprints written when each starts

Stubs only until activation. Don't treat these as committed designs.

**Stop-gate test-count note:** CLAUDE.md Definition of Done item #2
says "149 tests must stay green." That number is **accurate through
Phase B**. From Phase C onward, tests under `src/components/workspace/`,
`src/components/database/`, `src/components/editor/`,
`src/components/home/`, `src/components/search/`, and
`src/components/import/` get deleted alongside their components. Each
phase's stop gate replaces "149 tests stay green" with: **"no test
failure from code outside the phase's retirement scope + new components
land with coverage of their critical paths (happy path + one error
case minimum)."** Final test count at end of Phase I is expected to be
in the 80-150 range depending on component fan-out; quantity isn't the
metric, "nothing live in the codebase goes untested" is.

### Phase B — Entry Experience

**Status:** ready for kickoff (2026-04-22)
**Start condition:** Phase A complete ✅; D12-D17 locked below
**Expected duration:** 3-4 days with OAuth removed from scope

#### Goal

Apple-style 6-step onboarding wired to persisted state. Google OAuth
**deferred to Phase G**. "Sign in" moves to Settings → Account.

Full spec: [docs/architecture/entry-experience.md](docs/architecture/entry-experience.md).

#### Blueprint

**Stage machine extension** (`src/entry/EntryContext.tsx`):
- Add `'onboarding'` to `EntryStage` union.
- Route: `loading → onboarding (if not done) → login (if passphrase) → app`.
- Progress ramp maps to hydration signals, not wall-clock:
  `lock+tauri → sqlite+migrations → ORT+Rule19 → store hydrate → resolve`.

**Backend:**
- Migration adds `onboarding_state` table (single-row, CHECK(id=1)).
- New `src-tauri/src/commands/onboarding.rs`:
  `get_onboarding_state`, `update_onboarding_state`, `reset_onboarding`.
- Reuse existing commands: `request_microphone_access`, `download_model`,
  `cancel_download`, `set_active_model`.

**6 step components** (flat `src/components/`):
1. `OnboardingStepWelcome.tsx` — hero + Continue (no sign-in CTA).
2. `OnboardingStepTheme.tsx` — preset grid, hover preview via
   transient `:root` override, commit via `ThemeProvider.setPreset`.
3. `OnboardingStepMic.tsx` — `request_microphone_access` + Skip.
4. `OnboardingStepAccessibility.tsx` — macOS only; skipped silently
   elsewhere (D13).
5. `OnboardingStepModels.tsx` — parallel download of Whisper (user
   picks size) + bge-small-en-v1.5 (required). Combined weighted
   progress, per-model sub-rows. Failure: 3-attempt exponential
   backoff, then soft-skip to Settings → Models (D14).
6. `OnboardingStepVault.tsx` — default path (D15 — locks
   `~/Documents/Infield` on first pick; falls back to `<app_data>/
   handy-vault` if path not writable) or custom folder via Tauri
   dialog. Writes `user_preferences.vault_root`.

**Shell + routing:**
- `src/components/OnboardingShell.tsx` — reads `onboarding_state`,
  mounts the active step, handles Continue / back / skip.
- `src/main.tsx` — stage dispatch.

**Styling (D17):**
- Introduce `src/styles/entry.css` as the first concern-file per
  Rule 18. Panel geometry, step-transition motion, segmented control.
- Inline `style={}` retained for state-driven dynamic values
  (Rule 18 §4).
- Reconcile token-name drift: `--radius-scale + arithmetic` in existing
  IRS-ported code → `--radius-lg` / `--radius-container` per Rule 12.
- Scrub raw `px` literals from fallbacks in existing `src/entry/*.tsx`
  (36px, 52px, 24px etc. hiding inside `calc()`).

**LoadingScreen wiring:**
- Replace mock 5s ramp with real hydration-signal ramp.
- Retain 3000ms minimum floor for the lemniscate arc.
- Failure-toast slot for stage errors + Retry.

#### Stop gate

- `cargo test --lib` green (onboarding migration + command tests).
- `bunx vitest run` green (EntryContext state-machine tests + step
  component tests — happy path + one failure case each).
- End-to-end boot path on Windows: fresh app data → onboarding all 6
  steps → AppShell loads. Kill mid-step 5 → reboot → resumes at step 5.
- `bun run build` + `bun run tauri dev` green; no Tauri command
  registration warnings; `bindings.ts` specta-regenerated.
- Rule 12 / Rule 18 pass on new code: no raw hex / px literals in
  `src/components/Onboarding*.tsx` or `src/styles/entry.css`.

#### Risks

1. **Resume-mid-step-5 partial download state.** `download_model`
   already handles partial files (Phase A verified); confirm the
   onboarding resume path doesn't re-verify sha256 from scratch on
   every step mount — cache verification result in
   `onboarding_state.models_downloaded` once per model.
2. **macOS accessibility prompt timing.** The deep-link opens System
   Settings but user resolution is async. Poll permission on window
   refocus; don't block Continue on the OS dialog outcome.
3. **Theme hover-preview leak.** If user navigates away mid-hover
   without clicking, transient `:root` override must revert. Use
   `pointerenter` / `pointerleave` symmetric cleanup, never a
   timeout.
4. **Glide Data Grid / `tokenBridge.ts` is Phase E scope, not B.**
   Entry screens don't use Glide — no `tokenBridge` needed here.
5. **Tailwind still imported in `src/app.css`.** Retirement is Phase I
   scope; Phase B does NOT add new Tailwind class usage and does NOT
   remove the import. New components go through inline-style +
   concern-file pattern.

#### Open decisions within Phase B (all locked 2026-04-22)

See top-level "Open decisions" tracker below. Summary:

- D12 — `onboarding_state` **table**, not `user_preferences` keys.
- D13 — Accessibility step **skipped silently** on non-macOS.
- D14 — Models step failure: **soft skip** to Settings → Models.
- D15 — Vault default: **`~/Documents/Infield`**, fallback to `<app_data>/
  handy-vault` if user's Documents folder is missing / unwritable.
- D16 — Reset onboarding via Settings → Advanced; does NOT touch
  theme / vault / models.
- D17 — CSS strategy: introduce first concern-file (`src/styles/
  entry.css`) now; continue inline-`style={}` for dynamic state.

### Phase C — Workspace Tree v2
Fresh tree in flat `src/components/Tree.tsx`. Drag/drop via `@dnd-kit`,
fractional-indexed positions, vault round-trip, split between notes tab
(document nodes) and databases tab (database nodes). Provides the node
index used by Phase D for wikilink autocomplete — Phase D depends on C,
**not on F**.

### Phase D — MDX Editor v2
Rebuild editor wrapping `@mdxeditor/editor` with a leaner toolbar,
wikilinks autocomplete (queries the Phase C tree index directly, not
through the search backend), voice-memo pills, quieter external-edit
conflict banner (inline, not modal).

### Phase E — Databases v2
Unified `<DatabaseShell>` with view-switcher + one renderer per layout
(Grid / Board / Calendar / List / Gallery). Excel-style grid reskin via
Glide Data Grid custom cells. **Rule 12 carve-out required** — Glide is
canvas-rendered; it can't consume `var(--token)` directly. Phase E
delivers a `tokenBridge.ts` utility that reads computed semantic tokens
via `getComputedStyle(document.documentElement)` on mount and on theme
change, and passes the resolved hex strings into Glide's `theme` prop.

### Phase F — Search v2
Hybrid FTS + vector in one SQL query. Quick-open overlay (Cmd+K) with
keyboard-first results, no mouse needed. Builds on the SearchManager
rewrite from Phase A — UI only.

### Phase G — AI Chat v2
Gemini / Vertex via user's own Google OAuth token (no shared API key).
Includes: OAuth **sign-in flow** (Tauri localhost PKCE, 4-6 days for
production-grade refresh-token rotation + keyring storage + revocation
detection), chat panel in the Home surface, inline message bubbles,
streaming responses. Sign-in lives in Settings → Account; chat UI gates
behind "Sign in to use AI chat" when token absent.

### Phase H — Audio v2
Mic transcribe + system audio capture UI rebuilt in IRS style. Voice
memo auto-writes to workspace "Mic Transcribe" folder (behavior
preserved from current pipeline).

### Phase I — Polish
- Tray icon glyph generation (monochrome hex silhouette for 16/32px,
  detailed `logo.png` for dock/installer)
- Settings page consolidation (one unified page with IRS-style
  sidebar)
- i18n gap-fill (audit all `t()` calls, add missing keys)
- Unused Tauri command prune in `lib.rs`
- Legacy file deletion (`src/components/TopBar.tsx` etc.)
- **CSS audit + concern-file verification** (CLAUDE.md Rule 18) —
  run coverage tool in long production session, cross-reference
  dynamic class strings + third-party renderers, delete dead CSS
  with grep-verify. Verify every concern file stays under 500 lines;
  split further if not.
  - Reality check: PurgeCSS / coverage tools do NOT understand
    string-concatenated class names (`heros-${variant}`), classes
    passed into third-party theme props (Glide tokenBridge), or
    classes only applied via `document.classList.add()`. Budget
    30-60 min of hand-curating a safelist before any mass deletion.
    Commit list to repo at `tools/css-safelist.txt`.

---

## Open decisions (live tracker)

| # | Decision | Context | Status |
|---|---|---|---|
| D1 | Embedding runtime (Phase A) | Candle vs ONNX Runtime | **Locked: ONNX Runtime** (flipped 2026-04-22 after discovering `transcribe-rs 0.3.5` already bundles ORT 2.0.0-rc.12 for 6 of 7 transcription engines; reusing shared infrastructure kills all the per-platform native-lib shipping work) |
| D1a | Model shipping | Installer (bge-small 133MB ONNX) vs lazy-download | **Locked: lazy-download** (flipped 2026-04-22). Consistency with transcription-model flow; saves installer size; integrates with existing `ModelInfo` download registry. |
| D1d | Model storage path | `src-tauri/resources/models/` (bundled) vs `<app_data>/models/bge-small-en-v1.5/` (user-writable, alongside Whisper) | **Locked: `<app_data>/models/bge-small-en-v1.5/`.** Matches existing transcription-model pattern; user can inspect / delete / replace; Phase B onboarding downloads it alongside Whisper via existing `ModelInfo` flow. |
| D1e | Multi-file download support | Extend `ModelInfo` with `MultiFile` variant vs host a tarball vs bespoke path | **Locked: `MultiFile` variant** (extend `ModelInfo` / `DownloadSpec`). Future-proofs registry for any multi-file model (re-rankers, future embedders). ~1 day inside Phase A budget. Rejected tarball (creates CDN operational burden for what HF already hosts) and bespoke (violates D1d "one mental model"). |
| D1b | Embedding dimension | 384 (bge-small) vs 768 (bge-base) | **Locked: 384** |
| D1c | Tokenizer | Bundled from HF snapshot via `tokenizers` crate | **Locked: bundled** |
| D2 | Google OAuth scope | AI chat auth only, not sync | **Locked: chat-only** |
| D2a | OAuth phase | Phase B (onboarding) or Phase G (chat gate) | **Locked: Phase G.** Phase B skips sign-in step; defer to Settings → Account wired in G. |
| D3 | Theme editor presence | Kept or dropped in IRS-style simplification? | Keep as "Settings → Appearance" panel |
| D4 | Tray glyph states | How many states needed? (idle / recording / transcribing / error?) | TBD at Phase I kickoff |
| D5 | Vault bidirectional conflict UX | Inline banner vs modal — kept modal in old frontend | **Locked: inline banner (Phase D)** |
| D6 | i18n during rebuild | Rebuild with `t()` from day one, or hardcode English and lift later? | **Locked: hardcode English; lift in Phase I** |
| D7 | Which locale files to keep | 20 exist today; some are auto-translated and low quality | Keep `en`, let Phase I decide on the rest |
| D8 | `notes.db` fate in Phase A | Delete outright (no migration) vs keep parallel | **Locked: delete outright.** No legacy data migration. `NotesManager`, `notesStore.ts`, `notes.rs` retire in Phase A alongside usearch + sidecar. |
| D9 | Re-embed UX during Phase A migration | Foreground modal vs background job | **Locked: background** — titlebar banner with progress %, never blocks UI, FTS-only during backfill. |
| D10 | sqlite-vec delivery | Static-link via Rust crate vs dlopen per-platform binary | **Locked: static-link.** Uses `sqlite-vec = "0.1"` crate + `sqlite3_auto_extension`. Kills Rule 17 complexity for this extension; Rule 17 still applies to future dlopen-required extensions. |
| D11 | Second-instance behavior | Silent exit / native dialog / focus first | **Locked: native dialog + clean exit.** "Infield is already running for this vault — close the other window first." No IPC, no focus-stealing. |
| D12 | Onboarding progress persistence (Phase B) | `user_preferences` keys vs. dedicated table | **Locked: dedicated `onboarding_state` table.** Clearer shape for partial-completion recovery on crash, auditable history, isolates onboarding schema churn from the pref-value churn loop. Single-row `CHECK (id = 1)`. |
| D13 | Accessibility step on non-macOS | Skip silently / show + auto-advance / show "not required" message | **Locked: skip silently.** Step is not rendered at all on Windows/Linux; stage machine advances directly to Models. Avoids cargo-cult UX noise on platforms where the concept doesn't exist. |
| D14 | Models step failure policy | Hard block / soft skip / retry forever | **Locked: soft skip.** 3-attempt exponential backoff (2s → 8s → 32s), then "Skip and set up later in Settings → Models". Semantic search + transcription gracefully degrade; FTS-only remains functional. |
| D15 | Vault location default | `~/Documents/Infield` / `<app_data>/handy-vault` / force user to pick | **Locked: `~/Documents/Infield`**, with fallback to `<app_data>/handy-vault` if Documents is missing or unwritable. Documents folder is where users look for their files — app_data is invisible on Windows/macOS. User can still override via "Choose a folder…". |
| D16 | Re-entering onboarding | Settings toggle / dev-only / never | **Locked: Settings → Advanced → Reset onboarding.** Clears `onboarding_state`; next boot enters from step 1. Does NOT touch theme / vault / models — reset is about the guided flow, not user data. |
| D17 | CSS strategy during Phase B | All-inline / all concern-files / hybrid | **Locked: hybrid.** Phase B introduces the first concern-file (`src/styles/entry.css`) per Rule 18 for panel geometry + step-transition motion + segmented control. Inline `style={}` retained for dynamic state-driven values (Rule 18 §4). Establishes the pattern remaining phases follow. |
| D18 | Legacy onboarding retirement (surfaced mid-execution 2026-04-22) | Replace wholesale / coexist with new 6-step | **Locked: Path A — wholesale replacement.** Finding: `src/entry/EntryContext.tsx` was scaffolded but unused; `App.tsx` rolls its own duplicate state machine + renders a pre-rebuild 2-step onboarding (`AccessibilityOnboarding` + `Onboarding` model-picker driven by `checkOnboardingStatus`). Phase B retires that surface: strip `App.tsx`'s inline entry-stage machine (replace with `<EntryProvider>`), delete the two legacy onboarding components, retire the `show_onboarding` settings flag (D16 reset repurposes `onboarding_state` wipe). +1 day scope; prevents the two-state-machines-drift class of bug. Same mid-flight correction pattern as Phase A §15a point 3 (sidecar dual-mode). |
| D19 | User-picked vault path backend integration (surfaced commit 3 2026-04-22) | Wire during Phase B / defer to Phase I / drop the picker | **Locked: defer wiring to follow-up inside Phase B, keep the picker visible now.** Finding: `resolve_vault_root` in `src-tauri/src/app_identity.rs` computes its path from `app_data_dir + VAULT_DIR_NAME` and does not yet read from `user_preferences.vault_root`. The Vault step records the user's choice in `onboarding_state.vault_root` for audit, but the backend still boots the default on next launch. Picker copy is explicit about this ("custom locations land in a future release — your choice is saved so it applies automatically once the integration ships") so users aren't silently mislead. Follow-up commit adds the Rust read-modify (new `user_preferences` key, priority read inside `resolve_vault_root`, canonicalize + write-permission probe). Kept the step visible because (a) default users breeze through unchanged, (b) power users get a visible locked-in promise rather than a hidden one, (c) retro-fitting the copy is cheap when the backend catches up. |
| D20 | Whisper model size labels (surfaced commit 3 2026-04-22) | Hardcode PLAN's Tiny/Base/Small/Medium / follow the live registry | **Locked: follow the live registry.** PLAN.md blueprint listed `Tiny / Base / Small / Medium` as Whisper options; the actual `ModelInfo` registry exposes `small / medium / turbo / large` (plus `breeze-asr`, Parakeet, Moonshine, SenseVoice, GigaAM, Canary) — no tiny, no base. Models step filters `getAvailableModels()` by `engine_type === "Whisper"` + `category === "Transcription"`, showing whatever the registry offers with `is_recommended` as the default. Keeps the step correct across future registry churn; no frontend change needed when models are added or retired. Aligns with Phase A precedent of flagging mid-flight corrections concretely. |

---

## Status tracker

| Field | Value |
|---|---|
| Current phase | W4 — Database views (kickoff next) |
| In flight | W3 Hybrid search shipped 2026-04-25 (21 tasks; 27 new Vitest tests; 118 total; 23 new cargo lib tests; 186 total). Manual E2E walk-through (12 §11.3 scenarios) pending — browser automation unavailable in shipping session. Reranker first-download verification (logit tensor name + sha256 pinning) pending real-world boot. W7 (URL Media Import) shipping in parallel on the same branch. |
| Blockers | None. W3 surfaces (Cmd+K Spotlight + paginated SearchView) build and test green. |
| Last phase completed | W3 — Hybrid search: bge-reranker-v2-m3 stage-4 cross-encoder, LRU rerank cache, hybrid filters, SpotlightOverlay (Cmd+K), SearchView rewrite, safe `<mark>` snippet renderer (2026-04-25). |
| Reusable from pre-rebuild work | Sovereign Glass DNA port (complete), `AppShell` / `Titlebar` / `IconRail` / `AtmosphericStage` / `LoadingScreen` / `LemniscateOrb`, theme preset v2 schema migration |
| Review gate passed | 2026-04-22 critical review addressed; see REBUILD_RATIONALE.md §16 |

---

## Reference

- Rules + invariants: [CLAUDE.md](CLAUDE.md)
- Rebuild rationale + decisions: [REBUILD_RATIONALE.md](REBUILD_RATIONALE.md)
- Engineering pitfalls (evergreen): [pitfall.md](pitfall.md)
- Build + dev commands: [BUILD.md](BUILD.md), [CRUSH.md](CRUSH.md)
- Per-area architecture:
  - [docs/architecture/atmospheric-stack.md](docs/architecture/atmospheric-stack.md)
  - [docs/architecture/entry-experience.md](docs/architecture/entry-experience.md)
  - [docs/architecture/vault-database-storage.md](docs/architecture/vault-database-storage.md)
  - [docs/architecture/panel-system.md](docs/architecture/panel-system.md)
- HerOS port plan: [docs/superpowers/plans/2026-04-23-heros-frontend-port.md](docs/superpowers/plans/2026-04-23-heros-frontend-port.md)
- Legacy docs: [old/](old/) — retired planning history (includes the
  archived PROJECT_HANDOVER.md, historical only)
