use crate::import::{ImportQueueService, ImportQueueSnapshot};
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn enqueue_import_paths(
    service: State<'_, ImportQueueService>,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    service.enqueue_paths(paths).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_import_queue(
    service: State<'_, ImportQueueService>,
) -> Result<ImportQueueSnapshot, String> {
    Ok(service.snapshot().await)
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_import_job(
    service: State<'_, ImportQueueService>,
    job_id: String,
) -> Result<(), String> {
    service.cancel_job(job_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn clear_completed_imports(
    service: State<'_, ImportQueueService>,
) -> Result<(), String> {
    service.clear_completed_imports().await
}

// Import-recovery commands (get_import_recovery_candidates,
// discard_import_recovery, resume_import_recovery) deleted in Phase A
// Commit 3 — they were notes-scoped (imports produced Note records that
// could be resumed if interrupted). With NotesManager gone, the recovery
// UX goes with it. Phase B/C may reintroduce resume semantics scoped to
// workspace_nodes if the UX case emerges.
