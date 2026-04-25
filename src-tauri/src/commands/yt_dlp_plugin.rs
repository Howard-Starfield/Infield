//! Tauri commands for yt-dlp plugin lifecycle.
use crate::plugin::yt_dlp;
use tauri::AppHandle;

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
pub async fn uninstall_yt_dlp_plugin(app: AppHandle) -> Result<(), String> {
    // Active-job cancellation is added in Task 18 once the worker exists.
    yt_dlp::uninstall(&app)
}
