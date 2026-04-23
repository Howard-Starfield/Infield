use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::managers::workspace::{AppState, VaultManager};
use crate::managers::workspace::vault::ExportedDatabase;

fn vault_manager(app: &AppHandle) -> VaultManager {
    let vault_root = crate::app_identity::resolve_vault_root(app);
    VaultManager::new(vault_root)
}

/// Export a single database (by node id) to the vault.
/// Returns the vault-root-relative paths of every file written.
#[tauri::command]
#[specta::specta]
pub async fn export_database_to_vault(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    db_id: String,
) -> Result<Vec<String>, String> {
    let vm = vault_manager(&app);
    let paths = vm.export_database(&db_id, &state.workspace_manager).await?;
    Ok(paths.into_iter().map(|p| p.to_string_lossy().replace('\\', "/")).collect())
}

/// Import a single database from a vault file into SQLite via upsert.
///
/// `vault_rel_path` must be relative to the vault root, e.g.
/// `"databases/my-table.md"` or `"databases/my-board/board.md"`.
/// Fails atomically — any parse error leaves SQLite untouched.
/// Returns the number of rows upserted on success.
#[tauri::command]
#[specta::specta]
pub async fn import_database_from_vault(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    vault_rel_path: String,
) -> Result<usize, String> {
    let vm = vault_manager(&app);
    vm.import_database_from_vault(&vault_rel_path, &state.workspace_manager).await
}

/// Export every non-deleted database in the workspace to the vault.
#[tauri::command]
#[specta::specta]
pub async fn export_all_databases_to_vault(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ExportedDatabase>, String> {
    let vm = vault_manager(&app);
    vm.export_all_databases(&state.workspace_manager).await
}
