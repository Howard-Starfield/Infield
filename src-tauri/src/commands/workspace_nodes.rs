use std::fs;
use tauri::{State, AppHandle, Manager};
use crate::managers::workspace::{NodeComment, NodeTemplate, NodeView, WorkspaceNode, AppState};
use crate::managers::workspace::workspace_manager::{SelectOption as WSSelectOption, SelectColor as WSSelectColor};
use crate::app_identity::{read_markdown_body_from_vault_file, resolve_vault_root};
use serde::Serialize;
use specta::Type;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Type)]
pub struct VaultSyncStatus {
    pub total_documents: i64,
    pub synced_documents: i64,
    pub pending_documents: i64,
}

/// Cascade vault path rewrites for all document descendants after a parent
/// rename/move changed the ancestor chain.  Each descendant is re-written at
/// its new computed path and the old file is deleted.  Databases, deleted
/// nodes, and rows are skipped (they have no document-style vault file).
///
/// Pass `None` for `last_seen_mtime_secs` — cascade is a structural operation,
/// not an edit, so the Rule 13 guard does not apply.
async fn cascade_descendant_vault_paths(
    app: &AppHandle,
    state: &Arc<AppState>,
    root_id: &str,
) -> usize {
    let descendant_ids = match state.workspace_manager.get_descendant_ids(root_id).await {
        Ok(ids) => ids,
        Err(e) => {
            log::warn!("[cascade] Failed to enumerate descendants of {}: {}", root_id, e);
            return 0;
        }
    };
    let vault_root = resolve_vault_root(app);
    let mut rewritten = 0usize;
    for id in descendant_ids {
        let node = match state.workspace_manager.get_node(&id).await {
            Ok(Some(n)) => n,
            _ => continue,
        };
        if node.node_type != "document" || node.deleted_at.is_some() {
            continue;
        }
        let old_rel_path = node.vault_rel_path.clone();
        match state.workspace_manager.write_node_to_vault(app, &node, None).await {
            Ok(new_rel_path) => {
                if let Some(old) = old_rel_path.as_deref() {
                    if old != new_rel_path {
                        let old_file = vault_root.join(old);
                        if old_file.exists() {
                            if let Err(e) = fs::remove_file(&old_file) {
                                log::warn!(
                                    "[cascade] Failed to remove stale vault file {}: {}",
                                    old_file.display(), e
                                );
                            }
                        }
                    }
                }
                if let Err(e) = state.workspace_manager.update_vault_rel_path(&node.id, &new_rel_path).await {
                    log::error!(
                        "[cascade] Failed to update vault_rel_path for descendant {}: {}",
                        node.id, e
                    );
                }
                rewritten += 1;
            }
            Err(e) => log::warn!(
                "[cascade] Failed to rewrite vault for descendant {}: {}",
                node.id, e
            ),
        }
    }
    rewritten
}

#[tauri::command]
#[specta::specta]
pub async fn create_node(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    parent_id: Option<String>,
    node_type: String,
    name: String,
) -> Result<WorkspaceNode, String> {
    let node = state.workspace_manager.create_node(parent_id, &node_type, &name, "📄").await?;
    if node.node_type == "document" {
        if let Ok(rel_path) = state.workspace_manager.write_node_to_vault(&app, &node, None).await {
            if let Err(e) = state.workspace_manager.update_vault_rel_path(&node.id, &rel_path).await {
                log::error!("Failed to update vault_rel_path for newly created node {}: {}", node.id, e);
            }
        }
    }
    Ok(node)
}

#[tauri::command]
#[specta::specta]
pub async fn get_node(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Option<WorkspaceNode>, String> {
    let node = state.workspace_manager.get_node(&id).await?;

    // 5b: if vault file is newer than DB, read body from file
    if let Some(ref n) = node {
        if n.node_type == "document" && n.deleted_at.is_none() {
            if let Some(rel_path) = n.vault_rel_path.as_deref().filter(|p| !p.is_empty()) {
                let vroot = resolve_vault_root(&app);
                let file_path = vroot.join(rel_path);
                if file_path.exists() {
                    if let Ok(metadata) = fs::metadata(&file_path) {
                        use std::time::UNIX_EPOCH;
                        let file_mtime = metadata.modified().ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs() as i64));
                        let file_len = metadata.len();
                        // §4.4: Bug 4 fix — writes are now atomic (temp+rename), so the
                        // mtime guard can be tight. We keep +1s as a conservative buffer
                        // against filesystem timestamp granularity (FAT32 = 2s, NTFS = 100ns).
                        //
                        // Cloud-sync placeholder guard (CLAUDE.md Edge Case Matrix #4):
                        // iCloud / OneDrive / Dropbox leave 0-byte stubs in place of
                        // dehydrated files.  If DB has real content but the file on
                        // disk is empty, that is never a legitimate external edit —
                        // skip sync to avoid clobbering the user's body with "".
                        let is_cloud_placeholder = file_len == 0 && !n.body.trim().is_empty();
                        if file_mtime > Some(n.updated_at + 1) && !is_cloud_placeholder {
                            if let Some(new_body) = read_markdown_body_from_vault_file(&vroot, rel_path) {
                                if let Some(updated) = state
                                    .workspace_manager
                                    .sync_document_body_from_vault(&n.id, &new_body)
                                    .await?
                                {
                                    return Ok(Some(updated));
                                }
                            }
                        } else if is_cloud_placeholder {
                            log::warn!(
                                "[vault] Skipping sync of 0-byte file (likely cloud-sync placeholder): {}",
                                file_path.display()
                            );
                        }
                    }
                }
            }
        }
    }

    Ok(node)
}

#[tauri::command]
#[specta::specta]
pub async fn get_node_children(
    state: State<'_, Arc<AppState>>,
    parent_id: String,
) -> Result<Vec<WorkspaceNode>, String> {
    state.workspace_manager.get_node_children(&parent_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_root_nodes(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<WorkspaceNode>, String> {
    state.workspace_manager.get_root_nodes().await
}

#[tauri::command]
#[specta::specta]
pub async fn update_node(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
    name: String,
    icon: String,
    properties: String,
    body: String,
    last_seen_mtime_secs: Option<i64>,
) -> Result<WorkspaceNode, String> {
    // W4: row vault-first write — fire BEFORE the SQLite update so a
    // VAULT_CONFLICT bubbles up to the frontend without persisting any change.
    // Capture the new vault path + old rel_path so we can sync vault_rel_path
    // and delete the stale file after a rename (mirrors the move_node row branch).
    let mut row_vault_sync: Option<(String, Option<String>)> = None;
    if let Some(existing) = state.workspace_manager.get_node(&id).await? {
        if existing.node_type == "row" && existing.deleted_at.is_none() {
            if let Some(parent_db_id) = existing.parent_id.as_deref() {
                // Body is being mutated to `body` here but hasn't yet hit
                // SQLite — pass it as the pending override so the row file
                // reflects the new body, not the stale one.
                let pending_body = if body != existing.body { Some(body.as_str()) } else { None };
                let vm = crate::managers::workspace::VaultManager::new(resolve_vault_root(&app));
                let new_abs = vm
                    .export_row(
                        parent_db_id,
                        &existing.id,
                        last_seen_mtime_secs,
                        &[],
                        pending_body,
                        &state.workspace_manager,
                        &state.database_manager,
                    )
                    .await?;
                let vault_root = resolve_vault_root(&app);
                let new_rel = new_abs
                    .strip_prefix(&vault_root)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_else(|_| new_abs.to_string_lossy().replace('\\', "/"));
                row_vault_sync = Some((new_rel, existing.vault_rel_path.clone()));
            }
        }
    }

    let node = match state.workspace_manager.update_node(&id, &name, &icon, &properties, &body).await {
        Ok(n) => n,
        Err(e) => {
            if row_vault_sync.is_some() {
                log::warn!(
                    "vault-sqlite drift: row={} vault wrote new value but SQLite update_node failed: {}. \
                     vault/import.rs will reconcile on next read.",
                    id, e
                );
            }
            return Err(e);
        }
    };

    // Row rename: sync vault_rel_path + delete old row file if path changed.
    // Mirrors the move_node row branch (around line 294-304).
    if let Some((new_rel, old_rel_path)) = row_vault_sync {
        let vault_root = resolve_vault_root(&app);
        if let Some(old) = old_rel_path.as_deref() {
            if old != new_rel {
                let old_file = vault_root.join(old);
                if old_file.exists() {
                    if let Err(e) = fs::remove_file(&old_file) {
                        log::warn!(
                            "update_node: failed to delete old row vault file {}: {}",
                            old_file.display(), e
                        );
                    }
                }
            }
        }
        if let Err(e) = state.workspace_manager.update_vault_rel_path(&node.id, &new_rel).await {
            log::error!("Failed to update vault_rel_path for renamed row {}: {}", node.id, e);
        }
    }
    if node.node_type == "document" && node.deleted_at.is_none() {
        let old_rel_path = node.vault_rel_path.clone();
        if let Ok(new_rel_path) = state.workspace_manager.write_node_to_vault(&app, &node, last_seen_mtime_secs).await {
            let mut path_changed = false;
            if let Some(old) = old_rel_path.as_deref() {
                if old != new_rel_path {
                    path_changed = true;
                    let old_file = resolve_vault_root(&app).join(old);
                    if old_file.exists() {
                        if let Err(e) = fs::remove_file(&old_file) {
                            log::warn!("Failed to remove old vault file {}: {}", old_file.display(), e);
                        }
                    }
                }
            }
            if let Err(e) = state.workspace_manager.update_vault_rel_path(&node.id, &new_rel_path).await {
                log::error!("Failed to update vault_rel_path for node {}: {}", node.id, e);
            }
            // Rename cascade: if this node's own slug changed, all document
            // descendants need their vault files regenerated at the new ancestor path.
            if path_changed {
                let n = cascade_descendant_vault_paths(&app, &state, &node.id).await;
                if n > 0 {
                    log::info!("[cascade] Rewrote {} descendant vault files after rename of {}", n, node.id);
                }
            }
        }
    }
    Ok(node)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_node(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    state.workspace_manager.soft_delete_node(&id).await
}

#[tauri::command]
#[specta::specta]
pub async fn move_node(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
    parent_id: Option<String>,
    position: f64,
) -> Result<WorkspaceNode, String> {
    let node = state.workspace_manager.move_node(&id, parent_id, position).await?;
    // W4: row move — re-export to the new parent database's rows/<slug>.md path.
    if node.node_type == "row" && node.deleted_at.is_none() {
        let parent_db_id = node.parent_id.as_deref()
            .ok_or("Row has no parent database")?;
        let old_rel_path = node.vault_rel_path.clone();
        let vm = crate::managers::workspace::VaultManager::new(resolve_vault_root(&app));
        // Move doesn't change cells or body — just position. No pending overrides.
        let new_abs = vm
            .export_row(
                parent_db_id,
                &node.id,
                None,
                &[],
                None,
                &state.workspace_manager,
                &state.database_manager,
            )
            .await?;
        // Compute vault-rel for storage; new_abs may not strip cleanly on
        // case-insensitive Windows paths, so fall back to the absolute string
        // when strip_prefix fails (matches existing patterns elsewhere).
        let vault_root = resolve_vault_root(&app);
        let new_rel = new_abs
            .strip_prefix(&vault_root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| new_abs.to_string_lossy().replace('\\', "/"));
        if let Some(old) = old_rel_path.as_deref() {
            if old != new_rel {
                let old_file = vault_root.join(old);
                if old_file.exists() {
                    let _ = fs::remove_file(&old_file);
                }
            }
        }
        if let Err(e) = state.workspace_manager.update_vault_rel_path(&node.id, &new_rel).await {
            log::error!("Failed to update vault_rel_path for moved row {}: {}", node.id, e);
        }
        return Ok(node);
    }
    if node.node_type == "document" && node.deleted_at.is_none() {
        // node.vault_rel_path is still the OLD path here — move_node only touches parent_id/position
        let old_rel_path = node.vault_rel_path.clone();
        if let Ok(new_rel_path) = state.workspace_manager.write_node_to_vault(&app, &node, None).await {
            let mut path_changed = false;
            if let Some(old) = old_rel_path.as_deref() {
                if old != new_rel_path {
                    path_changed = true;
                    let old_file = resolve_vault_root(&app).join(old);
                    if old_file.exists() {
                        if let Err(e) = fs::remove_file(&old_file) {
                            log::warn!("Failed to remove old vault file after move {}: {}", old_file.display(), e);
                        }
                    }
                }
            } else {
                // No previous rel_path recorded — treat a move as a structural change
                // and cascade anyway so any descendants with stale paths catch up.
                path_changed = true;
            }
            if let Err(e) = state.workspace_manager.update_vault_rel_path(&node.id, &new_rel_path).await {
                log::error!("Failed to update vault_rel_path for moved node {}: {}", node.id, e);
            }
            if path_changed {
                let n = cascade_descendant_vault_paths(&app, &state, &node.id).await;
                if n > 0 {
                    log::info!("[cascade] Rewrote {} descendant vault files after move of {}", n, node.id);
                }
            }
        }
    }
    Ok(node)
}

#[tauri::command]
#[specta::specta]
pub async fn create_node_view(
    state: State<'_, Arc<AppState>>,
    node_id: String,
    name: String,
    layout: String,
) -> Result<NodeView, String> {
    state.workspace_manager.create_node_view(&node_id, &name, &layout).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_node_views(
    state: State<'_, Arc<AppState>>,
    node_id: String,
) -> Result<Vec<NodeView>, String> {
    state.workspace_manager.get_node_views(&node_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn update_node_view(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: String,
    color: Option<String>,
    filters: String,
    sorts: String,
    view_options: String,
) -> Result<NodeView, String> {
    state.workspace_manager.update_node_view(&id, &name, color.as_deref(), &filters, &sorts, &view_options).await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_node_view(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    state.workspace_manager.delete_node_view(&id).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_node_comments(
    state: State<'_, Arc<AppState>>,
    node_id: String,
) -> Result<Vec<NodeComment>, String> {
    state.workspace_manager.get_node_comments(&node_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn add_comment(
    state: State<'_, Arc<AppState>>,
    node_id: String,
    author: String,
    content: String,
) -> Result<NodeComment, String> {
    state.workspace_manager.add_comment(&node_id, &author, &content).await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_comment(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    state.workspace_manager.delete_comment(&id).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_templates(
    state: State<'_, Arc<AppState>>,
    node_id: String,
) -> Result<Vec<NodeTemplate>, String> {
    state.workspace_manager.get_templates(&node_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn create_template(
    state: State<'_, Arc<AppState>>,
    node_id: String,
    name: String,
    template_data: String,
) -> Result<NodeTemplate, String> {
    state.workspace_manager.create_template(&node_id, &name, &template_data).await
}

#[tauri::command]
#[specta::specta]
pub async fn ws_create_select_option(
    state: State<'_, Arc<AppState>>,
    database_id: String,
    field_id: String,
    name: String,
) -> Result<WSSelectOption, String> {
    state.workspace_manager
        .create_select_option(&database_id, &field_id, &name)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn ws_rename_select_option(
    state: State<'_, Arc<AppState>>,
    database_id: String,
    field_id: String,
    option_id: String,
    name: String,
) -> Result<WSSelectOption, String> {
    state.workspace_manager
        .rename_select_option(&database_id, &field_id, &option_id, &name)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn ws_update_select_option_color(
    state: State<'_, Arc<AppState>>,
    database_id: String,
    field_id: String,
    option_id: String,
    color: WSSelectColor,
) -> Result<WSSelectOption, String> {
    state.workspace_manager
        .update_select_option_color(&database_id, &field_id, &option_id, color)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn ws_delete_select_option(
    state: State<'_, Arc<AppState>>,
    database_id: String,
    field_id: String,
    option_id: String,
) -> Result<(), String> {
    state.workspace_manager
        .delete_select_option(&database_id, &field_id, &option_id)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn ws_reorder_select_options(
    state: State<'_, Arc<AppState>>,
    database_id: String,
    field_id: String,
    option_ids: Vec<String>,
) -> Result<Vec<WSSelectOption>, String> {
    state.workspace_manager
        .reorder_select_options(&database_id, &field_id, option_ids)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn ws_get_cell(
    state: State<'_, Arc<AppState>>,
    row_id: String,
    field_id: String,
) -> Result<Option<String>, String> {
    let cell = state.workspace_manager
        .get_cell(&row_id, &field_id)
        .await?;
    cell.map(|v| serde_json::to_string(&v).map_err(|e| e.to_string()))
        .transpose()
}

#[tauri::command]
#[specta::specta]
pub async fn ws_update_cell(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    row_id: String,
    field_id: String,
    cell_type: String,
    value: String,
    cell_extras: Option<String>,
) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(&value).map_err(|e| e.to_string())?;
    let extras = cell_extras
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| serde_json::from_str::<serde_json::Value>(s))
        .transpose()
        .map_err(|e| e.to_string())?;
    state
        .workspace_manager
        .update_cell(&row_id, &field_id, &cell_type, value, extras)
        .await?;
    // Note: vault writeback for cell mutations runs through commands::database::update_cell
    // (the live W4 path). This ws_* command path is dead frontend-side; if revived,
    // route it through the bridge — don't reintroduce a layout-specific writer here.
    let _ = app;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ws_create_row_in_group(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    database_id: String,
    field_id: String,
    option_id: String,
    name: String,
) -> Result<WorkspaceNode, String> {
    let row = state.workspace_manager
        .create_row_in_group(&database_id, &field_id, &option_id, &name)
        .await?;
    // Note: vault writeback for row-in-group creation runs through
    // commands::database::create_row_in_group (the live W4 path). This ws_* path
    // is dead frontend-side; revive only via the bridge.
    let _ = app;
    Ok(row)
}

#[tauri::command]
#[specta::specta]
pub async fn ws_add_single_select_field(
    state: State<'_, Arc<AppState>>,
    database_id: String,
    field_name: String,
) -> Result<WorkspaceNode, String> {
    state.workspace_manager
        .add_single_select_field(&database_id, &field_name)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn ws_add_field(
    state: State<'_, Arc<AppState>>,
    database_id: String,
    field_name: String,
    field_type: String,
) -> Result<WorkspaceNode, String> {
    state.workspace_manager
        .add_field(&database_id, &field_name, &field_type)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn ws_rename_field(
    state: State<'_, Arc<AppState>>,
    database_id: String,
    field_id: String,
    name: String,
) -> Result<WorkspaceNode, String> {
    state.workspace_manager
        .rename_field(&database_id, &field_id, &name)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn ws_set_field_type(
    state: State<'_, Arc<AppState>>,
    database_id: String,
    field_id: String,
    field_type: String,
) -> Result<WorkspaceNode, String> {
    state
        .workspace_manager
        .set_field_type(&database_id, &field_id, &field_type)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn ws_set_field_group(
    state: State<'_, Arc<AppState>>,
    database_id: String,
    field_id: String,
    group: String,
) -> Result<WorkspaceNode, String> {
    state
        .workspace_manager
        .set_field_group(&database_id, &field_id, &group)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn ws_rename_field_group(
    state: State<'_, Arc<AppState>>,
    database_id: String,
    old_name: String,
    new_name: String,
) -> Result<WorkspaceNode, String> {
    state
        .workspace_manager
        .rename_field_group(&database_id, &old_name, &new_name)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn ws_delete_field(
    state: State<'_, Arc<AppState>>,
    database_id: String,
    field_id: String,
) -> Result<WorkspaceNode, String> {
    state.workspace_manager
        .delete_field(&database_id, &field_id)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_user_preference(
    state: State<'_, Arc<AppState>>,
    key: String,
) -> Result<Option<String>, String> {
    state.workspace_manager.get_user_preference(&key).await
}

#[tauri::command]
#[specta::specta]
pub async fn set_user_preference(
    state: State<'_, Arc<AppState>>,
    key: String,
    value: String,
) -> Result<(), String> {
    state.workspace_manager.set_user_preference(&key, &value).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_backlinks(
    state: State<'_, Arc<AppState>>,
    target_id: String,
) -> Result<Vec<WorkspaceNode>, String> {
    state.workspace_manager.get_backlinks(&target_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn propagate_rename(
    state: State<'_, Arc<AppState>>,
    target_id: String,
    old_name: String,
    new_name: String,
) -> Result<usize, String> {
    state.workspace_manager.propagate_rename(&target_id, &old_name, &new_name).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_or_create_daily_note(
    state: State<'_, Arc<AppState>>,
    date: String,
) -> Result<WorkspaceNode, String> {
    state.workspace_manager.get_or_create_daily_note(&date).await
}

#[tauri::command]
#[specta::specta]
pub async fn restore_node(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<WorkspaceNode, String> {
    state.workspace_manager.restore_node(&id).await
}

#[tauri::command]
#[specta::specta]
pub async fn permanent_delete_node(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    // Collect vault path before deletion — manager won't have it after the DB row is gone
    let vault_path = state.workspace_manager
        .get_node(&id)
        .await?
        .and_then(|n| n.vault_rel_path);

    state.workspace_manager.permanent_delete_node(&id).await?;

    if let Some(rel_path) = vault_path {
        let file = resolve_vault_root(&app).join(&rel_path);
        if file.exists() {
            // Bug 5 fix: log errors instead of silently swallowing them.
            if let Err(e) = fs::remove_file(&file) {
                log::error!("Failed to delete old vault file {:?}: {}", file, e);
            }
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_deleted_nodes(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<WorkspaceNode>, String> {
    state.workspace_manager.get_deleted_nodes().await
}

#[tauri::command]
#[specta::specta]
pub async fn empty_trash(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    // Collect vault paths for all trashed nodes before the DB rows are gone
    let vault_paths: Vec<String> = state.workspace_manager
        .get_deleted_nodes()
        .await?
        .into_iter()
        .filter_map(|n| n.vault_rel_path)
        .collect();

    state.workspace_manager.empty_trash().await?;

    let vroot = resolve_vault_root(&app);
    for rel_path in vault_paths {
        let file = vroot.join(&rel_path);
        if file.exists() {
            // Bug 5 fix: log errors instead of silently swallowing them.
            if let Err(e) = fs::remove_file(&file) {
                log::error!("Failed to delete old vault file {:?}: {}", file, e);
            }
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn import_markdown_folder(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<Vec<WorkspaceNode>, String> {
    state.workspace_manager.import_markdown_folder(&path).await
}

#[tauri::command]
#[specta::specta]
pub async fn import_csv(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<WorkspaceNode, String> {
    state.workspace_manager.import_csv(&path).await
}

#[tauri::command]
#[specta::specta]
pub async fn export_markdown(
    state: State<'_, Arc<AppState>>,
    node_id: String,
    path: String,
) -> Result<(), String> {
    state.workspace_manager.export_markdown(&node_id, &path).await
}

#[tauri::command]
#[specta::specta]
pub async fn export_csv(
    state: State<'_, Arc<AppState>>,
    node_id: String,
    view_id: String,
    path: String,
) -> Result<(), String> {
    state.workspace_manager.export_csv(&node_id, &view_id, &path).await
}

#[tauri::command]
#[specta::specta]
pub async fn sync_vault(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<usize, String> {
    state.workspace_manager.sync_all_nodes_to_vault(&app).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_vault_sync_status(
    state: State<'_, Arc<AppState>>,
) -> Result<VaultSyncStatus, String> {
    let conn = state.workspace_manager.conn().lock().await;
    let total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workspace_nodes WHERE node_type = 'document' AND deleted_at IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let with_path: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workspace_nodes WHERE node_type = 'document' AND deleted_at IS NULL AND vault_rel_path IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(VaultSyncStatus {
        total_documents: total,
        synced_documents: with_path,
        pending_documents: total - with_path,
    })
}
