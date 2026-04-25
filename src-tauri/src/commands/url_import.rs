//! Tauri commands for URL-driven media imports.
use crate::import::{
    AlreadyImportedHit, ImportQueueService, PlaylistEnvelope, WebMediaImportOpts, WebMediaMetadata,
    YtDlpHandle,
};
use crate::plugin::yt_dlp;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, State};

/// Combined result from `fetch_url_metadata`: the raw metadata from yt-dlp
/// plus an optional hit if this URL has already been imported.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UrlMetadataResult {
    #[serde(flatten)]
    pub meta: WebMediaMetadata,
    pub already_imported: Option<AlreadyImportedHit>,
}

/// Fetch yt-dlp metadata for a URL and check whether it has already been
/// imported into the workspace.
#[tauri::command]
#[specta::specta]
pub async fn fetch_url_metadata(
    app: AppHandle,
    queue: State<'_, ImportQueueService>,
    url: String,
) -> Result<UrlMetadataResult, String> {
    let bin = yt_dlp::binary_path(&app)?;
    let handle = YtDlpHandle::new(bin);
    let meta = handle
        .fetch_metadata(&url)
        .await
        .map_err(|e| e.to_string())?;
    let already_imported = queue
        .workspace_manager()
        .find_node_by_source_id(&meta.source_id)
        .await?;
    Ok(UrlMetadataResult {
        meta,
        already_imported,
    })
}

/// Fetch the entries of a playlist URL without downloading any media.
#[tauri::command]
#[specta::specta]
pub async fn fetch_playlist_entries(
    app: AppHandle,
    url: String,
) -> Result<PlaylistEnvelope, String> {
    let bin = yt_dlp::binary_path(&app)?;
    let handle = YtDlpHandle::new(bin);
    handle
        .fetch_playlist_entries(&url)
        .await
        .map_err(|e| e.to_string())
}

/// Enqueue one or more URLs for import. Returns the job IDs.
#[tauri::command]
#[specta::specta]
pub async fn enqueue_import_urls(
    queue: State<'_, ImportQueueService>,
    urls: Vec<String>,
    opts: WebMediaImportOpts,
) -> Result<Vec<String>, String> {
    queue.enqueue_urls(urls, opts).await
}

/// Pause the import queue worker (in-flight jobs finish; no new jobs start).
#[tauri::command]
#[specta::specta]
pub async fn pause_import_queue(queue: State<'_, ImportQueueService>) -> Result<(), String> {
    queue.pause();
    Ok(())
}

/// Resume the import queue worker.
#[tauri::command]
#[specta::specta]
pub async fn resume_import_queue(queue: State<'_, ImportQueueService>) -> Result<(), String> {
    queue.resume();
    Ok(())
}

/// Return whether the import queue is currently paused.
#[tauri::command]
#[specta::specta]
pub async fn import_queue_pause_state(
    queue: State<'_, ImportQueueService>,
) -> Result<bool, String> {
    Ok(queue.is_paused())
}
