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
>   (atmospheric stack, theme module, entry experience, vault-database storage, panel system)
> - [old/](old/) — retired planning history (pre-rebuild context only,
>   including the archived PROJECT_HANDOVER.md)

---

## Rebuild in progress (2026-04-22)

Infield is being rebuilt. The current frontend in `src/components/workspace/`,
`src/components/database/`, `src/components/editor/`, `src/components/home/`,
`src/components/search/`, `src/components/import/`, `src/components/Sidebar.tsx`,
`src/components/TopBar.tsx`, `src/components/BottomBar.tsx` is being
progressively replaced by a **flat, IRS-style frontend** under
`src/components/` (no deep subfolders) using vanilla CSS and `src/app.css`
for tokens.

**What's already rebuilt and live:**
- `src/shell/AppShell.tsx`, `Titlebar.tsx`, `IconRail.tsx`, `AtmosphericStage.tsx`, `WindowControls.tsx`
- `src/shell/primitives/` — Sovereign Glass DNA (atmospheric blobs, glass, grain, chip, compact button, etc.)
- `src/entry/LoadingScreen.tsx`, `LoginPage.tsx`, `LemniscateOrb.tsx` — entry surfaces (IRS-ported)
- `src/theme/` — token system, presets, schema-versioned persistence (SCHEMA_VERSION = 2)
- `src-tauri/src/managers/embedding_ort.rs` — InferenceHandle + ORT
  worker thread (Rule 16) + sentinel (Rule 16a) + Rule 19 reindex check
- `src-tauri/src/managers/embedding_worker.rs` — queue-driven drain
  against `embed_backfill_queue` (Phase A deliverables 4/5/10)
- `src-tauri/src/app_identity.rs` VaultLock — wired at lib.rs boot
  before any SQLite open (Rule 15 / D11)
- sqlite-vec migration: `vec_embeddings` + `embedding_model_info` +
  `embed_backfill_queue` (Phase A deliverable 4)
- bge-small-en-v1.5 `MultiFile` entry in `ModelInfo` registry with
  pinned sha256s (Phase A deliverable 6 / D1e)

**What's retired or will be retired:**
- `usearch` + `handy-embedding-sidecar` Rust binary → sqlite-vec in-DB vectors (Phase A)
- Old split shell (TopBar / BottomBar / Sidebar / WorkspaceShell / ChatWindow) — unreferenced, deletes in Phase I
- `src/components/workspace/` — replaced over Phases C-H

See [PLAN.md](PLAN.md) for the active phase and blueprint.

---

## Core Vision & Architecture Invariants

Four invariants run through every design decision. If a proposed change
breaks one, stop and raise it.

1. **The vault is the source of truth.** `<app_data>/handy-vault/` is a
   tree of `.md` files with YAML frontmatter. SQLite (`workspace.db`) is
   a derived index: FTS5, vector embeddings, tree parent/position,
   wikilink edges. Every create/update/move/delete writes both in one
   pipeline.
2. **Never lose user data silently.** Every write path checks "did the
   file change on disk since we last read it?" before overwriting. On
   conflict, ask the user — never auto-resolve by clobbering.
3. **One theme system controls every pixel.** Users change
   `--heros-brand` (or any other token) once and the entire UI updates.
   No hardcoded colors anywhere in `src/`.
4. **AI is native, not bolted on.** Hybrid FTS + vector + wikilinks +
   voice-memo capture all flow through the same pipeline. AI writes go
   through the same `update_node` path as human writes — no hidden "AI
   state" in SQLite only.

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
   undefined in the browser. Token emission / pure-CSS changes can be
   inspected via the Vite preview + `preview_inspect :root`.
4. No hardcoded color / radius / shadow / spacing literal in new code —
   only `var(--token)`. (Rule 12)
5. Every new component lives in flat `src/components/` (NOT nested
   `src/components/workspace/*`) — IRS-style organization.
6. All styles go through `src/app.css` tokens + inline styles; no new
   Tailwind usage.
7. No new component subscribes to the whole `workspaceStore` — must use
   selectors. (Rule 4)
8. New SQLite tables go in a migration file, never ad-hoc.
9. Every vault write path passes the conflict guard. (Rule 13)
10. No new filesystem watcher on the vault. (Rule 14)
11. Performance targets at the bottom of this doc are not regressed.
12. Theme editor still opens via `Cmd/Ctrl+,` after any mount-topology change.

---

## Architecture Rules

### Rule 2 — Navigation always through workspaceStore

```typescript
// ONLY correct way
workspaceStore.navigateTo(nodeId, { viewId?, source? })
workspaceStore.goBack()

// NEVER for workspace navigation
window.history.pushState(...)
window.history.back()
```

History stack lives in `workspaceStore`, capped at 100 entries.

### Rule 4 — Granular Zustand selectors, always

```typescript
const activeNodeId = useWorkspaceStore(s => s.activeNode?.id)   // correct
const store = useWorkspaceStore()                                // wrong — re-renders whole tree
```

### Rule 5 — Optimistic UI for all mutations

```typescript
useWorkspaceStore.setState({ ...optimisticChange })
try { await invoke('update_node', { ... }) }
catch {
  useWorkspaceStore.setState({ ...rollback })
  showErrorToast()
}
```

Required for: cell edits, checkbox toggles, row creation, node rename.

### Rule 6 — Bridge adapter uses invoke directly

```typescript
const node = await invoke<WorkspaceNode>('get_node', { id: databaseId })  // correct
await workspaceStore.loadNode(databaseId)                                 // wrong — pollutes activeNode
```

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

### Rule 12 — Theme tokens only; never hardcoded literals

**No literal colors, radii, shadows, or spacing values in any file under
`src/`.** All visual values come from CSS custom properties.

```typescript
// Wrong — every one of these defeats user theming
<div style={{ background: '#1a1b21', borderRadius: 14, boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>

// Correct
<div style={{
  background: 'var(--surface-container)',
  borderRadius: 'var(--radius-container)',
  boxShadow: 'var(--shadow-sm)',
}}>
```

Three-tier token system:
- **Primitive**: raw values (`--heros-brand: #cc4c2b`)
- **Semantic**: role-based (`--surface-container`, `--on-surface`, `--primary`)
- **Component**: derived (`--tree-row-hover-bg`) — via `color-mix()` from semantic

Components consume **semantic** and **component** tokens. Only the theme
module's `tokens.ts` / `presets.ts` reference primitives.

**Exception — canvas-rendered third-party widgets.** Libraries that
render to `<canvas>` (Glide Data Grid, Three.js materials, SVG filter
primitives) cannot consume `var(--token)` — they need concrete hex /
rgba strings at JS level. For these, use the `tokenBridge.ts` utility
(Phase E deliverable): read computed semantic tokens via
`getComputedStyle(document.documentElement)` on mount, re-read on
theme-change event, pass resolved strings into the widget's `theme`
prop. Still no literals in the bridge's *input* — only the output is a
concrete string. This preserves Rule 12's intent (user theming flows
through everything) while acknowledging the API constraint.

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
   disk. Reload / Keep mine / Open diff"** (banner design lands Phase D)
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

The project uses **vanilla CSS**, not CSS Modules, not Tailwind (legacy
Tailwind usage in `src/components/database/` is retiring in Phase E).
Vanilla CSS is fast, readable, and matches the user's IRS workflow — but
it needs discipline to avoid the 2,600-line monolith + dead-CSS problem.

**Rules for every CSS file going forward:**

1. **Component prefix on every class name.**
   - `.tree-row`, `.tree-row__icon`, `.tree-row--active` (BEM for modifiers)
   - `.shell-titlebar`, `.shell-rail`, `.database-grid`, `.editor-body`
   - No bare names — never `.button`, `.container`, `.panel`. Always
     prefixed (`.heros-btn`, `.home-container`, `.glass-panel`).
   - Prevents global namespace collisions across the flat
     `src/components/` tree.

2. **Every numeric value through a token.** No raw `px`, `rem`, hex
   colors, box-shadow literals, or radius values in CSS or inline
   `style={{}}`. Use `var(--space-N)`, `var(--radius-N)`,
   `var(--text-N)`, `var(--surface-*)`, etc. (Rule 12 covers colors;
   this rule extends it to every dimension.)

3. **CSS file structure — concern-based, not component-based.**
   - Root: `src/app.css` imports the concern files
   - `src/styles/tokens.css` — `:root` primitives + semantic layer
   - `src/styles/shell.css` — titlebar, rail, stage, utility chrome
   - `src/styles/tree.css` — sidebar tree
   - `src/styles/editor.css` — MDX editor shell + toolbar
   - `src/styles/databases.css` — grid / board / calendar / list / gallery
   - `src/styles/entry.css` — loading / login / onboarding
   - `src/styles/animations.css` — `@keyframes` and motion utilities
   - `src/styles/utilities.css` — small reusable primitives (`.sr-only`, etc.)
   - **No concern-file grows past ~500 lines.** If it does, split
     further (e.g. `database-grid.css` + `database-board.css`).

4. **Layout + structure in CSS. State + dynamic values inline.**
   - Static: `.tree-row { padding: var(--space-2) var(--space-3); }`
   - Dynamic: `style={{ background: isActive ? 'var(--accent)' : 'transparent' }}`
   - Don't mix the two at the same layer — readers should know where to
     look for "why is this 12px?"

5. **No `!important` without a one-line comment** explaining the
   overridden rule. If you can't explain, don't use it.

6. **Dead-CSS audit policy.**
   - Don't purge piecemeal during the rebuild — Phases C-E delete
     whole component trees, their CSS goes with them
   - After Phase H: one dedicated audit pass. Run a coverage tool
     (e.g. `css-stats`, `purgecss --reporter`) in a long production
     session, cross-reference dynamic class strings + third-party
     renderers (Glide cells, MDXEditor icons), delete with
     grep-verify
   - Ongoing: quarterly audit + ESLint rule flagging hardcoded
     pixel/color literals in `.tsx` / `.css` files

7. **File split strategy.**
   - During Phases A-G: new styles go straight into the right
     concern file (create the concern file if it doesn't exist yet)
   - Don't let `app.css` grow past ~500 lines of imports + tokens +
     utility primitives
   - Phase H includes a final "verify concern boundaries" pass

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
`node://` href. Call `workspaceStore.navigateTo(uuid)`; never let
browser handle it.

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

---

## Theme Module

Every visual value in `src/` is a CSS variable. Three tiers — primitives
→ semantic → component. See Rule 12.

**Key invariants** (full spec: [docs/architecture/theme-module.md](docs/architecture/theme-module.md)):

- `@property` registration MANDATORY for slider-driven tokens. List in
  [src/theme/tokens.ts](src/theme/tokens.ts) `REGISTERED_SLIDER_TOKENS`.
- Persistence: localStorage-sync authoritative + Tauri-durable backup.
  Keys `infield:theme:state` + `infield:theme:vars`. Schema-versioned
  (SCHEMA_VERSION = 2); stale blobs rejected by `isPersistedState` and
  by the FOUT script in `index.html`.
- `ThemeProvider` wraps the outermost boundary (`src/main.tsx`).
  `AppCrashBoundary` sits between it and `<App />`. `ThemeEditorRoot`
  is a **sibling** of `<App />`, not a child.
- Preset switch MUST atomically clear overrides (`setState({ presetId,
  overrides: {} })` in one call).
- `--ui-scale` scales space AND typography together.
- `color-mix()` + `calc()` do semantic derivations in CSS, not JS.

**Current preset default (Sovereign Glass DNA):**
- `surfaceBase: #0a0b0f` (cinematic charcoal)
- `brand: #cc4c2b` (terracotta)
- `glassBlur: 32`, `glassSaturate: 220`
- Three kinetic blobs in `AtmosphericBackground` (no single mesh)

---

## Entry Experience (post-Phase B)

After Phase B ships, the launch sequence is:

**Loading → Welcome + Sign-in → Theme Picker → Mic → Accessibility → Model → Vault → Enter**

Sign-in via Google OAuth unlocks Gemini/Vertex AI chat; user can
continue without an account. Full spec lands at Phase B kickoff in
[docs/architecture/entry-experience.md](docs/architecture/entry-experience.md).

---

## Files Never to Modify

| File | Why |
|---|---|
| `src/bindings.ts` | Auto-generated — overwritten on next build |
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

- Dark mode token sets beyond the Sovereign Glass default (v2 theme variants)
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
| Theme token change (primitive → all UI reflects) | < 50ms |
| Autosave roundtrip (debounce → DB + vault written) | < 200ms for bodies ≤ 50KB |
| Table virtualisation threshold | 500 rows — use `@tanstack/react-virtual` |

---

## Keyboard Contracts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+K` | Quick open |
| `Cmd+Shift+J` | Open today's daily note |
| `Cmd+N` | New root-level document |
| `Cmd/Ctrl+[` | Go back (`workspaceStore.goBack()`) — `Cmd+W` is macOS window-close, do not rebind |
| `Cmd/Ctrl+S` | Immediate save |
| `Cmd/Ctrl+L` | Lock app |
| `Cmd/Ctrl+,` | Open theme editor |
| Tree: arrows | Navigate nodes |
| Tree: Enter | Open selected node |
| Tree: Delete | Soft-delete → trash |
| Table: Tab / Shift+Tab | Move between cells |
| Table: Enter | Start editing cell |
| Table: Escape | Stop editing |
| Table: Cmd+Enter | Open row page |

---

## Windows build troubleshooting (MAX_PATH)

Cargo generates deeply nested files. If cloning into a long path
triggers "Path too long":

1. **Recommended:** Enable Long Paths in Registry
   (`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`)
2. **Fallback:** Override cargo target-dir to a short path
   (`target-dir = "C:/ht"` under `[build]` in `.cargo/config.toml`).
   Never commit this override.
