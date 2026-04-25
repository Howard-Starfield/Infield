//! Tauri commands for yt-dlp plugin lifecycle.
use crate::import::ImportQueueService;
use crate::plugin::yt_dlp;
use tauri::{AppHandle, State};

#[tauri::command]
#[specta::specta]
pub async fn yt_dlp_plugin_status(app: AppHandle) -> Result<yt_dlp::PluginStatus, String> {
    yt_dlp::read_status(&app)
}

#[tauri::command]
#[specta::specta]
pub async fn install_yt_dlp_plugin(app: AppHandle) -> Result<(), String> {
    yt_dlp::install(&app).await
}

#[tauri::command]
#[specta::specta]
pub async fn check_yt_dlp_update(app: AppHandle) -> Result<yt_dlp::UpdateCheckResult, String> {
    yt_dlp::check_update(&app).await
}

#[tauri::command]
#[specta::specta]
pub async fn uninstall_yt_dlp_plugin(
    app: AppHandle,
    queue: State<'_, ImportQueueService>,
) -> Result<(), String> {
    // Cancel any active WebMedia jobs so yt-dlp child processes are signalled
    // before the binary is removed.
    queue.cancel_all_web_media_jobs().await?;
    yt_dlp::uninstall(&app)
}
