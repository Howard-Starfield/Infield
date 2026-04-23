# Infield Migration — Audit, Fixes, and Rename Plan

Audit date: 2026-04-19. Scope: (1) FTS5 shadow-table corruption root cause, (2) rename `Handy` → `Infield`, (3) review of Claude Code's three file changes, (4) recommended follow-ups.

---

## 1. Verification of the FTS5 / "Notes DB issue" analysis

All source line references below were confirmed by reading the current tree.

### 1.1 Findings that are CORRECT

| Claim | Evidence | Verdict |
|---|---|---|
| `workspace_fts` is a **standalone** FTS5 virtual table, not external-content | `workspace_manager.rs:1733` — `CREATE VIRTUAL TABLE ... USING fts5(node_id UNINDEXED, title, body)` with no `content=` clause | ✅ True |
| `notes_fts` has the phantom-delete guard (`import_status IN ('ready','failed')`); `workspace_fts` has none | `notes.rs:43-130` (guarded triggers) vs. `workspace_manager.rs:1154-1171` (`replace_workspace_fts_row` does raw DELETE + INSERT) | ✅ True |
| `reindex_node_fts` does raw DELETE + INSERT with no existence check | `workspace_manager.rs:1810-1827` | ✅ True |
| `ensure_workspace_fts_populated` does a full `DELETE FROM workspace_fts` on startup when counts diverge | `workspace_manager.rs:1776-1806` (calls `rebuild_workspace_fts_locked` at 1190-1223, which deletes everything inside a transaction) | ✅ True |
| `move_node` does NOT trigger FTS sync or embedding | Confirmed by grepping — `move_node` never calls `sync_node_fts` or `enqueue_index` | ✅ True |
| Vault watcher has **zero debouncing** and calls `reindex_node_fts + enqueue_workspace_index` on every event | `lib.rs:353-387` — plain `while let Ok(event) = rx.recv()` loop | ✅ True |
| `usearch::Index::load()` requires a post-load `reserve()` | `vector_store.rs:117-126` — comment + explicit `reserve(index.size() + 1024)` | ✅ True and **already fixed** in current code |

### 1.2 Findings that need correction

| Claim | What's actually true |
|---|---|
| "The footer badge triggers because `probe_db_health` detects shadow table inconsistencies in workspace_fts" | `probe_db_health` (`notes.rs:350-363`) runs `PRAGMA quick_check` only on the **notes.db** connection. A bare `workspace_fts` corruption does **not** directly flip `is_healthy`. What actually happens: any SQLite operation that returns a `malformed` error routes through `record_db_health_from_error` (`notes.rs:371-382`) which pattern-matches on the error string — so a `main.workspace_fts malformed` surfaced through a notes-adjacent query or shared error-handling path is what sets the badge. The badge is driven by the *last error string*, not by a per-DB probe. |
| "ensure_workspace_fts_populated writes vault files during rebuild" (Issue C) | **FALSE.** `rebuild_workspace_fts_locked` only reads from `workspace_nodes` and writes to `workspace_fts`. No `write_node_to_vault` call inside it. The cascade described in the report is a different phenomenon — see §1.3. |
| "`get_node` mtime check returns an updated body but doesn't persist it" (Issue E) | **Was true. Already partially fixed** — see §3. |

### 1.3 What is actually causing the rebuild-triggered file events

The real cascade is not from `ensure_workspace_fts_populated`. It is from `update_node` / `create_node` in `commands/workspace_nodes.rs` always calling `write_node_to_vault` after every DB mutation (lines 28-32 and 106-115). That write fires `notify` → watcher → `reindex_node_fts` → if `reindex_node_fts` somehow calls back into vault writes (it doesn't today), you'd loop. Today the loop closes at `reindex_node_fts` because the function body writes only to `workspace_fts`, not the filesystem. But any future refactor that added "also save body" to `reindex_node_fts` would create a true cascade.

**Net: the cascade risk is real, but it is latent, not active.** The duplicated `untitled-0473cb64.md`, `c.md`, `cccccccc.md` files are more likely from:
- rapid rename-while-typing creating multiple slugged paths (see `update_node` cleanup at `workspace_nodes.rs:107-113` — only removes the *previous* path, not every historical slug), or
- the vault-as-truth read in `get_node` now writing back (see §3 on Claude's change).

### 1.4 Missing guardrails in the workspace DB

| Issue | Evidence |
|---|---|
| Workspace DB has **no `journal_mode=WAL`, no `busy_timeout`, no `synchronous=NORMAL`** | `lib.rs:212-218` opens the connection and only sets `foreign_keys=ON`. `notes.rs:287-289` and `notes.rs:417-419` do set WAL + busy_timeout on the notes DB. CLAUDE.md explicitly calls WAL out as required. This is the single biggest correctness/perf gap. |
| `sync_node_fts` holds `conn.lock().await` across `build_row_indexable_text` (another await) | `workspace_manager.rs:3007-3033` — borderline. Current code re-acquires the lock inside each branch, so it is OK, but the function is fragile. |
| `ensure_workspace_fts_populated` uses `conn.blocking_lock()` on the tokio runtime startup path | `workspace_manager.rs:1778` — called at `lib.rs:224` during `setup`, which is fine because setup runs on a blocking context, but calling this from any async code later would deadlock. |

---

## 2. Review of Claude Code's three changed files

### 2.1 `src-tauri/src/app_identity.rs` — ✅ Good

Introduces `APP_NAME = "Infield"`, `VAULT_DIR_NAME = "infield-vault"`, plus legacy constants and `resolve_vault_root()` that auto-migrates a legacy `handy-vault/` directory to `infield-vault/` on first run. Also exposes `read_markdown_body_from_vault_file` for the vault-as-truth read.

**Strengths**
- Idempotent: if `infield-vault/` already exists, it returns that and ignores the legacy path.
- Falls back gracefully if `std::fs::rename` fails (e.g. cross-volume or file locked).

**Concerns (not blockers)**
- `resolve_vault_root` does a directory rename on every call that hits the migration branch. Fine in practice because after the first successful rename the legacy path no longer exists, but worth a one-shot flag if you anticipate crashes mid-rename.
- The function is still called `resolve_vault_root`; naming is neutral, good.

### 2.2 `src-tauri/src/commands/workspace_nodes.rs` — ⚠️ Logic change, needs a guard

The new `get_node` branch (lines 44-69) does this when the vault file's mtime is newer than `node.updated_at`:
1. Read the body from disk via `read_markdown_body_from_vault_file`
2. Call `workspace_manager.sync_document_body_from_vault(&id, &new_body)`
3. Return the updated node

`sync_document_body_from_vault` (at `workspace_manager.rs:1973-2011`) does the right things: persist the body, bump `updated_at`, call `sync_node_fts`, replace page_links, and enqueue an embedding. **That fixes Issue E.**

**Problem:** every single `get_node` call now does an `fs::metadata` + possible file read + possible DB write. `get_node` is called very frequently (tree clicks, navigation, every `useWorkspaceStore` selector). This converts what was a pure read into a write under certain conditions. Concrete risks:

1. Two Handy windows/tabs open → both call `get_node` → both race to `sync_document_body_from_vault` → one transaction loses. Not fatal, but wasteful.
2. If the user has the same document open in Obsidian *and* Handy, typing in Obsidian → mtime advances → Handy's next navigation persists + re-embeds. This is intentional but needs a guard against **`get_node` being called during the watcher's own re-embed**, or you double-embed.

**Recommended additional guard** (before calling `sync_document_body_from_vault`):
```rust
// Skip if the workspace watcher path (lib.rs:370) already handles this file.
// Alternatively, only sync if mtime > updated_at + 1s (tolerance for watcher lag).
if file_mtime > Some(n.updated_at + 1) {
    // ... existing sync logic
}
```

### 2.3 `src-tauri/src/managers/workspace/workspace_manager.rs` — ✅ `sync_document_body_from_vault` is correctly structured

Lines 1973-2011 release the mutex before awaiting `sync_node_fts`, `replace_page_links_for_source`, and `enqueue_index`. That follows the CLAUDE.md "never hold the lock across await" rule. Early-returns on `existing.body.trim() == trimmed_body` prevent no-op writes and no-op re-embeds. Good.

**What's NOT addressed in the current changes**
- No phantom-delete guard on `workspace_fts` (Issue A still open)
- No vault watcher debounce (Issue B still open)
- No auto-REINDEX on corruption detection (Issue F still open)
- Workspace DB still lacks WAL / busy_timeout (§1.4)

### 2.4 Verdict on Claude Code's changes

| File | Verdict |
|---|---|
| `app_identity.rs` | Ship it. Keep legacy constants around for at least 2 release cycles. |
| `commands/workspace_nodes.rs` | Ship with the tolerance guard above, otherwise OK. |
| `managers/workspace/workspace_manager.rs` | `sync_document_body_from_vault` is fine. But this change alone does **not** fix the FTS corruption badge. |

---

## 3. Rename plan — Handy → Infield

Completion status: **~15% done.** `app_identity.rs` + `resolve_vault_root()` done. UI strings, `tauri.conf.json`, `package.json`, updater feed, bundle identifier, and Cargo crate name still pending.

### 3.1 Blockers that must flip in the same commit

These references will cause the rename to be inconsistent or break at runtime:

| Location | Current | Must become | Notes |
|---|---|---|---|
| `src-tauri/src/lib.rs:296` | `app_data_dir.join("handy-vault")` | `resolve_vault_root(app_handle)` | `DatabaseManager` is being given the legacy path — this bypasses the migration in `app_identity.rs`. Causes split vaults on upgrade. |
| `src-tauri/src/lib.rs:309, 319` | vault watcher hardcodes `handy-vault` | `resolve_vault_root(app_handle)` | Watcher watches the wrong directory after migration → external edits in the new vault don't propagate. |
| `src-tauri/tauri.conf.json:3` | `"productName": "Handy"` | `"productName": "Infield"` | Window title, installer name, dock label. |
| `src-tauri/tauri.conf.json:5` | `"identifier": "com.pais.handy"` | `"identifier": "com.pais.infield"` or new org | **Changing the identifier invalidates OS-level grants** (autostart, accessibility, mic). Users will need to re-grant permissions. Document this. |
| `src-tauri/tauri.conf.json:61` | `-d Handy` sign command | `-d Infield` | Code signing display name. |
| `src-tauri/tauri.conf.json:71` | `https://github.com/cjpais/Handy/releases/.../latest.json` | New Infield release URL | Until the new repo exists, leaving this pointing at Handy's feed means the app may offer to "update" to the old Handy. **Either change or temporarily disable the updater.** |
| `package.json:2` | `"name": "handy-app"` | `"name": "infield-app"` | npm package name. |
| `package.json:10` | `cargo build ... --bin handy-embedding-sidecar` | either rename the binary too, or keep it named `handy-embedding-sidecar` and document why | See §3.2. |

### 3.2 Things you almost certainly should NOT rename

Renaming these will break builds or upstream fetches:

| Keep as-is | Why |
|---|---|
| `Cargo.toml` `handy-keys = "0.2.4"` (crates.io dep) | Third-party crate, not yours to rename. |
| `Cargo.toml` `tauri-runtime = { git = ..., branch = "handy-2.10.2" }` | A fork branch name upstream. Changing it breaks the git dep. |
| `src-tauri/src/bin/handy-embedding-sidecar.rs` + binary name `handy-embedding-sidecar` | Can rename, but it's cross-referenced from `package.json`, `managers/embedding.rs`, and any packaging manifests. If you rename, do it as a **separate commit** and grep for the exact binary name. Low-reward churn otherwise. |
| `src-tauri/src/shortcut/handy_keys.rs` + module `handy_keys` | Bindings to the `handy-keys` crate. Rename the *file* if you want, but the `use handy_keys::...` imports must stay. |
| `Cargo.toml` `name = "handy"`, `default-run = "handy"`, lib `name = "handy_app_lib"` | You *can* rename these, but every internal `use handy_app_lib::...` import path changes. Do it, but recognize it's the single largest diff in the rename. |

### 3.3 Strings to find-and-replace across the tree (safe set)

These are safe 1:1 replacements assuming you review the diff:

- `"Handy"` → `"Infield"` in UI strings (`productName`, menu items, tray tooltip `tray.rs:928`, About dialog)
- Path string `"handy-vault"` → use `resolve_vault_root` / `VAULT_DIR_NAME` instead of a literal
- Path string `"Handy Portable Mode"` → `"Infield Portable Mode"` via `PORTABLE_MAGIC` in `portable.rs`
- `com.pais.handy` → new identifier (one-time, coordinate with code-signing)
- Frontend logos / text in `src/components/icons/HandyHand.tsx`, `HandyTextLogo.tsx`, About page, Onboarding

### 3.4 Rename execution order

1. ~~**Vault-path unification first.** Replace every `join("handy-vault")` with `resolve_vault_root(app)`. Test app starts, migrates, and re-opens cleanly.~~ ✅ **Done** — `app_identity.rs` + vault module use `resolve_vault_root`.
2. **UI strings + productName.** Visible change but low risk.
3. **Bundle identifier.** Ship as a *major* version. Write release notes telling users permissions will reset.
4. **Updater feed URL.** Must flip in the same release that ships the new identifier, otherwise the old Handy updater may chain-update users back onto the old app.
5. **Cargo crate name / lib name.** Last. Massive diff (every `use handy_app_lib::...`). Do it as a standalone refactor commit.
6. **Leave legacy constants** (`LEGACY_APP_NAME`, `LEGACY_VAULT_DIR_NAME`, `LEGACY_PORTABLE_MAGIC`) in place for 2+ releases so migrations keep working.

### 3.5 Bindings / generated files

`src/bindings.ts` is auto-generated (see CLAUDE.md). Do **not** hand-edit. After the rename, run `bun run build` to regenerate.

---

## 4. Recommended fixes for the FTS corruption issue (priority order)

### 4.1 P0 — set workspace DB PRAGMAs at open time

In `lib.rs` right after `Connection::open(&workspace_db_path)` and before migrations:

```rust
ws_conn.busy_timeout(std::time::Duration::from_secs(5))?;
let _ = ws_conn.pragma_update(None, "journal_mode", "WAL");
let _ = ws_conn.pragma_update(None, "synchronous", "NORMAL");
let _ = ws_conn.pragma_update(None, "cache_size", -32000);
let _ = ws_conn.pragma_update(None, "temp_store", "MEMORY");
ws_conn.execute_batch("PRAGMA foreign_keys = ON;")?;
```

Reason: without WAL, concurrent autosave writes block reads and any crash mid-write leaves the FTS shadow tables in the state that triggers the badge. This is the **single highest-leverage fix** for the symptom described.

### 4.2 P0 — REINDEX on startup when quick_check fails on workspace.db

Currently only `notes.db` gets `quick_check`. Add a workspace-side probe in `workspace_manager.rs`:

```rust
pub fn probe_and_repair(&self) -> Result<(), String> {
    let conn = self.conn.blocking_lock();
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if check != "ok" {
        log::warn!("[workspace] quick_check failed: {check}. Running REINDEX workspace_fts.");
        let _ = conn.execute("REINDEX workspace_fts", []);
        // If still bad, drop and rebuild virtual table.
    }
    Ok(())
}
```

Call from `lib.rs` after `ensure_workspace_fts_populated()`.

### 4.3 P1 — debounce the vault watcher

Batch per-path events by ~300-500ms. A `HashMap<PathBuf, Instant>` on the watcher thread is enough. The structure at `lib.rs:353-390` already has the right shape for this — the change is localized.

### 4.4 P1 — add a guard to `get_node`'s new mtime-sync branch

As noted in §2.2: require `file_mtime > n.updated_at + 1` (or use a 500ms tolerance) so the watcher's own writes don't trigger a second round of persistence.

### 4.5 P2 — phantom-delete guard for `workspace_fts`

Change `replace_workspace_fts_row` and the raw DELETEs in `sync_node_fts` / `soft_delete_node` to:

```sql
DELETE FROM workspace_fts WHERE node_id = ?1
  AND EXISTS (SELECT 1 FROM workspace_fts WHERE node_id = ?1);
```

or simpler: use `INSERT OR REPLACE` keyed on `node_id` with a unique constraint (FTS5 doesn't allow UNIQUE directly on contentless/external tables, but the current table is plain — you can enforce uniqueness by only calling `replace_workspace_fts_row` once per node per transaction).

Net effect: even if the caller has a stale idea of what's in `workspace_fts`, the DELETE becomes idempotent.

### 4.6 P2 — split "rebuild FTS from DB" from "write vault files"

`ensure_workspace_fts_populated` today does **not** call into the vault writer (verified), but the report's structural recommendation still stands as a design rule: any code path named `rebuild_fts` must never touch the filesystem. Worth adding a comment at `workspace_manager.rs:1190` stating that invariant.

### 4.7 P3 — Windows file-event rate limiting for workspace embedding

`notes.rs:1607-1621` already gates note embedding on Windows via `should_queue_note_indexing`. Mirror that for workspace nodes, or at least expose it behind a setting.

---

## 5. On the Vault plain-text export module (Option B)

> ⚠️ **Section 5b (implementation) was started on 2026-04-19. See §5b below.
> All §4 fixes should be completed before beginning §5 on a fresh checkout.**

---

## 5b. Vault Export — Implemented (2026-04-19)

**Status: export only. Import deferred until §4.3 (watcher debounce) is shipped.**

> **For full detail** (all Q&A, data model answers, format examples): see `vault-clarifications.md`.
> This section is the canonical summary. Once §4.3 is done and import is built, fold vault-clarifications.md content here.

### Governing Frame

**Core thesis — Defer UI, not storage:**
> "Some things can be deferred in UI, but should not be deferred in storage.
> Card body is the best example. You can defer showing it on the board,
> but if you don't preserve it in the schema/export now, you create migration pain later."
> — external senior review

**Data model hierarchy:**
```
Table  ← CANONICAL (source of truth)
Board  ← projection: each card = row, grouping = status field, body preserved
Calendar ← projection: each task = row, grouping = date field, body preserved
```

Board and calendar are views over the table data. One `workspace_nodes.row` entry serves both.
**Build order: Table → Board → Calendar.** Table import must be solid before board/calendar import.

### What Must Never Be Deferred (Storage Semantics)

| Item | Why deferring is expensive |
|---|---|
| Stable IDs for database, row, field, view, and select options | All five levels must be stable or cross-references break on rename |
| Card/row body preserved in schema + export | Old body content becomes inaccessible if not exported today |
| Board grouping by field ID + option ID, not label | Renaming a status option breaks all boards if keyed by label |
| Card ordering within column (`position` f64) in sub-doc YAML | Drag order cannot survive round-trip if not preserved |
| Calendar date semantics (date-only vs datetime, timezone, all-day) | Dates shift on import without fixed UTC semantics |
| Option/color metadata keyed by stable option ID | Rename creates orphaned color assignments if keyed by label |
| Hidden columns marked but still exported | Visibility is a view property; hidden data still belongs in the vault |

### What Can Be Deferred (UI Only)

| Item | Why deferring is safe |
|---|---|
| Board card body preview on card face | Body is in storage and exported; UI just doesn't render it yet |
| Fancy card headers, covers, badges | Pure rendering; no data semantics |
| Rich column styling beyond basic option colors | CSS only; no schema change |
| Calendar recurrence, reminders, date ranges | Scheduling semantics; not needed for basic task mapping |
| Multiple calendar date fields per database | Single primary date field sufficient for v1 |
| Board/calendar high-fidelity round-trip import | Table import is the foundation |

### Files Added

| File | Purpose |
|---|---|
| `managers/workspace/vault/format.rs` | Core types (`VaultOption`, `VaultField`, `VaultType`), cell serialization, YAML frontmatter, slug, date helpers |
| `managers/workspace/vault/table.rs` | Table export: YAML frontmatter + CSV body via `csv` crate |
| `managers/workspace/vault/calendar.rs` | Calendar export: YAML frontmatter + Obsidian Tasks body |
| `managers/workspace/vault/board.rs` | Board export: main file + card sub-docs in `databases/{slug}/cards/` |
| `managers/workspace/vault/mod.rs` | `VaultManager` orchestrator — no DB connection held |
| `commands/vault_sync.rs` | Tauri command handlers |

### Commands Wired Up

- `export_database_to_vault` ✅ — single database by ID
- `export_all_databases_to_vault` ✅ — batch export all non-deleted databases
- `import_new_databases_from_vault` ❌ NOT built — deferred (needs §4.3 first)
- `full_vault_backup` ❌ NOT built — deferred (depends on import)

### Key Decisions (From Codebase Analysis)

| Question | Decision |
|---|---|
| Round-trip mode | **Human-readable backup** (Option B). Vault is one-way export. Watcher re-import is manual-only. |
| Row UUID | Stored in `_row_id` CSV pseudo-column (table), card YAML frontmatter (board), `<!-- infield_row_id: -->` comment (calendar). UUIDs are `uuid::Uuid::new_v4()` — crypto-random v4, no recycling. |
| Board card body | `row.body` = card description (raw markdown). Preserved in `databases/{slug}/cards/{row-id}.md` even if UI doesn't render it yet. |
| Board grouping | By `field_id + option_id`, not label. `column_option_id` in card YAML. `## Uncategorized` for null. |
| Board card order | `position: f64` stored in card YAML. Rows within column sorted by position ascending. |
| Calendar date | Stored as Unix ms epoch (UTC). `date`: `YYYY-MM-DD`. `date_time` with `include_time`: `YYYY-MM-DDTHH:MM:SSZ`. `include_time` is a persisted field flag. |
| Calendar unscheduled | `## Unscheduled` section at bottom for null date rows. |
| Blank grouping field | `## Uncategorized` column at end of board file with `column_option_id: null`. |
| Column change in Obsidian | Main board file is authoritative. Card `column_option_id` in YAML is context only, not used on import. |
| Hidden columns | All fields exported. Hidden fields marked `hidden: true` in frontmatter. |
| Protected fields | Excluded from CSV entirely. Noted in frontmatter `excluded_fields:` list. |
| Formula fields | No `Formula` FieldType. Per-cell `formula` property holds expression; `value` is cached result. Export `value` as plain text, mark `has_formula: true` in frontmatter. |
| Checklist (7) vs Checkbox (5) | Checkbox = bool. Checklist = array of `{text, is_checked}`. CSV: semicolon-separated `[ ] item; [x] done`. |
| `multi_select` separator | JSON array of names: `["Option A","Option B"]`. NOT pipe-separated (avoids collision). |
| `type_option` double-encoding | Stored as JSON string inside JSON object. Parse both: `Value::Object` directly, and `Value::String` that must be `serde_json::from_str`ed again. |
| Option colors | Named string enum (`"purple"`, `"pink"`, `"yellow"`, etc.), NOT hex. Stored in `type_option.options[].color`. |

### Vault File Format Summary

**Namespace: `infield_version: 1`, `infield_type: "table/board/calendar/board-card"`**
(Not `handy_version` — no backward compat with Handy exports. Add later if needed.)

| Layout | Vault path |
|---|---|
| Table (grid/chart) | `databases/{slug}.md` — YAML frontmatter + CSV body |
| Calendar | `databases/{slug}/calendar.md` — YAML frontmatter + Obsidian Tasks body |
| Board | `databases/{slug}/board.md` + `databases/{slug}/cards/{row-id}.md` per card |

**Slug collision:** Two databases with the same name overwrite each other. UI should warn before export.

### Known Gaps (Intentional)

- **Import not built**: requires §4.3 debounce first. Without it, card sub-doc writes trigger redundant re-import loops.
- **Batch error visibility**: `export_all_databases_to_vault` continues on per-database failure (logs warning, returns error in `ExportedDatabase.error`). Callers must inspect individual `error` fields.
- **No Handy backward compat**: only `infield_version: 1` accepted. No `handy_version` fallback.
- **`csv` crate used correctly**: RFC 4180 compliant. No hand-rolled CSV parser.

### v2 Deferrals

- Media file copying to `databases/media/`
- Multi-view export (all views, not just primary)
- Watcher auto-import (requires §4.3)
- Sync conflict UI
- Partial re-import (changed rows only)
- Link remapping after re-import
- Board card enriched frontmatter (priority, assignee in card YAML)
- Calendar recurrence/reminders/ranges
- Multiple calendar date fields
- Card body preview on board face
- Round-trip import for board and calendar (table import first)

---



The design in the brief is sensible: YAML frontmatter + body, one `VaultManager` alongside `WorkspaceManager`, new `commands/vault_sync.rs`. Before implementing, decide:

1. **Namespace in frontmatter.** The brief uses `handy_version`, `handy_type`. If you rename to Infield, use `infield_version`, `infield_type`. Keep parsers lenient: accept both keys for at least 2 releases so old exports still import.
2. **CSV library.** Don't hand-roll `parse_csv_line` as the brief does — add the `csv` crate. The hand-rolled version in the brief mishandles quoted fields containing newlines (RFC 4180 allows them).
3. **Board sub-documents.** `row_node.body` is already raw markdown per Rule 10 — no transformation needed to write to `cards/<uuid>.md`. Good.
4. **Watcher integration.** Do not add the board-card import path until you have the debounce from §4.3, otherwise each card file write will re-trigger import of the parent board file.
5. **`serde_yaml::String` usage in `assemble_card_file`** in the brief is not a real API. Use `serde_yaml::to_string` on a small struct instead of manual formatting.

This work is **independent** of the FTS fixes and the rename. Do FTS fixes (§4) and the vault-path unification (§3.4 step 1) first — the vault module will depend on `resolve_vault_root`.

---

## 6. Suggested commit sequence

### Completed (2026-04-19)

| Step | Description | Status |
|---|---|---|
| §3.4 step 1 | Vault-path unification — `resolve_vault_root` + `app_identity.rs` | ✅ Done |
| §2 | Three-file change: `app_identity.rs`, `workspace_nodes.rs` (mtime guard), `workspace_manager.rs` (`sync_document_body_from_vault`) | ✅ Done |
| §5 | Vault plain-text export module (§5b above) | ✅ Done (export only; import deferred) |
| §4.1 + §4.2 | Workspace DB WAL + busy_timeout + startup REINDEX | ✅ Done |
| §4.4 | get_node mtime tolerance guard | ✅ Done |
| §4.3 | Vault watcher 500ms debounce | ✅ Done |
| §4.5 + §4.6 | Idempotent FTS DELETE + rebuild invariant comment | ✅ Done |
| §4.7 | Windows embedding rate-limit gate | ✅ Done |
| N/A | Transcription model-unload race fix | ✅ Done |
| N/A | Workspace search repair (SearchTab integration) | ✅ Done |
| N/A | Vault export UI (SearchTab button) | ✅ Done |
| §3.4 step 1 | `fix(vault): route watcher + DatabaseManager through resolve_vault_root` (lib.rs call sites) | ✅ Done |

### Remaining

| Step | Description | Blocking |
|---|---|---|
| 1 | `fix(vault): Flat Vault Architecture & Persistence Fix` (Flatten `compute_vault_rel_path`, inject `parent_id` to frontmatter, force `ensure_transcription_folder` to write to vault) | ✅ Done |
| 2 | `chore(rename): product strings + tauri.conf.json identifier + updater URL` (§3.1, §3.2, §3.3) — major version bump | ✅ Done |
| 3 | `fix(vault): Persistence Hardening & Error Handling` (Replace `let _ =` with error logging, fix collision overwrite on unreadable files) | ✅ Done |
| 4 | `chore(rename): cargo crate + lib name` (§3.2 last bullet) | separate refactor commit |
| 5 | Vault import commands + watcher integration (§5b) | After step 4 |

---

## 7. One-paragraph summary for the PR description

The existing `workspace_fts` virtual table lacks the guards we already applied to `notes_fts`, and the workspace SQLite connection never enables WAL, so any mid-write interruption leaves the FTS shadow tables in a state that trips the notes-health probe and surfaces as "Notes DB issue" in the footer. Claude Code's three-file change does a legitimate job of persisting vault-as-truth reads back into the DB (fixing the previous phantom re-embed loop) and stubs in the Infield rename via `app_identity.rs`, but the rename is ~5% complete — the vault watcher and `DatabaseManager` both still hardcode `handy-vault`, and `tauri.conf.json`, `package.json`, the updater feed, and the bundle identifier all still say Handy. The right order of operations is: (1) flip workspace DB PRAGMAs and add a startup REINDEX; (2) route all vault paths through `resolve_vault_root`; (3) add watcher debounce and a get_node tolerance guard; (4) do the cosmetic rename as a single tagged commit; (5) leave legacy constants in `app_identity.rs` for two releases.
