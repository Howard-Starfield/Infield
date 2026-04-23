use crate::managers::llm::LlmManager;
use crate::managers::model::{ModelInfo, ModelManager};
use crate::managers::transcription::{ModelStateEvent, TranscriptionManager};
use crate::settings::{get_settings, write_settings, ModelUnloadTimeout};
use log::{info, warn};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
#[specta::specta]
pub async fn get_available_models(
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<Vec<ModelInfo>, String> {
    Ok(model_manager.get_available_models())
}

#[tauri::command]
#[specta::specta]
pub async fn get_model_info(
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<Option<ModelInfo>, String> {
    Ok(model_manager.get_model_info(&model_id))
}

#[tauri::command]
#[specta::specta]
pub async fn download_model(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), String> {
    let result = model_manager
        .download_model(&model_id)
        .await
        .map_err(|e| e.to_string());

    if let Err(ref error) = result {
        let _ = app_handle.emit(
            "model-download-failed",
            serde_json::json!({ "model_id": &model_id, "error": error }),
        );
    }

    result
}

#[tauri::command]
#[specta::specta]
pub async fn delete_model(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    llm_manager: State<'_, Arc<LlmManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    model_id: String,
) -> Result<(), String> {
    // If deleting the active transcription model, unload it and clear the setting
    let settings = get_settings(&app_handle);
    let model_info = model_manager
        .get_model_info(&model_id)
        .ok_or_else(|| format!("Model not found: {}", model_id))?;
    let llm_model_path = if model_info.is_llm_model() {
        model_manager
            .get_model_path(&model_id)
            .ok()
            .map(|path| path.to_string_lossy().to_string())
    } else {
        None
    };
    if model_info.is_transcription_model() && settings.selected_model == model_id {
        transcription_manager
            .unload_model()
            .map_err(|e| format!("Failed to unload model: {}", e))?;

        let mut settings = get_settings(&app_handle);
        settings.selected_model = String::new();
        write_settings(&app_handle, settings);
    }

    if let Some(model_path) = llm_model_path {
        let mut settings = get_settings(&app_handle);
        if settings.llm_model_path.as_deref() == Some(model_path.as_str()) {
            settings.llm_model_path = None;
            write_settings(&app_handle, settings);
            llm_manager
                .reload_from_settings(&app_handle)
                .map_err(|e| e.to_string())?;
            let _ = app_handle.emit("model-state-changed", ());
        }
    }

    // D1b locked: bge-small-en-v1.5 is the only embedding model in v1.
    // Deleting it leaves semantic search unavailable until re-downloaded;
    // the `InferenceHandle` boot check catches this on next startup and
    // shows the Settings banner. No in-process fallback to pick.
    if model_info.category == crate::managers::model::ModelCategory::Embedding {
        log::info!(
            "Deleted embedding model {} — semantic search unavailable \
             until re-downloaded",
            model_id
        );
    }

    model_manager
        .delete_model(&model_id)
        .map_err(|e| e.to_string())?;

    let _ = app_handle.emit("model-state-changed", ());

    Ok(())
}

/// Shared logic for switching the active model, used by both the Tauri command
/// and the tray menu handler.
///
/// Validates the model, updates the persisted setting, and loads the model
/// unless the unload timeout is set to "Immediately" (in which case the model
/// will be loaded on-demand during the next transcription).
pub fn switch_active_model(app: &AppHandle, model_id: &str) -> Result<(), String> {
    let model_manager = app.state::<Arc<ModelManager>>();
    let transcription_manager = app.state::<Arc<TranscriptionManager>>();

    // Atomically claim the loading slot — prevents concurrent model loads
    // from tray double-clicks or overlapping commands. The guard resets the
    // flag on drop (including early returns, errors, and panics).
    let _loading_guard = transcription_manager
        .try_start_loading()
        .ok_or_else(|| "Model load already in progress".to_string())?;

    // Check if model exists and is available
    let model_info = model_manager
        .get_model_info(model_id)
        .ok_or_else(|| format!("Model not found: {}", model_id))?;

    if !model_info.is_transcription_model() {
        return Err(format!(
            "Model {} is not a transcription model and cannot be activated",
            model_id
        ));
    }

    if !model_info.is_downloaded {
        return Err(format!("Model not downloaded: {}", model_id));
    }

    let settings = get_settings(app);
    let unload_timeout = settings.model_unload_timeout;
    let old_model = settings.selected_model.clone();

    // Persist the new selection early so the frontend sees the correct model
    // when it reacts to events emitted by load_model.
    let mut settings = settings;
    settings.selected_model = model_id.to_string();

    // Reset language to auto if the new model doesn't support the currently selected language.
    // This prevents stale language settings from causing errors (e.g. Canary receiving zh-Hans)
    // and stops downstream processing (e.g. OpenCC) from running on an irrelevant language.
    if settings.selected_language != "auto"
        && !model_info.supported_languages.is_empty()
        && !model_info
            .supported_languages
            .contains(&settings.selected_language)
    {
        log::info!(
            "Resetting language from '{}' to 'auto' (not supported by {})",
            settings.selected_language,
            model_id
        );
        settings.selected_language = "auto".to_string();
    }

    write_settings(app, settings);

    // Skip eager loading if unload is set to "Immediately" — the model
    // will be loaded on-demand during the next transcription.
    if unload_timeout == ModelUnloadTimeout::Immediately {
        // Notify frontend — load_model won't be called so no events
        // would otherwise be emitted.
        let _ = app.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "selection_changed".to_string(),
                model_id: Some(model_id.to_string()),
                model_name: Some(model_info.name.clone()),
                error: None,
            },
        );
        log::info!(
            "Model selection changed to {} (not loading — unload set to Immediately).",
            model_id
        );
        return Ok(());
    }

    // Load the model. On failure, revert the persisted selection.
    if let Err(e) = transcription_manager.load_model(model_id) {
        let mut settings = get_settings(app);
        settings.selected_model = old_model;
        write_settings(app, settings);
        return Err(e.to_string());
    }

    Ok(())
}

/// If `selected_model` is empty but at least one transcription model is downloaded
/// (e.g. user deleted `settings_store.json`), pick a default and persist it.
pub fn ensure_selected_transcription_model(app: &AppHandle) {
    let settings = get_settings(app);
    if !settings.selected_model.trim().is_empty() {
        return;
    }

    let model_manager = app.state::<Arc<ModelManager>>();
    let models = model_manager.get_available_models();
    let downloaded: Vec<&ModelInfo> = models
        .iter()
        .filter(|m| m.is_transcription_model() && m.is_downloaded)
        .collect();

    if downloaded.is_empty() {
        return;
    }

    let chosen = downloaded
        .iter()
        .find(|m| m.is_recommended)
        .copied()
        .unwrap_or(downloaded[0]);

    info!(
        "selected_model was empty; auto-selecting transcription model '{}'",
        chosen.id
    );

    if let Err(e) = switch_active_model(app, chosen.id.as_str()) {
        warn!(
            "Failed to auto-select transcription model '{}': {}",
            chosen.id, e
        );
    }
}

#[tauri::command]
#[specta::specta]
pub async fn set_active_model(
    app_handle: AppHandle,
    _model_manager: State<'_, Arc<ModelManager>>,
    _transcription_manager: State<'_, Arc<TranscriptionManager>>,
    model_id: String,
) -> Result<(), String> {
    switch_active_model(&app_handle, &model_id)
}

#[tauri::command]
#[specta::specta]
pub async fn get_current_model(app_handle: AppHandle) -> Result<String, String> {
    let settings = get_settings(&app_handle);
    Ok(settings.selected_model)
}

#[tauri::command]
#[specta::specta]
pub async fn set_active_llm_model(
    app_handle: AppHandle,
    llm_manager: State<'_, Arc<LlmManager>>,
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), String> {
    let model_info = model_manager
        .get_model_info(&model_id)
        .ok_or_else(|| format!("Model not found: {}", model_id))?;

    if !model_info.is_llm_model() {
        return Err(format!(
            "Model {} is not a local AI model and cannot be activated",
            model_id
        ));
    }

    if !model_info.is_downloaded {
        return Err(format!("Model not downloaded: {}", model_id));
    }

    let model_path = model_manager
        .get_model_path(&model_id)
        .map_err(|e| e.to_string())?;

    let mut settings = get_settings(&app_handle);
    settings.llm_model_path = Some(model_path.to_string_lossy().to_string());
    write_settings(&app_handle, settings);
    llm_manager
        .reload_from_settings(&app_handle)
        .map_err(|e| e.to_string())?;

    let _ = app_handle.emit("model-state-changed", ());

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_current_llm_model(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<Option<String>, String> {
    let settings = get_settings(&app_handle);
    let Some(current_path) = settings
        .llm_model_path
        .clone()
        .filter(|path| !path.trim().is_empty())
    else {
        return Ok(None);
    };

    for model in model_manager.get_available_models() {
        if !model.is_llm_model() || !model.is_downloaded {
            continue;
        }

        let Ok(model_path) = model_manager.get_model_path(&model.id) else {
            continue;
        };

        if model_path.to_string_lossy() == current_path {
            return Ok(Some(model.id));
        }
    }

    Ok(None)
}

// D1b locked: bge-small-en-v1.5 is the only embedding model in v1. The
// previous `get_current_embedding_model` and `set_active_embedding_model`
// commands existed to let users swap between nomic / bge-m3 GGUF variants
// at runtime; Phase A removed those variants entirely (see
// REBUILD_RATIONALE §15). Frontend replacement: `get_embedding_model_info`
// in commands/search.rs returns the static bge-small identity + availability
// derived from `InferenceHandle`.

#[tauri::command]
#[specta::specta]
pub async fn get_transcription_model_status(
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<Option<String>, String> {
    Ok(transcription_manager.get_current_model())
}

#[tauri::command]
#[specta::specta]
pub async fn is_model_loading(
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<bool, String> {
    // Check if transcription manager has a loaded model
    let current_model = transcription_manager.get_current_model();
    Ok(current_model.is_none())
}

#[tauri::command]
#[specta::specta]
pub async fn has_any_models_available(
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<bool, String> {
    let models = model_manager.get_available_models();
    Ok(models
        .iter()
        .any(|m| m.is_downloaded && m.is_transcription_model()))
}

#[tauri::command]
#[specta::specta]
pub async fn has_any_models_or_downloads(
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<bool, String> {
    let models = model_manager.get_available_models();
    // Return true if any models are downloaded OR if any downloads are in progress
    Ok(models
        .iter()
        .any(|m| m.is_transcription_model() && (m.is_downloaded || m.is_downloading)))
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_download(
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), String> {
    model_manager
        .cancel_download(&model_id)
        .map_err(|e| e.to_string())
}

// `get_embedding_debug_info` deleted alongside `set_active_embedding_model`
// — the DebugInfo struct exposed sidecar-process diagnostics that no longer
// exist with the in-process ORT path. Availability info is reachable via
// `get_embedding_model_info` (commands/search.rs) + the
// `vector-search-unavailable` Tauri event.
