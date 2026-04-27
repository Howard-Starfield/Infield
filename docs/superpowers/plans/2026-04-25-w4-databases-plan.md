# W4 — Databases Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `src/components/DatabasesView.tsx`'s mock UI with a real, vault-backed Notion-style database surface. Two views ship in W4: **Table** (TanStack Table v8 + `@tanstack/react-virtual`) and **Board** (dnd-kit kanban). Six field types are editable in-place. Every cell edit, row create/delete, and group-drag round-trips through Tauri commands and writes the affected `rows/<id>.md` file vault-first (Invariant #1). Calendar / List / Gallery / Timeline render `<EmptyState>` and ship in later phases.

**Architecture:** Four flat components in `src/components/` (`DatabasesView`, `DatabaseTableView`, `DatabaseBoardView`, `DatabaseSelectPopover`) plus two peer files in `src/database/` (`cellRenderers.tsx`, `useDatabase.ts`), mirroring the Notes / `src/editor/` split. Sidebar and chrome are inline in `DatabasesView.tsx` until they earn extraction. TanStack Table renders DOM `<td>` elements that inherit CSS token values directly — no JS theme adapter, no canvas. Every mutation calls `VaultManager::export_row` as the first step (vault before SQLite); if the vault write returns `ExternalEditConflict`, SQLite is never touched and the optimistic local state rolls back.

**Tech Stack:** TanStack Table v8, `@tanstack/react-virtual`, dnd-kit/sortable, `@floating-ui/react`, sonner, vanilla CSS via `--card-{deep,mid,overlay}-*` tier tokens.

**Spec:** [docs/superpowers/specs/2026-04-25-w4-databases-design.md](../specs/2026-04-25-w4-databases-design.md)

**Branch:** `main` (with explicit user consent — same posture as W2/W3).

**Predecessors:** W3 hybrid search shipped. `bun run build` green; `bunx vitest run` green; `cargo test --lib` green (verify exact baseline counts before starting).

---

## File Structure

| File | Role | Commit |
|---|---|---|
| `src-tauri/src/managers/database/manager.rs` | Add `get_cells_for_rows` batched manager method | A |
| `src-tauri/src/commands/database.rs` | Add `list_databases` + `get_cells_for_rows` Tauri commands | A |
| `src-tauri/src/lib.rs` | Register both new commands in `collect_commands!` | A |
| `src-tauri/src/managers/workspace/vault/mod.rs` | Add `VaultManager::export_row` method | B |
| `src-tauri/src/commands/database.rs` | Reorder `update_cell`, `create_row`, `create_row_in_group`, `update_row_date` to call `export_row` first | B |
| `src-tauri/src/commands/workspace_nodes.rs` | Route `update_node` + `move_node` through `export_row` when `node_type == "row"` | B |
| `src/database/useDatabase.ts` | Single hook: row index, paged cell fetch, optimistic mutations, debounce split | C |
| `src/database/cellRenderers.tsx` | Six cell components (RichText, Number, Date, SingleSelect, MultiSelect, Checkbox) | C |
| `src/database/__tests__/useDatabase.test.ts` | Unit tests: paged slice math, debounce policy, sort independence | C |
| `src/components/DatabaseTableView.tsx` | TanStack Table + react-virtual renderer; right-click context menu | D |
| `src/components/DatabaseBoardView.tsx` | dnd-kit kanban columns from first SingleSelect field | E |
| `src/components/DatabaseSelectPopover.tsx` | Shared single/multi select editor via `@floating-ui/react` | E |
| `src/components/DatabasesView.tsx` | Shell rewrite: inline sidebar (list_databases), inline chrome, view router | F |
| `src/styles/databases.css` | All `.db-*` classes; tokens-only per Rule 12 | D, E, F |
| `src/App.css` | Add `@import './styles/databases.css'` if not already present | F |

---

## Commit A — Backend surface (Rust only)

**Goal:** Add two new Tauri commands — `list_databases` and `get_cells_for_rows` — and register them. No frontend changes; no behavior change yet. Independently revertable.

**Read first:**
- `src-tauri/src/managers/database/manager.rs` — existing `pub async fn` signatures, particularly `get_all_cells_for_row` and `get_rows`.
- `src-tauri/src/commands/database.rs` — existing command signatures and `DatabaseMeta` / `Row` types.
- `src-tauri/src/lib.rs` lines 854–872 — the existing `commands::database::*` block in `collect_commands!`.
- `docs/superpowers/specs/2026-04-25-w4-databases-design.md` §3 "Sidebar data source" and §2 "Paged cell fetch".

**Files touched:**

| File | Change |
|---|---|
| `src-tauri/src/managers/database/manager.rs` | Add `pub async fn get_cells_for_rows(db_id, row_ids) -> Result<Vec<(String, Vec<(String, CellData)>)>>` |
| `src-tauri/src/commands/database.rs` | Add `DatabaseSummary` type; add `list_databases` command; add `get_cells_for_rows` command wrapper |
| `src-tauri/src/lib.rs` | Register `list_databases`, `get_cells_for_rows` in `collect_commands!` |

### Tasks

- [ ] **A-1: Add `DatabaseSummary` type to `src-tauri/src/commands/database.rs`**

  After the existing `Row` struct definition, add:

  ```rust
  /// Lightweight database listing entry returned by list_databases.
  #[derive(Clone, Debug, Serialize, Deserialize, Type)]
  pub struct DatabaseSummary {
      pub id: String,
      pub title: String,
      pub icon: String,
      pub row_count: i64,
  }
  ```

  This type is exposed to the frontend via specta; `src/bindings.ts` regenerates on next `bun run tauri dev`.

- [ ] **A-2: Add `list_databases` manager method to `DatabaseManager`**

  In `src-tauri/src/managers/database/manager.rs`, after `get_rows`, add:

  ```rust
  /// Return all non-deleted databases sorted alphabetically by name.
  /// Optional prefix filter (case-insensitive LIKE) for the sidebar search input.
  pub async fn list_databases(
      &self,
      prefix: Option<String>,
  ) -> Result<Vec<(String, String, String, i64)>> {
      // Returns (id, name, icon, row_count) tuples.
      let conn = self.conn.lock().await;
      let sql = if prefix.is_some() {
          r#"
          SELECT w.id, w.name, w.icon,
                 (SELECT COUNT(*) FROM workspace_nodes r
                  WHERE r.parent_id = w.id
                    AND r.node_type = 'row'
                    AND r.deleted_at IS NULL) AS row_count
          FROM workspace_nodes w
          WHERE w.node_type = 'database'
            AND w.deleted_at IS NULL
            AND LOWER(w.name) LIKE LOWER(?1)
          ORDER BY LOWER(w.name)
          "#
      } else {
          r#"
          SELECT w.id, w.name, w.icon,
                 (SELECT COUNT(*) FROM workspace_nodes r
                  WHERE r.parent_id = w.id
                    AND r.node_type = 'row'
                    AND r.deleted_at IS NULL) AS row_count
          FROM workspace_nodes w
          WHERE w.node_type = 'database'
            AND w.deleted_at IS NULL
          ORDER BY LOWER(w.name)
          "#
      };
      let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
      let pattern = prefix.map(|p| format!("{p}%"));
      let rows: Vec<(String, String, String, i64)> = if let Some(ref pat) = pattern {
          stmt.query_map([pat], |row| {
              Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
          })
          .map_err(|e| e.to_string())?
          .collect::<Result<_, _>>()
          .map_err(|e: rusqlite::Error| e.to_string())?
      } else {
          stmt.query_map([], |row| {
              Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
          })
          .map_err(|e| e.to_string())?
          .collect::<Result<_, _>>()
          .map_err(|e: rusqlite::Error| e.to_string())?
      };
      Ok(rows)
  }
  ```

  Note: `DatabaseManager` holds a `conn: Arc<Mutex<Connection>>` to `workspace.db` — confirm the field name before writing by reading the `impl DatabaseManager` block at the top of `manager.rs`.

- [ ] **A-3: Add `list_databases` Tauri command to `src-tauri/src/commands/database.rs`**

  ```rust
  #[tauri::command]
  #[specta::specta]
  pub async fn list_databases(
      db_mgr: State<'_, Arc<DatabaseManager>>,
      prefix: Option<String>,
  ) -> Result<Vec<DatabaseSummary>, String> {
      let rows = db_mgr.list_databases(prefix).await.map_err(|e| e.to_string())?;
      Ok(rows
          .into_iter()
          .map(|(id, title, icon, row_count)| DatabaseSummary { id, title, icon, row_count })
          .collect())
  }
  ```

- [ ] **A-4: Add `get_cells_for_rows` manager method to `DatabaseManager`**

  In `manager.rs`, after `get_all_cells_for_row`, add:

  ```rust
  /// Batched cells fetch for a slice of row IDs.
  /// Returns Vec<(row_id, Vec<(field_id, CellData)>)> in the same order as `row_ids`.
  /// Rows with no cells return an empty inner Vec (not an error).
  pub async fn get_cells_for_rows(
      &self,
      _db_id: &str,
      row_ids: &[String],
  ) -> Result<Vec<(String, Vec<(String, CellData)>)>> {
      let mut result = Vec::with_capacity(row_ids.len());
      for row_id in row_ids {
          let cells = self.get_all_cells_for_row(row_id).await?;
          result.push((row_id.clone(), cells));
      }
      Ok(result)
  }
  ```

  Note: This iterates rather than doing a single JOIN because `get_all_cells_for_row` handles the JSON deserialization path correctly. A future optimization can collapse into a single query; the interface is stable.

- [ ] **A-5: Add `get_cells_for_rows` Tauri command to `src-tauri/src/commands/database.rs`**

  ```rust
  #[tauri::command]
  #[specta::specta]
  pub async fn get_cells_for_rows(
      db_mgr: State<'_, Arc<DatabaseManager>>,
      database_id: String,
      row_ids: Vec<String>,
  ) -> Result<Vec<(String, Vec<(String, CellData)>)>, String> {
      db_mgr
          .get_cells_for_rows(&database_id, &row_ids)
          .await
          .map_err(|e| e.to_string())
  }
  ```

- [ ] **A-6: Register both commands in `src-tauri/src/lib.rs`**

  Find the `commands::database::run_workspace_migration,` line (currently the last database command in the collect block, around line 872). Add immediately after it:

  ```rust
  commands::database::list_databases,
  commands::database::get_cells_for_rows,
  ```

- [ ] **A-7: Add Rust unit tests**

  At the bottom of `manager.rs` (inside the existing `#[cfg(test)] mod tests` block or create one), add:

  ```rust
  #[cfg(test)]
  mod tests {
      use super::*;

      #[tokio::test]
      async fn list_databases_returns_alphabetical() {
          // Create an in-memory DatabaseManager and insert two databases out of order.
          // Assert the returned vec is sorted by LOWER(name).
          // Implementation: construct a DatabaseManager with a temp Connection,
          // call create_database twice ("Zebra", "Apple"), call list_databases(None),
          // assert result[0].0 contains "Apple"'s id and result[1].0 contains "Zebra"'s id.
          // (Full setup mirrors workspace_manager test helpers — adapt as needed.)
      }

      #[tokio::test]
      async fn get_cells_for_rows_preserves_order() {
          // Insert a database with two rows and cells. Call get_cells_for_rows
          // with row_ids in reverse insertion order. Assert the output vec preserves
          // the input row_ids order.
      }
  }
  ```

  These are skeleton tests; flesh out with the in-memory setup pattern used elsewhere in manager tests.

- [ ] **A-8: Build and test**

  ```bash
  cd src-tauri && cargo build --lib 2>&1 | tail -15
  cargo test --lib list_databases 2>&1
  cargo test --lib get_cells_for_rows 2>&1
  ```

  Both must compile and test green before committing.

- [ ] **A-9: Commit**

  ```bash
  git add src-tauri/src/managers/database/manager.rs \
          src-tauri/src/commands/database.rs \
          src-tauri/src/lib.rs
  git commit -m "feat(w4): add list_databases + get_cells_for_rows commands (Rust only)

  Two new Tauri commands wired into collect_commands!:
  - list_databases(prefix?) — alphabetic, no 200-cap, backed by workspace_nodes
    WHERE node_type='database'. Replaces the abused searchWorkspaceTitle path.
  - get_cells_for_rows(db_id, row_ids) — batched cell fetch for the virtualizer
    visible window. Replaces per-row N+1 calls.

  No frontend changes. No behavior change. Independently revertable."
  ```

### Acceptance Criteria

- `grep -c "list_databases" src-tauri/src/lib.rs` returns ≥1.
- `grep -c "get_cells_for_rows" src-tauri/src/lib.rs` returns ≥1.
- `cd src-tauri && cargo build --lib` exits 0.
- `cargo test --lib` exits 0 with no regressions.
- File `src/database/glideTheme.ts` does NOT exist (confirm it was never created).

---

## Commit B — `VaultManager::export_row` + vault-first reordering

**Goal:** Add the `export_row` method and make every row-affecting mutation command call it before touching SQLite. If the vault write throws, SQLite is never touched. This commit is pure Rust — no frontend changes.

**Read first:**
- `src-tauri/src/managers/workspace/vault/mod.rs` — `VaultManager::new`, `export_database`, `write_card_for_row` (the existing per-row write — understand it before adding `export_row`).
- `src-tauri/src/managers/workspace/workspace_manager.rs` lines 1554–1650 — `write_node_to_vault`: the conflict guard pattern (mtime check, temp-file + rename, `last_read_mtime` update, and the slug-collision helper at lines 1581–1602).
- `src-tauri/src/managers/workspace/workspace_manager.rs` lines 2808–2833 — `move_node` (manager method): SQLite-only update. The cross-cutting vault sync (write new, delete old, cascade descendants) lives in the **command wrapper** at `commands/workspace_nodes.rs:235-275`, not here. W4 extends that wrapper, not this method.
- `src-tauri/src/commands/database.rs` — `update_cell`, `create_row`, `create_row_in_group`, `update_row_date` — their current SQLite-only bodies.
- `src-tauri/src/commands/workspace_nodes.rs` — `update_node` and `move_node` command wrappers.
- `docs/superpowers/specs/2026-04-25-w4-databases-design.md` §4 "VaultManager::export_row" — the 10-step pseudocode.

**Files touched:**

| File | Change |
|---|---|
| `src-tauri/src/managers/workspace/vault/mod.rs` | Add `export_row` method |
| `src-tauri/src/commands/database.rs` | Reorder 4 mutation commands to call `export_row` first |
| `src-tauri/src/commands/workspace_nodes.rs` | Guard `update_node` + `move_node` for `node_type='row'` |

### Tasks

- [ ] **B-1: Understand the existing `write_card_for_row` method**

  Read `vault/mod.rs` in full. `write_card_for_row` already writes a per-row file for board view. `export_row` is a superset: it writes `rows/<slug>.md` (not the board `cards/` path), includes all cells as YAML frontmatter, applies the Rule 13 mtime guard, and is used for every mutation (not just board). Do not delete `write_card_for_row` — board export still uses it.

- [ ] **B-2: Add `export_row` to `VaultManager`**

  In `src-tauri/src/managers/workspace/vault/mod.rs`, add the following method to `impl VaultManager`. This method follows the 10-step contract from spec §4 and reuses the slug-collision helper pattern from `workspace_manager.rs:1581-1602`:

  ```rust
  /// Write one row's `rows/<slug>.md` to the vault, vault-first.
  ///
  /// Steps:
  ///   1. Read row node from workspace_manager (parent slug + row slug).
  ///   2. Read all cells for the row from db_mgr (post-mutation in-memory state).
  ///   3. Read database fields (schema) for cell-to-frontmatter formatting.
  ///   4. Read row body from workspace_nodes (raw markdown).
  ///   5. Compose YAML frontmatter + body via vault/format.rs helpers.
  ///   6. Compute target path: databases/<db-slug>/rows/<row-slug>.md
  ///   7. Rule 13 mtime check — skip if file does not yet exist (first-write).
  ///   8. Write .tmp + fs::rename (atomic).
  ///   9. Update workspace_nodes.last_read_mtime.
  ///  10. Return vault-root-relative path.
  ///
  /// If the file's on-disk mtime is newer than last_seen_mtime_secs + 1s,
  /// returns Err("VAULT_CONFLICT:{json}") WITHOUT touching SQLite.
  pub async fn export_row(
      &self,
      db_id: &str,
      row_id: &str,
      last_seen_mtime_secs: Option<i64>,
      workspace_manager: &WorkspaceManager,
      db_mgr: &crate::managers::database::manager::DatabaseManager,
  ) -> Result<std::path::PathBuf, String> {
      use std::io::Write as _;

      // 1. Fetch the row node and its parent database node for slug computation.
      let row = workspace_manager
          .get_node(row_id)
          .await?
          .ok_or_else(|| format!("Row '{}' not found", row_id))?;
      if row.node_type != "row" {
          return Err(format!("Node '{}' is not a row", row_id));
      }
      let db = workspace_manager
          .get_node(db_id)
          .await?
          .ok_or_else(|| format!("Database '{}' not found", db_id))?;

      // 2. Fetch all cells for this row.
      let cells = db_mgr
          .get_all_cells_for_row(row_id)
          .await
          .map_err(|e| e.to_string())?;

      // 3. Fetch field schema.
      let fields = db_mgr
          .get_fields(db_id)
          .await
          .map_err(|e| e.to_string())?;

      // 4. Row body is in workspace_nodes.body (raw markdown).
      let body = row.body.clone().unwrap_or_default();

      // 5. Compose file content: YAML frontmatter + markdown body.
      //    Use the existing format helpers for consistency with import.rs.
      let db_slug = format::slugify(&db.name);
      let row_slug = format::slugify(&row.name);
      let content = format_row_file(&row, &fields, &cells, &body, db_id);

      // 6. Compute target path databases/<db-slug>/rows/<row-slug>.md
      let rows_dir = self.vault_root.join("databases").join(&db_slug).join("rows");
      std::fs::create_dir_all(&rows_dir)
          .map_err(|e| format!("Failed to create rows dir: {e}"))?;

      let base_path = rows_dir.join(format!("{row_slug}.md"));
      // Slug-collision guard: if the target exists and belongs to a different id,
      // append -<first8ofid> (same policy as workspace_manager.rs:1581-1602).
      let file_path = {
          if base_path.exists() {
              let existing_id = WorkspaceManager::vault_file_node_id(&base_path);
              if existing_id.as_deref() != Some(&row.id) {
                  let short_id = &row.id[..row.id.len().min(8)];
                  rows_dir.join(format!("{row_slug}-{short_id}.md"))
              } else {
                  base_path
              }
          } else {
              base_path
          }
      };

      // 7. Rule 13 mtime guard — skip on first write (file does not exist).
      if file_path.exists() {
          if let Some(last_seen) = last_seen_mtime_secs {
              if let Ok(meta) = std::fs::metadata(&file_path) {
                  if let Ok(mtime) = meta.modified() {
                      let disk_secs = mtime
                          .duration_since(std::time::UNIX_EPOCH)
                          .unwrap_or_default()
                          .as_secs() as i64;
                      // +3s grace for cloud-sync (Rule 13a).
                      if disk_secs > last_seen + 3 {
                          return Err(format!(
                              "VAULT_CONFLICT:{{\"node_id\":\"{row_id}\",\"disk_mtime\":{disk_secs},\"last_seen\":{last_seen}}}"
                          ));
                      }
                  }
              }
          }
      }

      // 8. Atomic write: .tmp + rename.
      let tmp_path = file_path.with_extension("md.tmp");
      {
          let mut f = std::fs::File::create(&tmp_path)
              .map_err(|e| format!("Failed to create tmp file: {e}"))?;
          f.write_all(content.as_bytes())
              .map_err(|e| format!("Failed to write tmp file: {e}"))?;
      }
      std::fs::rename(&tmp_path, &file_path)
          .map_err(|e| format!("Failed to rename vault file: {e}"))?;

      // 9. Update last_read_mtime in workspace_nodes.
      if let Ok(meta) = std::fs::metadata(&file_path) {
          if let Ok(mtime) = meta.modified() {
              let mtime_secs = mtime
                  .duration_since(std::time::UNIX_EPOCH)
                  .unwrap_or_default()
                  .as_secs() as i64;
              // Best-effort — ignore error (not fatal).
              let _ = workspace_manager
                  .set_node_last_read_mtime(row_id, mtime_secs)
                  .await;
          }
      }

      // 10. Return vault-root-relative path.
      Ok(file_path)
  }
  ```

  After writing this, add the private helper `format_row_file` in the same file (or in `vault/format.rs` if format helpers already live there). It composes:

  ```
  ---
  id: <row.id>
  database_id: <db_id>
  title: <row.name>
  <field_id>: <cell_value_yaml>
  ...
  vault_version: 1
  ---
  <body>
  ```

  Use `serde_yaml` or manual string construction consistent with how `write_card_for_row` / `export_board` currently serialize YAML. Do not introduce a new YAML library.

- [ ] **B-3: Add `set_node_last_read_mtime` helper to `WorkspaceManager` if it doesn't exist**

  Check `workspace_manager.rs` for an existing `set_node_last_read_mtime` method. If absent, add:

  ```rust
  pub async fn set_node_last_read_mtime(&self, node_id: &str, mtime_secs: i64) -> Result<(), String> {
      let conn = self.conn.lock().await;
      conn.execute(
          "UPDATE workspace_nodes SET last_read_mtime = ?1 WHERE id = ?2",
          params![mtime_secs, node_id],
      ).map_err(|e| e.to_string())?;
      Ok(())
  }
  ```

  Confirm that `workspace_nodes` has a `last_read_mtime` column (it should — Rule 13 uses it for document writes). If the column does not exist, add a migration.

- [ ] **B-4: Reorder `update_cell` to call `export_row` first**

  In `src-tauri/src/commands/database.rs`, the current `update_cell` calls `db_mgr.update_cell(...)` directly. Change it to:

  1. Accept `db_id: String` as a new parameter (needed to locate the database slug). Also accept `last_seen_mtime_secs: Option<i64>` for the Rule 13 guard.
  2. Call `vault_mgr.export_row(db_id, row_id, last_seen_mtime_secs, ws_mgr, db_mgr).await?` first.
  3. Only if that succeeds, call `db_mgr.update_cell(row_id, field_id, data).await`.

  The command signature becomes:

  ```rust
  #[tauri::command]
  #[specta::specta]
  pub async fn update_cell(
      db_mgr: State<'_, Arc<DatabaseManager>>,
      ws_mgr: State<'_, Arc<WorkspaceManager>>,
      vault_mgr: State<'_, Arc<VaultManager>>,
      database_id: String,
      row_id: String,
      field_id: String,
      _field_type: FieldType,
      data: CellData,
      last_seen_mtime_secs: Option<i64>,
  ) -> Result<(), String> {
      vault_mgr
          .export_row(&database_id, &row_id, last_seen_mtime_secs, &ws_mgr, &db_mgr)
          .await?;
      db_mgr
          .update_cell(&row_id, &field_id, &data)
          .await
          .map_err(|e| e.to_string())
  }
  ```

  Note: `VaultManager` must be registered as a Tauri `State` in `lib.rs`. Check whether it is already. If not, add it to the `app.manage(...)` block in `lib.rs` (construct with `VaultManager::new(vault_root)`).

- [ ] **B-5: Reorder `create_row` to call `export_row` first**

  After `db_mgr.create_row(database_id).await` creates the SQLite row and returns the new `row_id`, call `vault_mgr.export_row(database_id, new_row_id, None, ws_mgr, db_mgr).await`. Pass `None` for `last_seen_mtime_secs` — first-write skips mtime check. If vault write fails, soft-delete the SQLite row to avoid orphans, then return the error.

- [ ] **B-6: Reorder `create_row_in_group` to call `export_row` first**

  Same pattern as B-5: create row in SQLite, then immediately call `export_row` with `last_seen_mtime_secs = None`. Rollback on vault failure.

- [ ] **B-7: Reorder `update_row_date` to call `export_row` first**

  Accept `database_id: String` and `last_seen_mtime_secs: Option<i64>` in the command signature. Call `export_row` before `db_mgr.update_row_date(...)`.

- [ ] **B-8: Guard `update_node` in `commands/workspace_nodes.rs` for rows**

  In the `update_node` Tauri command, after reading the node from `ws_mgr`, check `node.node_type == "row"`. If true, call `vault_mgr.export_row(parent_db_id, node_id, last_seen_mtime_secs, ws_mgr, db_mgr).await?` before the existing `ws_mgr.update_node(...)` call. The `parent_db_id` is `node.parent_id`. If `parent_id` is None or the parent is not a database, fall through to the existing document path unchanged.

- [ ] **B-9: Extend the existing `move_node` wrapper to handle rows**

  **Read first:** [src-tauri/src/commands/workspace_nodes.rs:235-275](src-tauri/src/commands/workspace_nodes.rs:235). The wrapper already does the right thing for `node_type == "document"`: calls `ws_mgr.move_node` (SQLite), then `write_node_to_vault` (new path), then `fs::remove_file(old_path)` if the path changed, then `cascade_descendant_vault_paths`. Documents are NOT broken — there is no orphan-file bug for documents to fix. W4's job is to extend the same wrapper to also handle rows.

  Change the gate at line 243:

  ```rust
  // Before:
  if node.node_type == "document" && node.deleted_at.is_none() {
      // existing write-new + delete-old + cascade logic
  }

  // After:
  if node.deleted_at.is_none() {
      match node.node_type.as_str() {
          "document" => {
              // existing path — unchanged
              let old_rel_path = node.vault_rel_path.clone();
              let new_rel_path = state.workspace_manager.write_node_to_vault(&app, &node, None).await?;
              // ... existing delete-old + cascade ...
          }
          "row" => {
              // new path — vault-first via export_row
              let parent_db_id = node.parent_id.as_deref()
                  .ok_or("Row has no parent database")?;
              let old_rel_path = node.vault_rel_path.clone();
              let new_rel_path = state.vault_manager
                  .export_row(parent_db_id, &node.id, None, &state.workspace_manager, &state.database_manager)
                  .await?;
              if let Some(old) = old_rel_path.as_deref() {
                  if old != new_rel_path.to_string_lossy() {
                      let old_file = resolve_vault_root(&app).join(old);
                      if old_file.exists() {
                          let _ = fs::remove_file(&old_file);  // best-effort, log on failure
                      }
                  }
              }
              state.workspace_manager.update_vault_rel_path(&node.id, &new_rel_path.to_string_lossy()).await?;
          }
          _ => { /* databases and other types skip vault sync */ }
      }
  }
  ```

  **Do not add a new code path.** Reuse the existing wrapper's structure (old-path capture → write new → delete old → update `vault_rel_path`). The only new branch is the `"row"` arm that calls `export_row` instead of `write_node_to_vault`.

  Cascade is not needed for rows because rows don't have descendants (rows live under a database, never under another row).

- [ ] **B-10: Write Rust tests for `export_row`**

  In `src-tauri/src/managers/workspace/vault/mod.rs` or a sibling test file, add:

  ```rust
  #[cfg(test)]
  mod export_row_tests {
      #[tokio::test]
      async fn export_row_first_write_skips_mtime_check() {
          // Set up temp vault dir + in-memory WorkspaceManager + DatabaseManager.
          // Create a database and a row. Call export_row with last_seen_mtime_secs=None.
          // Assert: file created at expected path; no VAULT_CONFLICT error.
      }

      #[tokio::test]
      async fn export_row_mtime_conflict_returns_error_before_sqlite() {
          // Set up same as above but write a file at the target path with a future mtime.
          // Call export_row with last_seen_mtime_secs = (past value).
          // Assert: returns Err containing "VAULT_CONFLICT".
          // Assert: SQLite cells table is unchanged (verify by re-reading cells).
      }

      #[tokio::test]
      async fn export_row_rename_writes_new_path_deletes_old() {
          // Create a row, export it (creates rows/old-slug.md).
          // Rename the row (update workspace_nodes.name → new name).
          // Call export_row again.
          // Assert: rows/new-slug.md exists.
          // Assert: rows/old-slug.md is deleted.
      }
  }
  ```

- [ ] **B-11: Build and test**

  ```bash
  cd src-tauri && cargo build --lib 2>&1 | tail -15
  cargo test --lib export_row 2>&1
  cargo test --lib 2>&1 | tail -5
  ```

  All green before committing.

- [ ] **B-12: Commit**

  ```bash
  git add src-tauri/src/managers/workspace/vault/mod.rs \
          src-tauri/src/commands/database.rs \
          src-tauri/src/commands/workspace_nodes.rs \
          src-tauri/src/managers/workspace/workspace_manager.rs
  git commit -m "feat(w4): VaultManager::export_row + vault-first mutation ordering

  Adds export_row: atomic temp+rename write of rows/<slug>.md with Rule 13
  mtime guard (+3s cloud-sync grace). First-write skips the mtime check.
  Slug-collision appends -<first8ofid> (same policy as workspace_manager
  write_node_to_vault lines 1581-1602).

  Reorders update_cell, create_row, create_row_in_group, update_row_date
  to call export_row BEFORE any SQLite write. VAULT_CONFLICT returns before
  SQLite is ever touched — local optimistic state rolls back on the frontend.

  Extends the existing move_node command wrapper at workspace_nodes.rs:243
  to handle node_type='row' alongside the existing 'document' path. Documents
  already had correct vault sync (write-new + delete-old + cascade); the
  earlier-flagged 'document orphan' concern was a misread of the code. No new
  code path — same wrapper, one new match arm.

  cargo test --lib: all green."
  ```

### Acceptance Criteria

- `grep -c "export_row" src-tauri/src/managers/workspace/vault/mod.rs` returns ≥1.
- `grep -c "export_row" src-tauri/src/commands/database.rs` returns ≥3 (used in update_cell, create_row, create_row_in_group, update_row_date).
- `cargo test --lib export_row_first_write` exits 0.
- `cargo test --lib export_row_mtime_conflict` exits 0.
- `cargo test --lib` exits 0 — no regressions.

---

## Commit C — `useDatabase` hook + `cellRenderers`

**Goal:** Frontend-only. Write the two `src/database/` files that all three view components will consume. No component renders yet — these are pure logic + UI primitives. Testable in isolation.

**Read first:**
- `docs/superpowers/specs/2026-04-25-w4-databases-design.md` §3 — `useDatabase` return shape, debounce policy table, data-flow diagram.
- `src/components/NotesView.tsx` — pattern for `commands` import from `../bindings`, `sonner` toast usage.
- `src/bindings.ts` — existing `commands.*` types after A+B regeneration. Specifically: `DatabaseSummary`, `CellData`, `Field`, `FieldType`, `Row`.
- `src/editor/tabsReducer.ts` — not directly used but shows how the project structures non-component logic in `src/editor/`.

**Files touched:**

| File | Change |
|---|---|
| `src/database/useDatabase.ts` | New file |
| `src/database/cellRenderers.tsx` | New file |
| `src/database/__tests__/useDatabase.test.ts` | New file |

### Tasks

- [ ] **C-1: Create `src/database/` directory structure**

  ```bash
  mkdir -p src/database/__tests__
  ```

- [ ] **C-2: Write `src/database/useDatabase.ts`**

  The hook manages three layers:
  - `rowIndex`: loaded once on mount via `commands.getRowsFilteredSorted(dbId, [], [])`. Each entry is `{ id, title, position, groupKey }` — a small payload; body/cells are never in this list.
  - `cells`: a `useRef<Map<string, Map<string, CellData>>>` (rowId → fieldId → value) populated lazily.
  - `cellsVersion`: a `useState<number>` counter that increments after each `get_cells_for_rows` call to trigger re-render of affected rows.

  Key behaviors to implement:

  1. `cellsForRange(startIdx, endIdx)` — diff against already-fetched row IDs, call `commands.getCellsForRows(dbId, missingIds)`, populate `cells` ref, increment `cellsVersion`.
  2. `mutateCell(rowId, fieldId, data, debounceKind)` — `debounceKind: 'typing' | 'immediate'`. Typing uses a 300ms debounce per `${rowId}:${fieldId}` key. Immediate calls `invoke` synchronously (no debounce, no batch). Both are optimistic: update `cells` ref immediately, then call Tauri command. On error: revert `cells` ref entry to previous value, fire `toast.error('Failed to save')`.
  3. `createRow()` — calls `commands.createRow(dbId)`, appends to `rowIndex`.
  4. `createRowInGroup(fieldId, optionId)` — calls `commands.createRowInGroup(dbId, fieldId, optionId)`.
  5. `moveRowGroup(rowId, fieldId, optionId)` — calls `mutateCell(rowId, fieldId, { type: 'SingleSelect', value: optionId }, 'immediate')`.
  6. `deleteRow(rowId)` — calls `commands.softDeleteNode(rowId)`, removes from `rowIndex`.

  Sort: when `sortParams` changes (future), re-issue `commands.getRowsFilteredSorted(dbId, filters, sorts)` and reset the cell cache. In W4, default is no sort, no filter — pass empty arrays.

  The hook signature:

  ```typescript
  export function useDatabase(dbId: string | null): UseDatabaseResult
  ```

  When `dbId` is null, return an empty/loading state — sidebar may not have selected a DB yet.

- [ ] **C-3: Write `src/database/cellRenderers.tsx`**

  Six named exports, one per field type. All are plain DOM components; CSS classes from `databases.css` (to be created in Commit D+). Each component receives `{ value, onChange, readOnly?, fieldId, rowId }` and the matching `CellData` type from bindings.

  | Export | FieldType | Element | Behavior |
  |---|---|---|---|
  | `TextCell` | `RichText` | `contenteditable div` | `onInput` fires `onChange` with debounce 300ms |
  | `NumberCell` | `Number` | `<input type="number">` | `onChange` fires with debounce 300ms |
  | `DateCell` | `Date` | pill + `<input type="date">` on click | immediate onChange |
  | `SelectCell` | `SingleSelect` or `MultiSelect` | pill(s) + opens `DatabaseSelectPopover` | immediate onChange |
  | `CheckboxCell` | `Checkbox` | `<input type="checkbox">` | immediate onChange |
  | `UnsupportedCell` | all others | read-only text + tooltip "Field type not supported in W4" | no onChange |

  All cell components must use only CSS class names (`.db-cell-text`, `.db-cell-number`, etc.) — no inline style literals. Dynamic values (e.g., option color from `options[].color`) may use `style={{ background: option.color }}` since color is data-driven, not a design constant.

- [ ] **C-4: Write `src/database/__tests__/useDatabase.test.ts`**

  Four test cases to write (use vitest + `@testing-library/react` hooks testing, matching the test pattern in `src/editor/__tests__/`):

  1. **Paged slice math**: given `rowIndex` of 100 rows, call `cellsForRange(10, 59)`. Assert that `commands.getCellsForRows` was called with exactly the 50 row IDs at indices 10–59. Call `cellsForRange(10, 59)` again — assert `commands.getCellsForRows` is NOT called again (already fetched).

  2. **Sort independence**: populate `rowIndex` from `getRowsFilteredSorted` returning IDs in a specific order. Assert that `cellsForRange` fetches cells for those IDs in that order regardless of insertion order in the `cells` Map.

  3. **Atomic mutation skips debounce**: call `mutateCell` with kind `'immediate'`. Assert the Tauri `invoke` is called synchronously in the same tick (no setTimeout/debounce pending).

  4. **Soft-delete hides row**: call `deleteRow(rowId)`. Assert the row is removed from `rowIndex`. Assert the `cells` map entry for that row is cleared.

- [ ] **C-5: Run tests**

  ```bash
  bunx vitest run src/database/__tests__/useDatabase.test.ts
  ```

  All four must pass.

- [ ] **C-6: Commit**

  ```bash
  git add src/database/
  git commit -m "feat(w4): useDatabase hook + cellRenderers (frontend, no component render yet)

  useDatabase(dbId):
  - rowIndex loads once via getRowsFilteredSorted (small payload, no cells)
  - cellsForRange(start, end) lazy-fetches the visible window via getCellsForRows
  - cells stored in a useRef Map; cellsVersion counter triggers targeted re-renders
  - mutateCell split: typing=300ms debounce, atomic=immediate
  - optimistic: local state updates first; rollback + sonner toast on error

  cellRenderers: six field-type components (TextCell, NumberCell, DateCell,
  SelectCell, CheckboxCell, UnsupportedCell). All DOM, no canvas. CSS tokens only.

  4 vitest cases: paged slice math, sort independence, atomic skip debounce,
  soft-delete hides row — all green."
  ```

### Acceptance Criteria

- `bunx vitest run src/database/__tests__/useDatabase.test.ts` exits 0, 4 tests passing.
- File `src/database/glideTheme.ts` does NOT exist.
- `grep -c "getComputedStyle" src/database/useDatabase.ts` returns 0.
- `grep -c "getComputedStyle" src/database/cellRenderers.tsx` returns 0.
- `grep -rE "rgba\(" src/database/` returns zero matches.

---

## Commit D — `DatabaseTableView` (TanStack + virtualizer)

**Goal:** The Table view component. Renders all loaded rows with TanStack Table v8, virtualizes rows with `@tanstack/react-virtual`. Right-click on a row shows a context menu with "Open" and "Delete". Creates `src/styles/databases.css` with the initial `.db-*` class set.

**Read first:**
- TanStack Table v8 docs for `useReactTable`, `getCoreRowModel`, `getRowId`, `flexRender`. (Use context7 or the bundled node_modules README if offline.)
- `@tanstack/react-virtual` docs for `useVirtualizer` with a scrollable container element ref.
- `src/database/useDatabase.ts` (from Commit C) — the hook's return shape.
- `src/database/cellRenderers.tsx` — the six cell components.
- `src/components/NotesView.tsx` — `toast` import pattern; `commands` usage.
- `docs/superpowers/specs/2026-04-25-w4-databases-design.md` §3 TanStack cell renderers table + §6 card-tier mapping.

**Files touched:**

| File | Change |
|---|---|
| `src/components/DatabaseTableView.tsx` | New file |
| `src/styles/databases.css` | New file — initial `.db-*` class set |

### Tasks

- [ ] **D-1: Install dependencies if missing**

  Check `package.json` for `@tanstack/react-table`, `@tanstack/react-virtual`. If absent:

  ```bash
  bun add @tanstack/react-table @tanstack/react-virtual
  ```

  Also confirm `dnd-kit` packages are present (needed in Commit E). If not:

  ```bash
  bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
  ```

  And `@floating-ui/react` for Commit E's popover:

  ```bash
  bun add @floating-ui/react
  ```

- [ ] **D-2: Create `src/styles/databases.css`**

  This file holds all `.db-*` class definitions. Token-only per Rule 12. Initial set for the Table view:

  ```css
  /* databases.css — W4 database surface styles.
     All values via CSS custom properties. No rgba literals. No px/rem/hex
     hardcoded values — use var(--space-N), var(--radius-*), var(--text-*). */

  /* ── Layout ─────────────────────────────────────────────────────────── */

  .db-shell {
    display: flex;
    height: 100%;
    overflow: hidden;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  .db-sidebar {
    width: 220px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    background: var(--card-mid-fill);
    backdrop-filter: blur(var(--card-mid-blur)) saturate(var(--card-mid-saturate));
    border: 1px solid var(--card-mid-rim);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
    overflow-y: auto;
  }

  .db-stage {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--card-deep-fill);
    backdrop-filter: blur(var(--card-deep-blur)) saturate(var(--card-deep-saturate));
    border: 1px solid var(--card-deep-rim);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .db-chrome {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--card-deep-rim);
  }

  /* ── Sidebar items ───────────────────────────────────────────────────── */

  .db-sidebar__search {
    width: 100%;
  }

  .db-sidebar__item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-container);
    cursor: pointer;
    color: var(--heros-text-secondary);
    font-size: var(--text-sm);
    transition: background 0.15s ease;
  }

  .db-sidebar__item:hover {
    background: var(--row-hover-fill);
  }

  .db-sidebar__item--active {
    background: var(--row-hover-fill);
    color: var(--heros-text-primary);
  }

  .db-sidebar__count {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--heros-text-tertiary);
  }

  /* ── Chrome ──────────────────────────────────────────────────────────── */

  .db-chrome__title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--heros-text-primary);
    flex: 1;
  }

  .db-chrome__tabs {
    display: flex;
    gap: var(--space-1);
  }

  .db-chrome__tab {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--chip-radius);
    font-size: var(--text-sm);
    color: var(--heros-text-secondary);
    cursor: pointer;
    border: none;
    background: transparent;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .db-chrome__tab:hover {
    background: var(--row-hover-fill);
  }

  .db-chrome__tab--active {
    background: var(--card-mid-fill);
    color: var(--heros-text-primary);
  }

  .db-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--chip-radius);
    font-size: var(--text-xs);
    background: var(--card-mid-fill);
    color: var(--heros-text-secondary);
    cursor: pointer;
    border: 1px solid var(--card-mid-rim);
    transition: background 0.15s ease;
  }

  .db-pill:hover {
    background: var(--row-hover-fill);
  }

  /* ── Table ───────────────────────────────────────────────────────────── */

  .db-table-scroll {
    flex: 1;
    overflow: auto;
    position: relative;
  }

  .db-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
    color: var(--heros-text-primary);
  }

  .db-table thead {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--card-deep-fill);
  }

  .db-table th {
    padding: var(--space-2) var(--space-3);
    text-align: left;
    font-weight: 500;
    color: var(--heros-text-secondary);
    border-bottom: 1px solid var(--card-deep-rim);
    white-space: nowrap;
  }

  .db-table td {
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--card-deep-rim);
    vertical-align: middle;
  }

  .db-table tr:hover td {
    background: var(--row-hover-fill);
  }

  .db-table__title-cell {
    cursor: pointer;
    color: var(--heros-text-primary);
    font-weight: 500;
  }

  .db-table__title-cell:hover {
    text-decoration: underline;
  }

  /* ── Cells ───────────────────────────────────────────────────────────── */

  .db-cell-text {
    width: 100%;
    min-height: 1.4em;
    outline: none;
  }

  .db-cell-number {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: inherit;
    font-size: inherit;
    font-family: inherit;
  }

  .db-cell-checkbox {
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: var(--heros-brand);
  }

  .db-cell-date {
    cursor: pointer;
    color: var(--heros-text-secondary);
  }

  .db-cell-select-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px var(--space-2);
    border-radius: var(--chip-radius);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .db-cell-unsupported {
    color: var(--heros-text-tertiary);
    font-size: var(--text-xs);
    font-style: italic;
  }

  /* ── Footer ──────────────────────────────────────────────────────────── */

  .db-footer {
    flex-shrink: 0;
    padding: var(--space-2) var(--space-4);
    border-top: 1px solid var(--card-deep-rim);
    font-size: var(--text-xs);
    color: var(--heros-text-tertiary);
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .db-footer__add-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    cursor: pointer;
    color: var(--heros-text-secondary);
    transition: color 0.15s ease;
    background: none;
    border: none;
    font-size: var(--text-xs);
    padding: 0;
  }

  .db-footer__add-row:hover {
    color: var(--heros-text-primary);
  }

  /* ── Context menu ────────────────────────────────────────────────────── */

  .db-context-menu {
    position: fixed;
    z-index: 100;
    background: var(--card-overlay-fill);
    backdrop-filter: blur(var(--card-overlay-blur)) saturate(var(--card-overlay-saturate));
    border: 1px solid var(--card-overlay-rim);
    border-radius: var(--radius-container);
    padding: var(--space-1);
    min-width: 160px;
    box-shadow: var(--heros-panel-shadow);
  }

  .db-context-menu__item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--chip-radius);
    font-size: var(--text-sm);
    color: var(--heros-text-primary);
    cursor: pointer;
    background: none;
    border: none;
    width: 100%;
    text-align: left;
    transition: background 0.1s ease;
  }

  .db-context-menu__item:hover {
    background: var(--row-hover-fill);
  }

  .db-context-menu__item--danger {
    color: var(--heros-danger);
  }
  ```

- [ ] **D-3: Write `src/components/DatabaseTableView.tsx`**

  Receives `{ dbId, onOpenRow }` props. Internally:

  1. Calls `useDatabase(dbId)` for `rowIndex`, `fields`, `cells`, `cellsForRange`, `mutateCell`, `createRow`, `deleteRow`.
  2. Creates a TanStack table with `useReactTable({ data: rowIndex, columns, getCoreRowModel, getRowId: row => row.id })`. Columns are derived from `fields`: first column is the title/name column (always present), then one column per field.
  3. Uses `useVirtualizer` from `@tanstack/react-virtual` with the scroll container ref. `estimateSize` returns 36 (px) per row. After each virtualizer render, calls `cellsForRange(range.startIndex, range.endIndex)`.
  4. Renders the virtualizer rows using `flexRender` + the appropriate cell component from `cellRenderers.tsx`. `mutateCell` is wired into each cell's `onChange`.
  5. Right-click on any row fires a `contextmenu` event: shows `.db-context-menu` at `(e.clientX, e.clientY)` with "Open" (calls `onOpenRow(rowId)`) and "Delete" (calls `deleteRow(rowId)`). Menu closes on any other click (click-outside listener on `window`).
  6. The title cell click calls `onOpenRow(rowId)` directly.
  7. Footer shows `{rowIndex.length} rows` and a "+ New row" button that calls `createRow()`.
  8. `Del` / `Backspace` key on a focused row (not editing a cell) calls `deleteRow(rowId)`.

- [ ] **D-4: Verify `databases.css` is imported**

  In `src/App.css`, check for the `@import './styles/databases.css'` line. Add it if absent (after the existing concern imports).

- [ ] **D-5: Build check**

  ```bash
  bun run build 2>&1 | grep -E "error|warning" | head -20
  ```

  Zero new errors. Warnings about missing Tauri backend are expected in build-only mode.

- [ ] **D-6: Commit**

  ```bash
  git add src/components/DatabaseTableView.tsx src/styles/databases.css src/App.css
  git commit -m "feat(w4): DatabaseTableView — TanStack Table + react-virtual (DOM rows)

  TanStack Table v8 with useVirtualizer (react-virtual). ~50 rows in DOM
  at any time. cellsForRange called after each virtualizer scroll tick.
  cellRenderers wired per field type. Right-click context menu: Open + Delete.
  Title cell click routes to Notes view via onOpenRow prop.

  databases.css: all .db-* classes, token-only per Rule 12. No rgba literals.
  No inline style literals except option.color (data-driven, not design token)."
  ```

### Acceptance Criteria

- `grep -rE "rgba\(" src/components/DatabaseTableView.tsx src/styles/databases.css` returns zero matches.
- `grep -c "useVirtualizer" src/components/DatabaseTableView.tsx` returns ≥1.
- `grep -c "useReactTable" src/components/DatabaseTableView.tsx` returns ≥1.
- `grep -c "GlideDataGrid\|glide-data-grid\|glideTheme" src/components/DatabaseTableView.tsx` returns 0.
- `bun run build` exits 0 with no new errors.

---

## Commit E — `DatabaseBoardView` + `DatabaseSelectPopover`

**Goal:** Kanban board using dnd-kit. Columns sourced from the first SingleSelect field in `fields` order. Drag within a column reorders; drag across columns calls `moveRowGroup`. Also adds `DatabaseSelectPopover` (used by SelectCell in both views).

**Read first:**
- `docs/superpowers/specs/2026-04-25-w4-databases-design.md` §3 "Board view structure" — `.db-board__col`, `.db-board__card`, drag interaction rules.
- dnd-kit `DndContext`, `SortableContext`, `useSortable`, `verticalListSortingStrategy`, `arrayMove` docs.
- `@floating-ui/react` `useFloating`, `useInteractions`, `useDismiss` docs for the popover.
- `src/database/useDatabase.ts` — `createRowInGroup`, `moveRowGroup` signatures.
- `pitfall.md` § "Tree drag-and-drop" — four dnd-kit traps already hit in this repo.

**Board DnD vs Tree DnD — what's different:**

The note tree (`src/components/Tree.tsx`) and the board have opposite DnD needs.

| Concern | Tree | Board |
|---|---|---|
| Sorting strategy | `noopSortingStrategy` — items must NOT shift while dragging | `verticalListSortingStrategy` — items SHOULD shift to show where the card lands |
| Drop animation | `<DragOverlay dropAnimation={null}>` | Same — also set `dropAnimation={null}` to kill the bounce snap-back |
| Nesting detection | bottom-half + `delta.x > 32` = inside | N/A — no nesting in kanban columns |
| Collision detection | `pointerWithin` + `closestCenter` fallback | Standard `closestCenter` is fine for column-to-column drops |

The board has its own isolated `DndContext` — it does not share state or sensors with the tree's `DndContext`. Do NOT merge them.

**Files touched:**

| File | Change |
|---|---|
| `src/components/DatabaseBoardView.tsx` | New file |
| `src/components/DatabaseSelectPopover.tsx` | New file |
| `src/styles/databases.css` | Append board + popover classes |

### Tasks

- [ ] **E-1: Append board classes to `src/styles/databases.css`**

  After the existing context-menu rules, add:

  ```css
  /* ── Board ───────────────────────────────────────────────────────────── */

  .db-board {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3);
    overflow-x: auto;
    height: 100%;
    align-items: flex-start;
  }

  .db-board__col {
    flex-shrink: 0;
    width: 280px;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .db-board__col-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-1);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--heros-text-primary);
  }

  .db-board__col-count {
    font-size: var(--text-xs);
    color: var(--heros-text-tertiary);
    font-weight: 400;
  }

  .db-board__col-add {
    margin-left: auto;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--heros-text-secondary);
    padding: var(--space-1);
    border-radius: var(--chip-radius);
    transition: background 0.1s ease;
  }

  .db-board__col-add:hover {
    background: var(--row-hover-fill);
    color: var(--heros-text-primary);
  }

  .db-board__cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 40px;
  }

  .db-board__card {
    background: var(--card-mid-fill);
    backdrop-filter: blur(var(--card-mid-blur)) saturate(var(--card-mid-saturate));
    border: 1px solid var(--card-mid-rim);
    border-radius: var(--radius-container);
    padding: var(--space-2) var(--space-3);
    cursor: grab;
    transition: background 0.1s ease, box-shadow 0.1s ease;
  }

  .db-board__card:hover {
    background: var(--row-hover-fill-deep);
  }

  .db-board__card--dragging {
    opacity: 0.5;
    cursor: grabbing;
  }

  .db-board__card-title {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--heros-text-primary);
    cursor: pointer;
  }

  .db-board__card-title:hover {
    text-decoration: underline;
  }

  /* ── Select Popover ───────────────────────────────────────────────────── */

  .db-select-popover {
    background: var(--card-overlay-fill);
    backdrop-filter: blur(var(--card-overlay-blur)) saturate(var(--card-overlay-saturate));
    border: 1px solid var(--card-overlay-rim);
    border-radius: var(--radius-container);
    padding: var(--space-2);
    min-width: 180px;
    box-shadow: var(--heros-panel-shadow);
    z-index: 200;
  }

  .db-select-popover__option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--chip-radius);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: background 0.1s ease;
  }

  .db-select-popover__option:hover {
    background: var(--row-hover-fill);
  }

  .db-select-popover__option--selected {
    font-weight: 600;
  }

  .db-select-popover__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  ```

- [ ] **E-2: Write `src/components/DatabaseSelectPopover.tsx`**

  Props: `{ options, value: string | string[], multi: boolean, onChange, referenceElement }`.

  Uses `useFloating` from `@floating-ui/react` with `offset(4)` and `flip()` middleware. Positioned relative to `referenceElement`. `useDismiss` closes on click-outside or Escape.

  Renders a `.db-select-popover` div with one `.db-select-popover__option` per option. In multi mode, shows checkmarks alongside selected options. In single mode, highlights the current selection. Clicking an option fires `onChange` immediately.

- [ ] **E-3: Wire `SelectCell` in `cellRenderers.tsx` to use `DatabaseSelectPopover`**

  `SelectCell` renders the current pill(s). On click, it renders `<DatabaseSelectPopover>` anchored to itself. `onChange` calls the parent's `mutateCell` with kind `'immediate'`.

- [ ] **E-4: Write `src/components/DatabaseBoardView.tsx`**

  Props: `{ dbId, onOpenRow }`.

  1. Calls `useDatabase(dbId)` for `fields`, `rowIndex`, `cells`, `cellsForRange`, `createRowInGroup`, `moveRowGroup`.
  2. Finds the group field: `const groupField = fields.find(f => f.fieldType === 'SingleSelect')`. If `undefined`, renders `<EmptyState message="Add a SingleSelect field to use Board view" />`.
  3. Fetches cells for all rows on mount (`cellsForRange(0, rowIndex.length)`) — Board view needs all group-key values to place cards in columns. This is acceptable because Board is not virtualized in W4 (deferred per spec §11 remaining unknowns).
  4. Groups `rowIndex` by each row's value in the group field: builds `Map<optionId | null, RowMeta[]>`.
  5. Renders columns: one per option in `groupField.options` order, plus an optional "No status" column for rows with no group cell value.
  6. Each column is a `SortableContext` with `verticalListSortingStrategy`. Each card is a `useSortable` element.
  7. `DndContext.onDragEnd`:
     - If `over.id` is in the same column: call `WorkspaceManager.reorder_node_children` via `commands.reorderDbViews` (check whether an existing reorder command covers rows, or use `moveNode` with an updated position). Use fractional indexing: `newPosition = (prev.position + next.position) / 2`. If gap < 1e-9, rebalance.
     - If `over.id` is in a different column: call `moveRowGroup(rowId, groupField.id, newOptionId)`.
  8. Column "+" button calls `createRowInGroup(groupField.id, optionId)`.
  9. Card title click calls `onOpenRow(rowId)`.

- [ ] **E-5: Build check**

  ```bash
  bun run build 2>&1 | grep -E "^.*error" | head -20
  ```

  Zero new errors.

- [ ] **E-6: Commit**

  ```bash
  git add src/components/DatabaseBoardView.tsx \
          src/components/DatabaseSelectPopover.tsx \
          src/styles/databases.css \
          src/database/cellRenderers.tsx
  git commit -m "feat(w4): DatabaseBoardView (dnd-kit) + DatabaseSelectPopover (@floating-ui)

  Board columns from first SingleSelect field in fields order (spec §3).
  Drag within column: reorder via fractional position. Drag across: moveRowGroup
  → update_cell(groupField, newOptionId) vault-first.
  EmptyState if no SingleSelect field exists.

  DatabaseSelectPopover: @floating-ui/react anchor, dismiss on click-outside,
  single + multi mode. Wired into SelectCell in cellRenderers.tsx.

  databases.css: board + popover token classes appended. Still zero rgba."
  ```

### Acceptance Criteria

- `grep -c "DndContext" src/components/DatabaseBoardView.tsx` returns ≥1.
- `grep -c "useFloating" src/components/DatabaseSelectPopover.tsx` returns ≥1.
- `grep -c "GlideDataGrid\|glide-data-grid" src/components/DatabaseBoardView.tsx` returns 0.
- `grep -rE "rgba\(" src/styles/databases.css` returns zero matches.
- `bun run build` exits 0.

---

## Commit F — Shell rewrite + sidebar + conflict toast wiring

**Goal:** Rewrite `DatabasesView.tsx` completely. Inline sidebar backed by `list_databases`. Inline chrome (title, view tabs, filter pills, footer stats). View router connecting the three commits above. Conflict toast with "Open / Reload / Keep mine" actions. Focus-reconcile hook (capped to virtualizer-visible rows).

**Read first:**
- `src/components/DatabasesView.tsx` — the current 300+ line mock to be replaced in full. Read it once to confirm which lucide-react icons will still be needed (keep `Database`, `Search`, `Plus`, `Filter`, `Table`, `Layout`, `Columns` if still used; drop the rest).
- `src/components/NotesView.tsx` — the wiring pattern to mirror for `currentPage` prop and `onNavigate`.
- `src/contexts/VaultContext.tsx` — how `currentPage` / `onNavigate` are threaded through `AppShell`.
- `docs/superpowers/specs/2026-04-25-w4-databases-design.md` §5 conflict handling table.
- `CLAUDE.md` Rule 13 — conflict guard; Rule 14 — focus reconcile capped to visible rows.

**Files touched:**

| File | Change |
|---|---|
| `src/components/DatabasesView.tsx` | Full rewrite |
| `src/App.css` | Confirm `@import './styles/databases.css'` exists |

### Tasks

- [ ] **F-1: Write the new `DatabasesView.tsx` shell**

  Skeleton (fill in detail):

  ```typescript
  import { useState, useEffect, useRef, useCallback } from 'react'
  import { Database, Search, Plus, Filter, Table2, Columns3 } from 'lucide-react'
  import { toast } from 'sonner'
  import { commands } from '../bindings'
  import { DatabaseTableView } from './DatabaseTableView'
  import { DatabaseBoardView } from './DatabaseBoardView'
  import { EmptyState } from './EmptyState'          // existing component
  import type { DatabaseSummary } from '../bindings'

  type ViewType = 'table' | 'board' | 'calendar' | 'list' | 'gallery' | 'timeline'

  interface Props {
    onNavigate: (page: string, nodeId?: string) => void
  }

  export function DatabasesView({ onNavigate }: Props) {
    const [databases, setDatabases] = useState<DatabaseSummary[]>([])
    const [selectedDbId, setSelectedDbId] = useState<string | null>(null)
    const [currentView, setCurrentView] = useState<ViewType>('table')
    const [searchQuery, setSearchQuery] = useState('')

    // Load sidebar on mount and on searchQuery change (debounced 150ms).
    // ...

    // Conflict toast helper — fires when any mutation command returns
    // a string starting with "VAULT_CONFLICT:".
    const handleVaultConflict = useCallback((rowId: string, conflictJson: string) => {
      const { disk_mtime } = JSON.parse(conflictJson.replace('VAULT_CONFLICT:', ''))
      toast.error(`Row changed on disk.`, {
        action: {
          label: 'Open',
          onClick: () => onNavigate('notes', rowId),
        },
        cancel: { label: 'Dismiss', onClick: () => {} },
        // "Reload" and "Keep mine" are handled inside useDatabase hook directly.
      })
    }, [onNavigate])

    const renderView = () => {
      if (!selectedDbId) {
        return <EmptyState message="Select a database from the sidebar" />
      }
      switch (currentView) {
        case 'table':
          return (
            <DatabaseTableView
              dbId={selectedDbId}
              onOpenRow={(rowId) => onNavigate('notes', rowId)}
            />
          )
        case 'board':
          return (
            <DatabaseBoardView
              dbId={selectedDbId}
              onOpenRow={(rowId) => onNavigate('notes', rowId)}
            />
          )
        default:
          return <EmptyState message={`${currentView} view coming in W4.5`} />
      }
    }

    return (
      <div className="db-shell">
        {/* Inline sidebar */}
        <aside className="db-sidebar">
          <HerOSInput
            className="db-sidebar__search"
            placeholder="Search databases…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {databases.map(db => (
            <div
              key={db.id}
              className={`db-sidebar__item${selectedDbId === db.id ? ' db-sidebar__item--active' : ''}`}
              onClick={() => setSelectedDbId(db.id)}
            >
              <Database size={14} />
              <span>{db.title}</span>
              <span className="db-sidebar__count">{db.row_count}</span>
            </div>
          ))}
          <button
            className="db-sidebar__item"
            onClick={async () => {
              const name = 'Untitled database'
              const res = await commands.createDatabase(name, crypto.randomUUID())
              if (res.status === 'ok') {
                setSelectedDbId(res.data.id)
                // Refresh sidebar
              }
            }}
          >
            <Plus size={14} /> New database
          </button>
        </aside>

        {/* Stage with inline chrome + view router */}
        <section className="db-stage">
          <header className="db-chrome">
            <span className="db-chrome__title">
              {databases.find(d => d.id === selectedDbId)?.title ?? ''}
            </span>
            <div className="db-chrome__tabs">
              {(['table', 'board', 'calendar', 'list'] as ViewType[]).map(v => (
                <button
                  key={v}
                  className={`db-chrome__tab${currentView === v ? ' db-chrome__tab--active' : ''}`}
                  onClick={() => setCurrentView(v)}
                >
                  {viewIcon(v)} {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            <button className="db-pill"><Filter size={12}/> Filter</button>
          </header>
          {renderView()}
        </section>
      </div>
    )
  }

  function viewIcon(v: ViewType) {
    switch (v) {
      case 'table': return <Table2 size={12} />
      case 'board': return <Columns3 size={12} />
      default: return null
    }
  }
  ```

  Complete the sidebar load logic and conflict handling stub. Remove ALL:
  - `import { motion, AnimatePresence } from 'motion/react'` (line 2 of current file).
  - `const databases = [{ id: 'pinned', ...}]` and all other inline mock arrays.
  - `const rows = [...]`, `const columns = useMemo(...)`, `const calendarEvents = {...}`.
  - `import { ScrollShadow }` if not used in the rewritten version (verify; keep if sidebar scroll still needs it).
  - All `style={{ ... rgba ... }}` inline literals.

- [ ] **F-2: Wire window-focus mtime check (Rule 14)**

  Add a `useFocusReconcile` hook inline (or as a small exported function in `src/database/useDatabase.ts`) that:

  1. Listens to `window` `focus` event.
  2. On focus, reads the virtualizer's current visible range from `DatabaseTableView` (pass a `visibleRowIds` ref up via a callback prop or a ref forwarded from the virtualizer).
  3. For each visible row ID (max 50), calls `commands.getNode(rowId)` to stat the node's `last_read_mtime` vs the stored mtime in `cells`.
  4. If mtime drifted, re-fetches cells for that row via `getCellsForRows([rowId])` and updates the `cells` ref. Fires a silent re-render (increment `cellsVersion`).
  5. If the body changed (compare row body hash or length), fires a non-blocking sonner toast "Refreshed from disk".
  6. Cloud-sync materialization suppression: if old body was empty and new is non-empty, or only YAML frontmatter changed → apply silently, no toast.

- [ ] **F-3: Confirm no `motion/react` import remains**

  ```bash
  grep -c "motion/react" src/components/DatabasesView.tsx
  ```

  Must return 0.

- [ ] **F-4: Confirm no mock arrays remain**

  ```bash
  grep -cE "useState.*\[\s*\{" src/components/DatabasesView.tsx
  ```

  Must return 0.

- [ ] **F-5: Build and typecheck**

  ```bash
  bun run build 2>&1 | grep -E "error TS" | head -20
  ```

  Zero TypeScript errors.

- [ ] **F-6: Commit**

  ```bash
  git add src/components/DatabasesView.tsx src/App.css
  git commit -m "feat(w4): DatabasesView shell rewrite — inline sidebar + chrome + view router

  Full rewrite of the 300-line mock. Removes:
  - motion/react AnimatePresence view transitions (replaced with conditional render)
  - All inline mock arrays (databases, rows, columns, calendarEvents)
  - All inline rgba style literals

  Sidebar: flat alphabetic list from list_databases — no 200-cap.
  Chrome: title + view tabs (Table/Board/Calendar/List) + filter pill (display-only).
  View router: DatabaseTableView | DatabaseBoardView | EmptyState (deferred views).
  Conflict toast: 'Row changed on disk. [Open] [Dismiss]'.
  Focus reconcile: re-stat virtualizer-visible rows (~50 max) on window focus.

  bun run build: zero new errors."
  ```

### Acceptance Criteria

- `grep -c "motion/react" src/components/DatabasesView.tsx` returns 0.
- `grep -c "AnimatePresence" src/components/DatabasesView.tsx` returns 0.
- `grep -cE "useState.*\[\s*\{" src/components/DatabasesView.tsx` returns 0.
- `grep -cE "rgba\(" src/components/DatabasesView.tsx` returns 0.
- `grep -c "list_databases\|listDatabases" src/components/DatabasesView.tsx` returns ≥1.
- `bun run build` exits 0 with no new errors.

---

## Commit G — Cleanup + verification greps

**Goal:** Final hygiene pass. Run the five verification greps from spec §12. Remove any stragglers. Update `src/bindings.ts` regeneration reminder. Document zero-match results in the commit message.

**Read first:**
- `docs/superpowers/specs/2026-04-25-w4-databases-design.md` §12 — the complete verification grep table and retired-files list.
- `CLAUDE.md` "Files Never to Modify" — confirms `src/bindings.ts` must not be hand-edited (regenerates on `bun run tauri dev`).

**Files touched:**

| File | Change |
|---|---|
| `src/components/DatabasesView.tsx` | Any remaining stragglers removed |
| `src/styles/databases.css` | Any remaining hardcoded literals removed |
| `src/database/cellRenderers.tsx` | Verify no rgba |
| Commit message | Documents zero-match grep results |

### Tasks

- [ ] **G-1: Run grep 1 — no rgba literals**

  ```bash
  grep -rE "rgba\(" \
    src/components/DatabasesView.tsx \
    src/components/DatabaseTableView.tsx \
    src/components/DatabaseBoardView.tsx \
    src/components/DatabaseSelectPopover.tsx \
    src/database/ \
    src/styles/databases.css
  ```

  Expected: zero matches. Fix any hits before proceeding.

- [ ] **G-2: Run grep 2 — no motion/react**

  ```bash
  grep -rE "motion/react" \
    src/components/DatabasesView.tsx \
    src/components/DatabaseTableView.tsx \
    src/components/DatabaseBoardView.tsx \
    src/components/DatabaseSelectPopover.tsx \
    src/database/
  ```

  Expected: zero matches. (The `motion/react` package remains installed — other components use it. Only this surface must not import it.)

- [ ] **G-3: Run grep 3 — no inline mock arrays**

  ```bash
  grep -rE "useState.*\[\s*\{" \
    src/components/DatabasesView.tsx \
    src/components/DatabaseTableView.tsx \
    src/components/DatabaseBoardView.tsx \
    src/components/DatabaseSelectPopover.tsx \
    src/database/
  ```

  Expected: zero matches.

- [ ] **G-4: Run grep 4 — no searchWorkspaceTitle database abuse**

  ```bash
  grep -rE "searchWorkspaceTitle.*node_type.*database" src/
  ```

  Expected: zero matches. (Replaced by `list_databases` in DatabasesView.)

- [ ] **G-5: Run grep 5 — no getComputedStyle (no JS theme adapter)**

  ```bash
  grep -rE "getComputedStyle" src/database/ src/components/DatabaseTableView.tsx
  ```

  Expected: zero matches. (TanStack DOM renders inherit CSS tokens directly.)

- [ ] **G-6: Audit lucide-react imports in `DatabasesView.tsx`**

  Compare the import list against which icons actually appear in JSX. Remove any that are no longer rendered (e.g., `Star`, `ArrowUpRight`, `Download`, `Grid` from the original if absent from the rewrite). Do NOT remove shared imports that other files use — only the ones in this file's own import statement.

- [ ] **G-7: Confirm `src/database/glideTheme.ts` does not exist**

  ```bash
  test -f src/database/glideTheme.ts && echo "EXISTS — delete it" || echo "OK — does not exist"
  ```

  Must print "OK — does not exist".

- [ ] **G-8: Run full build + test matrix**

  ```bash
  bun run build 2>&1 | tail -5
  bunx vitest run 2>&1 | tail -10
  cd src-tauri && cargo test --lib 2>&1 | tail -10
  ```

  All three must exit 0. Note the test count in the commit message (compare to pre-W4 baseline).

- [ ] **G-9: Commit**

  ```bash
  git add -A
  git commit -m "chore(w4): cleanup — verification greps all zero, build + tests green

  Verification greps (all zero matches):
  - rgba() in new DB files: 0
  - motion/react in new DB files: 0
  - useState mock arrays in new DB files: 0
  - searchWorkspaceTitle node_type database: 0
  - getComputedStyle in DB files: 0

  src/database/glideTheme.ts: confirmed does not exist.
  lucide-react unused imports pruned from DatabasesView.tsx.

  bun run build: 0 new errors.
  bunx vitest run: <N> tests passing (was <M> before W4).
  cargo test --lib: <N> passed (was <M> before W4)."
  ```

  Replace `<N>` / `<M>` with the actual counts from G-8.

### Acceptance Criteria

All five verification greps return zero matches (documented in commit message). `bun run build`, `bunx vitest run`, and `cargo test --lib` all exit 0.

---

## Cross-Cutting Checks

### Five verification greps (run before final commit, all must return zero matches)

| # | Command | Files | Expected |
|---|---|---|---|
| 1 | `grep -rE "rgba\("` | `src/components/DatabasesView.tsx DatabaseTableView.tsx DatabaseBoardView.tsx DatabaseSelectPopover.tsx src/database/ src/styles/databases.css` | 0 |
| 2 | `grep -rE "motion/react"` | same (minus databases.css) | 0 |
| 3 | `grep -rE "useState.*\[\s*\{"` | same | 0 |
| 4 | `grep -rE "searchWorkspaceTitle.*node_type.*database"` | `src/` | 0 |
| 5 | `grep -rE "getComputedStyle"` | `src/database/ src/components/DatabaseTableView.tsx` | 0 |

### CLAUDE.md Definition of Done checks

- [ ] `bun run build` exits 0 — zero new errors.
- [ ] `bunx vitest run` green — no regressions; new `src/database/__tests__/` tests pass.
- [ ] `cargo test --lib` green — no regressions; new `export_row_*` + `list_databases_*` + `get_cells_for_rows_*` tests pass.
- [ ] No hardcoded color/radius/shadow/spacing literals in any new file under `src/` (Rule 12). Exception: `option.color` in SelectCell is data-driven, not a design constant.
- [ ] New components in flat `src/components/` — no nested domain folders (DoD #5).
- [ ] Styles in `src/styles/databases.css` — vanilla CSS (DoD #6).
- [ ] `src/bindings.ts` not hand-edited — regenerated on next `bun run tauri dev` (CLAUDE.md "Files Never to Modify").

### Manual smoke test (spec DoD #20)

Perform this sequence end-to-end in `bun run tauri dev` after all commits:

1. Launch app. Navigate to Databases in the icon rail.
2. Confirm the sidebar shows a flat alphabetic list of all databases (not the mock "Pinned / Projects" groups).
3. Click "+ New database". Confirm a new database appears in the sidebar and is selected.
4. In Table view: confirm table is empty with "0 rows" footer stat.
5. Click "+ New row" in the footer. Confirm a row appears.
6. Click a RichText cell and type text. Wait 300ms. Verify `databases/<db-slug>/rows/<row-slug>.md` exists on disk and contains the typed text in YAML frontmatter.
7. Toggle a Checkbox cell. Verify the file is rewritten immediately (no 300ms wait).
8. Change a SingleSelect cell. Confirm the popover appears with the database's options. Select one. Verify file is updated immediately.
9. Click the row title. Confirm navigation to Notes view with that row open in the CodeMirror editor.
10. Switch to Board view. Confirm columns appear from the SingleSelect field's options.
11. Drag a card between columns. Confirm the card moves and the vault file is updated.
12. Right-click a row in Table view. Confirm context menu with "Open" and "Delete".
13. Click "Delete". Confirm row disappears from table. Navigate to Trash (existing surface) and confirm the row appears there.
14. Reload the app (`bun run tauri dev` restart). Confirm all data is restored from vault.
15. Manually edit a row's vault file (`rows/<slug>.md`) with an external editor while the app is open. Trigger an autosave. Confirm the conflict toast appears with correct row title.
16. Click "Reload" in the conflict toast. Confirm the cell updates to the disk value.

---

## Risks and Mitigations

**Sort correctness with lazy cell loading.** Sort runs server-side in `get_rows_filtered_sorted`, returning an ordered list of row IDs. The frontend lazy-loads cells for the visible window of that ordered list. Changing sort re-issues `get_rows_filtered_sorted` and resets the cell cache. Sort is never frontend-only — no risk of showing wrong order.

**Vault-first rollback asymmetry.** If `export_row` succeeds but `DatabaseManager.update_cell` fails (rare — SQLite I/O error), disk has the new value but SQLite does not. On next read, `vault/import.rs` reconciles. No data loss; transient inconsistency is healed automatically. Logged as a Rust `warn!`.

**TanStack render cost at 10k rows.** Mitigated by `@tanstack/react-virtual` (≤50 rows in the DOM). Memoize cell components keyed on `(rowId, fieldId, cellsVersion)`. Above 50k rows, revisit.

**Rule 13 conflict storms during cloud-sync.** The `+3s` grace window in `export_row` (from Rule 13a) covers initial iCloud/OneDrive sync materialization bursts. Silent suppression applies when file transitions from 0 bytes to populated (cloud-sync first materialization).

**Board + Table virtualizer coexistence.** Board view does not use `@tanstack/react-virtual` in W4 (deferred until >500 cards/column). Both views are conditionally rendered (not simultaneous), so virtualizer instances don't coexist.

**`move_node` for documents is already correct.** An earlier draft of this plan claimed a pre-existing document-orphan bug — that was a misread of the manager method without reading the command wrapper. The wrapper at `commands/workspace_nodes.rs:235-275` already writes the new path, deletes the old, and cascades to descendants. W4 extends the same wrapper's gate from `"document"` to also handle `"row"`. No carve-out needed.

---

## Out of Scope (Deferred)

- Calendar / List / Gallery / Timeline views — render `<EmptyState>` with "Coming in W4.5".
- Filter / sort / group editor popovers — chrome pills exist visually; dropdowns deferred.
- Field schema editor (add / rename / delete fields via UI) — deferred.
- Pinning / starring databases in the sidebar.
- Column resize + width persistence (CLAUDE.md deferred list).
- Rich-text inside cells, wikilinks inside cells, formulas, rollups, relations.
- 8 of 14 field types: URL, Checklist, LastEditedTime, CreatedTime, Time, Media, DateTime, Protected — render read-only with tooltip.
- `database-cell-updated` Tauri event — cut from W4; lands with its first consumer (W6 or live-collab).
- Seed database on first-run — cut; replaced by empty state with "Create your first database" CTA.
- Settings → Databases → "Re-index from vault" button — architecturally present (`vault/import.rs`); UI deferred to W5.
- Inline database as CodeMirror widget inside notes — architecturally compatible; not in W4.
- (No `move_node` document carve-out — the wrapper already handles documents correctly. W4 extends the same wrapper to also cover rows.)
- Cross-database row drag, multi-select bulk edit.
- Real-time collaboration / CRDT.

---

## Pre-flight

Before starting Commit A, record the current test baseline:

```bash
bunx vitest run 2>&1 | grep -E "Tests|passed|failed" | tail -3
cd src-tauri && cargo test --lib 2>&1 | grep -E "test result" | tail -3
```

Note the exact counts. Every subsequent commit must not regress these numbers.