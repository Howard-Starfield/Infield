# CLAUDE.md — Infield Implementation Guide

> **For**: stable rules, architecture invariants, token contracts, decision logs. Read fully before touching code.
>
> **Not for**: phase status, task lists, "what's next" — those live in [PLAN.md](PLAN.md).
>
> **Companions:** [PLAN.md](PLAN.md) roadmap · [REBUILD_RATIONALE.md](REBUILD_RATIONALE.md) decisions + history · [pitfall.md](pitfall.md) evergreen lessons · [docs/architecture/](docs/architecture/) per-concern deep dives · [old/](old/) retired planning.

---

## Current state

- **Frontend**: wholesale-swapped 2026-04-23 from `third_party_selling_desktop/src/` (commit `49f0386`). 100% verbatim copy/ shell + Handy-backed `VaultContext` adapter. `src/components/` is flat.
- **Rust backend**: stable. Phase A complete (sqlite-vec, `vec_embeddings`, `embedding_model_info`, bge-small-en-v1.5 via ORT, `VaultLock`, Rule 16/16a/19 all live).
- **Current work**: **Backend Wiring Phase (W)** — wiring the ported shell to the Rust backend, surface by surface. See [PLAN.md](PLAN.md).

**Shipped wired surfaces** (W0 + W1, 2026-04-23): Onboarding (4-step Spotlight), `AudioView` (mic → voice memos), `SystemAudioView` (WASAPI loopback → paragraphs), UI scale slider + Cmd+=/-/0.

**Dormant surfaces still to wire**: Notes (W2, next — tree + CodeMirror 6 editor), Databases (W4), Search (W3), Settings (W5), AI chat (W6). eBay views stay dormant forever — not wiring to Handy.

---

## Core Vision & Architecture Invariants

Five invariants. If a change breaks one, stop and raise it.

1. **The vault is source of truth.** `<app_data>/handy-vault/` is a tree of `.md` files with YAML frontmatter. SQLite (`workspace.db`) is a derived index: FTS5, vector embeddings, tree parent/position, wikilink edges. Every create/update/move/delete writes both in one pipeline.
2. **Never lose user data silently.** Every write path checks "did the file change on disk since we last read it?" before overwriting. On conflict, ask the user — never auto-resolve.
3. **One design language controls every pixel.** All visuals come from the ported `.heros-*` / `.blob-*` CSS classes (in `src/styles/heros.css` + `src/styles/blobs.css`) and `--heros-*` tokens (in `src/App.css :root`). Vanilla CSS over inline styles. No Tailwind, no CSS-in-JS, no runtime theme switching.
4. **AI is native, not bolted on.** Hybrid FTS + vector + wikilinks + voice capture flow through the same pipeline. AI writes go through `update_node` — no hidden "AI state" in SQLite only.
5. **Wire, don't rebuild.** The frontend is ported; the Rust backend is stable. Current work is wiring dormant cosmetic surfaces to existing Tauri commands. Unwired actions fall back to `<EmptyState>` until their W-phase arrives.

---

## Definition of Done

All of these must be true:

1. `bun run build` has zero new errors
2. `bunx vitest run` + `cargo test --lib` green. No regressions in live code; new components land with critical-path coverage (post Phase A baseline: 125 lib tests).
3. Feature works end-to-end in `bun run tauri dev`. Vite-only (`bun run dev`) can't boot — `invoke()` is undefined in browser. Dormant cosmetic surfaces are exempt as long as they render and surface `<EmptyState>` for unwired actions.
4. No hardcoded color / radius / shadow / spacing literal in new code — only `var(--token)` (Rule 12). Verbatim ports from copy/ preserve original literals.
5. New components live in flat `src/components/` — no nested domain folders.
6. Styles go through `src/styles/*.css` concern files (vanilla CSS) + inline `style={{}}` for dynamic values. No Tailwind, no CSS Modules, no CSS-in-JS.
7. New SQLite tables go in a migration file, never ad-hoc.
8. Every vault write passes the conflict guard (Rule 13).
9. No new filesystem watcher on the vault (Rule 14).
10. Performance targets below not regressed.

---

## Architecture Rules

### Rule 2 — Navigation via `currentPage` + Context, no Zustand

Navigation flows through copy/'s `currentPage` state lifted in `AppShell` plus `VaultContext` for cross-surface state. **No new Zustand stores.**

```typescript
const [currentPage, setCurrentPage] = useState<PageId>('home')
<IconRail currentPage={currentPage} onNavigate={setCurrentPage} />
const { vaultData, lock, unlock } = useVault()
```

The Handy workspace (tree + markdown editor) lives under the `'notes'` page. `NotesView` is the container shell; tree + editor render inside its glass frame once W2 wires them.

### Rule 8 — Cell inputs must be controlled, never defaultValue

```typescript
<input defaultValue={cell.value} onChange={...} />   // wrong — stale after re-render
<input value={cell.value ?? ''} onChange={...} />    // correct
```

### Rule 9 — Voice memo transcription writes workspace.db + vault only

Voice-memo auto-notes live as workspace documents under the **Mic Transcribe** folder. Each capture appends a `::voice_memo_recording{...}` directive + transcript to the daily child doc.

- Daily title: `"Voice Memos — YYYY-MM-DD"`
- Session pointer: `VoiceSessionManager.get/set_workspace_doc_id()` — workspace node id only
- Daily lookup: children of Mic Transcribe folder where `name == today_title` and `deleted_at IS NULL`
- Mirror props: `{"voice_memo_mirror":{"note_id": <ws id>, "recorded_at_ms": <ms>, "audio_file_path": <str|null>}}`
- Never dual-write to `notes.db` — that DB was deleted in Phase A

### Rule 10 — Body is raw markdown, not JSON document trees

```typescript
<MarkdownEditor markdown={node.body ?? ''} onChange={handleSave} />   // correct
const body = JSON.stringify([{ type: "paragraph", content: text }])   // wrong
```

`workspace_nodes.body` stores raw markdown strings. New nodes default to `body = ''`. Never `'[]'`. See Rule 22 for editor choice.

### Rule 11 — No separate folder node type

No `node_type = "folder"`. A document with ≥1 non-deleted child **is** the folder. Tree renders a caret when children exist; opening the doc shows its body + auto-rendered "Children" section. Never add `"folder"` to `node_type` — it would fork tree, navigation, and vault logic.

### Rule 12 — Tokens only; never hardcoded literals

No literal colors, radii, shadows, or spacing values in any file under `src/`. All visual values come from CSS custom properties declared in `src/App.css :root`.

```typescript
// Wrong
<div style={{ background: '#1a1b21', borderRadius: 14, boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
// Correct
<div style={{ background: 'var(--surface-container)', borderRadius: 'var(--radius-container)', boxShadow: 'var(--shadow-sm)' }}>
```

All tokens declared statically in `:root`. No runtime theme switching, no preset system, no `tokens.ts`.

**Verbatim-port carve-out:** when porting classes from `copy/src/app.css`, preserve original literal values verbatim. Aggressive tokenization risks drift from copy/.

**Radius hierarchy:**
- `var(--radius-lg)` — big panels (titlebar, tree sidebar, stage, chrome popovers)
- `var(--radius-container)` — smaller controls (rail buttons, avatar, tab pills)
- `var(--compact-button-radius)` / `var(--chip-radius)` / `var(--segmented-radius)` — specialized

### Rule 13 — Every vault write must pass the conflict guard

Before `write_node_to_vault` overwrites an existing file:

```rust
let on_disk_mtime = fs::metadata(&abs_path).ok().and_then(|m| m.modified().ok());
if let (Some(disk), Some(last_seen)) = (on_disk_mtime, node.last_read_mtime) {
    if disk > last_seen + Duration::from_secs(1) {
        return Err(VaultWriteError::ExternalEditConflict { node_id, disk_mtime: disk, last_seen });
    }
}
// proceed: temp file → rename
```

Frontend handles `ExternalEditConflict` with an **inline banner** (not modal): "This file changed on disk. Reload / Keep mine / Open diff."
- Reload: `get_node` force re-read, push new body to editor
- Keep mine: set `node.last_read_mtime = disk_mtime`, retry write once
- Diff: side-by-side merge (v2; v1 = reload/keep only)

Autosave pauses for the conflicted node until resolved. `last_read_mtime` tracked per open editor session. **Never auto-merge. Never silently overwrite.**

### Rule 13a — Vault path normalization

- **Unicode normalize to NFC** before any compare. macOS HFS/APFS delivers NFD; same filename, different bytes → two nodes.
- **Case-insensitive compare** on macOS / Windows filesystems ("Foo.md" and "foo.md" must collide).
- **Ignore** hidden files: `.DS_Store`, `.git/**`, `Thumbs.db`, `desktop.ini`, `*.icloud`, `*.tmp`, `* (conflict *).md`, `*.conflicted.md`.
- **Cloud-sync mtime**: Rule 13's `+1s` buffer is too tight for iCloud/OneDrive/Dropbox. Bump to `+3s` when vault matches cloud-sync patterns, or use `user_preferences.vault.mtime_grace_ms`.

### Rule 14 — No filesystem watcher on the vault

Watchers introduce rename-as-delete+create, cloud-sync placeholder, batch flood, and re-entry risks. Replacement:
- **On navigation**: `get_node` mtime check
- **On window focus**: `workspace:window-focused` → re-invoke `get_node(activeNodeId)` → non-blocking "Refreshed from disk" toast if body changed
- **On boot**: fast stat-only scan; mark `vault_dirty` in-memory for drifted rows
- **On write**: Rule 13 conflict guard

**Toast suppression — cloud-sync materialization.** When `file.len()` was `0` and is now `>0` (first-time materialization) OR only YAML frontmatter changed, apply the refresh silently. Cloud-sync async materialization trains users to ignore legitimate toasts.

### Rule 15 — Single-process vault lock

Two Handy instances on the same vault corrupts `workspace_fts` and `vec_embeddings` (sqlite-vec virtual tables are not cross-process safe even with WAL).

Acquire exclusive OS lock on `<vault>/.handy.lock` via `fs2::FileExt::try_lock_exclusive` before any `Connection::open`. On failure: `rfd` native dialog "Infield is already running" → exit 0. On clean shutdown: release. On crash: OS releases automatically.

**Implemented**: `VaultLock::acquire` at `src-tauri/src/app_identity.rs`, wired at `lib.rs` init.

### Rule 16 — Native model inference must isolate crashes

Any Rust code calling native ML libraries (ORT, whisper-rs, Candle, etc.) MUST:

- Run on a dedicated `std::thread::spawn` worker, **not** a tokio task. `catch_unwind` doesn't cross `no_mangle` reliably; a native panic in a tokio task can poison the executor.
- Communicate via `crossbeam_channel::bounded` — bounded so back-pressure is visible.
- Implement **sentinel + restart-once**: heartbeat-monitored worker; on death, respawn once, then on second death mark feature `unavailable` and fall back.
- Never block the UI thread on inference.

**Implemented**: `managers::embedding_ort::InferenceHandle` — worker thread + `crossbeam_channel::bounded(16)` + `tokio::sync::oneshot`. Sentinel respawns once on stale heartbeat (30s); second death flips `vector_search_available = false`, emits `vector-search-unavailable`.

### Rule 16a — Multi-session ORT concurrency

When 2+ ORT sessions run concurrently (transcription + embedding + diarization), they share CPU threads and GPU command queues. A latency-sensitive session (transcription) can be starved by background work (embedding queue).

When adding a new ORT session alongside existing ones:

1. **Cap intra-op threads**: `ort::SessionBuilder::with_intra_threads(num_cpus::get() / N)` where N = concurrent sessions at peak.
2. **Quiesce background sessions during interactive ones.** Poll a "is interactive work active?" helper (e.g. `transcription_session_holds_model(app)` in `managers/transcription.rs`) and sleep/retry rather than compete.
3. **GPU assignment**: one session per GPU at a time. DirectML/CoreML command queues serialize concurrent GPU work. Reserve GPU for the latency-sensitive session; run background sessions on CPU.
4. **Independent `Session` instances per logical model.** Never share `ort::Session` across threads — `session.run()` isn't thread-safe.

Rule 16 still applies to each individual session; 16a governs the interaction between them.

### Rule 17 — Native extensions ship per-platform

For dlopen-at-runtime extensions (whisper, future ones) — NOT statically linked — they MUST:

- Live under `src-tauri/resources/<extension>/` in source
- Listed in `tauri.conf.json` under `bundle.resources`
- Platform-specific binaries: `.dll` / `.dylib` / `.so` — never assume cross-platform
- Runtime path: `ResourceResolver` in production, relative in dev — keep both tested
- **macOS**: ad-hoc codesign required or `dlopen` fails under Gatekeeper
- **Windows**: consider EV codesigning to avoid SmartScreen (not blocking v1)

**Carve-out**: sqlite-vec is static-linked via the Rust crate (`sqlite3_auto_extension`); Rule 17 doesn't apply to it.

### Rule 18 — CSS hygiene (vanilla-CSS discipline)

Vanilla CSS, class-driven per Invariant #3. Rules:

1. **Component prefix on every class.** `.heros-*`, `.blob-*`, `.tree-row__icon`, `.tree-row--active` (BEM for Handy-extension classes). No bare `.button` or `.panel` — prevents collisions in flat `src/components/`.
2. **Every numeric value through a token.** No raw `px`, `rem`, hex, shadow, or radius literals in CSS or inline `style={{}}`. Use `var(--space-N)` / `var(--radius-N)` / `var(--text-N)` / `var(--surface-*)`. Verbatim-port carve-out applies.
3. **Concern-based file structure.** `src/App.css` = `:root` tokens + concern imports + animation keyframes. `src/styles/heros.css` = verbatim HerOS classes. `src/styles/blobs.css` = verbatim blob atmosphere. `src/styles/entry.css` = onboarding/loading/lock. New pages get their own concern file when class definitions accumulate. No concern file past ~500 lines.
4. **Layout in CSS, state inline.** Static: `.heros-glass-panel { padding: 48px 40px; }`. Dynamic: `style={{ background: isActive ? 'var(--heros-brand)' : 'transparent' }}`.
5. **No `!important`** without a one-line comment explaining the overridden rule.
6. **Dead-CSS audit** deferred to post-W5. PurgeCSS/coverage tools miss string-concatenated class names and third-party theme props — budget hand-curating a safelist before any mass deletion.

### Rule 19 — Model-version guard on persisted ML outputs

Any persisted artefact from an ML model (embeddings, transcription timestamps, summaries) MUST record model identity alongside the data. Mismatch on boot → regenerate, never silent reuse.

```sql
CREATE TABLE IF NOT EXISTS embedding_model_info (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  model_id TEXT NOT NULL,     -- e.g. "bge-small-en-v1.5"
  dimension INTEGER NOT NULL,
  model_hash TEXT NOT NULL    -- sha256 of weights
);
```

On boot:
- `model_id` or `dimension` mismatch → `DELETE FROM vec_embeddings`, mark all nodes `'pending'` in `embed_backfill_queue`, show reindex banner.
- `model_hash` mismatch but id+dim match → log warning; do NOT auto-reindex (HF rebuilds cause false positives). Require explicit Settings → Advanced action.

Apply the pattern to future persisted ML outputs. Prevents "768d vectors in a 384d column" and stale summaries from a swapped model.

**Implemented**: `managers::embedding_ort::rule_19_reindex_check` with mtime-keyed sha256 side-file.

### Rule 20 — Global UI scaling via native webview zoom, never CSS zoom

Use the `set_app_zoom` Tauri command (`src-tauri/src/commands/ui.rs`). It wraps `WebView2::SetZoomFactor` / `WKWebView::setPageZoom` / `webkit2gtk set_zoom_level` — the same mechanism Ctrl+`+`/Ctrl+`-` uses in any Chromium browser.

**Never use CSS `zoom`** — non-standard, shrinks declared size at sub-1.0 leaving gutters, unpredictable with `position: fixed` / backdrop filters / SVG / canvas, inconsistently implemented across engines.

Native webview zoom reflows layout at the effective viewport and scales every pixel uniformly (including inline-px literals from copy/). Composes correctly with drag-drop, fixed positioning, canvas.

`--ui-scale` token still readable for finer typography control, but NOT the primary mechanism. `--app-zoom` is informational only.

### Rule 21 — UI-scale window coupling is asymmetric

When UI scale changes, window resizes asymmetrically per user browser-zoom intuition:

- **scale < 1.0** → window stays the same (zoom-out gives more content density)
- **scale = 1.0** → window returns to BASE_WINDOW (2016×1200, matches `src-tauri/src/lib.rs` default)
- **scale > 1.0** → window grows proportionally, capped at 95% of monitor (prevents overflow)

Implemented in `src/contexts/VaultContext.tsx::resizeWindowToScale` via `getCurrentWindow().setSize()` + `currentMonitor()`. BASE_WINDOW and the Rust default must stay in sync.

Trade-off: changing scale clobbers any manual window resize. Add a "lock window to scale" toggle only if it becomes an actual friction point.

### Rule 22 — Markdown editor: CodeMirror 6 + GFM, never the Agentz360 fork

The W2 Notes editor uses **official `@codemirror/lang-markdown`** with GFM extensions enabled:

```ts
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
markdown({ base: markdownLanguage, extensions: [GFM] })
```

This gives native GFM table / task list / strikethrough / autolink parsing, a real Lezer AST for decorations, and what Obsidian uses at scale.

**Do NOT use `Agentz360/secure-lang-markdown`** — 0 stars, 0 forks, and its `ai-sec-sdk.ts` is a telemetry SDK that POSTs events to a remote `ingestionUrl`. Fundamentally incompatible with Invariant #1 (local-first). The fork also pins you to whatever upstream version they last merged.

**Why CodeMirror 6 over TipTap / BlockNote / Plate**: CM6 is markdown-native, which satisfies Rule 10 without a bidirectional JSON↔markdown adapter layer. TipTap/BlockNote/Plate treat markdown as an export format — every save, round-trip bugs are possible. CM6 matches Obsidian's architecture: markdown bytes stay pristine on disk.

If a Notion-style WYSIWYG block editor is ever wanted later, layer custom widget decorations over CM6 source — don't swap the foundation.

### Rule 23 — Slash commands via `@codemirror/autocomplete`

Don't hand-roll a floating menu. Register a completion source keyed on `/` at line start — CM6's `autocompletion` extension gives keyboard handling, fuzzy filtering, positioning, and lifecycle for free. The same machinery powers `[[` wikilink autocomplete (Rule 2, via a separate source).

Catalog lives at `src/editor/slashCommands.ts` (Tier 1: 10 block primitives — `/h1` `/h2` `/h3` `/ul` `/ol` `/todo` `/quote` `/divider` `/code` `/table`). Handy-native commands (Tier 2: `/link` `/today` `/voice` `/database` `/embed`) land in `src/editor/commands/` as each Tauri command gets wired in W2+.

Each command's `run(view, from, to)` mutates the doc — replace the `/query` span, position the caret thoughtfully (inside the first table cell, inside a code fence, after `- [ ] `).

**Line-start guard**: the completion source checks the text before `/` is whitespace-only. Prevents slash triggering mid-sentence ("go to /usr/bin").

---

## HerOS Design System

Every page uses the same shared primitives ported from `copy/src/components/HerOS.tsx` and `copy/src/app.css`. Consistency comes from **using these primitives**, not from rebuilding ad hoc per page.

### Primitives (`src/components/HerOS.tsx`)

- `<HerOSPanel>` — main container card (glass, rim light, padding). Use for **every content card**.
- `<HerOSInput>` — carved/recessed text input. Use for **every text input** — search, login, settings, forms.
- `<HerOSButton>` — floating-light pill. Variants: default, brand (terracotta), danger.
- `<HerOSViewport>` — page wrapper providing atmospheric background + content area.

### CSS classes (`src/styles/heros.css`)

- `.heros-shell` — top-level page shell
- `.heros-page-container` — scrollable content frame, consistent padding
- `.heros-glass-panel` / `.heros-glass-card` — **unified content cards**; single source of truth for card styling
- `.heros-glass-bubble` / `.heros-glass-bubble-me` — message bubbles (chat, notifications)
- `.heros-btn` / `.heros-btn-brand` / `.heros-btn-danger` — button base + variants
- `.heros-input-wrapper` — carved input style
- `.heros-shadow` — standard floating shadow
- `.heros-glow-amber` — backlight halo for highlight surfaces
- `.heros-icon-animate-focus` / `.heros-icon-animate-hover` — icon motion
- `.login-mode` — body modifier shifting blob saturation/brightness for the lock surface

### Atmosphere (`src/styles/blobs.css`)

- `.blob-container` + `.blob-cluster-a/b/c` — three-cluster kinetic background (orange / red / bright-orange radial gradients, 9-14s drift animations)
- `--heros-bg-foundation` (`#0a0b0f`) — deep charcoal foundation under the blobs

### Cross-page rules

1. **Content cards must use `.heros-glass-panel` / `<HerOSPanel>`**. Variants via BEM modifier (`.heros-glass-panel--variant`) so every page picks them up.
2. **Spacing uses `var(--space-N)`**. Cards: `--space-4` (16px) gap typical; sections: `--space-6` (24px); page padding: `--space-8` (32px).
3. **Page boundaries use `.heros-page-container`** — consistent scroll, padding, text color.
4. **Readability on glass**: `--heros-text-shadow` baked into `.heros-glass-panel`; `.heros-glow-amber` on highlight surfaces for contrast; `var(--heros-glass-black)` (82% charcoal) only when truly opaque substrate needed.
5. **No new primitives without checking copy/ first.** Port if it exists; design with existing primitives if not. New primitives go through review into `HerOS.tsx` or `heros.css`.

---

## Search Stack

Post-Phase-A, search unifies on `sqlite-vec`:

| Component | Location | Role |
|---|---|---|
| `sqlite-vec` | static-linked extension | Vector similarity via `vec0` virtual tables |
| `workspace_fts` | `workspace_manager.rs` | FTS5 for title + body |
| `vec_embeddings` | `vec0` virtual table | Vector index, joined to FTS via SQL |
| `EmbeddingWorker` | `managers/embedding_worker.rs` | Background embed pipeline |
| `SearchManager` | `managers/search.rs` | Hybrid FTS + vector via one SQL RRF |

Rules:
1. Keep `workspace_fts` migrations + triggers aligned with `WorkspaceManager` sync paths
2. Feed new write paths into `EmbeddingWorker.enqueue_index()`
3. Extend via `SearchManager` — never `LIKE '%query%'` for user search

Eligible for both indexes: `node_type IN ('document', 'row')` → title + body. `node_type = 'database'` → title only. `deleted_at IS NOT NULL` → excluded.

---

## SQLite Performance

WAL mode on first connection is critical:

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
FROM workspace_nodes
WHERE deleted_at IS NULL
ORDER BY parent_id, position;
```

**Body is lazy — never load markdown during tree init.**

---

## Position / Ordering — Fractional Indexing

```
New item:            position = max_sibling_position + 1.0
Drop between A, B:   position = (A + B) / 2.0
Gap < 1e-9:          rebalance siblings to evenly spaced integers
```

`workspace_nodes.position` and `node_views.position` are `REAL` (f64). Sequential integers would require O(n) updates on reorder.

---

## Vault File Lifecycle

File I/O in `src-tauri/src/commands/workspace_nodes.rs` + `managers/workspace/workspace_manager.rs`; vault root via `resolve_vault_root()` in `app_identity.rs`.

| Event | Vault action |
|---|---|
| `create_node` (document) | Write `.md`; save `vault_rel_path` |
| `update_node` (rename / body) | Write new `.md`; delete old if slug path changed |
| `move_node` | Write at new slug; delete old if path changed |
| `soft_delete_node` | **No change** — file stays, recoverable from trash |
| `permanent_delete_node` | Delete vault file(s) |
| `empty_trash` | Delete files for all permanent-removed nodes |
| External edit (app closed) | Caught by `get_node` mtime check on navigation |
| External edit (app open) | Rule 13 conflict guard fires on next autosave |

**Path computation**: `compute_vault_rel_path` walks ancestors, builds `parent-slug/child-slug.md`. Slug collision appends first 8 chars of UUID.

**Atomic write**: `name.md.tmp` → `fs::rename`. On Windows <10.1709, `fs::rename` isn't atomic when target exists — future work uses `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`.

**Cloud-sync defensiveness**: ignore `*.icloud`, `*.tmp`, `* (conflict *).md`, `*.conflicted.md`. Never read a file with `len() == 0` if DB body is non-empty. Surface conflict-copy files in a "Vault issues" panel; don't auto-import.

**Autosave**: 300ms debounce. Respects Rule 13.

---

## Vault Database Storage

Databases serialize as `databases/<slug>/database.md` (schema + default view in YAML frontmatter) + `databases/<slug>/rows/<id>.md` per row + `databases/<slug>/views/<name>.view.json` per extra view.

**Markdown pipe tables (`| col |`) are banned as storage.**

Full contract: [docs/architecture/vault-database-storage.md](docs/architecture/vault-database-storage.md).

Invariants:
- Row files MUST declare `id` + `database_id` in frontmatter
- `database.md` `fields:` array IDs are permanent
- Wikilinks into rows use `node://<row-uuid>`; relation cells use `[[databases/<db-slug>/rows/<target-slug>]]`

---

## Wikilinks

Stored as `[display title](node://uuid)` in markdown.

**`[[` autocomplete**: intercept via `@codemirror/autocomplete` source, query `searchNodes` (title only, 150ms debounce). On select: replace `[[...` with `[title](node://uuid)`.

**`node://` click — mandatory**: custom link renderer catches every `node://` href. Call the active page setter (Rule 2) to route to `'notes'` + node id; never let browser handle it.

**Rename propagation**: optimistic/instant. Source-page display-text updates are background async. Progress indicator only when > 50 source pages affected.

**`page_links` sync on save**: delete all rows where `source_node_id = currentNodeId`, insert links extracted from saved body. Always replace, never diff.

---

## Tauri Command Conventions

- snake_case: `get_node`, `update_node`, `search_workspace_hybrid`
- Return type: `Result<T, String>`
- New commands: add to relevant file in `src-tauri/src/commands/`
- Register in `src-tauri/src/lib.rs` inside `.invoke_handler(tauri::generate_handler![...])`
- eBay commands referenced by `copy/src/tauri-bridge.ts` are NOT registered. Calling them throws — wrap in try/catch + `<EmptyState>`.

---

## Entry Experience

**Boot**: `LoadingScreen → AppShell`. No boot password gate — vault is plain markdown, not encrypted at rest.

**Cmd/Ctrl+L lock**: copy/'s LoginPage UI repurposed as the lock overlay. Renders only when locked; auto-unlocks on first launch (no password ever set).

**Onboarding**: 4-step Spotlight overlay (mic → accessibility → models → vault), boot-gated in `App.tsx`. Source of truth: Rust `onboarding_state` table. Shipped in W0.

---

## Files Never to Modify

| File | Why |
|---|---|
| `src/bindings.ts` | Auto-generated by specta — overwritten on next `bun run tauri dev` |
| `src/styles/heros.css` | Verbatim port from `copy/src/app.css` — don't refactor or aggressively re-tokenize |
| `src/styles/blobs.css` | Same constraint |
| `translation.json` `database.calendar.*` keys | Used by `CalendarToolbar` — renaming breaks calendar |

---

## Workspace DB Mutex Discipline

`WorkspaceManager` uses `tokio::sync::Mutex<Connection>`. Compiler will NOT catch violations — `MutexGuard` is `Send`, so holding across `.await` compiles silently and deadlocks.

- Never hold `conn.lock().await` across another `.await`. Acquire, do sync work, drop, then await.
- Never do CPU-heavy work in the critical section.
- rusqlite calls are sync and block the tokio thread — keep holds short.

---

## Deferred — Do Not Implement in v1

- Runtime theme switching, presets, token sliders (theme module deleted; design is static HerOS)
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
- **Real speaker diarization** (pyannote via ORT). Current system-audio flow uses source-based attribution (You vs. Speaker). True diarization (same mic, multiple humans) deferred until post-W5 — requires a new ORT session that interacts with transcription under Rule 16a.
- **Auto-translation of transcripts** (NLLB / M2M100 or LLM-routed). Deferred until LLM infra lands in W6.
- **AI auto-edits** (backtrack, filler removal via LLM). Snippets + personal dictionary + regex filler removal are cheap and can land in a polish phase; LLM-powered edits wait for W6.

---

## Performance Targets

Do not regress without explicit sign-off.

| Metric | Target |
|---|---|
| Cold start (interactive, post-LoadingScreen) | < 500ms |
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
| `Cmd/Ctrl+=` / `-` / `0` | UI scale up / down / reset |
| Tree: arrows | Navigate nodes |
| Tree: Enter | Open selected node |
| Tree: Delete | Soft-delete → trash |
| Table: Tab / Shift+Tab | Move between cells |
| Table: Enter | Start editing cell |
| Table: Escape | Stop editing |
| Table: Cmd+Enter | Open row page |

`Cmd/Ctrl+,` is currently unbound (theme editor retired).

---

## Windows build troubleshooting (MAX_PATH)

Cargo generates deeply nested files. If cloning into a long path triggers "Path too long":

1. **Recommended**: enable Long Paths in Registry (`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`)
2. **Fallback**: override cargo target-dir to a short path (`target-dir = "C:/ht"` under `[build]` in `.cargo/config.toml`). Never commit this override.
