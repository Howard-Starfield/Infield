use crate::app_identity::resolve_vault_root;
use crate::managers::database::field::{CellData, Field, FieldType};
use crate::managers::database::filter::Filter;
use crate::managers::database::manager::DatabaseManager;
use crate::managers::database::sort::Sort;
use crate::managers::workspace::AppState;
use crate::managers::workspace::VaultManager;
use crate::managers::workspace::WorkspaceManager;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, State};

// ------------------------------------------------------------------ //
//  Extra types exposed to the frontend
// ------------------------------------------------------------------ //

/// Lightweight metadata returned when a database is created.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct DatabaseMeta {
    pub id: String,
    pub name: String,
}

/// A database row, returned by get_rows / create_row.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Row {
    pub id: String,
    pub database_id: String,
}

/// Lightweight database listing entry returned by list_databases.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct DatabaseSummary {
    pub id: String,
    pub title: String,
    pub icon: String,
    pub row_count: i64,
}

/// Per-row cells batch returned by `get_cells_for_rows`. `last_modified_secs`
/// carries the row's vault-file mtime (seconds since UNIX epoch) so the
/// frontend can populate `lastSeenMtimeSecs` and feed the Rule 13 conflict
/// guard on subsequent `update_cell` calls. `None` when the vault file does
/// not yet exist (e.g. row created in this session, no cells written).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct RowCellsBatch {
    pub row_id: String,
    pub cells: Vec<(String, CellData)>,
    pub last_modified_secs: Option<i64>,
}

// ------------------------------------------------------------------ //
//  Inner (testable without Tauri State)
// ------------------------------------------------------------------ //

/// Database-layer-only create. Inserts a row into `database.db` and returns
/// metadata. Does NOT mirror into `workspace_nodes` and does NOT write the
/// vault file. Retained as the inner used by the existing unit test
/// (`create_database_and_add_row`) which can't instantiate a
/// `WorkspaceManager` on Windows MSVC due to a STATUS_ENTRYPOINT_NOT_FOUND
/// in test builds. The Tauri-facing path is `create_database_inner_with_vault`.
pub async fn create_database_inner(
    mgr: &Arc<DatabaseManager>,
    name: String,
) -> Result<DatabaseMeta, String> {
    let id = mgr
        .create_database(name.clone())
        .await
        .map_err(|e| e.to_string())?;
    Ok(DatabaseMeta { id, name })
}

/// Full create_database orchestration: database.db row + workspace_nodes
/// mirror + vault `database.md` file. SQLite is the source of truth on
/// failure, vault drift is recoverable on next boot.
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

    // 2. Compute canonical vault_rel_path. slugify is deterministic +
    //    Unicode-NFC + Windows-safe; resolve_db_slug then probes the vault
    //    for a slug collision (e.g. several "Untitled database" entries) and
    //    appends a short-id suffix so each database gets its own folder.
    let base_slug = crate::managers::workspace::vault::format::slugify(&name);
    let slug = crate::managers::workspace::vault::database_md::resolve_db_slug(
        vm.vault_root_path(),
        &base_slug,
        &id,
    );
    let vault_rel_path = format!("databases/{slug}/database.md");

    // 3. Mirror into workspace_nodes. Empty icon for now (icon picker not
    //    wired in W4). On failure, roll back the database.db row to avoid an
    //    orphan with no FTS/vector index entry.
    if let Err(e) = ws_mgr
        .upsert_workspace_mirror_node(&id, None, "database", &name, "", 1.0, "{}", &vault_rel_path)
        .await
    {
        log::warn!(
            "Mirror upsert failed for db '{id}'; rolling back database.db row: {e}"
        );
        let _ = db_mgr.delete_database_hard(&id).await;
        return Err(format!(
            "Failed to mirror database into workspace_nodes: {e}"
        ));
    }

    // 4. Write database.md vault-first. On failure, leave SQLite state intact
    //    — the boot migration (Commit G) backfills missing vault files. Vault
    //    drift is recoverable; SQLite drift isn't.
    if let Err(e) = vm.export_database_md(&id, ws_mgr, db_mgr).await {
        log::warn!(
            "export_database_md failed for db '{id}': {e}. SQLite state retained; will retry on next boot."
        );
    }

    Ok(DatabaseMeta { id, name })
}

pub async fn create_row_inner(
    mgr: &Arc<DatabaseManager>,
    database_id: String,
) -> Result<Row, String> {
    let id = mgr
        .create_row(&database_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Row { id, database_id })
}

/// Full create_row orchestration: db_rows insert + workspace_nodes mirror.
/// Does NOT write the vault file — empty rows have no meaningful body to
/// serialize, and the file is written on the first cell edit when
/// `update_cell` calls `export_row`. On mirror failure, rolls back the
/// db_rows insert via `delete_row_hard`.
pub async fn create_row_inner_with_vault(
    db_mgr: &Arc<DatabaseManager>,
    ws_mgr: &Arc<WorkspaceManager>,
    database_id: String,
) -> Result<Row, String> {
    // 1. db_rows insert.
    let row_id = db_mgr
        .create_row(&database_id)
        .await
        .map_err(|e| e.to_string())?;

    // 2. Look up parent database mirror to compute vault_rel_path. Commit C
    //    guarantees the mirror exists for any database created via
    //    create_database_inner_with_vault. Legacy databases get backfilled by
    //    the boot migration in Commit G; if a row is created against a
    //    not-yet-backfilled database, we surface the error rather than write
    //    a row file under an unknown slug.
    let db_node = ws_mgr
        .get_node(&database_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!(
            "Database '{database_id}' has no workspace_nodes mirror. \
             Restart the app to run the boot migration, then retry."
        ))?;

    let db_slug = crate::managers::workspace::vault::format::slugify(&db_node.name);
    let row_slug = &row_id[..row_id.len().min(8)];
    let vault_rel_path = format!("databases/{db_slug}/rows/{row_slug}.md");

    // 3. Position: append at end. db_rows uses i64 position; mirror uses f64.
    //    Use the row count after insert as a stable monotonic value.
    let position = db_mgr
        .get_rows(&database_id)
        .await
        .map_err(|e| e.to_string())?
        .len() as f64;

    // 4. Mirror upsert. Empty name + empty icon — name will be set on first
    //    primary-cell edit (Commit E wires that propagation).
    if let Err(e) = ws_mgr
        .upsert_workspace_mirror_node(
            &row_id, Some(&database_id), "row", "", "", position, "{}", &vault_rel_path,
        )
        .await
    {
        log::warn!("Row mirror failed for '{row_id}'; rolling back db_rows row: {e}");
        let _ = db_mgr.delete_row_hard(&row_id).await;
        return Err(format!("Failed to mirror row into workspace_nodes: {e}"));
    }

    Ok(Row { id: row_id, database_id })
}

/// Soft-delete a row: flips `deleted_at` on the workspace_nodes mirror.
/// `soft_delete_node` cascades + clears FTS + enqueues embedding deletes.
/// `db_rows` keeps its row so Restore from Trash can un-flag the mirror
/// and the data is still there. Permanent delete (which would call
/// `delete_row_hard`) is deferred to W9. The `db_mgr` parameter is kept in
/// the signature for symmetry with `delete_database_inner_with_vault` and
/// to leave room for permanent-delete plumbing without changing the API.
pub async fn delete_row_inner_with_vault(
    _db_mgr: &Arc<DatabaseManager>,
    ws_mgr: &Arc<WorkspaceManager>,
    row_id: &str,
) -> Result<(), String> {
    ws_mgr.soft_delete_node(row_id).await?;
    Ok(())
}

/// Soft-delete a database: flips `deleted_at` on the workspace_nodes mirror,
/// which cascades to row mirrors. `databases` and `db_rows` keep their rows
/// so Restore from Trash can resurrect the database with all its rows / cells
/// intact. The `list_databases` command filters out databases whose mirror
/// is soft-deleted so they disappear from the sidebar until restored.
pub async fn delete_database_inner_with_vault(
    _db_mgr: &Arc<DatabaseManager>,
    ws_mgr: &Arc<WorkspaceManager>,
    db_id: &str,
) -> Result<(), String> {
    ws_mgr.soft_delete_node(db_id).await?;
    Ok(())
}

// ------------------------------------------------------------------ //
//  Tauri commands
// ------------------------------------------------------------------ //

#[tauri::command]
#[specta::specta]
pub async fn create_database(
    state: State<'_, Arc<AppState>>,
    vm: State<'_, Arc<VaultManager>>,
    name: String,
    _default_view_id: String,
) -> Result<DatabaseMeta, String> {
    create_database_inner_with_vault(
        &state.database_manager,
        &state.workspace_manager,
        &vm,
        name,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_fields(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
) -> Result<Vec<Field>, String> {
    db_mgr
        .get_fields(&database_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_rows(
    state: State<'_, Arc<AppState>>,
    database_id: String,
) -> Result<Vec<Row>, String> {
    let ids = state
        .database_manager
        .get_rows(&database_id)
        .await
        .map_err(|e| e.to_string())?;

    // Hide rows whose workspace_nodes mirror is soft-deleted (Trash UI
    // restores them via `restore_node`, which un-flags the mirror).
    let trashed = state
        .workspace_manager
        .get_deleted_node_ids(Some("row"))
        .await?;

    Ok(ids
        .into_iter()
        .filter(|id| !trashed.contains(id))
        .map(|id| Row {
            id,
            database_id: database_id.clone(),
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn create_row(
    state: State<'_, Arc<AppState>>,
    database_id: String,
) -> Result<Row, String> {
    create_row_inner_with_vault(
        &state.database_manager,
        &state.workspace_manager,
        database_id,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_row(
    state: State<'_, Arc<AppState>>,
    row_id: String,
) -> Result<(), String> {
    delete_row_inner_with_vault(
        &state.database_manager,
        &state.workspace_manager,
        &row_id,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_database(
    state: State<'_, Arc<AppState>>,
    database_id: String,
) -> Result<(), String> {
    delete_database_inner_with_vault(
        &state.database_manager,
        &state.workspace_manager,
        &database_id,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_cell(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    database_id: String,
    row_id: String,
    field_id: String,
    _field_type: FieldType,
    data: CellData,
    last_seen_mtime_secs: Option<i64>,
) -> Result<(), String> {
    // Vault-first: VAULT_CONFLICT returns before SQLite is ever touched.
    // The pending cell override ensures the file written to disk reflects the
    // *new* value, not the pre-mutation SQLite snapshot — fixing the lag bug
    // where the last edit per row was lost on app close.
    let vm = VaultManager::new(resolve_vault_root(&app));
    let pending = [(field_id.clone(), data.clone())];
    vm.export_row(
        &database_id,
        &row_id,
        last_seen_mtime_secs,
        &pending,
        None,
        &state.workspace_manager,
        &state.database_manager,
    )
    .await?;

    match state
        .database_manager
        .update_cell(&row_id, &field_id, &data)
        .await
    {
        Ok(()) => {
            // Propagate primary-field text edits to the mirror's name so the tree view,
            // FTS, and search results reflect the row's title. Only fires for primary
            // RichText cells; other field types and non-primary cells are no-ops.
            if let CellData::RichText(ref new_text) = data {
                let fields = state
                    .database_manager
                    .get_fields(&database_id)
                    .await
                    .map_err(|e| e.to_string())?;
                if fields.iter().any(|f| f.id == field_id && f.is_primary) {
                    if let Err(e) = state
                        .workspace_manager
                        .update_workspace_mirror_name(&row_id, new_text)
                        .await
                    {
                        log::warn!(
                            "primary-name mirror sync failed for row {row_id}: {e}. \
                             Cell write succeeded; tree title may lag until next refresh."
                        );
                    }
                }
            }
            Ok(())
        }
        Err(e) => {
            log::warn!(
                "vault-sqlite drift: row={} field={} vault wrote new value but SQLite update_cell failed: {}. \
                 vault/import.rs will reconcile on next read.",
                row_id, field_id, e
            );
            Err(e.to_string())
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn get_all_cells_for_row(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    row_id: String,
) -> Result<Vec<(String, CellData)>, String> {
    db_mgr
        .get_all_cells_for_row(&row_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_rows_filtered_sorted(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
    filters: Vec<Filter>,
    sorts: Vec<Sort>,
) -> Result<Vec<Row>, String> {
    // Fetch all row ids
    let mut row_ids = db_mgr
        .get_rows(&database_id)
        .await
        .map_err(|e| e.to_string())?;

    // Apply filters (AND of all filters)
    if !filters.is_empty() {
        let mut kept: Vec<String> = Vec::with_capacity(row_ids.len());
        for row_id in &row_ids {
            let cells = db_mgr
                .get_all_cells_for_row(row_id)
                .await
                .map_err(|e| e.to_string())?;

            // Build a quick lookup: field_id -> CellData
            let cell_map: std::collections::HashMap<&str, &CellData> =
                cells.iter().map(|(fid, cd)| (fid.as_str(), cd)).collect();

            let passes = filters.iter().all(|f| {
                // Determine the field_id this filter targets (best-effort for Data leaf)
                let field_id = match &f.inner {
                    crate::managers::database::filter::FilterInner::Data { field_id, .. } => {
                        field_id.as_str()
                    }
                    // For And/Or composites, use empty string; matches() handles recursion
                    _ => "",
                };
                f.matches_cell(field_id, cell_map.get(field_id).copied())
            });

            if passes {
                kept.push(row_id.clone());
            }
        }
        row_ids = kept;
    }

    // Sort placeholder — proper implementation deferred; preserves insertion order
    if !sorts.is_empty() {
        // Collect cells for sort fields into a map for efficiency
        let mut cells_cache: std::collections::HashMap<String, Vec<(String, CellData)>> =
            std::collections::HashMap::new();
        for row_id in &row_ids {
            let cells = db_mgr
                .get_all_cells_for_row(row_id)
                .await
                .map_err(|e| e.to_string())?;
            cells_cache.insert(row_id.clone(), cells);
        }

        crate::managers::database::sort::sort_rows(&mut row_ids, &sorts, |row_id, field_id| {
            cells_cache.get(row_id).and_then(|cells| {
                cells
                    .iter()
                    .find(|(fid, _)| fid == field_id)
                    .map(|(_, cd)| cd.clone())
            })
        });
    }

    Ok(row_ids
        .into_iter()
        .map(|id| Row {
            id,
            database_id: database_id.clone(),
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn ensure_database(
    db_manager: State<'_, Arc<DatabaseManager>>,
    database_id: String,
    name: String,
) -> Result<String, String> {
    db_manager
        .get_or_create_database(database_id, name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn create_select_option(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    field_id: String,
    name: String,
) -> Result<crate::managers::database::field::SelectOption, String> {
    db_mgr.create_select_option(&field_id, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn rename_select_option(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    field_id: String,
    option_id: String,
    name: String,
) -> Result<(), String> {
    db_mgr.rename_select_option(&field_id, &option_id, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_select_option_color(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    field_id: String,
    option_id: String,
    color: crate::managers::database::field::SelectColor,
) -> Result<(), String> {
    db_mgr.update_select_option_color(&field_id, &option_id, color).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_select_option(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    field_id: String,
    option_id: String,
) -> Result<(), String> {
    db_mgr.delete_select_option(&field_id, &option_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn create_row_in_group(
    state: State<'_, Arc<AppState>>,
    vm: State<'_, Arc<VaultManager>>,
    database_id: String,
    field_id: String,
    option_id: String,
) -> Result<Row, String> {
    // 1. db_rows + db_cells insert (the group cell goes in atomically).
    let row_id = state
        .database_manager
        .create_row_in_group(&database_id, &field_id, &option_id)
        .await
        .map_err(|e| e.to_string())?;

    // 2. Look up parent for vault path + mirror.
    let db_node = state
        .workspace_manager
        .get_node(&database_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!(
            "Database '{database_id}' has no workspace_nodes mirror. \
             Restart the app to run the boot migration, then retry."
        ))?;
    let db_slug = crate::managers::workspace::vault::format::slugify(&db_node.name);
    let row_slug = &row_id[..row_id.len().min(8)];
    let vault_rel_path = format!("databases/{db_slug}/rows/{row_slug}.md");

    let position = state
        .database_manager
        .get_rows(&database_id)
        .await
        .map_err(|e| e.to_string())?
        .len() as f64;

    // 3. Mirror upsert. Roll back db_rows on failure.
    if let Err(e) = state
        .workspace_manager
        .upsert_workspace_mirror_node(
            &row_id, Some(&database_id), "row", "", "", position, "{}", &vault_rel_path,
        )
        .await
    {
        log::warn!("Row mirror failed for '{row_id}'; rolling back db_rows row: {e}");
        let _ = state.database_manager.delete_row_hard(&row_id).await;
        return Err(format!("Failed to mirror row into workspace_nodes: {e}"));
    }

    // 4. Vault export. The group cell is already in db.db so export_row
    //    reads it without a pending override. On failure, fully roll back
    //    (mirror soft-delete cascades + cleans FTS/embeddings; db_rows hard-delete).
    if let Err(e) = vm
        .export_row(
            &database_id,
            &row_id,
            None,
            &[],
            None,
            &state.workspace_manager,
            &state.database_manager,
        )
        .await
    {
        let _ = state.workspace_manager.soft_delete_node(&row_id).await;
        let _ = state.database_manager.delete_row_hard(&row_id).await;
        log::warn!(
            "create_row_in_group vault export failed for row {row_id}: {e}. Rolled back."
        );
        return Err(e);
    }

    Ok(Row { id: row_id, database_id })
}

#[tauri::command]
#[specta::specta]
pub async fn create_date_field(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
    field_name: String,
) -> Result<crate::managers::database::field::Field, String> {
    db_mgr.create_date_field(&database_id, &field_name).await.map_err(|e| e.to_string())
}

/// Generic add-column command. Creates a field of any supported type with
/// sensible default options (empty options list for selects, MM/dd/yyyy +
/// 12h for date / datetime, "none" format for numbers, etc.). The W4
/// "+ Add column" UI calls this; cell-type-specific configuration lives
/// in a future field-options editor (post-W4 polish).
#[tauri::command]
#[specta::specta]
pub async fn create_field(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
    field_name: String,
    field_type: FieldType,
) -> Result<crate::managers::database::field::Field, String> {
    db_mgr
        .create_field(&database_id, &field_name, field_type)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_row_date(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    database_id: String,
    row_id: String,
    field_id: String,
    timestamp: Option<i64>,
    last_seen_mtime_secs: Option<i64>,
) -> Result<(), String> {
    let vm = VaultManager::new(resolve_vault_root(&app));
    let pending = [(field_id.clone(), CellData::Date(timestamp))];
    vm.export_row(
        &database_id,
        &row_id,
        last_seen_mtime_secs,
        &pending,
        None,
        &state.workspace_manager,
        &state.database_manager,
    )
    .await?;

    match state
        .database_manager
        .update_row_date(&row_id, &field_id, timestamp)
        .await
    {
        Ok(()) => Ok(()),
        Err(e) => {
            log::warn!(
                "vault-sqlite drift: row={} field={} vault wrote new date value but SQLite update_row_date failed: {}. \
                 vault/import.rs will reconcile on next read.",
                row_id, field_id, e
            );
            Err(e.to_string())
        }
    }
}

// ------------------------------------------------------------------ //
//  Database view commands
// ------------------------------------------------------------------ //

#[tauri::command]
#[specta::specta]
pub async fn get_db_views(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
) -> Result<Vec<crate::managers::database::field::DatabaseView>, String> {
    db_mgr
        .get_db_views(&database_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn create_db_view(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
    name: String,
    layout: crate::managers::database::field::DbViewLayout,
) -> Result<crate::managers::database::field::DatabaseView, String> {
    db_mgr
        .create_db_view(&database_id, &name, layout)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_db_view(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    view_id: String,
) -> Result<(), String> {
    db_mgr
        .delete_db_view(&view_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn reorder_db_views(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    db_mgr
        .reorder_db_views(&database_id, &ordered_ids)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn ensure_default_view(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
    layout: crate::managers::database::field::DbViewLayout,
) -> Result<crate::managers::database::field::DatabaseView, String> {
    db_mgr
        .ensure_default_view(&database_id, layout)
        .await
        .map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ //
//  Template CRUD commands
// ------------------------------------------------------------------ //

#[tauri::command]
#[specta::specta]
pub async fn export_database_template(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
) -> Result<Vec<crate::managers::database::json_store::TemplateEntry>, String> {
    // Return templates for this database (from JSON vault)
    Ok(vec![])
}

#[tauri::command]
#[specta::specta]
pub async fn save_database_template(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
    template: crate::managers::database::json_store::TemplateEntry,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_database_template(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
    template_id: String,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn list_database_templates(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
) -> Result<Vec<crate::managers::database::json_store::TemplateEntry>, String> {
    Ok(vec![])
}

// ------------------------------------------------------------------ //
//  Migration command
// ------------------------------------------------------------------ //

#[tauri::command]
#[specta::specta]
pub async fn run_workspace_migration(
    state: State<'_, Arc<crate::managers::workspace::AppState>>,
) -> Result<usize, String> {
    let db_mgr = state.database_manager.clone();
    let ws_conn = state.workspace_manager.conn().clone();
    tokio::task::spawn_blocking(move || {
        let conn = ws_conn.blocking_lock();
        db_mgr.migrate_to_workspace_nodes(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ------------------------------------------------------------------ //
//  W4 Databases — listing + batched cells
// ------------------------------------------------------------------ //

#[tauri::command]
#[specta::specta]
pub async fn list_databases(
    state: State<'_, Arc<AppState>>,
    prefix: Option<String>,
) -> Result<Vec<DatabaseSummary>, String> {
    let rows = state
        .database_manager
        .list_databases(prefix)
        .await
        .map_err(|e| e.to_string())?;

    // Hide databases whose workspace_nodes mirror is soft-deleted. They stay
    // in `database.db` so Restore from Trash can resurrect them with all rows.
    let trashed = state
        .workspace_manager
        .get_deleted_node_ids(Some("database"))
        .await?;

    Ok(rows
        .into_iter()
        .filter(|(id, _, _, _)| !trashed.contains(id))
        .map(|(id, title, icon, row_count)| DatabaseSummary { id, title, icon, row_count })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn get_cells_for_rows(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    database_id: String,
    row_ids: Vec<String>,
) -> Result<Vec<RowCellsBatch>, String> {
    // 1. Cells from the database manager (ordered to match `row_ids`).
    let cells = state
        .database_manager
        .get_cells_for_rows(&database_id, &row_ids)
        .await
        .map_err(|e| e.to_string())?;

    // 2. Bulk-look up each row's vault_rel_path from workspace_nodes so we can
    //    stat() the on-disk file. One SELECT for all rows.
    let mut rel_path_by_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    if !row_ids.is_empty() {
        let conn_arc = state.workspace_manager.conn().clone();
        let row_ids_for_query = row_ids.clone();
        let lookup: Result<Vec<(String, Option<String>)>, String> =
            tokio::task::spawn_blocking(move || -> Result<_, String> {
                let conn = conn_arc.blocking_lock();
                let placeholders: String = (0..row_ids_for_query.len())
                    .map(|i| format!("?{}", i + 1))
                    .collect::<Vec<_>>()
                    .join(",");
                let sql = format!(
                    "SELECT id, vault_rel_path FROM workspace_nodes WHERE id IN ({})",
                    placeholders
                );
                let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
                let params: Vec<&dyn rusqlite::ToSql> = row_ids_for_query
                    .iter()
                    .map(|s| s as &dyn rusqlite::ToSql)
                    .collect();
                let rows = stmt
                    .query_map(params.as_slice(), |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
                    })
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                Ok(rows)
            })
            .await
            .map_err(|e| e.to_string())?;
        for (id, rel) in lookup? {
            if let Some(path) = rel {
                rel_path_by_id.insert(id, path);
            }
        }
    }

    // 3. Stat each row's vault file. None when missing or unreadable.
    let vault_root = resolve_vault_root(&app);
    let result: Vec<RowCellsBatch> = cells
        .into_iter()
        .map(|(row_id, cells)| {
            let last_modified_secs = rel_path_by_id
                .get(&row_id)
                .and_then(|rel| {
                    let abs = vault_root.join(rel);
                    std::fs::metadata(&abs).ok()
                })
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64);
            RowCellsBatch {
                row_id,
                cells,
                last_modified_secs,
            }
        })
        .collect();
    Ok(result)
}

// ------------------------------------------------------------------ //
//  Tests
// ------------------------------------------------------------------ //

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    async fn make_manager() -> Arc<DatabaseManager> {
        let tmp = NamedTempFile::new().expect("tempfile");
        let path = tmp.path().to_path_buf();
        std::mem::forget(tmp);
        Arc::new(DatabaseManager::new_with_path(path).expect("DatabaseManager::new_with_path"))
    }

    #[tokio::test]
    async fn create_database_and_add_row() {
        let mgr = make_manager().await;

        let meta = create_database_inner(&mgr, "Test DB".to_string())
            .await
            .expect("create_database_inner");

        assert!(!meta.id.is_empty());
        assert_eq!(meta.name, "Test DB");

        let row = create_row_inner(&mgr, meta.id.clone())
            .await
            .expect("create_row_inner");

        assert!(!row.id.is_empty());
        assert_eq!(row.database_id, meta.id);

        // Verify row appears in get_rows
        let rows = mgr.get_rows(&meta.id).await.expect("get_rows");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0], row.id);
    }
}
