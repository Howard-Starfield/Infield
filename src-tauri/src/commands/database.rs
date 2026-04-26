use crate::managers::database::field::{CellData, Field, FieldType};
use crate::managers::database::filter::Filter;
use crate::managers::database::manager::DatabaseManager;
use crate::managers::database::sort::Sort;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use tauri::State;

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

// ------------------------------------------------------------------ //
//  Inner (testable without Tauri State)
// ------------------------------------------------------------------ //

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

// ------------------------------------------------------------------ //
//  Tauri commands
// ------------------------------------------------------------------ //

#[tauri::command]
#[specta::specta]
pub async fn create_database(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    name: String,
    _default_view_id: String,
) -> Result<DatabaseMeta, String> {
    create_database_inner(&db_mgr, name).await
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
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
) -> Result<Vec<Row>, String> {
    let ids = db_mgr
        .get_rows(&database_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ids
        .into_iter()
        .map(|id| Row {
            id,
            database_id: database_id.clone(),
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn create_row(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
) -> Result<Row, String> {
    create_row_inner(&db_mgr, database_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn update_cell(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    row_id: String,
    field_id: String,
    _field_type: FieldType,
    data: CellData,
) -> Result<(), String> {
    db_mgr
        .update_cell(&row_id, &field_id, &data)
        .await
        .map_err(|e| e.to_string())
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
    db_mgr: State<'_, Arc<DatabaseManager>>,
    database_id: String,
    field_id: String,
    option_id: String,
) -> Result<Row, String> {
    let id = db_mgr.create_row_in_group(&database_id, &field_id, &option_id).await.map_err(|e| e.to_string())?;
    Ok(Row { id, database_id })
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

#[tauri::command]
#[specta::specta]
pub async fn update_row_date(
    db_mgr: State<'_, Arc<DatabaseManager>>,
    row_id: String,
    field_id: String,
    timestamp: Option<i64>,
) -> Result<(), String> {
    db_mgr.update_row_date(&row_id, &field_id, timestamp).await.map_err(|e| e.to_string())
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
    state: State<'_, Arc<crate::managers::workspace::AppState>>,
    prefix: Option<String>,
) -> Result<Vec<DatabaseSummary>, String> {
    let db_mgr = state.database_manager.clone();
    let ws_conn = state.workspace_manager.conn().clone();
    let rows = tokio::task::spawn_blocking(move || -> Result<_, String> {
        let conn = ws_conn.blocking_lock();
        db_mgr.list_databases(&conn, prefix).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(rows
        .into_iter()
        .map(|(id, title, icon, row_count)| DatabaseSummary { id, title, icon, row_count })
        .collect())
}

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
