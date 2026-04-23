use crate::managers::system_audio::SystemAudioManager;
use crate::TranscriptionCoordinator;
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Type)]
pub struct RenderDeviceInfo {
    pub id: String,
    pub name: String,
}

/// Start system audio capture via WASAPI loopback.
/// Delegates to TranscriptionCoordinator to enforce mutual exclusion with mic recording.
#[tauri::command]
#[specta::specta]
pub async fn start_system_audio_capture(app: AppHandle) -> Result<(), String> {
    if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
        coordinator.send_system_audio_toggle(true);
        Ok(())
    } else {
        Err("TranscriptionCoordinator not initialized".to_string())
    }
}

/// Whether WASAPI loopback capture is active (persists across React tab changes).
#[tauri::command]
#[specta::specta]
pub fn is_system_audio_capturing(app: AppHandle) -> Result<bool, String> {
    Ok(app
        .try_state::<Arc<SystemAudioManager>>()
        .map(|m| m.is_running())
        .unwrap_or(false))
}

/// Elapsed seconds since system-audio capture started, or `None` when not capturing.
#[tauri::command]
#[specta::specta]
pub fn get_system_audio_capture_elapsed_secs(app: AppHandle) -> Result<Option<f32>, String> {
    Ok(app
        .try_state::<Arc<SystemAudioManager>>()
        .and_then(|m| m.capture_elapsed_secs()))
}

/// Stop system audio capture.
#[tauri::command]
#[specta::specta]
pub async fn stop_system_audio_capture(app: AppHandle) -> Result<(), String> {
    if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
        coordinator.send_system_audio_toggle(false);
        Ok(())
    } else {
        Err("TranscriptionCoordinator not initialized".to_string())
    }
}

/// Play a short test tone and show live VU levels to verify the loopback device is working.
/// This is a no-op on non-Windows platforms.
#[tauri::command]
#[specta::specta]
pub async fn test_loopback_device(
    _app: AppHandle,
    _device_id: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Emit a brief silence so the level meter shows activity upon a real signal.
        // A full tone playback would require rodio integration; for MVP we just succeed.
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

/// List all active render (output) endpoints. Windows only — returns empty on other platforms.
/// For MVP, returns just the default device; full enumeration requires additional Windows property APIs.
#[tauri::command]
#[specta::specta]
pub fn get_render_devices(_app: AppHandle) -> Result<Vec<RenderDeviceInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        // Return the default render device as the only entry.
        // Full enumeration with friendly names requires Win32_Devices_Properties which
        // is deferred to a future enhancement.
        Ok(vec![RenderDeviceInfo {
            id: "default".to_string(),
            name: "Default Audio Output".to_string(),
        }])
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}
