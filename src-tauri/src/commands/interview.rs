use crate::managers::audio::AudioRecordingManager;
use crate::managers::interview_session::InterviewSessionManager;
use crate::managers::interview_worker::InterviewTranscriptionWorker;
use crate::managers::system_audio::SystemAudioManager;
use crate::settings::get_settings;
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Type)]
pub struct InterviewStartResult {
    pub workspace_doc_id: String,
    pub started_at_ms: i64,
}

/// Start a new interview session: mic + system audio simultaneously.
#[tauri::command]
#[specta::specta]
pub async fn start_interview_session(
    app: AppHandle,
    participant_name: String,
) -> Result<InterviewStartResult, String> {
    let name = participant_name.trim();
    if name.is_empty() {
        return Err("Participant name is required".to_string());
    }
    if name.eq_ignore_ascii_case("you") {
        return Err("Participant name cannot be 'You'".to_string());
    }

    if let Some(mgr) = app.try_state::<Arc<InterviewSessionManager>>() {
        if mgr.is_active() {
            return Err("An interview session is already running".to_string());
        }
    }
    if app
        .try_state::<Arc<AudioRecordingManager>>()
        .map_or(false, |a| a.is_recording())
    {
        return Err("Stop the active mic transcription first".to_string());
    }
    if app
        .try_state::<Arc<SystemAudioManager>>()
        .map_or(false, |m| m.is_running())
    {
        return Err("Stop the active system-audio capture first".to_string());
    }

    let worker = app
        .try_state::<Arc<InterviewTranscriptionWorker>>()
        .ok_or_else(|| "InterviewTranscriptionWorker not initialized".to_string())?
        .inner()
        .clone();

    let settings = get_settings(&app);
    let max_chunk_secs = settings.system_audio_max_chunk_secs;
    let vad_hangover_secs = settings.system_audio_vad_hangover_secs;

    match worker
        .start(name.to_string(), max_chunk_secs, vad_hangover_secs)
        .await
    {
        Ok((workspace_doc_id, started_at_ms)) => Ok(InterviewStartResult {
            workspace_doc_id,
            started_at_ms,
        }),
        Err(e) => Err(format!("Failed to start interview session: {e}")),
    }
}

/// Stop the active interview session. Returns the workspace doc id
/// (already written) or `None` if no session was active.
#[tauri::command]
#[specta::specta]
pub async fn stop_interview_session(app: AppHandle) -> Result<Option<String>, String> {
    let worker = app
        .try_state::<Arc<InterviewTranscriptionWorker>>()
        .ok_or_else(|| "InterviewTranscriptionWorker not initialized".to_string())?
        .inner()
        .clone();
    worker
        .stop()
        .await
        .map_err(|e| format!("Failed to stop interview session: {e}"))
}

/// Whether an interview session is currently active.
#[tauri::command]
#[specta::specta]
pub fn is_interview_session_active(app: AppHandle) -> Result<bool, String> {
    Ok(app
        .try_state::<Arc<InterviewSessionManager>>()
        .map_or(false, |m| m.is_active()))
}
