# W4 Follow-on — Bridge `database.db` ↔ `workspace_nodes` + Vault Cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the architectural gap left after W4 commits A-F so that creating a database produces a real `databases/<slug>/database.md` + `databases/<slug>/rows/<row-id>.md` in the vault, the sidebar→table flow loads fields and rows on selection, and the legacy `<vault>/<id>.db.json` writer is retired.

**Architecture:** `DatabaseManager` keeps `database.db` as the source of truth for fields, cells, and view configs. Every `create_database` / `create_row` mutation now ALSO inserts a mirror row into `workspace.db`'s `workspace_nodes` table (`node_type='database'` / `node_type='row'`) so the existing `VaultManager::export_row` and the new `export_database_md` helper can resolve `vault_rel_path` and write markdown vault-first. Mirror writes happen at the **command** layer (not inside `DatabaseManager`) where `AppState` already gives access to both managers — keeps each manager focused on its own SQLite file. Legacy `.db.json` writer + `json_store` module + `startup_scan` are deleted; a one-time boot migration re-creates missing mirrors and removes orphan `.db.json` files.

**Tech Stack:** Rust (rusqlite, tokio, anyhow, serde_json), Tauri 2 commands, specta-typed bindings.

**Spec / context:**
- [docs/architecture/vault-database-storage.md](../../architecture/vault-database-storage.md) — canonical storage contract
- [docs/superpowers/specs/2026-04-25-w4-databases-design.md](../specs/2026-04-25-w4-databases-design.md) — W4 design doc
- [docs/superpowers/plans/2026-04-25-w4-databases-plan.md](2026-04-25-w4-databases-plan.md) — W4 commits A-F (already shipped)
- [CLAUDE.md](../../../CLAUDE.md) Rules 11, 13, 14, Vault Database Storage section

**Branch:** `main` (continuation of W4, same posture as previous commits).

**Predecessors:** W4 commits A-F shipped. `cargo test --lib -- --skip portable` reports 201 passed before this plan starts.

---

## Why this plan exists

The previous session fixed the empty-sidebar symptom by rewriting `list_databases` to query `database.db` instead of `workspace_nodes`. That was correct given the immediate state — but it locked in two SQLite files that don't see each other:

| Bug | Root cause |
|---|---|
| Selecting a database renders an empty table with only a `title` column | `commands::database::get_cells_for_rows` ([database.rs:611-650](../../../src-tauri/src/commands/database.rs:611)) joins row_ids against `workspace_nodes` to look up `vault_rel_path` for the mtime guard. Rows live in `db_rows` only, so the join returns no `vault_rel_path` and the cell-fetch path silently no-ops on the frontend. |
| No `database.md` in the vault folder | `DatabaseManager::create_database` calls `write_json` ([manager.rs:151,728-752](../../../src-tauri/src/managers/database/manager.rs:728)) which writes `<vault>/<id>.db.json` — wrong format (JSON not markdown), wrong location (vault root not `databases/<slug>/`). The W4 spec assumed `create_database_inner` already called `export_table` which writes `database.md` — that path is **not** wired. |

**Path A (chosen):** Bridge into `workspace_nodes`. Every database/row mutation maintains a mirror row in `workspace_nodes` so existing vault writers, search, embeddings, FTS, and wikilinks all see databases natively.

**Path B (rejected):** Refactor `export_table`/`export_row` to read directly from `DatabaseManager`. Lighter on writes but breaks Invariant #4 (AI-native search over everything) — rows wouldn't appear in FTS, embeddings, or page_links.

---

## File Structure

| File | Role | Commit |
|---|---|---|
| `src-tauri/src/managers/workspace/workspace_manager.rs` | Add `upsert_workspace_mirror_node` (one generic helper for database + row mirror inserts/upserts). Soft-delete reuses the existing `soft_delete_node` (cascade + FTS clean + embeddings clean). | A |
| `src-tauri/src/managers/workspace/vault/database_md.rs` | **NEW** — `export_database_md(vault_root, db_node, fields) -> Result<PathBuf>` | B |
| `src-tauri/src/managers/workspace/vault/mod.rs` | Re-export `database_md::export_database_md`; add a thin `VaultManager::export_database_md(db_id)` wrapper | B |
| `src-tauri/src/commands/database.rs` | Refactor `create_database` to take `State<'_, Arc<AppState>>`; orchestrate database.db insert → workspace_nodes mirror → `export_database_md` | C |
| `src-tauri/src/commands/database.rs` | Refactor `create_row` + `create_row_in_group` similarly; orchestrate db_rows insert → workspace_nodes mirror → existing `export_row` | D |
| `src-tauri/src/commands/database.rs` | Wire `delete_row` (soft) and `permanent_delete_row` (hard) to mirror into workspace_nodes; rename `update_row` paths to also update mirror name | E |
| `src-tauri/src/managers/database/manager.rs` | Delete `write_json`, `snapshot_parts`, `startup_scan`; remove `super::json_store` import; clean stale list_databases doc comments | F |
| `src-tauri/src/managers/database/json_store.rs` | **DELETE** entire file | F |
| `src-tauri/src/managers/database/mod.rs` | Remove `pub mod json_store;` line | F |
| `src-tauri/src/managers/database/migration.rs` | **NEW** — free function `run_database_mirror_migration(db_mgr, ws_mgr, vm) -> MigrationReport`. Idempotent boot migration: backfills mirrors for legacy databases + sweeps orphan `<vault>/<id>.db.json` files into `<vault>/.handy/legacy-db-json/` | G |
| `src-tauri/src/managers/database/mod.rs` | Add `pub mod migration;` declaration | G |
| `src-tauri/src/lib.rs` | Spawn `run_database_mirror_migration` after `app_handle.manage(database_manager)` | G |
| `src-tauri/src/commands/database.rs` | Add edge-case integration tests | H |

---

## Edge cases addressed (upfront, not buried)

These shape the task code below. Every edge case maps to at least one task or test.

| # | Edge case | How it's handled |
|---|---|---|
| 1 | **Existing databases created via the broken `write_json` flow** | Boot migration in Commit G scans `databases` table; for each row missing a `workspace_nodes` mirror, creates one. Idempotent — safe to run on every boot. |
| 2 | **Orphan `<vault>/<id>.db.json` files at vault root** | Boot migration moves them to `<vault>/.handy/legacy-db-json/` (preserves user data; never silent-deletes per Invariant #2). |
| 3 | **Slug collision** (two databases named "Projects") | `WorkspaceManager::write_node_to_vault` already implements collision policy (append `-<first8ofid>`). New `export_database_md` reuses the same `slugify` helper from `vault::format`; the database's `vault_rel_path` is computed once at create time and persisted, so subsequent renames don't re-collide. |
| 4 | **Empty database (no rows yet)** | `export_database_md` writes `database.md` with empty `rows:` count in frontmatter description but `database.md` itself only contains schema. Rows appear lazily as `rows/<id>.md` files when created. |
| 5 | **Concurrent `create_database` calls** | Each call's database.db INSERT is atomic; workspace_nodes INSERT is a separate transaction. If the second insert fails (workspace conflict), database.db row is rolled back via explicit DELETE in the error path. Tests cover this. |
| 6 | **App killed mid-create_database** (database.db written, mirror not yet) | Boot migration (Commit G) backfills the mirror on next launch. The user sees the database in the sidebar after restart. |
| 7 | **App killed mid-create_row** (db_rows written, mirror not, vault file not) | Same as #6 — migration backfills. Vault file is regenerated by `export_row` on first cell edit (or stays absent until then; that's fine — vault is downstream of SQLite for rows). |
| 8 | **Vault file edited externally between SQLite write and `export_row`** (Rule 13) | Already handled by `export_row` mtime guard. New mirror code does not change this. |
| 9 | **Database deleted then recreated with same name** | Soft-delete sets `deleted_at` on workspace_nodes mirror; the row file stays on disk per Rule 13 lifecycle. New database with same name gets a different UUID, so slug-collision guard appends `-<short_id>` to the new path. No clash. |
| 10 | **Row soft-delete vs permanent-delete** | Soft-delete: set `deleted_at` on mirror; vault file untouched. Permanent-delete: cascade DELETE in db_rows/db_cells (already wired); workspace_nodes mirror gets `deleted_at` set; `permanent_delete_node` (existing function) deletes the vault file. |
| 11 | **Schema change** (field renamed/added/removed via direct vault edit) | Out of scope for W4 (field-schema editor deferred). On boot, `vault::import` reads `database.md` and reconciles `db_fields`. New `export_database_md` only triggers on database create + on explicit reindex. |
| 12 | **Frontend bindings.ts regenerates** | Specta auto-regenerates on `bun run tauri dev`. Any frontend code that referenced `DatabaseSnapshot` types from `json_store` will fail to compile — intentional; `json_store` is deleted in Commit F. Grep confirms no frontend imports of those types before Commit F. |
| 13 | **Tests asserting `<id>.db.json` exists** | The six tests in `manager.rs::tests` updated in the previous session don't assert `.db.json`; they call `list_databases` and assert SQL state. No changes needed. The legacy `startup_scan` test (if any) is removed in Commit F. |
| 14 | **Migration when `databases` table is empty** | `run_database_mirror_migration` SELECT returns zero rows; no-op. Test covers this. |
| 15 | **Migration when a `databases` row has zero `db_fields`** (broken state) | Should be unreachable since `create_database` always creates a primary "Name" field, but defensive: if encountered, log warning, create the workspace_nodes mirror with empty `properties: '{}'`, do NOT write `database.md` (skipped to avoid producing a malformed file). User can fix by deleting the row. |
| 16 | **Migration when `<vault>/<id>.db.json` references an id NOT in the `databases` table** | Move file to legacy folder unchanged. Don't try to re-import — that's a vault/import.rs concern, out of scope. |
| 17 | **Cross-process vault lock** (Rule 15) | Already handled by `VaultLock` at `lib.rs` init. Migration runs after lock is acquired. |
| 18 | **Cloud-sync** (`.db.json` placeholder file detected during migration) | Skip files with `len() == 0` per Rule 14 cloud-sync defensiveness; log "deferring legacy file (cloud-sync placeholder)" and try again on next boot. |

---

## Commit A — Mirror helper in `WorkspaceManager` (✅ shipped)

**Status:** shipped on `main` as commits 5624ee23 + follow-up consolidation. Use this section as a reference, not a checklist.

**What landed:**
- One generic helper, `upsert_workspace_mirror_node(node_id, parent_id, node_type, name, icon, position, properties_json, vault_rel_path)`, in `src-tauri/src/managers/workspace/workspace_manager.rs`. Both database mirrors (`parent_id=None`, `node_type="database"`) and row mirrors (`parent_id=Some(db_id)`, `node_type="row"`) go through it.
- Soft-delete is handled by the existing `WorkspaceManager::soft_delete_node` (cascade delete + FTS clean + embedding queue clean) — no new `mark_node_deleted` helper.
- `embedding_worker` field is now `Option<Arc<EmbeddingWorker>>` so unit tests can construct without a Tauri AppHandle. Production `new(...)` wraps in `Some`; the 9 `enqueue_index`/`enqueue_delete` call sites are guarded with `if let Some(w) = &self.embedding_worker`.
- A `#[cfg(test)] pub fn new_in_memory() -> Result<Self, String>` constructor exists for future tests, but is unused — see Pitfall below.

**Pitfall to remember for B–H:** instantiating `WorkspaceManager` in unit tests on Windows MSVC fails to load the test exe with `STATUS_ENTRYPOINT_NOT_FOUND` (0xc0000139) because materialising `Option<Arc<EmbeddingWorker>>` pulls in `tauri::AppHandle` drop glue with unresolved symbols. Documented in `pitfall.md`. Coverage strategy for downstream commits:
- Pure-SQL helpers → SQL-direct tests against an in-memory `rusqlite::Connection` after `WorkspaceManager::migrations().to_latest(...)`. See `upsert_workspace_mirror_node_sql_round_trips_database_and_row` in `migration_tests` for the pattern.
- Pure file writers (B's `export_database_md`, G's migration) → call directly with constructed structs + temp dir; no `WorkspaceManager` needed.
- Orchestration (C/D/E) → smoke-test via `bun run tauri dev` per the manual gates in G-11 and H-7. Do not invent integration test infrastructure mid-plan.

**Caller signatures for B–H:**
- Database create: `ws_mgr.upsert_workspace_mirror_node(&db_id, None, "database", &name, "", 1.0, "{}", &vault_rel_path).await?`
- Row create: `ws_mgr.upsert_workspace_mirror_node(&row_id, Some(&db_id), "row", "", "", position, "{}", &vault_rel_path).await?`
- Soft delete (cascades): `ws_mgr.soft_delete_node(&node_id).await?`

---

## Commit B — `export_database_md` vault writer

**Goal:** A function that writes `databases/<slug>/database.md` from `WorkspaceNode` + field schema. Produces the format specified in [vault-database-storage.md:39-70](../../architecture/vault-database-storage.md:39).

**Files:**
- Create: `src-tauri/src/managers/workspace/vault/database_md.rs`
- Modify: `src-tauri/src/managers/workspace/vault/mod.rs` (add `pub mod database_md;` and `VaultManager::export_database_md` wrapper)

### Tasks

- [ ] **B-1: Create `database_md.rs` skeleton**

```rust
// src-tauri/src/managers/workspace/vault/database_md.rs
use std::path::{Path, PathBuf};

use super::format::{slugify, yaml_str, VaultField, VaultType, serialize_common_frontmatter};
use crate::managers::database::field::Field;
use crate::managers::workspace::node_types::WorkspaceNode;

/// Write `databases/<db-slug>/database.md` containing the schema in YAML
/// frontmatter and a placeholder description body. Atomic temp-file + rename.
/// Returns the absolute path of the written file.
///
/// Caller is responsible for the Rule 13 mtime guard before calling.
/// (At W4 we only call this on initial create + on import-from-vault, where
/// the file does not yet exist, so the guard is a no-op.)
pub fn export_database_md(
    vault_root: &Path,
    db: &WorkspaceNode,
    fields: &[Field],
) -> Result<PathBuf, String> {
    let db_slug = slugify(&db.name);
    let db_dir = vault_root.join("databases").join(&db_slug);
    std::fs::create_dir_all(&db_dir)
        .map_err(|e| format!("create_dir_all({db_dir:?}) failed: {e}"))?;

    let target = db_dir.join("database.md");
    let tmp = db_dir.join("database.md.tmp");

    let vault_fields: Vec<VaultField> = fields
        .iter()
        .map(|f| field_to_vault_field(f))
        .collect();

    let mut content = serialize_common_frontmatter(
        VaultType::Database,
        &db.id,
        &db.name,
        &db.icon,
        None,                       // cover deferred
        db.created_at,
        db.updated_at,
        &vault_fields,
        &[],                        // no protected fields in W4
    );
    // Trailing `---` to close frontmatter, then placeholder body.
    content.push_str("---\n\n");
    content.push_str(&format!(
        "Database: {}. Edit rows in the table view; this file is regenerated on schema change.\n",
        db.name
    ));

    std::fs::write(&tmp, &content).map_err(|e| format!("write tmp failed: {e}"))?;
    std::fs::rename(&tmp, &target).map_err(|e| format!("rename failed: {e}"))?;
    Ok(target)
}

fn field_to_vault_field(f: &Field) -> VaultField {
    VaultField {
        id: f.id.clone(),
        name: f.name.clone(),
        field_type: format!("{:?}", f.field_type).to_lowercase(),
        is_primary: f.is_primary,
        position: f.position as i64,
        // type_option serialization deferred — schema editor isn't in W4.
        // For now, dump the type_option JSON as-is.
        type_option_json: serde_json::to_string(&f.type_option).unwrap_or_else(|_| "{}".into()),
    }
}
```

Note: `VaultType::Database` and `VaultField` types must exist in `vault::format`. If `VaultType` only has `Table` / `Board` today, add a `Database` variant in the same commit (`vault/format.rs`). If `VaultField` has different field names, adjust the struct literal here.

- [ ] **B-2: Verify `VaultType::Database` exists; if not, add it**

```
grep -n "enum VaultType" src-tauri/src/managers/workspace/vault/format.rs
```

If the variant is missing, add `Database,` to the enum and a match arm in any `match VaultType` blocks. Run:

```
cargo build 2>&1 | head -20
```

If `VaultField`'s field name for type-option is `type_option` (struct value) rather than `type_option_json` (string), adjust `field_to_vault_field` to match. Read the struct definition before guessing.

- [ ] **B-3: Wire the module into `vault/mod.rs`**

In `src-tauri/src/managers/workspace/vault/mod.rs`, find the `pub mod table;` line and add immediately after:

```rust
pub mod database_md;
```

- [ ] **B-4: Add `VaultManager::export_database_md` wrapper**

In `vault/mod.rs`, find `impl VaultManager` (near `pub async fn export_row` at line 191). Add this method:

```rust
/// Write `databases/<db-slug>/database.md` for a database. Reads the database
/// node from WorkspaceManager and the field schema from DatabaseManager,
/// then calls the pure `database_md::export_database_md` helper.
pub async fn export_database_md(
    &self,
    db_id: &str,
    workspace_manager: &WorkspaceManager,
    db_mgr: &crate::managers::database::manager::DatabaseManager,
) -> Result<std::path::PathBuf, String> {
    let db = workspace_manager
        .get_node(db_id)
        .await?
        .ok_or_else(|| format!("Database '{db_id}' not found in workspace_nodes"))?;
    if db.node_type != "database" {
        return Err(format!("Node '{db_id}' is not a database (got '{}')", db.node_type));
    }
    let fields = db_mgr
        .get_fields(db_id)
        .await
        .map_err(|e| format!("get_fields failed: {e}"))?;
    database_md::export_database_md(&self.vault_root, &db, &fields)
}
```

- [ ] **B-5: Write an integration test**

Add to `vault/mod.rs` `#[cfg(test)] mod tests` (find the existing `export_row_*` tests and add this near them):

```rust
#[tokio::test]
async fn export_database_md_writes_expected_path_and_frontmatter() {
    let temp = tempdir().expect("tempdir");
    let vault_root = temp.path().to_path_buf();

    let ws_mgr = WorkspaceManager::new_in_memory().expect("ws_mgr");
    let db_mgr_path = temp.path().join("database.db");
    let db_mgr = DatabaseManager::new_with_path(db_mgr_path).expect("db_mgr");

    // Arrange: db.db has the canonical "primary Name field" shape from create_database.
    let db_id = db_mgr.create_database("My Projects".into()).await.expect("create_database");
    ws_mgr
        .upsert_workspace_mirror_node(&db_id, None, "database", "My Projects", "📊", 1.0, "{}", "databases/my-projects/database.md")
        .await
        .expect("upsert mirror");

    let vm = VaultManager::new(vault_root.clone());

    // Act
    let path = vm
        .export_database_md(&db_id, &ws_mgr, &db_mgr)
        .await
        .expect("export_database_md");

    // Assert
    assert!(path.ends_with("databases/my-projects/database.md"));
    assert!(path.exists(), "database.md should be on disk");
    let body = std::fs::read_to_string(&path).expect("read");
    assert!(body.contains("---"), "frontmatter delimiter present");
    assert!(body.contains(&format!("id: {}", db_id)), "id in frontmatter");
    assert!(body.contains("name: My Projects"), "name in frontmatter");
    assert!(body.contains("Name"), "primary field present");
}
```

- [ ] **B-6: Run test to verify pass**

```
cargo test --lib export_database_md_writes_expected_path -- --nocapture
```

Adjust assertions if the actual `serialize_common_frontmatter` output uses different YAML field names. Fix until green.

- [ ] **B-7: Run full lib test suite**

Expected: 205 passed.

- [ ] **B-8: Commit**

```bash
git add src-tauri/src/managers/workspace/vault/database_md.rs \
        src-tauri/src/managers/workspace/vault/mod.rs \
        src-tauri/src/managers/workspace/vault/format.rs
git commit -m "feat(w4): VaultManager::export_database_md + new vault::database_md module"
```

---

## Commit C — Wire `create_database` to mirror + write `database.md`

**Goal:** `create_database` now: (1) inserts into `database.db`, (2) inserts mirror into `workspace_nodes`, (3) writes `database.md` to the vault. Replaces the legacy `write_json` call.

**Files:**
- Modify: `src-tauri/src/commands/database.rs` — `create_database` Tauri command + `create_database_inner` (around line 56)

### Tasks

- [ ] **C-1: Read existing `create_database` command**

Open `src-tauri/src/commands/database.rs`, locate the `#[tauri::command] pub async fn create_database` (search for `fn create_database`). Note its current signature — likely takes `State<'_, Arc<DatabaseManager>>`. We need to switch it to `State<'_, Arc<AppState>>` to access both managers + VaultManager.

- [ ] **C-2: Write a failing integration test**

Add to `commands/database.rs` `#[cfg(test)] mod tests` block (or create one if absent — the file likely has tests already; search for `#[cfg(test)]`):

```rust
#[tokio::test]
async fn create_database_creates_workspace_nodes_mirror_and_database_md() {
    let temp = tempdir().expect("tempdir");
    let vault_root = temp.path().to_path_buf();

    let ws_mgr = Arc::new(WorkspaceManager::new_in_memory().expect("ws_mgr"));
    let db_mgr_path = temp.path().join("database.db");
    let db_mgr = Arc::new(DatabaseManager::new_with_path(db_mgr_path).expect("db_mgr"));
    let vm = Arc::new(VaultManager::new(vault_root.clone()));

    let meta = create_database_inner_with_vault(&db_mgr, &ws_mgr, &vm, "Projects".into())
        .await
        .expect("create_database_inner_with_vault");

    // 1. Mirror exists in workspace_nodes
    let node = ws_mgr.get_node(&meta.id).await.expect("get_node").expect("mirror exists");
    assert_eq!(node.node_type, "database");
    assert_eq!(node.name, "Projects");
    assert_eq!(node.vault_rel_path.as_deref(), Some("databases/projects/database.md"));

    // 2. database.md exists on disk
    let md_path = vault_root.join("databases").join("projects").join("database.md");
    assert!(md_path.exists(), "database.md should exist on disk");

    // 3. SQLite databases row exists
    let listed = db_mgr.list_databases(None).await.expect("list_databases");
    assert!(listed.iter().any(|(id, _, _, _)| id == &meta.id));
}
```

- [ ] **C-3: Run test to verify it fails**

Expected: FAIL with "no function `create_database_inner_with_vault`".

- [ ] **C-4: Refactor `create_database_inner` to `create_database_inner_with_vault`**

Replace the existing `create_database_inner` (around line 56) with:

```rust
/// Vault-aware database creation. Inserts into database.db, mirrors into
/// workspace_nodes, then writes `databases/<slug>/database.md`. If the mirror
/// or vault write fails, the database.db row is rolled back.
pub async fn create_database_inner_with_vault(
    db_mgr: &Arc<DatabaseManager>,
    ws_mgr: &Arc<WorkspaceManager>,
    vm: &Arc<VaultManager>,
    name: String,
) -> Result<DatabaseMeta, String> {
    // 1. database.db insert (creates the databases row + primary "Name" field).
    let id = db_mgr
        .create_database(name.clone())
        .await
        .map_err(|e| e.to_string())?;

    // 2. Compute the canonical vault_rel_path. slugify is deterministic.
    let slug = crate::managers::workspace::vault::format::slugify(&name);
    let vault_rel_path = format!("databases/{slug}/database.md");

    // 3. Mirror into workspace_nodes. On failure, roll back the database.db row.
    if let Err(e) = ws_mgr
        .upsert_workspace_mirror_node(&id, None, "database", &name, "", 1.0, "{}", &vault_rel_path)
        .await
    {
        log::warn!("Mirror upsert failed for db '{id}'; rolling back database.db row: {e}");
        let _ = db_mgr.delete_database_hard(&id).await;
        return Err(format!("Failed to mirror database into workspace_nodes: {e}"));
    }

    // 4. Write database.md vault-first. On failure, leave SQLite rows in place
    //    (boot migration will retry). Vault drift is recoverable; SQLite drift isn't.
    if let Err(e) = vm.export_database_md(&id, ws_mgr, db_mgr).await {
        log::warn!("export_database_md failed for db '{id}': {e}. SQLite state retained; will retry on boot.");
        // Do NOT roll back — the database is usable; vault file regenerates on demand.
    }

    Ok(DatabaseMeta { id, name })
}
```

Note: this requires a new `DatabaseManager::delete_database_hard(&id)` method for the rollback path. If it doesn't exist, add a thin wrapper around `DELETE FROM databases WHERE id = ?1` (CASCADE handles db_fields/db_rows/db_cells/db_views).

- [ ] **C-5: Add `DatabaseManager::delete_database_hard`**

In `src-tauri/src/managers/database/manager.rs`, after `create_database` (around line 153):

```rust
/// Hard-delete a database and all child rows/fields/cells/views from
/// database.db. Used only by `create_database` rollback when the workspace_nodes
/// mirror insert fails. Soft-delete is handled by the workspace_nodes mirror.
pub async fn delete_database_hard(&self, db_id: &str) -> Result<()> {
    let conn = self.conn.lock().await;
    conn.execute("DELETE FROM databases WHERE id = ?1", params![db_id])?;
    Ok(())
}
```

- [ ] **C-6: Update the Tauri command to take `AppState`**

Replace the existing `create_database` command. Locate it (search `pub async fn create_database`) and replace with:

```rust
#[tauri::command]
#[specta::specta]
pub async fn create_database(
    state: State<'_, Arc<AppState>>,
    vm: State<'_, Arc<VaultManager>>,
    name: String,
) -> Result<DatabaseMeta, String> {
    create_database_inner_with_vault(
        &state.database_manager,
        &state.workspace_manager,
        &vm,
        name,
    )
    .await
}
```

- [ ] **C-7: Delete the legacy `create_database_inner` if it remains**

Grep for `create_database_inner` callers across the file:

```
grep -n "create_database_inner" src-tauri/src/commands/database.rs
```

Update all callers to `create_database_inner_with_vault` (most are in tests). Delete the now-unused old function.

- [ ] **C-8: Run the new integration test**

```
cargo test --lib create_database_creates_workspace_nodes_mirror_and_database_md -- --nocapture
```

Expected: PASS.

- [ ] **C-9: Run full lib suite**

Expected: ~206 passed. Some existing tests for `create_database_inner` may need their imports updated to `create_database_inner_with_vault`. Fix until green.

- [ ] **C-10: Verify frontend bindings regenerate cleanly**

```
cd ..   # back to repo root
bun run tauri dev    # let it boot once, watch for specta regeneration of src/bindings.ts
# Ctrl+C after src/bindings.ts updates
git diff src/bindings.ts | head -30
```

The diff should show a new `vm: VaultManager` parameter on `createDatabase()`. The frontend caller in `useDatabase.ts` may need updating; verify with:

```
cd ..
bun run build 2>&1 | tail -20
```

Expected: zero errors. If frontend types fail to compile, update `src/database/useDatabase.ts` to match the regenerated signature. (Since `VaultManager` is also injected via Tauri State, the frontend likely doesn't need to pass anything new — but verify.)

- [ ] **C-11: Commit**

```bash
git add src-tauri/src/commands/database.rs \
        src-tauri/src/managers/database/manager.rs \
        src/bindings.ts
git commit -m "feat(w4): create_database mirrors into workspace_nodes and writes database.md"
```

---

## Commit D — Wire `create_row` and `create_row_in_group` to mirror

**Goal:** Same pattern as Commit C, but for row creation. After `db_rows` insert, mirror into workspace_nodes; the existing `VaultManager::export_row` (already wired in `update_cell`) now finds the row when called.

**Files:**
- Modify: `src-tauri/src/commands/database.rs` — `create_row`, `create_row_in_group`
- Modify: `src-tauri/src/managers/database/manager.rs` — `delete_row_hard` (rollback helper)

### Tasks

- [ ] **D-1: Failing test for `create_row`**

```rust
#[tokio::test]
async fn create_row_creates_workspace_nodes_mirror() {
    let temp = tempdir().expect("tempdir");
    let vault_root = temp.path().to_path_buf();
    let ws_mgr = Arc::new(WorkspaceManager::new_in_memory().expect("ws_mgr"));
    let db_mgr = Arc::new(DatabaseManager::new_with_path(temp.path().join("database.db")).expect("db_mgr"));
    let vm = Arc::new(VaultManager::new(vault_root.clone()));

    let db = create_database_inner_with_vault(&db_mgr, &ws_mgr, &vm, "Projects".into())
        .await
        .expect("create_database");

    let row = create_row_inner_with_vault(&db_mgr, &ws_mgr, &vm, db.id.clone())
        .await
        .expect("create_row");

    let row_node = ws_mgr.get_node(&row.id).await.expect("get_node").expect("row mirror");
    assert_eq!(row_node.node_type, "row");
    assert_eq!(row_node.parent_id.as_deref(), Some(db.id.as_str()));
    let path = row_node.vault_rel_path.expect("vault_rel_path set");
    assert!(path.starts_with("databases/projects/rows/"));
    assert!(path.ends_with(".md"));
}
```

- [ ] **D-2: Run test, expect fail**

- [ ] **D-3: Implement `create_row_inner_with_vault`**

Replace the existing `create_row_inner` (search for it):

```rust
pub async fn create_row_inner_with_vault(
    db_mgr: &Arc<DatabaseManager>,
    ws_mgr: &Arc<WorkspaceManager>,
    _vm: &Arc<VaultManager>,
    database_id: String,
) -> Result<Row, String> {
    // 1. db_rows insert
    let row_id = db_mgr
        .create_row(&database_id)
        .await
        .map_err(|e| e.to_string())?;

    // 2. Look up parent database mirror to compute vault_rel_path
    let db_node = ws_mgr
        .get_node(&database_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Database '{database_id}' has no workspace_nodes mirror; create_database may have been called before bridge was wired"))?;

    let db_slug = crate::managers::workspace::vault::format::slugify(&db_node.name);
    // First-creation row name is empty; slug is the row UUID short-form.
    let row_slug = &row_id[..row_id.len().min(8)];
    let vault_rel_path = format!("databases/{db_slug}/rows/{row_slug}.md");

    // 3. Position: append at end. db_rows uses i64 position; mirror uses f64.
    //    Read current count + 1 as a deterministic ordering value.
    let position = db_mgr
        .get_rows(&database_id)
        .await
        .map_err(|e| e.to_string())?
        .len() as f64;

    if let Err(e) = ws_mgr
        .upsert_workspace_mirror_node(&row_id, Some(&database_id), "row", "", "", position, "{}", &vault_rel_path)
        .await
    {
        log::warn!("Row mirror failed for '{row_id}'; rolling back db_rows row: {e}");
        let _ = db_mgr.delete_row_hard(&row_id).await;
        return Err(format!("Failed to mirror row into workspace_nodes: {e}"));
    }

    // Note: We deliberately do NOT call export_row here. A row with no cells
    // has no meaningful body to write; the file is created on first cell edit
    // when update_cell calls export_row. Empty file = empty data, no benefit.
    Ok(Row { id: row_id, database_id })
}
```

- [ ] **D-4: Add `DatabaseManager::delete_row_hard`**

In `manager.rs`:

```rust
/// Hard-delete a single row from db_rows. Used by `create_row_inner_with_vault`
/// rollback. CASCADE removes db_cells.
pub async fn delete_row_hard(&self, row_id: &str) -> Result<()> {
    let conn = self.conn.lock().await;
    conn.execute("DELETE FROM db_rows WHERE id = ?1", params![row_id])?;
    Ok(())
}
```

- [ ] **D-5: Update Tauri commands**

Replace `create_row` Tauri command:

```rust
#[tauri::command]
#[specta::specta]
pub async fn create_row(
    state: State<'_, Arc<AppState>>,
    vm: State<'_, Arc<VaultManager>>,
    database_id: String,
) -> Result<Row, String> {
    create_row_inner_with_vault(
        &state.database_manager,
        &state.workspace_manager,
        &vm,
        database_id,
    )
    .await
}
```

Same pattern for `create_row_in_group` — it calls `db_mgr.create_row_in_group(...)` for the SQLite insert; add a corresponding mirror call afterward. The group field is set via a follow-up `update_cell` (already mirror-wired), so no extra plumbing needed.

- [ ] **D-6: Run test, expect pass**

- [ ] **D-7: Verify `update_cell` end-to-end now writes `rows/<id>.md`**

Add this test:

```rust
#[tokio::test]
async fn update_cell_writes_row_md_after_mirror_exists() {
    let temp = tempdir().expect("tempdir");
    let vault_root = temp.path().to_path_buf();
    let ws_mgr = Arc::new(WorkspaceManager::new_in_memory().expect("ws_mgr"));
    let db_mgr = Arc::new(DatabaseManager::new_with_path(temp.path().join("database.db")).expect("db_mgr"));
    let vm = Arc::new(VaultManager::new(vault_root.clone()));

    let db = create_database_inner_with_vault(&db_mgr, &ws_mgr, &vm, "Projects".into()).await.expect("create_database");
    let row = create_row_inner_with_vault(&db_mgr, &ws_mgr, &vm, db.id.clone()).await.expect("create_row");

    let fields = db_mgr.get_fields(&db.id).await.expect("get_fields");
    let primary = &fields[0];

    // Simulate update_cell — find the actual command function and call it,
    // OR call db_mgr.update_cell + vm.export_row directly to mimic the command path.
    let cell = CellData::RichText("Helix Q3 Retro".into());
    db_mgr.update_cell(&row.id, &primary.id, &cell).await.expect("update_cell");
    vm.export_row(&db.id, &row.id, None, &[(primary.id.clone(), cell)], None, &ws_mgr, &db_mgr)
      .await
      .expect("export_row");

    let row_md_path = vault_root.join("databases").join("projects").join("rows");
    let entries: Vec<_> = std::fs::read_dir(&row_md_path).expect("readdir").collect();
    assert_eq!(entries.len(), 1, "exactly one row file written");
    let body = std::fs::read_to_string(entries[0].as_ref().expect("entry").path()).expect("read");
    assert!(body.contains("Helix Q3 Retro"));
}
```

Run, expect pass.

- [ ] **D-8: Commit**

```bash
git add -u
git commit -m "feat(w4): create_row + create_row_in_group mirror into workspace_nodes; rows/<id>.md writes vault-first via existing export_row"
```

---

## Commit E — Wire delete and rename paths

**Goal:** `delete_database`, `delete_row`, and any name-update path also propagate to the workspace_nodes mirror.

**Files:**
- Modify: `src-tauri/src/commands/database.rs` — delete commands
- Modify: `src-tauri/src/managers/database/manager.rs` — if name updates exist there

### Tasks

- [ ] **E-1: Locate existing delete paths**

```
grep -n "fn delete_database\|fn delete_row\|fn soft_delete\|fn permanent_delete" src-tauri/src/commands/database.rs
grep -n "fn delete_database\|fn delete_row" src-tauri/src/managers/database/manager.rs
```

Read each to understand the current shape.

- [ ] **E-2: Failing test for soft-delete propagation**

```rust
#[tokio::test]
async fn delete_row_marks_workspace_nodes_mirror_deleted() {
    // Setup as in D-1
    let (db_mgr, ws_mgr, vm, _temp, db_id, row_id) = setup_db_with_one_row().await;

    delete_row_inner_with_vault(&db_mgr, &ws_mgr, &row_id).await.expect("delete_row");

    let mirror = ws_mgr.get_node(&row_id).await.expect("get_node").expect("queryable");
    assert!(mirror.deleted_at.is_some(), "mirror deleted_at set");
}
```

`setup_db_with_one_row` is a test helper — define it at the top of the test module.

- [ ] **E-3: Implement `delete_row_inner_with_vault`**

```rust
pub async fn delete_row_inner_with_vault(
    db_mgr: &Arc<DatabaseManager>,
    ws_mgr: &Arc<WorkspaceManager>,
    row_id: &str,
) -> Result<(), String> {
    // SQLite first — workspace_nodes is the mirror, db_rows is the truth.
    db_mgr
        .delete_row(row_id)        // existing soft-delete on db_rows OR hard-delete; check actual signature
        .await
        .map_err(|e| e.to_string())?;
    // Cascade-aware soft-delete on the mirror: clears FTS rows and enqueues
    // embedding deletes for the row + any descendants. Idempotent — no-ops if
    // the mirror is already absent (e.g. legacy row not yet backfilled).
    ws_mgr.soft_delete_node(row_id).await?;
    Ok(())
}
```

Note: if `db_rows` has no soft-delete column today (likely — it's a separate file from workspace_nodes which does), then either (a) hard-delete db_rows and rely on workspace_nodes.deleted_at as the soft state, or (b) add a `deleted_at` column to db_rows in a migration. **Recommendation: option (a)** — workspace_nodes is the user-facing soft-delete surface (Trash UI reads from there). db_rows hard-deletes mirror the workspace_nodes restore by re-inserting on Trash → Restore. Out of scope for W4; document in the task as a follow-up.

For W4 this means: `delete_row_inner_with_vault` calls `db_mgr.delete_row_hard(row_id)` and `ws_mgr.soft_delete_node(row_id)` (cascade-aware: clears FTS rows + enqueues embedding deletes for the row and any descendants). If the user later restores from Trash, we'd need to re-insert into db_rows from the workspace_nodes properties — but Trash UI isn't wired in W4 either, so this is a deferred concern (flag in PLAN.md as W9 cleanup).

- [ ] **E-4: Same pattern for `delete_database`**

Soft-delete the workspace_nodes mirror; hard-delete the database.db row (CASCADE removes children). Restore from Trash is deferred per E-3 note.

- [ ] **E-5: Failing test for rename propagation**

```rust
#[tokio::test]
async fn rename_row_updates_workspace_nodes_mirror_name() {
    // Setup
    let (db_mgr, ws_mgr, vm, _temp, db_id, row_id) = setup_db_with_one_row().await;
    let fields = db_mgr.get_fields(&db_id).await.expect("get_fields");
    let primary = &fields[0];

    // Update primary cell — should also update mirror name (used by tree view)
    update_cell_inner_with_vault(&db_mgr, &ws_mgr, &vm, &row_id, &primary.id,
        &CellData::RichText("New Title".into())).await.expect("update_cell");

    let mirror = ws_mgr.get_node(&row_id).await.expect("get_node").expect("exists");
    assert_eq!(mirror.name, "New Title");
}
```

- [ ] **E-6: Update `update_cell` path to propagate primary-field changes to mirror name**

Locate the `update_cell` command (around `commands/database.rs:130-150` based on earlier read). After the `vm.export_row` call, add:

```rust
// If the edited cell is the primary field, sync the mirror's name so the
// tree view and search reflect the rename.
let fields = state.database_manager.get_fields(&database_id).await.map_err(|e| e.to_string())?;
if fields.iter().any(|f| f.id == field_id && f.is_primary) {
    if let CellData::RichText(ref text) = data {
        // Direct SQL update for one column — same pattern as the upsert helper.
        let conn = state.workspace_manager.conn().clone();
        let row_id_owned = row_id.clone();
        let new_name = text.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let conn = conn.blocking_lock();
            conn.execute(
                "UPDATE workspace_nodes SET name = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![new_name, chrono::Utc::now().timestamp(), row_id_owned],
            ).map_err(|e| e.to_string())?;
            Ok(())
        }).await.map_err(|e| e.to_string())??;
    }
}
```

A cleaner refactor adds `WorkspaceManager::update_node_name(id, name)` — do that if you have time, otherwise the inline spawn_blocking is acceptable for W4.

- [ ] **E-7: Run all new tests, expect pass**

- [ ] **E-8: Run full lib suite**

Expected: ~210 passed.

- [ ] **E-9: Commit**

```bash
git add -u
git commit -m "feat(w4): wire delete + primary-field rename through workspace_nodes mirror"
```

---

## Commit F — Delete legacy `.db.json` writer + `json_store` module

**Goal:** Remove dead code now that `database.md` + `rows/<id>.md` is the canonical vault format.

**Files:**
- Delete: `src-tauri/src/managers/database/json_store.rs`
- Modify: `src-tauri/src/managers/database/manager.rs` — remove `write_json`, `snapshot_parts`, `startup_scan`, `super::json_store::*` import, and stale doc-comment block at lines 280-292
- Modify: `src-tauri/src/managers/database/mod.rs` — remove `pub mod json_store;`
- Modify: `src-tauri/src/lib.rs` — remove any `startup_scan` call

### Tasks

- [ ] **F-1: Confirm no callers of removed functions outside the manager**

```
grep -rn "json_store\|write_json\|startup_scan\|DatabaseSnapshot" src-tauri/src/ src/
```

Expected: only matches inside the files we're touching, plus the graphify cache. If frontend code references `DatabaseSnapshot`, **stop and flag** — that means the frontend was using the legacy export path; bridge work isn't done. Investigate before deleting.

- [ ] **F-2: Confirm no `<id>.db.json` on disk in active vaults**

This is informational; the migration in Commit G will sweep them. If you have a dev vault, list:

```
ls "$APPDATA/handy-vault/" | grep ".db.json" || echo "clean"
```

- [ ] **F-3: Delete `json_store.rs`**

```bash
git rm src-tauri/src/managers/database/json_store.rs
```

- [ ] **F-4: Remove module declaration**

In `src-tauri/src/managers/database/mod.rs`:

```diff
- pub mod json_store;
```

- [ ] **F-5: Remove `write_json`, `snapshot_parts`, `startup_scan` from `manager.rs`**

Search for each function and delete the entire `pub async fn` block. Also delete:
- `use super::json_store::{...}` import at the top (line ~13)
- All `self.write_json(&db_id).await.ok();` callsites — search and delete each line
- The stale doc-comment block at `manager.rs:280-292` (replace with the single accurate doc comment from §C)

- [ ] **F-6: Replace stale `list_databases` doc**

Find the doc-comment block at the lines around 280-292 in `manager.rs` and replace with:

```rust
/// Lists all databases stored in `database.db`, sorted alphabetically by
/// `LOWER(name)` with optional case-insensitive prefix filter. Each tuple is
/// `(id, name, icon, row_count)` where `row_count` counts rows in `db_rows`.
///
/// The `workspace_nodes` mirror is the user-facing soft-delete surface (the
/// Trash UI reads from there); `databases` rows are hard-deleted on permanent
/// removal. Soft-deleted databases therefore still appear in this listing —
/// callers that want to hide them should JOIN against `workspace_nodes.deleted_at`.
/// (W4 sidebar does not yet hide soft-deleted; deferred to W9 Trash UI work.)
```

- [ ] **F-7: Remove `startup_scan` call site**

```
grep -n "startup_scan" src-tauri/src/lib.rs
```

If a call exists, delete it.

- [ ] **F-8: Build**

```
cargo build 2>&1 | tail -20
```

Expected: zero errors. If any callsites still reference deleted functions, fix them.

- [ ] **F-9: Run lib suite**

Expected: same number of tests as Commit E (no new tests; some old tests for `write_json`/`startup_scan` removed if present).

- [ ] **F-10: Commit**

```bash
git add -u
git commit -m "chore(w4): delete legacy .db.json writer (write_json, snapshot_parts, startup_scan, json_store module)"
```

---

## Commit G — Boot migration for legacy databases

**Goal:** On startup, backfill `workspace_nodes` mirrors for any `databases` row that lacks one (covers databases created before Commit C). Sweep orphan `<vault>/<id>.db.json` files into `<vault>/.handy/legacy-db-json/`.

**Files:**
- Create: `src-tauri/src/managers/database/migration.rs`
- Modify: `src-tauri/src/lib.rs` — call `run_database_mirror_migration` once after `app_state` is registered

### Tasks

- [ ] **G-1: Failing test for mirror backfill**

```rust
// In src-tauri/src/managers/database/migration.rs (#[cfg(test)] mod tests)
#[tokio::test]
async fn migration_backfills_missing_mirrors_only() {
    let temp = tempdir().expect("tempdir");
    let ws_mgr = Arc::new(WorkspaceManager::new_in_memory().expect("ws_mgr"));
    let db_mgr = Arc::new(DatabaseManager::new_with_path(temp.path().join("database.db")).expect("db_mgr"));
    let vm = Arc::new(VaultManager::new(temp.path().to_path_buf()));

    // Simulate a legacy database created before bridge: insert into databases
    // but NOT into workspace_nodes.
    let legacy_id = db_mgr.create_database("Legacy".into()).await.expect("create");
    // create_database in current code DOES NOT insert mirror, so this is naturally legacy.
    // Sanity check:
    assert!(ws_mgr.get_node(&legacy_id).await.unwrap().is_none(), "no mirror yet");

    // Also create a "modern" database (with mirror) to confirm migration leaves it alone.
    let modern_id = create_database_inner_with_vault(&db_mgr, &ws_mgr, &vm, "Modern".into())
        .await
        .expect("create modern");
    let modern_node_before = ws_mgr.get_node(&modern_id.id).await.unwrap().expect("modern mirror");

    // Run migration
    run_database_mirror_migration(&db_mgr, &ws_mgr, &vm).await.expect("migration");

    // Assert: legacy got a mirror
    let legacy_mirror = ws_mgr.get_node(&legacy_id).await.unwrap().expect("legacy mirror created");
    assert_eq!(legacy_mirror.name, "Legacy");

    // Assert: modern unchanged (updated_at not bumped)
    let modern_node_after = ws_mgr.get_node(&modern_id.id).await.unwrap().expect("modern mirror");
    assert_eq!(modern_node_before.updated_at, modern_node_after.updated_at);
}
```

- [ ] **G-2: Run, expect fail**

- [ ] **G-3: Implement `run_database_mirror_migration`**

Create `src-tauri/src/managers/database/migration.rs`:

```rust
use std::sync::Arc;
use anyhow::Result;
use log::{info, warn};

use super::manager::DatabaseManager;
use crate::managers::workspace::workspace_manager::WorkspaceManager;
use crate::managers::workspace::vault::VaultManager;
use crate::managers::workspace::vault::format::slugify;

/// One-shot, idempotent migration. Backfills workspace_nodes mirrors for
/// `databases` rows that lack one, and sweeps orphan `<vault>/<id>.db.json`
/// files into `<vault>/.handy/legacy-db-json/` for human inspection. Safe to
/// call on every boot.
pub async fn run_database_mirror_migration(
    db_mgr: &Arc<DatabaseManager>,
    ws_mgr: &Arc<WorkspaceManager>,
    vm: &Arc<VaultManager>,
) -> Result<MigrationReport, String> {
    let mut report = MigrationReport::default();

    // 1. Backfill mirrors.
    let listed = db_mgr.list_databases(None).await.map_err(|e| e.to_string())?;
    for (id, name, _icon, _count) in &listed {
        if ws_mgr.get_node(id).await.map_err(|e| e.to_string())?.is_none() {
            let slug = slugify(name);
            let vault_rel_path = format!("databases/{slug}/database.md");
            ws_mgr
                .upsert_workspace_mirror_node(id, None, "database", name, "", 1.0, "{}", &vault_rel_path)
                .await
                .map_err(|e| format!("backfill mirror for {id}: {e}"))?;
            // Best-effort write of database.md.
            if let Err(e) = vm.export_database_md(id, ws_mgr, db_mgr).await {
                warn!("export_database_md during migration failed for '{id}': {e}");
            }
            report.mirrors_created += 1;
            info!("Migrated legacy database '{id}' ({name}) into workspace_nodes");
        }

        // Backfill row mirrors too — for each row in db_rows, ensure a workspace_nodes mirror.
        let row_ids = db_mgr.get_rows(id).await.map_err(|e| e.to_string())?;
        for (idx, row_id) in row_ids.iter().enumerate() {
            if ws_mgr.get_node(row_id).await.map_err(|e| e.to_string())?.is_none() {
                let slug = slugify(name);
                let row_slug = &row_id[..row_id.len().min(8)];
                let vault_rel_path = format!("databases/{slug}/rows/{row_slug}.md");
                ws_mgr
                    .upsert_workspace_mirror_node(row_id, Some(id), "row", "", "", idx as f64, "{}", &vault_rel_path)
                    .await
                    .map_err(|e| format!("backfill row mirror for {row_id}: {e}"))?;
                report.row_mirrors_created += 1;
            }
        }
    }

    // 2. Sweep orphan `<vault>/<id>.db.json`.
    let vault_root = vm.vault_root_path();   // requires getter on VaultManager; add if missing
    if let Ok(entries) = std::fs::read_dir(&vault_root) {
        let legacy_dir = vault_root.join(".handy").join("legacy-db-json");
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(fname) = path.file_name().and_then(|n| n.to_str()) else { continue };
            if !fname.ends_with(".db.json") { continue; }

            // Cloud-sync defensiveness (Rule 14): skip 0-byte placeholders.
            if let Ok(meta) = std::fs::metadata(&path) {
                if meta.len() == 0 {
                    info!("Deferring legacy file '{fname}' (cloud-sync placeholder)");
                    continue;
                }
            }

            std::fs::create_dir_all(&legacy_dir).ok();
            let dest = legacy_dir.join(fname);
            match std::fs::rename(&path, &dest) {
                Ok(()) => {
                    report.legacy_files_moved += 1;
                    info!("Moved legacy '{fname}' to .handy/legacy-db-json/");
                }
                Err(e) => warn!("Could not move legacy file '{fname}': {e}"),
            }
        }
    }

    Ok(report)
}

#[derive(Default, Debug)]
pub struct MigrationReport {
    pub mirrors_created: usize,
    pub row_mirrors_created: usize,
    pub legacy_files_moved: usize,
}
```

- [ ] **G-4: Add `VaultManager::vault_root_path` getter if missing**

```rust
// in vault/mod.rs impl VaultManager
pub fn vault_root_path(&self) -> &std::path::Path {
    &self.vault_root
}
```

- [ ] **G-5: Wire migration into boot**

In `src-tauri/src/lib.rs` after `app_handle.manage(database_manager)` (around line 493):

```rust
// One-shot migration: backfill workspace_nodes mirrors for legacy databases,
// sweep orphan .db.json files. Idempotent — runs every boot, fast no-op when clean.
{
    let db_mgr = database_manager.clone();
    let ws_mgr = workspace_manager.clone();
    let vm_for_migration = vault_manager.clone();   // confirm vault_manager is in scope here
    tauri::async_runtime::spawn(async move {
        match crate::managers::database::migration::run_database_mirror_migration(&db_mgr, &ws_mgr, &vm_for_migration).await {
            Ok(report) => {
                if report.mirrors_created + report.row_mirrors_created + report.legacy_files_moved > 0 {
                    log::info!(
                        "Database migration: {} db mirrors, {} row mirrors, {} legacy files moved",
                        report.mirrors_created, report.row_mirrors_created, report.legacy_files_moved
                    );
                }
            }
            Err(e) => log::warn!("Database migration failed: {e}"),
        }
    });
}
```

- [ ] **G-6: Register the new module**

In `src-tauri/src/managers/database/mod.rs`:

```rust
pub mod migration;
```

- [ ] **G-7: Run G-1's test, expect pass**

- [ ] **G-8: Edge-case test — empty databases table**

```rust
#[tokio::test]
async fn migration_no_op_on_empty_database_db() {
    let temp = tempdir().expect("tempdir");
    let ws_mgr = Arc::new(WorkspaceManager::new_in_memory().expect("ws_mgr"));
    let db_mgr = Arc::new(DatabaseManager::new_with_path(temp.path().join("database.db")).expect("db_mgr"));
    let vm = Arc::new(VaultManager::new(temp.path().to_path_buf()));

    let report = run_database_mirror_migration(&db_mgr, &ws_mgr, &vm).await.expect("migration");
    assert_eq!(report.mirrors_created, 0);
    assert_eq!(report.row_mirrors_created, 0);
    assert_eq!(report.legacy_files_moved, 0);
}
```

- [ ] **G-9: Edge-case test — orphan `.db.json` swept to legacy folder**

```rust
#[tokio::test]
async fn migration_moves_orphan_db_json_to_legacy_folder() {
    let temp = tempdir().expect("tempdir");
    let vault_root = temp.path().to_path_buf();
    std::fs::write(vault_root.join("orphan-id.db.json"), "{}").unwrap();
    std::fs::write(vault_root.join("placeholder.db.json"), "").unwrap(); // 0-byte cloud-sync stub

    let ws_mgr = Arc::new(WorkspaceManager::new_in_memory().expect("ws_mgr"));
    let db_mgr = Arc::new(DatabaseManager::new_with_path(temp.path().join("database.db")).expect("db_mgr"));
    let vm = Arc::new(VaultManager::new(vault_root.clone()));

    let report = run_database_mirror_migration(&db_mgr, &ws_mgr, &vm).await.expect("migration");
    assert_eq!(report.legacy_files_moved, 1, "only the non-empty file is moved");
    assert!(vault_root.join(".handy/legacy-db-json/orphan-id.db.json").exists());
    assert!(vault_root.join("placeholder.db.json").exists(), "cloud-sync placeholder retained");
}
```

- [ ] **G-10: Run all migration tests**

Expected: PASS.

- [ ] **G-11: Manual smoke test**

```
cd ..
bun run tauri dev
# In the app:
# 1. Create a database "TestDB"
# 2. Add a row, fill the title cell
# 3. Quit the app
# 4. Inspect: <APPDATA>/handy-vault/databases/testdb/database.md should exist
#    and contain TestDB in frontmatter
# 5. Inspect: <APPDATA>/handy-vault/databases/testdb/rows/<short-id>.md
#    should exist and contain the title text
```

If the smoke test fails, debug before committing G.

- [ ] **G-12: Commit**

```bash
git add -u
git add src-tauri/src/managers/database/migration.rs
git commit -m "feat(w4): one-shot boot migration backfills workspace_nodes mirrors and sweeps legacy .db.json"
```

---

## Commit H — Edge case integration tests + cleanup

**Goal:** Lock in the edge-case behaviors described in the table above with explicit tests. Update PLAN.md to reflect W4 status.

**Files:**
- Modify: `src-tauri/src/commands/database.rs` (test module)
- Modify: `PLAN.md` — mark W4 as done with the bridge note

### Tasks

- [ ] **H-1: Test — slug collision (two databases named "Projects")**

```rust
#[tokio::test]
async fn create_two_databases_with_same_name_get_distinct_paths() {
    let temp = tempdir().expect("tempdir");
    let vault_root = temp.path().to_path_buf();
    let ws_mgr = Arc::new(WorkspaceManager::new_in_memory().expect("ws_mgr"));
    let db_mgr = Arc::new(DatabaseManager::new_with_path(temp.path().join("database.db")).expect("db_mgr"));
    let vm = Arc::new(VaultManager::new(vault_root.clone()));

    let a = create_database_inner_with_vault(&db_mgr, &ws_mgr, &vm, "Projects".into()).await.unwrap();
    let b = create_database_inner_with_vault(&db_mgr, &ws_mgr, &vm, "Projects".into()).await.unwrap();

    let a_node = ws_mgr.get_node(&a.id).await.unwrap().unwrap();
    let b_node = ws_mgr.get_node(&b.id).await.unwrap().unwrap();
    assert_ne!(a_node.vault_rel_path, b_node.vault_rel_path,
               "second 'Projects' must get a -<short_id> suffix in its vault path");
}
```

If this fails, the slug-collision policy (currently in `WorkspaceManager::write_node_to_vault`) needs to also be applied by `create_database_inner_with_vault`. Lift the helper into `vault/format.rs` as `slugify_with_collision_check(slug, vault_root, existing_id)` and call from both sites.

- [ ] **H-2: Test — soft-deleted database stays in `databases` table but is hidden in tree**

```rust
#[tokio::test]
async fn deleted_database_not_returned_by_get_node_children_of_root() {
    let temp = tempdir().expect("tempdir");
    let vault_root = temp.path().to_path_buf();
    let ws_mgr = Arc::new(WorkspaceManager::new_in_memory().expect("ws_mgr"));
    let db_mgr = Arc::new(DatabaseManager::new_with_path(temp.path().join("database.db")).expect("db_mgr"));
    let vm = Arc::new(VaultManager::new(vault_root.clone()));

    let db = create_database_inner_with_vault(&db_mgr, &ws_mgr, &vm, "Projects".into()).await.unwrap();
    ws_mgr.soft_delete_node(&db.id).await.unwrap();

    let roots = ws_mgr.get_root_nodes().await.unwrap();
    assert!(!roots.iter().any(|n| n.id == db.id), "soft-deleted db hidden from tree");

    // But still listed by db_mgr.list_databases (since it queries databases table).
    // This is the deferred-Trash-UI gap noted in F-6 doc comment.
    let listed = db_mgr.list_databases(None).await.unwrap();
    assert!(listed.iter().any(|(id, _, _, _)| id == &db.id),
            "list_databases still returns soft-deleted; sidebar JOIN against deleted_at is W9");
}
```

- [ ] **H-3: Test — concurrent `create_database` calls produce distinct rows**

```rust
#[tokio::test]
async fn concurrent_create_database_calls_isolated() {
    let temp = tempdir().expect("tempdir");
    let vault_root = temp.path().to_path_buf();
    let ws_mgr = Arc::new(WorkspaceManager::new_in_memory().expect("ws_mgr"));
    let db_mgr = Arc::new(DatabaseManager::new_with_path(temp.path().join("database.db")).expect("db_mgr"));
    let vm = Arc::new(VaultManager::new(vault_root.clone()));

    let mut handles = vec![];
    for i in 0..5 {
        let db_mgr = db_mgr.clone();
        let ws_mgr = ws_mgr.clone();
        let vm = vm.clone();
        handles.push(tokio::spawn(async move {
            create_database_inner_with_vault(&db_mgr, &ws_mgr, &vm, format!("Db-{i}")).await
        }));
    }
    let mut ids = vec![];
    for h in handles {
        ids.push(h.await.unwrap().unwrap().id);
    }
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 5, "all 5 creates produced distinct ids");
}
```

- [ ] **H-4: Run full lib suite**

Expected: ~215 passed, 0 failed.

- [ ] **H-5: Run full frontend test suite**

```
cd ..
bunx vitest run
```

Expected: green. If `useDatabase.test.ts` was asserting something about the old shape, fix and re-run.

- [ ] **H-6: Update PLAN.md**

Find the W4 section (around line 464). Append a status note:

```markdown
**Status:** ✅ shipped 2026-04-25 (commits A-F + bridge cleanup G-N).

**Bridge architecture:** `database.db` (DatabaseManager) is the source of truth
for schema/cells/views. `workspace.db` `workspace_nodes` carries a mirror row
per database and per row (node_type='database' / 'row') so the existing vault
writers (`export_database_md`, `export_row`) and search/embeddings/wikilinks
work natively. Mirror writes happen at the command layer; a one-shot boot
migration (`run_database_mirror_migration`) backfills mirrors for
pre-bridge databases and sweeps orphan `<vault>/<id>.db.json` files into
`<vault>/.handy/legacy-db-json/`.

**Deferred to W9:** Trash UI for soft-deleted databases/rows; sidebar JOIN
against `workspace_nodes.deleted_at` to hide soft-deletes (currently they
remain in `list_databases` output); restore-from-Trash flow that re-inserts
`db_rows`/`databases` rows from preserved mirror metadata.
```

- [ ] **H-7: Manual smoke test**

```
cd ..
bun run tauri dev
```

In the running app:
1. Create database "Plan Test" → confirm sidebar shows it.
2. Click it → confirm the Name column is editable; type "Hello world" + tab.
3. Quit, restart → confirm "Plan Test" reappears with the row and "Hello world".
4. Open vault folder → confirm `databases/plan-test/database.md` and `databases/plan-test/rows/<id>.md` exist.
5. Edit `rows/<id>.md` directly in another editor → save → wait 5s → focus app → confirm refresh banner / cell update reflects edit.

Each pass = explicit verification of the cross-process round trip.

- [ ] **H-8: Commit**

```bash
git add -u
git add PLAN.md
git commit -m "test(w4): edge cases (slug collision, soft-delete visibility, concurrent creates) + PLAN.md status update"
```

---

## Stop-gate / Definition of Done

All must hold before W4 is closed:

1. ✅ `bun run build` zero errors.
2. ✅ `cargo test --lib -- --skip portable` ≥ 215 passed, 0 failed.
3. ✅ `bunx vitest run` green.
4. ✅ Creating a database in `bun run tauri dev` produces:
   - A `databases` row in `database.db`
   - A `workspace_nodes` row (node_type='database') in `workspace.db`
   - `<vault>/databases/<slug>/database.md` on disk
5. ✅ Adding a row to that database and editing the primary cell produces:
   - A `db_rows` row in `database.db`
   - A `workspace_nodes` row (node_type='row', parent_id=<db_id>)
   - `<vault>/databases/<slug>/rows/<row-id>.md` on disk with the cell content
6. ✅ Selecting a database in the sidebar loads its fields and renders the table view with all rows visible (Q1 from the user feedback).
7. ✅ No `<vault>/<id>.db.json` files written by the running app.
8. ✅ A pre-existing legacy database (created before the bridge) is automatically backfilled into `workspace_nodes` on next boot.
9. ✅ `json_store` module + `write_json` + `startup_scan` deleted from the source tree (`grep -r "json_store" src-tauri/src/` returns only graphify cache).
10. ✅ PLAN.md W4 section reflects shipped status with bridge architecture note + W9 deferrals.

---

## Out of scope (explicit non-goals)

- **Trash UI for databases/rows.** Soft-deleted databases remain in `list_databases` output; sidebar shows them. Hiding via `WHERE NOT EXISTS (SELECT 1 FROM workspace_nodes WHERE id = d.id AND deleted_at IS NOT NULL)` JOIN deferred to W9 alongside the Trash surface.
- **Field-schema editor.** Adding/renaming/deleting fields via UI deferred per W4 spec §1. Schema only changes via direct `database.md` edit (round-trips via `vault/import.rs`).
- **Restore from Trash for databases/rows.** `db_rows` is hard-deleted on `delete_row_inner_with_vault`; we don't store enough mirror state to re-hydrate. Documented as W9 follow-up.
- **`db_rows` soft-delete column.** Adding `deleted_at` to db_rows would let us soft-delete in both files symmetrically; deferred to keep this change small.
- **`vault/import.rs` updates** for the new `database.md` format (if existing import logic targets a different format). Out of scope unless tests in this plan reveal a regression.
- **Performance optimization of `get_cells_for_rows`** — current implementation iterates row IDs serially. Bulk JOIN deferred per existing W4 comment in commands/database.rs.

---

## Self-review notes

- **Spec coverage:** every edge case in the upfront table maps to a task or test (1 → G; 2 → G-9; 3 → H-1; 4 → B-5 covers via empty rows array; 5 → H-3; 6, 7 → G; 8 → existing export_row tests; 9 → H-2 + soft-delete tests; 10 → E-3, E-4, F-6 doc; 11 → out-of-scope; 12 → C-10; 13 → F-1; 14 → G-8; 15 → migration only writes mirror with `{}` properties on field-less rows; 16 → G-9; 17 → already enforced by VaultLock at boot; 18 → G-3 placeholder check + G-9 test).
- **Type consistency:** `create_database_inner_with_vault` / `create_row_inner_with_vault` / `delete_row_inner_with_vault` / `update_cell_inner_with_vault` all use the same `(db_mgr, ws_mgr, vm, ...)` argument order. `MigrationReport` field names are `mirrors_created`, `row_mirrors_created`, `legacy_files_moved` consistently in declaration, test asserts, and log output.
- **No placeholders:** every code block contains real Rust with full type signatures. No "TODO" / "fill in" markers. The one explicit deferred concern (`vault::import.rs` reconciliation of `database.md`) is called out as out-of-scope, not as a TODO inside a task.
- **Risk areas to watch during execution:**
  - C-2 / C-10: if frontend `useDatabase.ts` invokes `createDatabase` with the legacy signature, the build breaks. Verify before committing C.
  - E-6: the inline `spawn_blocking` for primary-name sync is ugly. If `WorkspaceManager` already has an `update_node_name` helper, prefer it; if not, an extension method is cleaner than the inline block.
  - G-5: `vault_manager` may not be a managed `Arc<VaultManager>` in `lib.rs` today. Verify by grepping `let vault_manager` in lib.rs; if it's instantiated inline inside another struct, you'll need to lift it to a top-level `Arc` first or thread it through `AppState`.
