# W4 Vault Cleanup — Retire Legacy Writers + Close Round-Trip

> **Status (2026-04-27):** Pre-1 + Pre-2 + Commits A, B, D, E ✅ SHIPPED in one session.
> **Commits F, G, H DEFERRED** — fresh-lens review uncovered an architectural gap (the existing `import_database_from_vault` only writes the workspace mirror, not `database.db::db_cells`, so wrapping it with mtime detection would silently no-op for cells). See "Handoff for follow-on session" at the bottom.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the on-disk vault layout match what was promised in PLAN.md:475 — `databases/<slug>/database.md` for schema and `databases/<slug>/rows/<short-id>.md` for every row, regardless of layout. Retire the two legacy writers (inline-CSV table, `cards/<uuid>.md` board) that still run alongside the W4 per-row writer and produce duplicate / misnamed files. ~~Close the external-edit round-trip so a user editing a row's `.md` in VS Code propagates back into SQLite without losing data.~~ (Round-trip half deferred — see handoff.)

**Architecture (unchanged from W4):** `database.db` remains the source of truth for typed cells, schema, and view configs. `workspace_nodes` is the mirror layer that lets vault writers, FTS5, embeddings, and wikilinks see databases natively. The vault is a **bidirectional projection**, not a source of truth — see `2026-04-27` discussion in this conversation for the rationale (vault-as-truth would not simplify FTS5/embedding and would impose O(n) scans on filter/sort/relation operations).

**Tech Stack:** Rust (rusqlite, tokio, serde_json, serde_yaml), Tauri 2 commands.

**Spec / context:**
- [docs/architecture/vault-database-storage.md](../../architecture/vault-database-storage.md) — canonical storage contract
- [docs/superpowers/plans/2026-04-25-w4-bridge-and-cleanup.md](2026-04-25-w4-bridge-and-cleanup.md) — predecessor plan (W4 commits A-G shipped)
- [PLAN.md](../../../PLAN.md) §W4 (✅ shipped 2026-04-26) and §W9 (Cleanup, deferred)
- [CLAUDE.md](../../../CLAUDE.md) Invariants #1, #2, Rules 11, 13, 13a, 14

**Branch:** `main`. Continuation of W4 posture.

**Predecessors:** W4 commits A–G shipped. Two preparatory steps already landed in this session before plan was written:

- **Pre-1** ✅ Slug fallback for unnamed rows: `mod.rs::export_row` now produces `row-<short-id>.md` instead of slugify's `"untitled"` collision when `row.name` is empty/whitespace.
- **Pre-2** ✅ Importer reads new format: `import.rs` gains `parse_database_with_rows`, `parse_row_file`, and `deserialize_cell_yaml`; dispatches when `infield_type: database` OR a sibling `rows/` directory exists. Legacy CSV/cards/calendar paths untouched. 18 vault tests pass.

---

## Why this plan exists

PLAN.md marks W4 ✅ shipped, but inspection of the runtime paths shows three gaps:

| Symptom | Root cause |
|---|---|
| Board mutations write **both** `rows/<slug>.md` AND legacy `cards/<uuid>.md` (duplicate files, UUID names) | `commands/workspace_nodes.rs` lines 258, 583, 606 still call `VaultManager::write_card_for_row` after every row mutation. The W4 ship added `export_row` but didn't retire the prior writer. |
| Full-database export for grid/list/calendar still produces a single inline-CSV `databases/<slug>.md` | `VaultManager::export_database` ([mod.rs:65-84](../../../src-tauri/src/managers/workspace/vault/mod.rs:65)) dispatches by primary view layout to `table::export_table` (CSV) / `calendar::export_calendar` (single-file) / `board::export_board` — NOT to the per-row `export_row` path that incremental mutations use. So `export_all_databases` and any cold re-export drift away from the per-row layout. |
| External-editor edits to `rows/*.md` don't propagate to SQLite | No focus / navigation hook calls `import_database_from_vault` for an open database; Rule 13 conflict guard not wired for row files; importer's diff is full-replace, not row-level. |

**Path A (chosen):** Retire the two legacy writers and route all export through per-row writes. Add a window-focus + navigation hook that re-imports an open database via the new `parse_database_with_rows` reader. Quarantine legacy on-disk files via boot migration before they confuse future imports.

**Path B (rejected):** Keep the legacy writers as a "compatibility export." Multiplies on-disk truth (which file represents the row?), doubles write-amplification, and the ambiguity bites every external-editor user.

---

## File Structure

| File | Role | Commit |
|---|---|---|
| `src-tauri/src/commands/workspace_nodes.rs` | Delete the 3 `write_card_for_row` calls (lines ~258, 583, 606); board now writes only `rows/<slug>.md` via `export_row` | A |
| `src-tauri/src/managers/workspace/vault/mod.rs` | Delete `write_card_for_row` method + its helpers (`resolve_board_group_field_id` retained for `export_database` board path until Commit B replaces it) | A |
| `src-tauri/src/managers/workspace/vault/mod.rs` | Refactor `export_database` to loop `export_row` per row for ALL layouts (grid, list, calendar, board); drop the per-layout dispatch | B |
| `src-tauri/src/managers/workspace/vault/table.rs` | **DELETE** — inline-CSV writer no longer used | B |
| `src-tauri/src/managers/workspace/vault/calendar.rs` | **DELETE** — single-file writer no longer used (calendar is now a view config, not a storage shape) | B |
| `src-tauri/src/managers/workspace/vault/board.rs` | **DELETE** — `cards/<uuid>.md` writer + `board.md` aggregate no longer used | B |
| `src-tauri/src/managers/workspace/vault/mod.rs` | Drop `pub mod {table, calendar, board};` | B |
| `src-tauri/src/managers/workspace/vault/import.rs` | Drop `parse_table` + `parse_board` + `parse_calendar` + `parse_card_file` + `parse_calendar_body` + `parse_csv_into_rows` once Commit D's quarantine confirms no live vaults still use them | E |
| `src-tauri/src/managers/database/migration.rs` | Extend the existing boot migration with a second sweep: move `databases/<slug>.md` (legacy inline-CSV), `databases/<slug>/cards/`, `databases/<slug>/board.md`, and `databases/<slug>/calendar.md` into `<vault>/.handy/legacy-db-files/<timestamp>/`. Idempotent. | D |
| `src-tauri/src/lib.rs` | (no change — migration runs from existing spawn point) | D |
| `src-tauri/src/managers/workspace/window_focus.rs` | **NEW** or extend existing focus handler — when a database node or any of its rows is `currentNodeId`, mtime-check `database.md` + each `rows/*.md`; on drift, call `import_database_from_vault` | F |
| `src-tauri/src/commands/vault_sync.rs` | Add `import_database_from_vault_if_changed(db_id)` that wraps the existing import command with a per-file mtime check; emits Rule 13 conflict-style errors when a row is open in the editor | F |
| `src/contexts/VaultContext.tsx` | Subscribe to `workspace:window-focused`; for the currently-open database, invoke `import_database_from_vault_if_changed` and refresh the grid/board/calendar via existing query invalidation | G |
| `src/components/database/*.tsx` | Surface a non-blocking "Refreshed from disk" toast when the import returns a non-empty diff (Rule 14 toast-suppression carve-out applies for materialization / frontmatter-only changes) | G |
| `src-tauri/src/managers/workspace/vault/import.rs` | Round-trip test: write a database via `export_database` → wipe SQLite → re-import → assert byte-identical re-export | H |

---

## Edge cases addressed (upfront, not buried)

| Edge case | Handling |
|---|---|
| User has an existing vault with legacy `databases/<slug>.md` (inline CSV) AND new `databases/<slug>/database.md` from W4 | Commit D's migration moves the legacy file into `legacy-db-files/<timestamp>/` BEFORE Commit B's deletion of `parse_table` ships. Order matters: D before E. |
| User has `cards/<uuid>.md` files written by W4 alongside `rows/<slug>.md` (the duplicate-file bug) | Commit D quarantines the entire `cards/` directory. The `rows/` directory is authoritative per the storage contract. |
| External edit to a row file while it's open in the editor | Commit F's `import_database_from_vault_if_changed` returns `VAULT_CONFLICT:{...}` when the open editor's `last_seen_mtime` is older than disk mtime + 3s grace (Rule 13a cloud-sync buffer). Frontend shows the existing inline banner. |
| External edit to `database.md` (schema change) while the database is open | Schema editor isn't shipped (deferred per PLAN.md:486). Treat schema drift in the importer as authoritative — apply the new `fields:` array to `database.db` via existing field upsert paths. Out of scope for this plan if it requires field-deletion semantics; if so, surface a "Vault issues" banner and leave SQLite unchanged. |
| Two databases with identical names → same slug → vault file collision | Already a known gap (PLAN.md:485). Out of scope; document in plan deferreds. |
| Position not stored in row YAML frontmatter | `parse_database_with_rows` already sorts by `created_at` then filename and reassigns dense `1.0..N` positions. Manual reorders done in the UI persist in SQLite; on cold re-import they collapse to creation order. Acceptable trade-off — tracked in deferreds. |
| Cloud-sync materialization (file len 0 → non-zero, or YAML-only change) | Rule 14 carve-out: import silently, no toast. Window-focus handler must check `len()` transition. |
| Empty databases (no rows yet) | `parse_database_with_rows` returns `Ok` with `rows: vec![]`. `export_database` writes only `database.md`. No `rows/` directory created until first row exists. |
| Rule 16/16a (ORT concurrency) | Not relevant to this plan — no inference paths touched. |

---

## Tasks

### Commit A ✅ SHIPPED — Delete `write_card_for_row` and its callers

**Why:** Board mutations currently write to both `rows/<slug>.md` (via `export_row`) and `cards/<uuid>.md` (via `write_card_for_row`). The latter is dead-but-running code producing duplicate files with UUID names. Frontend reads from SQLite, so removing it cannot affect UI.

- [ ] Read [src-tauri/src/commands/workspace_nodes.rs:240-262](../../../src-tauri/src/commands/workspace_nodes.rs:240) to confirm the 3 `write_card_for_row` call sites and the surrounding `export_row` calls (which stay).
- [ ] Delete the 3 `write_card_for_row(...)` blocks in `workspace_nodes.rs`. Each is a `if let Err(e) = vm.write_card_for_row(...).await { log::debug!(...) }` with no return-value dependency.
- [ ] Delete the `pub async fn write_card_for_row` method in [src-tauri/src/managers/workspace/vault/mod.rs:95-188](../../../src-tauri/src/managers/workspace/vault/mod.rs:95).
- [ ] `cargo check --lib` clean. `cargo test --lib vault` 18+ passing.
- [ ] Manual smoke: create a board database, add 3 rows in different columns, edit a cell. Inspect `<vault>/databases/<slug>/`. Confirm `rows/<slug>.md` files written, no `cards/` directory created (only existing legacy directories remain — those are quarantined in Commit D).
- [ ] Commit message: `fix(vault): retire write_card_for_row, board now writes rows/<slug>.md only`

### Commit B ✅ SHIPPED — Unify `export_database` on per-row writes

**Why:** `export_database` dispatches to layout-specific writers that produce inline-CSV / single-file shapes that don't match the per-row format the rest of W4 uses. A full re-export (`export_all_databases`) currently overwrites the per-row layout with the legacy shape.

- [ ] Read [src-tauri/src/managers/workspace/vault/mod.rs:37-85](../../../src-tauri/src/managers/workspace/vault/mod.rs:37) (`export_database`).
- [ ] Replace the layout-dispatch with: (1) call `export_database_md(...)` to write/refresh `database.md`; (2) for each non-deleted row in `rows`, call `export_row(...)` with no pending overrides and no mtime check (cold export). Aggregate returned paths into `Vec<PathBuf>`.
- [ ] Delete `pub mod table;`, `pub mod calendar;`, `pub mod board;` from [vault/mod.rs:1-6](../../../src-tauri/src/managers/workspace/vault/mod.rs:1). Delete the three files.
- [ ] Delete `resolve_board_group_field_id` and `resolve_calendar_date_field_id` from `mod.rs` if no longer referenced (compiler will tell us).
- [ ] `cargo check --lib` clean. `cargo test --lib vault` clean.
- [ ] Manual smoke: trigger `export_all_databases` from a dev shell or test command. Inspect output — every database produces `database.md` + `rows/*.md`, no top-level `databases/<slug>.md`, no `board.md`, no `calendar.md`, no `cards/`.
- [ ] Commit message: `refactor(vault): export_database loops export_row, drop layout-specific writers`

### Commit D ✅ SHIPPED — Boot migration: quarantine legacy on-disk files

**Why:** Existing user vaults (incl. dev test vaults) have `databases/<slug>.md` (CSV), `cards/<uuid>.md`, and `board.md` / `calendar.md` files left over from W4 and earlier. Deleting them risks Invariant #2 (never lose user data silently). Quarantine them so the new importer doesn't try to parse them as databases and so they remain forensically recoverable.

- [ ] Open [src-tauri/src/managers/database/migration.rs](../../../src-tauri/src/managers/database/migration.rs). Identify the existing `run_database_mirror_migration` body — extend it with a second pass.
- [ ] Implement `quarantine_legacy_vault_files(vault_root: &Path) -> Result<MigrationReport, String>`:
  - Walk `<vault>/databases/`. For each entry:
    - If file `<slug>.md` exists at the same level as a directory `<slug>/database.md`, move the file → `<vault>/.handy/legacy-db-files/<timestamp>/databases/<slug>.md`.
    - For each `<slug>/` directory: move `cards/`, `board.md`, `calendar.md` (if they exist) → `<vault>/.handy/legacy-db-files/<timestamp>/databases/<slug>/`.
  - Idempotent: if no legacy files exist, no-op (no timestamp directory created).
  - Return `MigrationReport { quarantined_files: usize, quarantined_dirs: usize, errors: Vec<String> }`.
- [ ] Wire into existing migration spawn point (no `lib.rs` change expected if the boot migration already runs).
- [ ] Test: temp vault populated with `databases/foo.md` (CSV) + `databases/foo/database.md` + `databases/foo/cards/abc.md` + `databases/foo/rows/r1.md`. After migration: rows + database.md still present; legacy paths under `.handy/legacy-db-files/`.
- [ ] Test (idempotency): run migration twice. Second run reports zero quarantined.
- [ ] Commit message: `feat(vault): boot migration quarantines pre-W4 database files`

### Commit E ✅ SHIPPED — Drop legacy importer paths

**Why:** Once Commit D quarantines the legacy files, `parse_table` / `parse_board` / `parse_calendar` are dead code. Keeping them confuses the dispatch logic in `parse_vault_database`.

- [ ] Delete `parse_table`, `parse_board`, `parse_calendar`, `parse_card_file`, `parse_calendar_body`, `parse_csv_into_rows`, `extract_task_name`, `extract_row_id_comment`, `deserialize_cell` (CSV-cell variant), `CardFrontmatter` from [import.rs](../../../src-tauri/src/managers/workspace/vault/import.rs).
- [ ] Simplify `parse_vault_database` to always call `parse_database_with_rows` (no dispatch).
- [ ] Update `parse_database_with_rows` to error explicitly if the sibling `rows/` directory is missing AND `infield_type != "database"`, with a message pointing at the migration: "Legacy database file detected; expected to be quarantined by boot migration."
- [ ] `cargo check --lib` clean.
- [ ] `cargo test --lib vault` — drop tests that referenced deleted parsers; existing `parse_database_with_rows` coverage stays.
- [ ] Commit message: `refactor(vault-import): drop pre-W4 parsers, single new-format path`

### Commit F ⏸ DEFERRED — External-edit detection (window focus + import-if-changed)

**Why deferred:** see "Handoff for follow-on session" at the bottom of this file. Short version: `import_database_from_vault` writes only the `workspace_nodes` mirror, not `database.db::db_cells`, so wrapping it with mtime-detection would silently no-op for cell edits. Resolving this needs an architectural decision that doesn't fit in this session's scope.

**Why:** External edits to `rows/*.md` don't propagate without a hook. Documents already do this via `get_node` + window-focus refresh; databases need parity.

- [ ] Read [src-tauri/src/commands/vault_sync.rs:34-40](../../../src-tauri/src/commands/vault_sync.rs:34) (existing `import_database_from_vault`).
- [ ] Add `import_database_from_vault_if_changed(db_id: String) -> Result<ImportRefreshReport, String>`:
  - Fetch the database node + its `vault_rel_path` from `workspace_manager`.
  - Stat `database.md` and every `rows/*.md`. If max mtime ≤ stored `last_imported_mtime` (track per database in memory or a small in-memory map keyed by db_id), return `ImportRefreshReport { changed: false, .. }`.
  - Otherwise call existing `parse_database_with_rows` + `upsert_database_from_import`.
  - For each row that was open in the UI editor (caller passes an optional list of `(row_id, last_seen_mtime)`), apply Rule 13 conflict-guard: if disk mtime > last_seen + 3s, return `VAULT_CONFLICT:{json}` for that row instead of silent overwrite.
- [ ] Register command in `lib.rs::invoke_handler!`.
- [ ] Add specta type `ImportRefreshReport { changed: bool, rows_added: usize, rows_updated: usize, rows_removed: usize, conflicts: Vec<ConflictDetail> }`.
- [ ] `cargo check --lib` clean.
- [ ] Commit message: `feat(vault-sync): import_database_from_vault_if_changed with mtime guard`

### Commit G ⏸ DEFERRED — Frontend wiring + toast

(Blocked on Commit F.)

**Why:** Backend hook is dormant without a frontend caller.

- [ ] Read [src/contexts/VaultContext.tsx](../../../src/contexts/VaultContext.tsx) — find the existing `workspace:window-focused` subscription used for documents.
- [ ] Extend the focus handler: if `currentPage === 'databases'` AND a database is selected, call `invoke('import_database_from_vault_if_changed', { dbId })`.
- [ ] On `report.changed === true` AND no conflicts, invalidate the database-grid query (existing query key) so the table re-renders.
- [ ] On any conflict, surface the existing inline conflict banner (re-use document conflict component) for the affected row(s).
- [ ] On materialization (file len 0 → non-zero) or YAML-only change, suppress the toast per Rule 14 carve-out.
- [ ] Manual smoke: open a database in the app, switch to VS Code, edit a row's `title:` in YAML, save, switch back to app → grid refreshes with the new title; no toast spam.
- [ ] Commit message: `feat(vault-sync): UI refreshes database on external edit`

### Commit H ⏸ DEFERRED — Round-trip test + plan close-out

(Blocked on Commit F.)

**Why:** Lock the contract. Future refactors break loudly.

- [ ] Add a test in [vault/import.rs](../../../src-tauri/src/managers/workspace/vault/import.rs) `mod tests`:
  - Construct a synthetic `DatabaseImport` with mixed field types (rich_text, number, single_select, multi_select, date, checkbox).
  - Write it to a temp vault via `export_database` (requires the test harness gap noted in W4 to be filled, OR mock at the file-write level).
  - Call `parse_vault_database` on the resulting `database.md`.
  - Assert returned `DatabaseImport` is byte-identical to the original (modulo position renumbering).
- [ ] If the test harness gap isn't closed: add a pure-helper test that exercises `parse_row_file` against a hand-written `rows/<id>.md` fixture and asserts cell JSON shape.
- [ ] Update PLAN.md §W4 deferreds list: strike "Field-schema editor" + "Trash UI" if still pending; mark this plan ✅ shipped with link.
- [ ] Update CLAUDE.md "Vault Database Storage" section if any invariants changed (none expected — this plan enforces what was already documented).
- [ ] Commit message: `test(vault): round-trip database export/import + close W4 cleanup`

---

## Stop gate

Before starting Commit F:
1. Commits A, B, D, E shipped. Manual smoke confirms no `cards/`, no inline-CSV `databases/<slug>.md`, no `board.md`, no `calendar.md` written under any operation.
2. `cargo test --lib -- --skip portable` ≥ 206 passed (current baseline).
3. Importer round-trip works in isolation (Commit H test scaffolded).

Before starting Commit G:
1. Commit F backend command compiles, registered in `invoke_handler!`, generates specta bindings on next `bun run tauri dev`.
2. Manual `invoke()` from devtools console returns `{ changed: false, ... }` for an unchanged database, `{ changed: true, ... }` when the file is edited externally.

Before declaring the plan ✅:
1. End-to-end manual: create database → add rows → edit row.md externally → app picks up change. Open row in editor → external edit → conflict banner appears, no silent overwrite.
2. Boot migration tested against a vault containing all three legacy shapes.
3. PLAN.md updated.

---

## Risks

| Risk | Mitigation |
|---|---|
| Commit B's unified `export_database` is slow for large databases (1000+ rows write 1001 files) | Acceptable for W4 — `export_database` is already infrequent (called from `export_all_databases` and on demand). Per-row writes during editing are unchanged. If profiling shows a problem, add a batched-write codepath later. |
| Commit D quarantines a file the user actively wanted (e.g. they manually built a CSV for a database) | Files are moved, not deleted. Quarantine path surfaces in a "Vault issues" panel in a future polish phase. Document the location in PLAN.md for users hitting it. |
| Commit F mtime tracking is in-memory only — restarts always trigger a re-import | Acceptable. Re-import is idempotent + cheap for any reasonable database size. Persisting `last_imported_mtime` in SQLite is a future optimization. |
| Schema drift via external edit to `database.md` lands a half-applied schema | Out of scope for this plan. Document as "schema editing via vault is read-mostly today; field add/rename via UI is W9." |

---

## Deferreds (explicit, do not implement here)

- Manual row reordering persisted across cold re-imports (would need a `position:` field in row frontmatter).
- Slug collision when two databases share a name (PLAN.md:485 — separate plan).
- Field-schema editor (add / rename / delete fields via UI; PLAN.md:486 — W9 work).
- Per-row `db_rows.deleted_at` column (PLAN.md:484).
- Vault file conflict-policy UI for non-row files (`database.md` external edits).
- Persisted `last_imported_mtime` per database (Commit F uses in-memory map only).

---

## Session outcome (2026-04-27)

**Shipped in this branch (~6 commits worth, all green):**

| Step | Result | Tests |
|---|---|---|
| Pre-1: slug fallback for unnamed rows | `row-<8charid>.md` instead of `untitled.md` collisions | existing 18 vault tests |
| Pre-2: importer reads new format | `parse_database_with_rows` + `parse_row_file` + `deserialize_cell_yaml` in `import.rs` | 18 vault tests |
| Commit A: retire `write_card_for_row` | Board mutations no longer double-write `cards/<uuid>.md` | 18 vault tests |
| Commit B: unify `export_database` | All layouts share `database.md` + `rows/<slug>.md`. Deleted `table.rs`, `calendar.rs`, `board.rs`. | 18 vault tests |
| Commit D: boot migration quarantines legacy files | `databases/<slug>.md` (CSV), `cards/`, `board.md`, `calendar.md` swept into `.handy/legacy-db-files/`. Idempotent, cloud-sync-safe. | 6 new quarantine tests |
| Commit E: drop legacy importer parsers | `import.rs` 801→362 lines. `format.rs` 470→205 lines. Single new-format path. | 18 vault tests |

**Net file deletions:** `vault/table.rs`, `vault/calendar.rs`, `vault/board.rs`. Legacy parsers + CSV helpers removed from `import.rs` and `format.rs`.

**Compile/test status:** `cargo check --lib` clean. `cargo test --lib vault` 18 passed, 3 ignored (pre-existing harness gaps). `cargo test --lib quarantine` 6 passed.

---

## Handoff for follow-on session

### What's blocked

Commits F + G + H were meant to close the **external-edit round-trip** — user edits `databases/<slug>/rows/<id>.md` in VS Code, app picks up the change on window focus, grid refreshes. This requires `import_database_from_vault` to actually propagate vault → SQLite.

**Current state of `import_database_from_vault`:** writes only the `workspace_nodes` mirror via `WorkspaceManager::upsert_database_from_import` ([workspace_manager.rs:1168](../../../src-tauri/src/managers/workspace/workspace_manager.rs:1168)). Does NOT touch `database.db::db_cells` (the source of truth for cell values). Does NOT touch `database.db::db_fields` (the source of truth for schema). Does NOT delete rows or fields removed externally.

**Consequence:** wrapping it with mtime detection (the original Commit F plan) would silently no-op for any cell or schema change. The mirror would update; the live UI (which reads from `database.db`) wouldn't see it.

### Three concrete gaps the follow-on session must resolve

1. **Cell sync gap.** `upsert_database_from_import` writes `properties_json` (the cells JSON blob) into `workspace_nodes`. The W4 bridge architecture says cells live in `database.db::db_cells`, not in `workspace_nodes.properties`. So the importer's "upsert" is half-applied — mirror reflects the edit, source-of-truth doesn't.
   - **Fix shape:** add `DatabaseManager::upsert_cells_from_import(db_id, &[RowImport])` that, for each row, loops fields and calls the existing `update_cell` codepath (or a transaction-friendly bulk variant). Coordinate with the mirror upsert in one logical operation.

2. **Phantom-row gap.** External row-file deletion is invisible. If a user deletes `rows/r1.md` in VS Code and triggers an import, `upsert_database_from_import` only inserts/updates the rows in the import payload — it never removes rows that disappeared. The deleted row stays in both `workspace_nodes` and `database.db::db_rows` indefinitely.
   - **Fix shape:** import path computes `vault_row_ids` from disk vs `sqlite_row_ids` from `db_rows.WHERE database_id = ?` and soft-deletes the diff. Critical: must be soft-delete (Invariant #2 — never silent data loss; user can undo via Trash). Add `db_rows.deleted_at` column (already a known PLAN.md:484 deferred — pull it forward if doing this).

3. **Schema-drift gap.** External edit to `database.md` (renaming a field, adding an option, etc.) lands in `workspace_nodes.properties` via mirror upsert, but `database.db::db_fields` is untouched. The grid renders the old schema; cells the user edited under "the new field name" land in a dead key.
   - **Fix shape:** import path also writes through to `db_fields`. Same coordination story as gap #1. Field-schema-editor (PLAN.md:486 W9 work) likely shares this codepath — worth designing them together.

### Architectural decision needed before coding

The deeper question: **how authoritative are external vault edits over SQLite?** Two coherent positions:

- **Position A (vault is non-authoritative for structured data):** External edits to row YAML or `database.md` schema are *advisory*. Imports prompt the user via "Vault issues" panel: "We saw a row file change on disk; apply, ignore, or open diff?" Nothing lands silently.

- **Position B (vault is authoritative when SQLite hasn't been touched since last_seen):** Same Rule 13 story as documents — disk wins if no in-memory editor session conflicts. Conflicts surface the existing inline banner.

Position A is safer (Invariant #2). Position B is what documents do today, so consistency argues for it. Either is defensible. The follow-on session should pick before writing code.

### What NOT to do

- Don't ship Commit F as originally written without solving gap #1. It produces a misleading "the import succeeded" return value.
- Don't make `database.db` writable from the importer without a transaction story. Half-applied imports under crash/rollback are worse than no import.
- Don't delete row files or fields silently. Soft-delete only; surface the diff to the user.
- Don't assume `update_cell` cascades through every side-effect (FTS, embeddings, page_links, mirror sync). It might or might not — verify before bulk-calling it from import.

### Files most relevant to the follow-on

- [src-tauri/src/managers/workspace/workspace_manager.rs:1168](../../../src-tauri/src/managers/workspace/workspace_manager.rs:1168) — `upsert_database_from_import` (the half-broken piece)
- [src-tauri/src/managers/database/manager.rs:361](../../../src-tauri/src/managers/database/manager.rs:361) — `update_cell` (the codepath cell-import would need to share)
- [src-tauri/src/managers/workspace/vault/import.rs](../../../src-tauri/src/managers/workspace/vault/import.rs) — produces `DatabaseImport { rows: Vec<RowImport { properties_json } > }` consumable by both managers
- [src-tauri/src/commands/vault_sync.rs](../../../src-tauri/src/commands/vault_sync.rs) — current Tauri command surface
- [docs/architecture/vault-database-storage.md](../../architecture/vault-database-storage.md) — storage contract; check whether it implies position A or B
- [CLAUDE.md](../../../CLAUDE.md) Rules 13, 13a, 14 — conflict-guard semantics for documents (the precedent to copy or deviate from)
