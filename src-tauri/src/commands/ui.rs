//! UI-level commands that don't belong under any specific domain
//! (workspace/database/audio/etc.). Currently:
//!
//! - `set_app_zoom` — sets the native webview zoom level. Wraps
//!   Tauri's platform-specific browser-zoom API (WebView2's
//!   `SetZoomFactor` on Windows, WebKit's `setPageZoom` on macOS,
//!   webkit2gtk's `set_zoom_level` on Linux). This is the same
//!   mechanism Ctrl+`+`/Ctrl+`-` uses in any Chromium browser —
//!   content zooms, viewport stays the correct size, layout reflows.
//!   Strictly better than CSS `zoom` which leaves clipped gutters
//!   and breaks fixed positioning.

use tauri::{AppHandle, Manager};

/// Sets the webview zoom level for the main window.
///
/// Range clamped 0.25–3.0 (WebView2's hard limits); typical UX range
/// is 0.5–1.5. Values outside the allowed range error rather than
/// silently clamping so callers can surface the limit to users.
#[tauri::command]
#[specta::specta]
pub async fn set_app_zoom(app: AppHandle, scale: f64) -> Result<(), String> {
    if !(0.25..=3.0).contains(&scale) {
        return Err(format!(
            "zoom scale {scale} out of range (allowed 0.25–3.0)"
        ));
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window
        .set_zoom(scale)
        .map_err(|e| format!("failed to set webview zoom: {e}"))?;
    Ok(())
}
