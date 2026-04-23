# CLAUDE.md — Infield Implementation Guide

> **What this file is for**: stable rules, architecture invariants, token
> contracts, and decision logs that apply every session. Read it fully
> before writing any code.
>
> **What this file is NOT for**: current phase status, task lists,
> "what's next" — those live in [PLAN.md](PLAN.md) and drift fast.
>
> **Canonical companions:**
> - [PLAN.md](PLAN.md) — rebuild roadmap, per-phase blueprint, open decisions
> - [REBUILD_RATIONALE.md](REBUILD_RATIONALE.md) — discussion history, decisions, user stack + needs
> - [pitfall.md](pitfall.md) — evergreen engineering lessons
> - [docs/architecture/](docs/architecture/) — per-concern deep dives
>   (atmospheric stack, entry experience, vault-database storage, panel system)
> - [docs/superpowers/plans/2026-04-23-heros-frontend-port.md](docs/superpowers/plans/2026-04-23-heros-frontend-port.md) — active HerOS port plan
> - [old/](old/) — retired planning history (pre-rebuild context only,
>   including the archived PROJECT_HANDOVER.md)

---

## Rebuild in progress (2026-04-23 — HerOS port)

Infield is being re-frontended. The previous IRS-style "Sovereign Glass"
direction is **superseded by the HerOS / OS1 verbatim port** from
`copy/` (mirror at `C:\Users\howard\Downloads\Ai_script\IRS_Software\
third_party_selling_desktop\src\` — same source). The Rust backend is
**stable and untouched** by the port.

**Strategy:** port copy/'s frontend **100% verbatim** as cosmetic
shells, then wire Handy's existing backend (vault, workspace.db,
sqlite-vec, transcription, AI) into them in dedicated wiring phases.
Visual fidelity first; behaviour comes later.

**Phase pipeline (HerOS port):**
- **H1** — Token + CSS foundation (HerOS `:root` tokens in `src/App.css`,
  `.heros-*` classes in `src/styles/heros.css`, blob atmosphere in
  `src/styles/blobs.css`). Theme module deleted. ✅ Complete (2026-04-23).
- **H2** — Entry surfaces reskinned (LoadingScreen, LoginPage as Cmd+L
  lock, AtmosphericBackground, 4-step onboarding in HerOS style).
- **H3** — Shell chrome port (AppShell, TitleBar, IconRail, HerOS
  primitives `HerOSPanel` / `HerOSInput` / `HerOSButton` / `HerOSViewport`).
- **H4** — View skeletons + generic widgets ported verbatim. eBay-domain
  views (Inbox, Conversation, Inspector, Account, etc.) ported as
  dormant stubs gated behind `<EmptyState>`. Handy-feature-adjacent
  views (Notes, Databases, Audio, Search, Settings, Capture, Import,
  Dashboard, Activity, Security, About) ported as visual shells; their
  Handy backend wiring lives in H6.
- **H5** — Legacy deletion (`src/components/workspace/`, `database/`,
  `editor/`, `home/`, `chat/`, `search/`, `import/`, plus
  `TopBar.tsx` / `BottomBar.tsx` / `Sidebar.tsx`). Zustand stores
  deleted. CLAUDE.md + PLAN.md doc updates land.
- **H6** — Wiring phase: connect Handy backend (workspace tree, MDX
  editor, transcription, search, AI chat) to the cosmetic shells.

**What's already rebuilt and live (post-H1):**
- `src/App.css :root` — HerOS primitive tokens (`--heros-brand`,
  `--heros-bg-foundation`, `--heros-glass-fill`, etc.) declared
  statically; ~70 tokens total
- `src/styles/heros.css` — `.heros-shell`, `.heros-glass-panel`,
  `.heros-btn*`, `.heros-input-wrapper`, etc. (verbatim from copy/)
- `src/styles/blobs.css` — `.blob-container` + `.blob-cluster-{a,b,c}`
  + `@keyframes blob-cl-{1,2,3}` (verbatim from copy/)
- `src-tauri/src/managers/embedding_ort.rs` — ORT worker thread
  (Rule 16) + sentinel (Rule 16a) + Rule 19 reindex check
- `src-tauri/src/managers/embedding_worker.rs` — queue-driven drain
  against `embed_backfill_queue`
- `src-tauri/src/app_identity.rs` `VaultLock` — Rule 15 / D11
- sqlite-vec migration: `vec_embeddings` + `embedding_model_info` +
  `embed_backfill_queue`
- bge-small-en-v1.5 `MultiFile` entry in `ModelInfo` registry

**What's retired or scheduled for retirement:**
- `usearch` + `handy-embedding-sidecar` → sqlite-vec (Phase A, done)
- `src/theme/` module — deleted in H1 (no runtime theme switching)
- `src/components/workspace/`, `database/`, `editor/`, `home/`,
  `chat/`, `search/`, `import/` + `TopBar.tsx` / `BottomBar.tsx` /
  `Sidebar.tsx` — H5 deletion after H4 dormant port stable
- `src/stores/` — H5 deletion after store consumers replaced by
  `currentPage` + `VaultContext` pattern
- Tailwind import + `@theme {}` block — already removed in H1

See [PLAN.md](PLAN.md) for the active phase status and
[docs/superpowers/plans/2026-04-23-heros-frontend-port.md](docs/superpowers/plans/2026-04-23-heros-frontend-port.md)
for the H1-H6 plan detail.

---

## Core Vision & Architecture Invariants

Five invariants run through every design decision. If a proposed change
breaks one, stop and raise it.

1. **The vault is the source of truth.** `<app_data>/handy-vault/` is a
   tree of `.md` files with YAML frontmatter. SQLite (`workspace.db`) is
   a derived index: FTS5, vector embeddings, tree parent/position,
   wikilink edges. Every create/update/move/delete writes both in one
   pipeline.
2. **Never lose user data silently.** Every write path checks "did the
   file change on disk since we last read it?" before overwriting. On
   conflict, ask the user — never auto-resolve by clobbering.
3. **One ported visual language controls every pixel.** All visual
   treatments come from `copy/`'s ported `.heros-*` / `.blob-*` CSS
   classes (in `src/styles/heros.css` + `src/styles/blobs.css`) and
   `--heros-*` tokens (in `src/App.css :root`). **Vanilla CSS over
   inline styles** where copy/ uses className — preserves the precise
   design copy/ achieved. No Tailwind, no CSS-in-JS, no runtime theme
   switching. New visual primitives must be ported from copy/ before
   being authored from scratch (see HerOS Design System section below).
4. **AI is native, not bolted on.** Hybrid FTS + vector + wikilinks +
   voice-memo capture all flow through the same pipeline. AI writes go
   through the same `update_node` path as human writes — no hidden "AI
   state" in SQLite only. Note: AI chat UI lands in H6 wiring; the
   cosmetic shell ports in H4 with `<EmptyState>` until then.
5. **Frontend ports verbatim, then wires.** Surfaces are ported visually
   identical to `copy/` first; backend wiring follows in dedicated
   phases (H6). During the cosmetic-port window (H4-H6), `<EmptyState>`
   is the universal fallback for unwired actions. Never half-port
   (visual + partial wiring) — full visual or full wiring per surface.
   The Rust backend is fully working; this is a presentation-layer
   migration only.

---

## Definition of Done

A task is complete when ALL of these are true:

1. `bun run build` has zero new errors
2. `bunx vitest run` + `cargo test --lib` green. Exact count shifts
   as phases retire code; the invariant is "no regressions in live
   code" + "new components land with critical-path coverage". Post
   Phase A: 125 lib tests passing.
3. The feature works end-to-end in `bun run tauri dev`. Vite-only
   preview (`bun run dev`) cannot boot this app: `invoke()` is
   undefined in the browser. **Carve-out for cosmetic-port phase
   (H4-H6):** dormant cosmetic surfaces are exempt as long as they
   boot, render, and surface `<EmptyState>` for unwired actions.
   Full end-to-end behaviour is required *for the wired surfaces of
   the current phase*. The carve-out lifts when H6 wires the surface
   to the Handy backend.
4. No hardcoded color / radius / shadow / spacing literal in new code —
   only `var(--token)`. (Rule 12) Exception: verbatim ports from copy/
   preserve copy/'s authored values; do not aggressively re-tokenize
   without re-comparing to copy/.
5. Every new component lives in flat `src/components/` (NOT nested
   `src/components/workspace/*`) — copy/ uses flat layout.
6. All styles go through `src/styles/*.css` concern files (vanilla CSS,
   class-driven per Invariant #3) plus inline `style={{}}` for dynamic
   state-driven values; no Tailwind, no CSS Modules, no CSS-in-JS.
7. New SQLite tables go in a migration file, never ad-hoc.
8. Every vault write path passes the conflict guard. (Rule 13)
9. No new filesystem watcher on the vault. (Rule 14)
10. Performance targets at the bottom of this doc are not regressed.

---

## Architecture Rules

### Rule 2 — Navigation via `currentPage` + Context, no Zustand

Navigation flows through copy/'s `currentPage` state pattern (lifted in
`AppShell`) plus a `VaultContext` adapter for cross-surface state. **No
new Zustand stores.** The previous workspaceStore-based contracts
(granular selectors, `navigateTo`, optimistic-UI through store
mutation) are superseded by Context state lifted in `AppShell`.

```typescript
// AppShell holds the active page
const [currentPage, setCurrentPage] = useState<PageId>('home')
// child surfaces navigate by calling the setter
<IconRail currentPage={currentPage} onNavigate={setCurrentPage} />
// page-scoped state reads from VaultContext
const { vaultData, lock, unlock } = useVault()
```

The Handy workspace (tree of nodes + MDX editor) lives **under the
`'notes'` page**. `NotesView` is the container shell (ported verbatim
from `copy/src/components/NotesView.tsx`); the workspace tree + MDX
editor render inside it once H6 wiring lands. Until then, NotesView
shows copy/'s authored EmptyState.

Rule 4 (granular Zustand selectors), Rule 5 (optimistic UI through
workspaceStore), and Rule 6 (Bridge adapter via invoke) from the IRS
era are deleted — they governed a system that exits in H5.

### Rule 8 — Cell inputs must be controlled, never defaultValue

```typescript
<input defaultValue={cell.value} onChange={...} />   // wrong — stale after re-render
<input value={cell.value ?? ''} onChange={...} />    // correct
```

### Rule 9 — Voice memo transcription writes to workspace.db + vault only

Voice-memo auto-notes live as workspace documents under the **Mic
Transcribe** folder. Each capture appends a `::voice_memo_recording{...}`
directive + transcript to the daily child doc.

**Daily title is ISO format:** `"Voice Memos — YYYY-MM-DD"`.

- Session pointer: `VoiceSessionManager.get/set_workspace_doc_id()` —
  workspace node id only
- Daily lookup: children of the Mic Transcribe folder whose `name ==
  today_title` and `deleted_at IS NULL`
- Mirror props: `{"voice_memo_mirror":{"note_id": <self-ref ws id>,
  "recorded_at_ms": <ms>, "audio_file_path": <str|null>}}`
- Never dual-write to `notes.db` on the voice-memo path

### Rule 10 — Body is raw markdown, not JSON document trees

```typescript
<MDXEditorView markdown={node.body ?? ''} onChange={handleSave} />   // correct
const body = JSON.stringify([{ type: "paragraph", content: text }])  // wrong
```

`workspace_nodes.body` stores raw markdown strings. New nodes default to
`body = ''`. Never `'[]'`.

### Rule 11 — No separate folder node type

There is no `node_type = "folder"`. A document with ≥1 non-deleted child
**is** the folder. Tree renders a caret when children exist; opening the
doc shows its MDX body + an auto-rendered "Children" section. Never add
`"folder"` to `node_type` — it would fork tree, navigation, and vault
logic.

### Rule 12 — Tokens only; never hardcoded literals

**No literal colors, radii, shadows, or spacing values in any file
under `src/`.** All visual values come from CSS custom properties
declared in `src/App.css :root`.

```typescript
// Wrong — every one of these defeats the design system
<div style={{ background: '#1a1b21', borderRadius: 14, boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>

// Correct
<div style={{
  background: 'var(--surface-container)',
  borderRadius: 'var(--radius-container)',
  boxShadow: 'var(--shadow-sm)',
}}>
```

All tokens are declared statically in `src/App.css :root` (HerOS
primitives + Handy-native extensions). There is no runtime theme
switching, no preset system, no `tokens.ts`/`presets.ts` file.

**Verbatim-port carve-out:** when porting a class from `copy/src/app.css`
into `src/styles/heros.css` or `blobs.css`, preserve copy/'s authored
literal values verbatim. Aggressive tokenization risks visual drift from
copy/. Tokenize only when the literal is identical to a defined token
*and* the design intent matches.

**Radius hierarchy:**
- `var(--radius-lg)` — big panels (titlebar, tree sidebar, stage, chrome popovers)
- `var(--radius-container)` — smaller controls (rail buttons, profile avatar, tab pills)
- `var(--compact-button-radius)` / `var(--chip-radius)` / `var(--segmented-radius)` — specialized

### Rule 13 — Every vault write must pass the conflict guard

Before `write_node_to_vault` overwrites an existing file:

```rust
let on_disk_mtime = fs::metadata(&abs_path).ok().and_then(|m| m.modified().ok());
if let (Some(disk), Some(last_seen)) = (on_disk_mtime, node.last_read_mtime) {
    if disk > last_seen + Duration::from_secs(1) {
        return Err(VaultWriteError::ExternalEditConflict {
            node_id: node.id.clone(),
            disk_mtime: disk,
            last_seen,
        });
    }
}
// proceed: temp file → rename
```

When frontend receives `ExternalEditConflict`:
1. Autosave is **paused** for that node
2. User sees an **inline banner** (not modal): **"This file changed on
   disk. Reload / Keep mine / Open diff"** (banner design lands in H6
   wiring of NotesView)
3. Reload: `get_node` force re-read, push new body to editor
4. Keep mine: set `node.last_read_mtime = disk_mtime`, retry write once
5. Diff: side-by-side merge (v2 feature; v1 = reload/keep only)

`node.last_read_mtime` tracked in memory per open editor session. Every
autosave passes it back to Rust.

**Never auto-merge. Never silently overwrite.**

### Rule 13a — Vault path normalization (applies on every slug compare)

When computing or comparing vault-relative paths:

- **Unicode normalize to NFC** before any compare. macOS HFS/APFS
  delivers NFD; Linux stores whatever was written. Same visible
  filename, different bytes → two nodes.
- **Case-insensitive compare** for collision detection on macOS /
  Windows default filesystems. "Foo.md" and "foo.md" must collide.
  Use `to_lowercase()` or ICU folding, not raw string `==`.
- **Ignore** hidden files (`.DS_Store`, `.git/**`, `Thumbs.db`,
  `desktop.ini`, `*.icloud`, `*.tmp`, `* (conflict *).md`,
  `*.conflicted.md`) in boot scan and `list_children`.
- **Network drive / cloud-sync mtime**: `+1s` buffer in Rule 13 is too
  tight for iCloud / OneDrive / Dropbox (which can lag by 2-5s). Bump
  to `+3s` when vault path matches known cloud-sync patterns, or make
  configurable via `user_preferences` key `vault.mtime_grace_ms`.

### Rule 14 — No filesystem watcher on the vault

Watchers introduce rename-as-delete+create, cloud-sync placeholder, batch
flood, and re-entry risks without solving the real UX problem (Rule 13
solves that correctly).

Replacement surface:
- **On navigation:** `get_node` mtime check (`file_mtime > updated_at + 1s`;
  `+3s` when vault path matches a cloud-sync pattern per Rule 13a)
- **On window focus:** `workspace:window-focused` event → frontend
  re-invokes `get_node(activeNodeId)` → non-blocking "Refreshed from
  disk" toast if body changed
- **On boot:** fast `stat`-only scan; mark `vault_dirty` in-memory for
  rows with `mtime > updated_at + 1s`
- **On write:** Rule 13 conflict guard

**Toast suppression — cloud-sync materialization.** iCloud / OneDrive /
Dropbox materialize placeholder files asynchronously: the app sees a
zero-byte file at boot, then a few seconds later the real content
arrives. Rule 14's focus / navigation refetch will fire the "Refreshed
from disk" toast every time this happens — training users to ignore
it. Suppress the toast when:
- Previous `file.len()` was `0` and new `file.len() > 0` (first-time
  materialization), OR
- Only YAML frontmatter changed (no body diff)

In both cases apply the refresh silently. Log to console.debug for
devs; no user-facing toast.

### Rule 15 — Single-process vault lock

Two Handy instances on the same vault corrupts `workspace_fts` and
`vec_embeddings` (sqlite-vec virtual tables are NOT cross-process
safe even with WAL). Required:

- On startup, acquire an exclusive OS file lock on `<vault>/.handy.lock`
  via `fs2::FileExt::try_lock_exclusive`
- On failure: show a native dialog "Infield is already running for
  this vault" and exit cleanly
- On clean shutdown: release the lock
- On crash: OS releases the lock automatically

The `.handy.lock` file is zero-byte; the lock is advisory on Linux,
mandatory on Windows, advisory on macOS — all sufficient for our
single-user case.

**Implemented:** `VaultLock::acquire` at `src-tauri/src/app_identity.rs`,
wired before any `Connection::open` at `lib.rs` init. Failure shows an
`rfd` native dialog and exits 0 per D11.

### Rule 16 — Native model inference must isolate crashes

Any Rust code that calls into native ML libraries (Candle, ONNX
Runtime, whisper-rs, etc.) MUST:

- Run on a **dedicated `std::thread::spawn` worker**, not a tokio task.
  `catch_unwind` does not cross `no_mangle` FFI boundaries reliably;
  a native panic in a tokio task can poison the executor.
- Communicate via `crossbeam_channel::bounded` — bounded so
  back-pressure is visible, not unbounded
- Implement **sentinel + restart-once**: main thread monitors worker
  health via heartbeat; on death, respawn exactly once, then on
  second death mark the feature `unavailable` and fall back
- Never block the main UI thread on model inference — always async
  via the channel

**Implemented:** `managers::embedding_ort::InferenceHandle` owns a
dedicated `std::thread::spawn` worker + `crossbeam_channel::bounded(16)`
+ `tokio::sync::oneshot` response. Sentinel thread respawns once on
heartbeat stale (30s threshold); second death flips
`vector_search_available = false` and emits
`vector-search-unavailable` event.

### Rule 16a — Multi-session ORT concurrency

When two or more ONNX Runtime sessions can run concurrently (e.g.
transcription via Parakeet / Moonshine / SenseVoice / GigaAM / Canary
alongside embedding via bge-small), they share CPU threads, GPU
command queues, and potentially thread pools. Without mitigation,
a latency-sensitive session (transcription) can be starved by a
background session (embedding) submitting concurrent work.

Required when adding a new ORT session alongside an existing one:

1. **Cap intra-op threads per session** — call
   `ort::SessionBuilder::with_intra_threads(num_cpus::get() / N)`
   where N = number of concurrent ORT sessions expected at peak.
   Prevents OS-level thread oversubscription.

2. **Quiesce background sessions during interactive ones.** If there's
   a user-facing latency-sensitive workload (mic recording,
   live-transcription stream), background workloads (embedding queue,
   summarization, etc.) poll a "is interactive work active?" helper
   and sleep/retry rather than competing. Existing helper:
   `transcription_session_holds_model(app)` in
   `managers/transcription.rs` — add similar gates for future
   interactive sessions.

3. **GPU assignment: one session per GPU at a time.** DirectML /
   CoreML command queues serialize concurrent GPU work. Reserve the
   GPU for the latency-sensitive session; run background sessions on
   CPU. Small models (bge-small at 133MB) run CPU-comfortably; keep
   GPU for the large/slow inference paths.

4. **Independent `Session` instances per logical model.** Never share
   an `ort::Session` across threads — each session's internal state
   is not thread-safe for `session.run()`. The OS-thread worker per
   model pattern from Rule 16 enforces this; don't work around it.

Rule 16 (dedicated OS thread + sentinel + restart-once) still applies
to each individual ORT session. 16a is about the *interaction* between
sessions, 16 is about the *safety* of each session.

### Rule 17 — Native extensions ship per-platform, not via cargo

sqlite-vec, whisper, any other native extension loaded at runtime
(not statically linked) MUST:

- Live under `src-tauri/resources/<extension-name>/` in source
- Be listed in `src-tauri/tauri.conf.json` under `bundle.resources`
- Have **platform-specific files**: `.dll` (Windows), `.dylib`
  (macOS), `.so` (Linux) — never commit one platform's binary and
  assume others will work
- Resolve path at runtime via Tauri `ResourceResolver` in production
  and a relative path in dev — keep both code paths tested
- **macOS: ad-hoc codesign required** or `dlopen` fails under
  Gatekeeper. Add to release workflow.
- **Windows: consider EV codesigning** to avoid SmartScreen — not
  required for v1 but expected by enterprise users

### Rule 18 — CSS hygiene (vanilla-CSS discipline)

The project uses **vanilla CSS** — class-driven per Invariant #3, not
CSS Modules, not Tailwind, not CSS-in-JS. Vanilla CSS is fast, readable,
matches copy/'s authored convention, and gives precise design control.
But it needs discipline to avoid the 2,600-line monolith + dead-CSS
problem.

**Rules for every CSS file going forward:**

1. **Component prefix on every class name.**
   - `.heros-shell`, `.heros-glass-panel`, `.heros-btn`, `.heros-input-wrapper`
   - `.blob-container`, `.blob-cluster-a/b/c`
   - `.tree-row`, `.tree-row__icon`, `.tree-row--active` (BEM for modifiers — for Handy-extension classes)
   - No bare names — never `.button`, `.container`, `.panel`. Always
     prefixed. Prevents global namespace collisions in the flat
     `src/components/` tree.

2. **Every numeric value through a token.** No raw `px`, `rem`, hex
   colors, box-shadow literals, or radius values in CSS or inline
   `style={{}}`. Use `var(--space-N)`, `var(--radius-N)`,
   `var(--text-N)`, `var(--surface-*)`, etc. (Rule 12 covers colors;
   this rule extends it to every dimension.) **Verbatim-port
   carve-out** (per Rule 12) applies here too.

3. **CSS file structure — concern-based, not component-based.**
   - Root: `src/App.css` — `:root` token block + concern-file imports
     + animation keyframes referenced by inline styles
   - `src/styles/heros.css` — verbatim port of copy/'s `.heros-*` classes
   - `src/styles/blobs.css` — verbatim port of copy/'s blob atmosphere
   - `src/styles/entry.css` — onboarding / loading / login concern file
   - Future concern files added as new pages land (e.g.
     `src/styles/notes.css`, `src/styles/databases.css`) when they
     accumulate enough class definitions to warrant splitting.
   - **No concern-file grows past ~500 lines.** If it does, split
     further (e.g. `databases-grid.css` + `databases-board.css`).

4. **Layout + structure in CSS. State + dynamic values inline.**
   - Static: `.heros-glass-panel { padding: 48px 40px; }`
   - Dynamic: `style={{ background: isActive ? 'var(--heros-brand)' : 'transparent' }}`
   - Don't mix the two at the same layer — readers should know where to
     look for "why is this 12px?"

5. **No `!important` without a one-line comment** explaining the
   overridden rule. If you can't explain, don't use it.

6. **Dead-CSS audit policy.**
   - Don't purge piecemeal during the rebuild — H5 deletes whole
     component trees, their CSS goes with them
   - After H6: one dedicated audit pass. Run a coverage tool
     (e.g. `css-stats`, `purgecss --reporter`) in a long production
     session, cross-reference dynamic class strings + third-party
     renderers, delete with grep-verify
   - Ongoing: quarterly audit + ESLint rule flagging hardcoded
     pixel/color literals in `.tsx` / `.css` files

7. **File split strategy.**
   - During H2-H5: new styles go straight into the right concern file
     (create the concern file if it doesn't exist yet)
   - Don't let `App.css` grow past ~600 lines of imports + tokens +
     animation keyframes
   - H6 includes a final "verify concern boundaries" pass

### Rule 19 — Model-version guard on persisted ML outputs

Any persisted artefact derived from an ML model (embeddings, audio
transcription timestamps, voice-memo summaries) MUST record the model's
identity alongside the data. On every boot, compare the recorded model
identity against the compiled-in one; mismatch triggers regeneration,
never silent reuse.

Current embedding artefacts use the `embedding_model_info` table:

```sql
CREATE TABLE IF NOT EXISTS embedding_model_info (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  model_id TEXT NOT NULL,    -- e.g. "bge-small-en-v1.5"
  dimension INTEGER NOT NULL,
  model_hash TEXT NOT NULL   -- sha256 of the model weights file
                             -- (`model.onnx` today; format-agnostic)
);
```

On boot:
- If `model_id` or `dimension` mismatch compiled-in values →
  `DELETE FROM vec_embeddings` (keep the table), mark every node in
  `embed_backfill_queue` as `'pending'`, show a one-time banner
  "Reindexing after model change — search quality reduced," continue.
- If `model_hash` mismatch but `model_id` + `dimension` match → a
  minor model revision. Log warning; do NOT auto-reindex (expensive
  false positive when HF republishes the same logical model with a
  rebuilt safetensor blob). Require explicit user action in
  Settings → Advanced to force rebuild.

Apply the same pattern to future persisted ML outputs (Whisper segment
timestamps, summarization caches). Storing a model ID alongside the
output prevents the "silently writing 768d vectors into a 384d column"
failure mode, and prevents feeding users stale summaries generated by a
model that's been swapped out underneath them.

**Implemented:** `managers::embedding_ort::rule_19_reindex_check`. Uses
an mtime-keyed sha256 side-file (`model.onnx.sha256`) to avoid the
600-900ms recompute cost on every boot. Surface outcomes:
`FirstInstall` / `UnchangedModel` / `OrphanVectorsRequeued` (no prior
identity row but vec_embeddings had rows) / `ModelSwapped`.

---

## Cosmetic-Port Discipline (H4-H6)

The HerOS port lands as **dormant cosmetic shells first**, then wires
during H6. This window has its own discipline because the app
intentionally boots into a state where many actions don't yet do
anything — that's by design, not a bug.

**copy/ ships designs ready to port for these pages:**
HomePage / DashboardView · NotesView · DatabasesView · AudioView ·
SearchView · SettingsView · CaptureView · ImportView · ActivityView ·
SecurityView · AboutView · InboxView (eBay-only, dormant) · ConversationList
(eBay-only, dormant) · ThreadWorkspace (eBay-only, dormant) ·
InspectorPanel (eBay-only, dormant) · AccountSidebar (eBay-only, dormant) ·
SortableAccountItem (eBay-only, dormant) · VaultSidebar (eBay-only,
dormant) · EbayConnectModal (eBay-only, dormant).

**Discipline rules:**

1. **Port verbatim.** Keep copy/'s JSX structure, className strings,
   inline styles, and component composition identical. Do not refactor
   for "Handy idioms" during the port — refactor passes happen post-H6
   when the wiring tells you what's actually used.

2. **Gate behaviour, not visuals.** Wrap unwired actions:
   ```typescript
   const handleSomething = async () => {
     try {
       await invoke('some_handy_command', { ... })
     } catch (err) {
       // command not yet wired, surface friendly fallback
       toast.error('This feature is being wired up. Check back in H6.')
     }
   }
   ```
   Or for whole pages:
   ```typescript
   if (!vaultData?.[whatTheViewExpects]) {
     return <EmptyState title="..." description="..." />
   }
   ```

3. **No new Tauri commands during the cosmetic port.** Per D-H3, eBay
   commands referenced by `copy/src/tauri-bridge.ts` are NOT registered
   in `src-tauri/src/lib.rs`. Calling an unregistered command throws a
   clear runtime error — that's the correct dormant behaviour. Wrap
   in try/catch + EmptyState fallback per #2.

4. **Document each unwired surface in PLAN.md** so the H6 wiring phase
   has a complete checklist. Format: `[ ] NotesView body editor →
   wire to MDXEditor + workspace_nodes.body autosave`.

5. **Visual fidelity is the only success metric for H4.** If a HerOS
   page renders pixel-identical to copy/ on a fresh `bun run tauri dev`
   boot, the port succeeded — even if every button does nothing. H6
   makes the buttons do things.

---

## HerOS Design System

Every page in Infield uses the same shared visual primitives ported
from `copy/src/components/HerOS.tsx` and `copy/src/app.css`.
Consistency is enforced by **using these primitives** rather than
rebuilding similar surfaces ad hoc on each new page.

### Primitives (port from `copy/src/components/HerOS.tsx` in H3)

- `<HerOSPanel>` — main container card (glass background, rim light,
  padding). Use for **every content card** across every page.
- `<HerOSInput>` — carved/recessed text input. Use for **every text
  input** across every page (search bars, login fields, settings
  inputs, form fields).
- `<HerOSButton>` — floating-light pill button. Variants: default,
  brand (terracotta), danger.
- `<HerOSViewport>` — page wrapper providing the atmospheric
  background + content area. Wraps every page-level component.

### CSS classes (in `src/styles/heros.css` after H1)

- `.heros-shell` — top-level page shell
- `.heros-page-container` — scrollable content frame with consistent padding
- `.heros-glass-panel` / `.heros-glass-card` — **unified content cards**
  (single source of truth for card styling across all pages)
- `.heros-glass-bubble` / `.heros-glass-bubble-me` — message bubbles
  (chat surfaces, notification rows)
- `.heros-btn` / `.heros-btn-brand` / `.heros-btn-danger` — button base
  + variants
- `.heros-input-wrapper` — input wrapper with carved style
- `.heros-shadow` — standard floating shadow
- `.heros-glow-amber` — backlight halo for highlight surfaces
- `.heros-icon-animate-focus` / `.heros-icon-animate-hover` — icon
  motion utilities
- `.login-mode` — body modifier that shifts blob saturation + brightness
  for the lock surface

### Atmosphere (in `src/styles/blobs.css` after H1)

- `.blob-container` + `.blob-cluster-a/b/c` — three-cluster kinetic
  background (orange / red / bright orange radial gradients with
  9-14s drift animations)
- `--heros-bg-foundation` (`#0a0b0f`) — deep charcoal foundation
  underneath the blobs

### Cross-page consistency rules

1. **Content cards must use `.heros-glass-panel` / `<HerOSPanel>`** —
   never roll a custom card. If a page needs a card variant, add it to
   `heros.css` with a `.heros-glass-panel--variant` modifier (BEM) so
   every page can pick it up.

2. **Spacing between sections uses `var(--space-N)`** — never raw pixel
   values. Cards: `--space-4` (16px) gap typical; section spacing:
   `--space-6` (24px); page-level padding: `--space-8` (32px).

3. **Page boundaries use `.heros-page-container`** for consistent
   scroll behaviour, padding, and color application. Wrapping every
   page in this class guarantees identical scroll affordance and
   readable text color.

4. **Readability overlays for text on glass:**
   - `var(--heros-text-shadow)` — already baked into `.heros-glass-panel`;
     do not redefine
   - `.heros-glow-amber` — apply on highlight surfaces (active card,
     focused notification) to lift contrast against the kinetic blob field
   - Avoid solid backgrounds that defeat the glass aesthetic — if text
     truly needs an opaque substrate, use `var(--heros-glass-black)` (an
     82%-opacity charcoal that preserves visual continuity)

5. **No new visual primitives without checking copy/ first.** If
   copy/ has it (`copy/src/components/` or `copy/src/app.css`), port
   it. If copy/ doesn't, design with the existing primitives before
   introducing new ones. New primitives go through review and land
   in `src/components/HerOS.tsx` (TypeScript) or `src/styles/heros.css`
   (vanilla CSS).

Full kit reference: `copy/src/components/HerOS.tsx` and
`copy/src/app.css`.

---

## Search Stack

After Phase A, search unifies behind `sqlite-vec`:

| Component | Location | Role |
|---|---|---|
| `sqlite-vec` | SQLite extension | Vector similarity via `vec0` virtual tables |
| `workspace_fts` | `workspace_manager.rs` | FTS5 for title + body |
| `vec_embeddings` | new virtual table | Vector index, joined to FTS via SQL |
| `EmbeddingWorker` | `managers/embedding_worker.rs` | Background embed pipeline — reuse |
| `SearchManager` | `managers/search.rs` | Hybrid FTS + vector via one SQL RRF |

Extension rules:
1. Keep `workspace_fts` migrations + triggers aligned with `WorkspaceManager` sync paths
2. Feed new write paths into `EmbeddingWorker.enqueue_index()` where not already
3. Extend via `SearchManager` — never use `LIKE '%query%'` for user search

Eligible nodes for both indexes:
- `node_type = 'document'` or `'row'` → index title + body
- `node_type = 'database'` → index title only (body = `''`)
- `deleted_at IS NOT NULL` → exclude

---

## SQLite Performance

WAL mode on first connection is critical.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size   = -32000;    -- 32 MB
PRAGMA temp_store   = MEMORY;
```

**Tree loading — one flat query, build in JS:**

```sql
SELECT id, name, node_type, parent_id, position, icon, deleted_at
FROM   workspace_nodes
WHERE  deleted_at IS NULL
ORDER  BY parent_id, position;
```

**Body is lazy — never load MDX during tree init.**

---

## Position / Ordering — Fractional Indexing

```
New item:            position = max_sibling_position + 1.0
Drop between A, B:   position = (A + B) / 2.0
Gap < 1e-9:          rebalance siblings to evenly spaced integers
```

Both `workspace_nodes.position` and `node_views.position` are `REAL`
(f64). Sequential integers would require O(n) updates on reorder.

---

## Vault File Lifecycle

All file I/O lives in `src-tauri/src/commands/workspace_nodes.rs` and
`managers/workspace/workspace_manager.rs`; vault root resolved via
`resolve_vault_root()` in `app_identity.rs`.

| Event | Vault file action |
|---|---|
| `create_node` (document) | Write `.md`; save path to `vault_rel_path` |
| `update_node` (rename / body) | Write new `.md`; delete old file if slug path changed |
| `move_node` | Write at new slug; delete old if path changed |
| `soft_delete_node` | **No change** — file stays; recoverable from trash |
| `permanent_delete_node` | Delete vault file(s) |
| `empty_trash` | Delete vault files for all permanent-removed nodes |
| External edit (app closed) | Caught by `get_node` mtime check on navigation |
| External edit (app open, doc open) | Rule 13 conflict guard fires on next autosave |

**Path computation:** `compute_vault_rel_path` walks ancestor chain,
builds `parent-slug/child-slug.md`. Collision on exact slug appends
first 8 chars of UUID.

**Atomic write:** write `name.md.tmp` → `fs::rename`. On Windows
<10.1709, `fs::rename` is NOT atomic when target exists — future work
uses `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`.

**Cloud-sync defensiveness:**
- Ignore files named `*.icloud`, `*.tmp`, `* (conflict *).md`, `*.conflicted.md`
- Never read a file with `len() == 0` if DB body is non-empty
- Surface conflict-copy files in a "Vault issues" panel; do not auto-import

**Autosave:** 300ms debounce after last keystroke. Respects Rule 13.

---

## Vault Database Storage

Databases serialize as `databases/<slug>/database.md` (schema + default
view in YAML frontmatter) + `databases/<slug>/rows/<id>.md` per row +
`databases/<slug>/views/<name>.view.json` per extra view.

**Markdown pipe tables (`| col |`) are banned as storage.**

Full contract: [docs/architecture/vault-database-storage.md](docs/architecture/vault-database-storage.md).

Key invariants:
- Row files MUST declare `id` + `database_id` in frontmatter
- `database.md` `fields:` array IDs are permanent
- Wikilinks into rows use `node://<row-uuid>`; relation cells use
  `[[databases/<db-slug>/rows/<target-slug>]]`

---

## Wikilinks

Stored as `[display title](node://uuid)` in MDX.

**`[[` autocomplete:** intercept in editor, floating overlay near caret,
query `searchNodes` (title only, 150ms debounce). On select: replace
`[[...` with `[title](node://uuid)`.

**`node://` click — mandatory:** custom MDX link renderer catches every
`node://` href. Call the active page setter (Rule 2) with a route to
`'notes'` + node id payload; never let browser handle it.

**Rename propagation:** rename is optimistic / instant. Source-page
display-text updates are background async. Progress indicator only when
> 50 source pages affected.

**page_links sync on save:** delete all rows where `source_node_id =
currentNodeId`, insert links extracted from saved MDX body. Always
replace, never diff.

---

## Tauri Command Conventions

- snake_case: `get_node`, `update_node`, `search_workspace_hybrid`
- Return type: `Result<T, String>`
- New commands: add to relevant file in `src-tauri/src/commands/`
- Register in `src-tauri/src/lib.rs` inside
  `.invoke_handler(tauri::generate_handler![...])`
- **Cosmetic-port note (D-H3):** eBay commands referenced by
  `copy/src/tauri-bridge.ts` are NOT registered. Calling them at
  runtime throws a clear error; wrap in try/catch + EmptyState
  fallback per Cosmetic-Port Discipline #2.

---

## Entry Experience (HerOS port direction)

Per D-H1 and D-H2:

**Boot flow:** `LoadingScreen → AppShell` (no boot password gate; the
vault is plain markdown, not encrypted at rest).

**Cmd/Ctrl+L lock surface:** copy/'s LoginPage UI is repurposed as the
lock overlay triggered by Cmd+L. Renders only when locked; auto-unlock
on first launch (no password ever set).

**Onboarding (4-step, only on first run):**
1. Mic permission
2. Accessibility permission (macOS only; auto-skipped elsewhere per D13)
3. Models download (bge-small + Whisper variant)
4. Vault location pick

Welcome and Theme picker steps are dropped (theme module deleted in H1;
welcome screen redundant once user is past first launch).

Full HerOS port plan:
[docs/superpowers/plans/2026-04-23-heros-frontend-port.md](docs/superpowers/plans/2026-04-23-heros-frontend-port.md).

---

## Files Never to Modify

| File | Why |
|---|---|
| `src/bindings.ts` | Auto-generated by specta — overwritten on next `bun run tauri dev` |
| `src/styles/heros.css` | Verbatim port from `copy/src/app.css`. Do not refactor or aggressively re-tokenize without re-comparing to copy/. |
| `src/styles/blobs.css` | Verbatim port from `copy/src/app.css`. Same constraint as `heros.css`. |
| `translation.json` `database.calendar.*` keys | Used by `CalendarToolbar` — renaming breaks calendar |

---

## Workspace DB Mutex Discipline

`WorkspaceManager` uses `tokio::sync::Mutex<Connection>`. Compiler will
NOT catch violations — `MutexGuard` is `Send`, so holding across
`.await` compiles silently and deadlocks.

Rules:
- Never hold `conn.lock().await` across another `.await`. Acquire, do
  synchronous work, drop the guard, then await.
- Never do CPU-heavy work inside the critical section.
- rusqlite calls are synchronous and block the tokio thread. Keep lock
  holds short.

---

## Deferred — Do Not Implement in v1

- Runtime theme switching, presets, or token sliders (theme module
  deleted in H1; design is now static HerOS via copy/'s tokens)
- Editing UI for `checklist` field type (render read-only)
- Wikilinks inside table rich-text cells
- File upload for page covers (preset gradients only)
- Multi-workspace / vault switching
- Multi-pane / split view
- Multi-device sync / CRDT
- Graph view visualization (data ready via `page_links`; UI deferred)
- Column resize + width persistence
- Database toolbar: Group by, Fields visibility toggle
- Vault encryption at rest

---

## Performance Targets

Do not regress without explicit sign-off.

| Metric | Target |
|---|---|
| Cold start (app interactive, post-LoadingScreen) | < 500ms |
| Warm start (last page visible) | < 150ms |
| Tree load (1,000 nodes) | < 100ms |
| Tree load (10,000 nodes) | < 400ms (windowed tree) |
| Quick open results returned | < 50ms |
| Page open (click to editor ready) | < 200ms |
| Autosave roundtrip (debounce → DB + vault written) | < 200ms for bodies ≤ 50KB |
| Table virtualisation threshold | 500 rows — use `@tanstack/react-virtual` |

---

## Keyboard Contracts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+K` | Quick open / spotlight |
| `Cmd+Shift+J` | Open today's daily note |
| `Cmd+N` | New root-level document |
| `Cmd/Ctrl+[` | Go back (active page history) — `Cmd+W` is macOS window-close, do not rebind |
| `Cmd/Ctrl+S` | Immediate save |
| `Cmd/Ctrl+L` | Lock app (HerOS lock overlay) |
| Tree: arrows | Navigate nodes |
| Tree: Enter | Open selected node |
| Tree: Delete | Soft-delete → trash |
| Table: Tab / Shift+Tab | Move between cells |
| Table: Enter | Start editing cell |
| Table: Escape | Stop editing |
| Table: Cmd+Enter | Open row page |

**Note:** `Cmd/Ctrl+,` was historically the theme editor binding; the
theme module was deleted in H1, so this binding is unbound. Cmd/Ctrl+L
triggers the HerOS lock overlay (lands in H2).

---

## Windows build troubleshooting (MAX_PATH)

Cargo generates deeply nested files. If cloning into a long path
triggers "Path too long":

1. **Recommended:** Enable Long Paths in Registry
   (`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`)
2. **Fallback:** Override cargo target-dir to a short path
   (`target-dir = "C:/ht"` under `[build]` in `.cargo/config.toml`).
   Never commit this override.
