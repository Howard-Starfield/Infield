#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::audio_toolkit::{is_microphone_access_denied, is_no_input_device_error};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::workspace::AppState;
use crate::managers::transcription::TranscriptionManager;
use crate::managers::voice_session::VoiceSessionManager;
use crate::settings::{
    get_settings, AppSettings, ClipboardHandling, PasteMethod, APPLE_INTELLIGENCE_PROVIDER_ID,
};
use crate::shortcut;
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils::{
    self, show_processing_overlay, show_recording_overlay, show_transcribing_overlay,
};
use crate::transcription_workspace;
use crate::TranscriptionCoordinator;
use chrono::Datelike;
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, info, warn};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tauri::Manager;
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
struct RecordingErrorEvent {
    error_type: String,
    detail: Option<String>,
}

/// Drop guard that notifies the [`TranscriptionCoordinator`] when the
/// transcription pipeline finishes — whether it completes normally or panics.
struct FinishGuard(AppHandle);
impl Drop for FinishGuard {
    fn drop(&mut self) {
        if let Some(c) = self.0.try_state::<TranscriptionCoordinator>() {
            c.notify_processing_finished();
        }
    }
}

fn finalize_transcription_ui(app: &AppHandle) {
    debug!("Finalizing transcription UI");

    let app_index = app.clone();
    tauri::async_runtime::spawn(async move {
        transcription_workspace::finalize_active_voice_workspace_index(&app_index).await;
    });

    #[cfg(target_os = "windows")]
    {
        let app_for_dispatch = app.clone();
        let app_for_ui = app_for_dispatch.clone();
        if let Err(err) = app_for_dispatch.run_on_main_thread(move || {
            utils::hide_recording_overlay(&app_for_ui);
            change_tray_icon(&app_for_ui, TrayIconState::Idle);
        }) {
            error!(
                "Failed to finalize transcription UI on main thread: {:?}",
                err
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        utils::hide_recording_overlay(app);
        change_tray_icon(app, TrayIconState::Idle);
    }
}

// Shortcut Action Trait
pub trait ShortcutAction: Send + Sync {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
}

// Transcribe Action
struct TranscribeAction {
    post_process: bool,
}

/// Field name for structured output JSON schema
const TRANSCRIPTION_FIELD: &str = "transcription";

/// Strip invisible Unicode characters that some LLMs may insert
fn strip_invisible_chars(s: &str) -> String {
    s.replace(['\u{200B}', '\u{200C}', '\u{200D}', '\u{FEFF}'], "")
}

/// Build a system prompt from the user's prompt template.
/// Removes `${output}` placeholder since the transcription is sent as the user message.
fn build_system_prompt(prompt_template: &str) -> String {
    prompt_template.replace("${output}", "").trim().to_string()
}

async fn post_process_transcription(settings: &AppSettings, transcription: &str) -> Option<String> {
    let provider = match settings.active_post_process_provider().cloned() {
        Some(provider) => provider,
        None => {
            debug!("Post-processing enabled but no provider is selected");
            return None;
        }
    };

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.trim().is_empty() {
        debug!(
            "Post-processing skipped because provider '{}' has no model configured",
            provider.id
        );
        return None;
    }

    let selected_prompt_id = match &settings.post_process_selected_prompt_id {
        Some(id) => id.clone(),
        None => {
            debug!("Post-processing skipped because no prompt is selected");
            return None;
        }
    };

    let prompt = match settings
        .post_process_prompts
        .iter()
        .find(|prompt| prompt.id == selected_prompt_id)
    {
        Some(prompt) => prompt.prompt.clone(),
        None => {
            debug!(
                "Post-processing skipped because prompt '{}' was not found",
                selected_prompt_id
            );
            return None;
        }
    };

    if prompt.trim().is_empty() {
        debug!("Post-processing skipped because the selected prompt is empty");
        return None;
    }

    debug!(
        "Starting LLM post-processing with provider '{}' (model: {})",
        provider.id, model
    );

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if provider.supports_structured_output {
        debug!("Using structured outputs for provider '{}'", provider.id);

        let system_prompt = build_system_prompt(&prompt);
        let user_content = transcription.to_string();

        // Handle Apple Intelligence separately since it uses native Swift APIs
        if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
            #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
            {
                if !apple_intelligence::check_apple_intelligence_availability() {
                    debug!(
                        "Apple Intelligence selected but not currently available on this device"
                    );
                    return None;
                }

                let token_limit = model.trim().parse::<i32>().unwrap_or(0);
                return match apple_intelligence::process_text_with_system_prompt(
                    &system_prompt,
                    &user_content,
                    token_limit,
                ) {
                    Ok(result) => {
                        if result.trim().is_empty() {
                            debug!("Apple Intelligence returned an empty response");
                            None
                        } else {
                            let result = strip_invisible_chars(&result);
                            debug!(
                                "Apple Intelligence post-processing succeeded. Output length: {} chars",
                                result.len()
                            );
                            Some(result)
                        }
                    }
                    Err(err) => {
                        error!("Apple Intelligence post-processing failed: {}", err);
                        None
                    }
                };
            }

            #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
            {
                debug!("Apple Intelligence provider selected on unsupported platform");
                return None;
            }
        }

        // Define JSON schema for transcription output
        let json_schema = serde_json::json!({
            "type": "object",
            "properties": {
                (TRANSCRIPTION_FIELD): {
                    "type": "string",
                    "description": "The cleaned and processed transcription text"
                }
            },
            "required": [TRANSCRIPTION_FIELD],
            "additionalProperties": false
        });

        match crate::llm_client::send_chat_completion_with_schema(
            &provider,
            api_key.clone(),
            &model,
            user_content,
            Some(system_prompt),
            Some(json_schema),
            Some(settings.local_llm_num_ctx),
        )
        .await
        {
            Ok(Some(content)) => {
                // Parse the JSON response to extract the transcription field
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(json) => {
                        if let Some(transcription_value) =
                            json.get(TRANSCRIPTION_FIELD).and_then(|t| t.as_str())
                        {
                            let result = strip_invisible_chars(transcription_value);
                            debug!(
                                "Structured output post-processing succeeded for provider '{}'. Output length: {} chars",
                                provider.id,
                                result.len()
                            );
                            return Some(result);
                        } else {
                            error!("Structured output response missing 'transcription' field");
                            return Some(strip_invisible_chars(&content));
                        }
                    }
                    Err(e) => {
                        error!(
                            "Failed to parse structured output JSON: {}. Returning raw content.",
                            e
                        );
                        return Some(strip_invisible_chars(&content));
                    }
                }
            }
            Ok(None) => {
                error!("LLM API response has no content");
                return None;
            }
            Err(e) => {
                warn!(
                    "Structured output failed for provider '{}': {}. Falling back to legacy mode.",
                    provider.id, e
                );
                // Fall through to legacy mode below
            }
        }
    }

    // Legacy mode: Replace ${output} variable in the prompt with the actual text
    let processed_prompt = prompt.replace("${output}", transcription);
    debug!("Processed prompt length: {} chars", processed_prompt.len());

    match crate::llm_client::send_chat_completion(
        &provider,
        api_key,
        &model,
        processed_prompt,
        Some(settings.local_llm_num_ctx),
    )
    .await
    {
        Ok(Some(content)) => {
            let content = strip_invisible_chars(&content);
            debug!(
                "LLM post-processing succeeded for provider '{}'. Output length: {} chars",
                provider.id,
                content.len()
            );
            Some(content)
        }
        Ok(None) => {
            error!("LLM API response has no content");
            None
        }
        Err(e) => {
            error!(
                "LLM post-processing failed for provider '{}': {}. Falling back to original transcription.",
                provider.id,
                e
            );
            None
        }
    }
}

pub(crate) async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    // Check if language is set to Simplified or Traditional Chinese
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        debug!("selected_language is not Simplified or Traditional Chinese; skipping translation");
        return None;
    }

    debug!(
        "Starting Chinese translation using OpenCC for language: {}",
        settings.selected_language
    );

    // Use OpenCC to convert based on selected language
    let config = if is_simplified {
        // Convert Traditional Chinese to Simplified Chinese
        BuiltinConfig::Tw2sp
    } else {
        // Convert Simplified Chinese to Traditional Chinese
        BuiltinConfig::S2tw
    };

    match OpenCC::from_config(config) {
        Ok(converter) => {
            let converted = converter.convert(transcription);
            debug!(
                "OpenCC translation completed. Input length: {}, Output length: {}",
                transcription.len(),
                converted.len()
            );
            Some(converted)
        }
        Err(e) => {
            error!("Failed to initialize OpenCC converter: {}. Falling back to original transcription.", e);
            None
        }
    }
}

pub(crate) struct ProcessedTranscription {
    pub final_text: String,
    pub post_processed_text: Option<String>,
    pub post_process_prompt: Option<String>,
}

/// Canonical daily title — ISO date for filesystem sortability and stable slugs.
fn voice_memo_daily_title_for_local_date() -> String {
    let d = chrono::Local::now().date_naive();
    format!("Voice Memos — {}", d.format("%Y-%m-%d"))
}

/// Legacy (pre-ISO) daily title.  Kept so we can detect and migrate docs
/// created before the ISO switch; never emitted going forward.
fn legacy_voice_memo_daily_title_for_local_date() -> String {
    let d = chrono::Local::now().date_naive();
    format!("Voice Memos — {}/{}/{}", d.month(), d.day(), d.year())
}

/// Rename a legacy-titled voice memo doc to its ISO equivalent.  Rewrites the
/// vault file at the new slug, deletes the old file, and updates vault_rel_path.
/// Returns the fresh node on success.
///
/// Safe to call on the voice-memo write path: the operation is idempotent and
/// any failure is logged but doesn't block transcription append.
async fn migrate_legacy_voice_memo_title(
    app: &AppHandle,
    state: &AppState,
    node: &crate::managers::workspace::WorkspaceNode,
    new_title: &str,
) -> Result<crate::managers::workspace::WorkspaceNode, String> {
    info!(
        "[voice-memo] Migrating daily-note title '{}' → '{}'",
        node.name, new_title
    );
    let updated = state
        .workspace_manager
        .update_node(&node.id, new_title, &node.icon, &node.properties, &node.body)
        .await?;

    let old_rel_path = node.vault_rel_path.clone();
    if let Ok(new_rel_path) = state
        .workspace_manager
        .write_node_to_vault(app, &updated, None)
        .await
    {
        if let Some(old) = old_rel_path.as_deref() {
            if old != new_rel_path {
                let old_file = crate::app_identity::resolve_vault_root(app).join(old);
                if old_file.exists() {
                    if let Err(e) = std::fs::remove_file(&old_file) {
                        warn!(
                            "[voice-memo] Failed to remove legacy vault file {}: {}",
                            old_file.display(),
                            e
                        );
                    }
                }
            }
        }
        if let Err(e) = state
            .workspace_manager
            .update_vault_rel_path(&updated.id, &new_rel_path)
            .await
        {
            error!(
                "[voice-memo] Failed to update vault_rel_path after title migration for {}: {}",
                updated.id, e
            );
        }
    }
    Ok(updated)
}

fn create_markdown_note_content(transcription: &str) -> String {
    transcription.trim().to_string()
}

fn append_markdown_note_content(existing_content: &str, transcription: &str) -> String {
    let existing = existing_content.trim();
    let new_text = transcription.trim();
    if existing.is_empty() {
        return new_text.to_string();
    }
    if new_text.is_empty() {
        return existing.to_string();
    }
    format!("{existing}\n\n{new_text}")
}

fn directive_escape_path(path: &str) -> String {
    path.replace('\\', "\\\\").replace('"', "\\\"")
}

/// One markdown leaf block per recording clip (rendered inside MDX) + transcript text.
fn voice_memo_recording_block(audio_path: &str, transcription: &str) -> String {
    format!(
        "::voice_memo_recording{{path=\"{}\"}}\n\n{}",
        directive_escape_path(audio_path),
        transcription.trim()
    )
}

/// Append one recording clip to an existing Mic Transcribe daily doc (workspace.db only).
///
/// Reads the current body via `get_node`, appends the `::voice_memo_recording{path="..."}`
/// directive + transcript text, and persists via `update_node_body_persist_only`.
/// Mirror props (`voice_memo_mirror.audio_file_path`) are kept in sync for the UI pill.
async fn append_transcription_to_voice_doc(
    app: &AppHandle,
    state: &AppState,
    existing_doc: &crate::managers::workspace::WorkspaceNode,
    transcription: &str,
    audio_file_path: Option<String>,
) {
    let appended_body = match audio_file_path.as_ref() {
        Some(p) if !p.trim().is_empty() => voice_memo_recording_block(p, transcription),
        _ => transcription.trim().to_string(),
    };
    let next_body = append_markdown_note_content(&existing_doc.body, appended_body.as_str());

    match state
        .workspace_manager
        .update_node_body_persist_only(&existing_doc.id, &next_body)
        .await
    {
        Ok(updated) => {
            if let Some(ref p) = audio_file_path {
                if !p.trim().is_empty() {
                    if let Err(e) = state
                        .workspace_manager
                        .update_voice_memo_mirror_audio_path(&updated.id, Some(p.as_str()))
                        .await
                    {
                        error!("Voice memo mirror audio_path update: {e}");
                    }
                }
            }
            match state.workspace_manager.write_node_to_vault(app, &updated, None).await {
                Ok(rel_path) => {
                    if let Err(e) = state.workspace_manager.update_vault_rel_path(&updated.id, &rel_path).await {
                        error!("Failed to update vault_rel_path for voice memo {}: {}", updated.id, e);
                    }
                }
                Err(e) => {
                    error!("Failed to write voice memo {} to vault: {}", updated.id, e);
                }
            }
            transcription_workspace::emit_workspace_node_body_updated_throttled(app, &updated);
        }
        Err(error) => {
            error!(
                "Failed to append transcription to voice doc {}: {}",
                existing_doc.id, error
            );
        }
    }
}

/// Auto-create / append to today's voice-memo daily doc under `Mic Transcribe`.
///
/// Resolution order:
///   1. `VoiceSessionManager.get_workspace_doc_id()` if alive + title matches today.
///   2. First live child of Mic Transcribe folder whose `name == today_title`.
///   3. New child document with `voice_memo_mirror` properties.
///
/// Single source of truth: `workspace_nodes`. No `notes.db` writes on this path.
async fn maybe_create_note_from_transcription(
    app: &AppHandle,
    transcription: &str,
    audio_file_path: Option<String>,
) {
    let settings = get_settings(app);
    if !settings.auto_create_note {
        return;
    }

    let Some(state) = app.try_state::<Arc<AppState>>() else {
        warn!("AppState missing; skipping voice-memo workspace write");
        return;
    };
    let Some(voice_session_manager) = app.try_state::<Arc<VoiceSessionManager>>() else {
        warn!("VoiceSessionManager missing; skipping voice-memo workspace write");
        return;
    };
    let today_title = voice_memo_daily_title_for_local_date();
    let legacy_title = legacy_voice_memo_daily_title_for_local_date();

    // 1. Reuse active session doc if still alive + titled today.
    if let Some(cached_id) = voice_session_manager.get_workspace_doc_id() {
        match state.workspace_manager.get_node(&cached_id).await {
            Ok(Some(node))
                if node.deleted_at.is_none()
                    && (node.name == today_title || node.name == legacy_title) =>
            {
                // Back-compat: if the cached doc is still on the legacy title,
                // migrate it to ISO before appending (see step 2 for rationale).
                let working = if node.name == legacy_title {
                    match migrate_legacy_voice_memo_title(app, state.as_ref(), &node, &today_title).await {
                        Ok(renamed) => renamed,
                        Err(e) => {
                            error!("Voice memo title migration failed for {}: {e}", node.id);
                            node
                        }
                    }
                } else {
                    node
                };
                append_transcription_to_voice_doc(
                    app,
                    state.as_ref(),
                    &working,
                    transcription,
                    audio_file_path,
                )
                .await;
                return;
            }
            Ok(_) => {
                // Stale pointer (deleted, renamed, or rolled over past midnight) — clear it.
                transcription_workspace::finalize_voice_workspace_mirror(app).await;
                voice_session_manager.clear();
            }
            Err(e) => error!("Voice memo cached doc lookup failed: {e}"),
        }
    }

    // 2. Resolve today's doc under Mic Transcribe by title.
    let folder_id = match state
        .workspace_manager
        .ensure_transcription_folder(app, transcription_workspace::MIC_TRANSCRIBE_FOLDER)
        .await
    {
        Ok(id) => id,
        Err(e) => {
            error!("ensure_transcription_folder (Mic Transcribe): {e}");
            return;
        }
    };

    let children = match state.workspace_manager.get_node_children(&folder_id).await {
        Ok(c) => c,
        Err(e) => {
            error!("get_node_children (Mic Transcribe): {e}");
            return;
        }
    };
    // Prefer ISO-titled doc; fall back to legacy once-per-day for migration.
    let existing_match = {
        let mut iso_match = None;
        let mut legacy_match = None;
        for c in children {
            if c.deleted_at.is_some() || c.node_type != "document" {
                continue;
            }
            if c.name == today_title && iso_match.is_none() {
                iso_match = Some(c);
            } else if c.name == legacy_title && legacy_match.is_none() {
                legacy_match = Some(c);
            }
        }
        iso_match.or(legacy_match)
    };

    if let Some(existing) = existing_match {
        // If legacy, rename to ISO before using — this also rewrites the
        // vault file at the new slug and deletes the old one (cascade runs
        // automatically via update_node's rename path).
        let working = if existing.name == legacy_title {
            match migrate_legacy_voice_memo_title(app, state.as_ref(), &existing, &today_title).await {
                Ok(renamed) => renamed,
                Err(e) => {
                    error!("Voice memo title migration failed for {}: {e}", existing.id);
                    existing
                }
            }
        } else {
            existing
        };
        voice_session_manager.set_workspace_doc_id(Some(working.id.clone()));
        append_transcription_to_voice_doc(
            app,
            state.as_ref(),
            &working,
            transcription,
            audio_file_path,
        )
        .await;
        return;
    }

    // 3. No daily doc yet — create it with the first recording block.
    let initial_body = match audio_file_path.as_ref() {
        Some(p) if !p.trim().is_empty() => voice_memo_recording_block(p, transcription),
        _ => create_markdown_note_content(transcription),
    };
    let recorded_at_ms = chrono::Utc::now().timestamp_millis();
    let audio_path_json = match audio_file_path.as_ref() {
        Some(p) if !p.trim().is_empty() => serde_json::json!(p),
        _ => serde_json::Value::Null,
    };
    // `note_id` kept for frontend compatibility (WorkspaceLayout.parseVoiceMemoMirror
    // requires a non-empty string). With notes.db out of the loop it self-references
    // the workspace node id; this is set after creation.
    let initial_props = serde_json::json!({
        "voice_memo_mirror": {
            "note_id": "",
            "recorded_at_ms": recorded_at_ms,
            "audio_file_path": audio_path_json,
        }
    })
    .to_string();

    let created = match state
        .workspace_manager
        .create_document_child_with_properties(
            &folder_id,
            &today_title,
            "🎙️",
            &initial_body,
            &initial_props,
        )
        .await
    {
        Ok(n) => n,
        Err(e) => {
            error!("Failed to create voice-memo daily doc: {e}");
            return;
        }
    };

    // Patch mirror props to self-reference the newly-minted workspace node id so the
    // "Recorded at" pill renders (parseVoiceMemoMirror requires noteId non-empty).
    let final_props = serde_json::json!({
        "voice_memo_mirror": {
            "note_id": &created.id,
            "recorded_at_ms": recorded_at_ms,
            "audio_file_path": audio_path_json,
        }
    })
    .to_string();
    if let Err(e) = state
        .workspace_manager
        .update_node_properties(&created.id, &final_props)
        .await
    {
        error!("Voice memo mirror props self-ref patch: {e}");
    }

    match state.workspace_manager.write_node_to_vault(app, &created, None).await {
        Ok(rel_path) => {
            if let Err(e) = state.workspace_manager.update_vault_rel_path(&created.id, &rel_path).await {
                error!("Failed to update vault_rel_path for newly created voice note {}: {}", created.id, e);
            }
        }
        Err(e) => {
            error!("Failed to write newly created voice note {} to vault: {}", created.id, e);
        }
    }
    voice_session_manager.set_workspace_doc_id(Some(created.id.clone()));
    transcription_workspace::emit_workspace_transcription_synced(app, &created.id, "voice_memo");
}

pub(crate) async fn process_transcription_output(
    app: &AppHandle,
    transcription: &str,
    post_process: bool,
) -> ProcessedTranscription {
    let settings = get_settings(app);
    let mut final_text = transcription.to_string();
    let mut post_processed_text: Option<String> = None;
    let mut post_process_prompt: Option<String> = None;

    if let Some(converted_text) = maybe_convert_chinese_variant(&settings, transcription).await {
        final_text = converted_text;
    }

    if post_process {
        if let Some(processed_text) = post_process_transcription(&settings, &final_text).await {
            post_processed_text = Some(processed_text.clone());
            final_text = processed_text;

            if let Some(prompt_id) = &settings.post_process_selected_prompt_id {
                if let Some(prompt) = settings
                    .post_process_prompts
                    .iter()
                    .find(|prompt| &prompt.id == prompt_id)
                {
                    post_process_prompt = Some(prompt.prompt.clone());
                }
            }
        }
    } else if final_text != transcription {
        post_processed_text = Some(final_text.clone());
    }

    ProcessedTranscription {
        final_text,
        post_processed_text,
        post_process_prompt,
    }
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);

        // Load model in the background
        let tm = app.state::<Arc<TranscriptionManager>>();
        let rm = app.state::<Arc<AudioRecordingManager>>();

        // Load ASR model and VAD model in parallel
        tm.initiate_model_load();
        let rm_clone = Arc::clone(&rm);
        std::thread::spawn(move || {
            if let Err(e) = rm_clone.preload_vad() {
                debug!("VAD pre-load failed: {}", e);
            }
        });

        let binding_id = binding_id.to_string();
        change_tray_icon(app, TrayIconState::Recording);
        show_recording_overlay(app);

        // Get the microphone mode to determine audio feedback timing
        let settings = get_settings(app);
        let is_always_on = settings.always_on_microphone;
        debug!("Microphone mode - always_on: {}", is_always_on);

        let mut recording_error: Option<String> = None;
        if is_always_on {
            // Always-on mode: Play audio feedback immediately, then apply mute after sound finishes
            debug!("Always-on mode: Playing audio feedback immediately");
            let rm_clone = Arc::clone(&rm);
            let app_clone = app.clone();
            // The blocking helper exits immediately if audio feedback is disabled,
            // so we can always reuse this thread to ensure mute happens right after playback.
            std::thread::spawn(move || {
                play_feedback_sound_blocking(&app_clone, SoundType::Start);
                rm_clone.apply_mute();
            });

            if let Err(e) = rm.try_start_recording(&binding_id) {
                debug!("Recording failed: {}", e);
                recording_error = Some(e);
            }
        } else {
            // On-demand mode: Start recording first, then play audio feedback, then apply mute
            // This allows the microphone to be activated before playing the sound
            debug!("On-demand mode: Starting recording first, then audio feedback");
            let recording_start_time = Instant::now();
            match rm.try_start_recording(&binding_id) {
                Ok(()) => {
                    debug!("Recording started in {:?}", recording_start_time.elapsed());
                    // Small delay to ensure microphone stream is active
                    let app_clone = app.clone();
                    let rm_clone = Arc::clone(&rm);
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        debug!("Handling delayed audio feedback/mute sequence");
                        // Helper handles disabled audio feedback by returning early, so we reuse it
                        // to keep mute sequencing consistent in every mode.
                        play_feedback_sound_blocking(&app_clone, SoundType::Start);
                        rm_clone.apply_mute();
                    });
                }
                Err(e) => {
                    debug!("Failed to start recording: {}", e);
                    recording_error = Some(e);
                }
            }
        }

        if recording_error.is_none() {
            // Dynamically register the cancel shortcut in a separate task to avoid deadlock
            shortcut::register_cancel_shortcut(app);
        } else {
            // Starting failed (for example due to blocked microphone permissions).
            // Revert UI state so we don't stay stuck in the recording overlay.
            utils::hide_recording_overlay(app);
            change_tray_icon(app, TrayIconState::Idle);
            if let Some(err) = recording_error {
                let error_type = if is_microphone_access_denied(&err) {
                    "microphone_permission_denied"
                } else if is_no_input_device_error(&err) {
                    "no_input_device"
                } else {
                    "unknown"
                };
                let _ = app.emit(
                    "recording-error",
                    RecordingErrorEvent {
                        error_type: error_type.to_string(),
                        detail: Some(err),
                    },
                );
            }
        }

        debug!(
            "TranscribeAction::start completed in {:?}",
            start_time.elapsed()
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        // Unregister the cancel shortcut when transcription stops
        shortcut::unregister_cancel_shortcut(app);

        let stop_time = Instant::now();
        debug!("TranscribeAction::stop called for binding: {}", binding_id);

        let ah = app.clone();
        let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
        let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
        let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());

        change_tray_icon(app, TrayIconState::Transcribing);
        show_transcribing_overlay(app);

        // Unmute before playing audio feedback so the stop sound is audible
        rm.remove_mute();

        // Play audio feedback for recording stop
        play_feedback_sound(app, SoundType::Stop);

        let binding_id = binding_id.to_string(); // Clone binding_id for the async task
        let post_process = self.post_process;

        tauri::async_runtime::spawn(async move {
            let _guard = FinishGuard(ah.clone());
            debug!(
                "Starting async transcription task for binding: {}",
                binding_id
            );

            let stop_recording_time = Instant::now();
            if let Some(samples) = rm.stop_recording(&binding_id) {
                debug!(
                    "Recording stopped and samples retrieved in {:?}, sample count: {}",
                    stop_recording_time.elapsed(),
                    samples.len()
                );

                if samples.is_empty() {
                    debug!("Recording produced no audio samples; skipping persistence");
                    finalize_transcription_ui(&ah);
                } else {
                    // Save WAV concurrently with transcription
                    let sample_count = samples.len();
                    let file_name = format!("handy-{}.wav", chrono::Utc::now().timestamp());
                    let wav_path = hm.recordings_dir().join(&file_name);
                    let wav_path_for_verify = wav_path.clone();
                    let samples_for_wav = samples.clone();
                    let wav_handle = tauri::async_runtime::spawn_blocking(move || {
                        crate::audio_toolkit::save_wav_file(&wav_path, &samples_for_wav)
                    });

                    // Transcribe concurrently with WAV save
                    let transcription_time = Instant::now();
                    let transcription_result = tm.transcribe(samples);

                    // Await WAV save and verify
                    let wav_saved = match wav_handle.await {
                        Ok(Ok(())) => {
                            match crate::audio_toolkit::verify_wav_file(
                                &wav_path_for_verify,
                                sample_count,
                            ) {
                                Ok(()) => true,
                                Err(e) => {
                                    error!("WAV verification failed: {}", e);
                                    false
                                }
                            }
                        }
                        Ok(Err(e)) => {
                            error!("Failed to save WAV file: {}", e);
                            false
                        }
                        Err(e) => {
                            error!("WAV save task panicked: {}", e);
                            false
                        }
                    };

                    match transcription_result {
                        Ok(transcription) => {
                            debug!(
                                "Transcription completed in {:?}: '{}'",
                                transcription_time.elapsed(),
                                transcription
                            );

                            if post_process {
                                show_processing_overlay(&ah);
                            }
                            let processed =
                                process_transcription_output(&ah, &transcription, post_process)
                                    .await;

                            // Save to history if WAV was saved
                            if wav_saved {
                                if let Err(err) = hm.save_entry(
                                    file_name,
                                    transcription.clone(),
                                    post_process,
                                    processed.post_processed_text.clone(),
                                    processed.post_process_prompt.clone(),
                                ) {
                                    error!("Failed to save history entry: {}", err);
                                }
                            }

                            let note_audio_path = if wav_saved {
                                Some(wav_path_for_verify.to_string_lossy().to_string())
                            } else {
                                None
                            };
                            maybe_create_note_from_transcription(
                                &ah,
                                &transcription,
                                note_audio_path,
                            )
                            .await;

                            if processed.final_text.is_empty() {
                                finalize_transcription_ui(&ah);
                            } else {
                                let output_settings = get_settings(&ah);
                                let should_dispatch_output = output_settings.paste_method
                                    != PasteMethod::None
                                    || output_settings.clipboard_handling
                                        == ClipboardHandling::CopyToClipboard;

                                if should_dispatch_output {
                                    let ah_clone = ah.clone();
                                    let paste_time = Instant::now();
                                    let final_text = processed.final_text;
                                    debug!("Dispatching output handling to main thread");
                                    // Only dispatch the paste operation to the main thread —
                                    // paste() requires the UI thread on Windows because
                                    // clipboard and input APIs are message-pump-bound.
                                    let paste_result = ah.run_on_main_thread(move || {
                                        match utils::paste(final_text, ah_clone.clone()) {
                                            Ok(()) => debug!(
                                                "Text pasted successfully in {:?}",
                                                paste_time.elapsed()
                                            ),
                                            Err(e) => {
                                                error!("Failed to paste transcription: {}", e)
                                            }
                                        }
                                    });
                                    if let Err(e) = paste_result {
                                        error!("Failed to run paste on main thread: {:?}", e);
                                    }
                                } else {
                                    debug!(
                                        "Skipping output dispatch because paste and clipboard output are disabled"
                                    );
                                }
                                finalize_transcription_ui(&ah);
                            }
                        }
                        Err(err) => {
                            debug!("Global Shortcut Transcription error: {}", err);
                            // Save entry with empty text so user can retry
                            if wav_saved {
                                if let Err(save_err) = hm.save_entry(
                                    file_name,
                                    String::new(),
                                    post_process,
                                    None,
                                    None,
                                ) {
                                    error!("Failed to save failed history entry: {}", save_err);
                                }
                            }
                            finalize_transcription_ui(&ah);
                        }
                    }
                }
            } else {
                debug!("No samples retrieved from recording stop");
                finalize_transcription_ui(&ah);
            }
        });

        debug!(
            "TranscribeAction::stop completed in {:?}",
            stop_time.elapsed()
        );
    }
}

// Cancel Action
struct CancelAction;

impl ShortcutAction for CancelAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        utils::cancel_current_operation(app);
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Nothing to do on stop for cancel
    }
}

// Test Action
struct TestAction;

impl ShortcutAction for TestAction {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Started - {} (App: {})", // Changed "Pressed" to "Started" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Stopped - {} (App: {})", // Changed "Released" to "Stopped" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }
}

// Static Action Map
pub static ACTION_MAP: Lazy<HashMap<String, Arc<dyn ShortcutAction>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    map.insert(
        "transcribe".to_string(),
        Arc::new(TranscribeAction {
            post_process: false,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "transcribe_with_post_process".to_string(),
        Arc::new(TranscribeAction { post_process: true }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "cancel".to_string(),
        Arc::new(CancelAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "test".to_string(),
        Arc::new(TestAction) as Arc<dyn ShortcutAction>,
    );
    map
});

#[cfg(test)]
mod tests {
    use super::{append_markdown_note_content, create_markdown_note_content};

    #[test]
    fn create_markdown_note_content_returns_trimmed_text() {
        let content = create_markdown_note_content("  Hello world  ");
        assert_eq!(content, "Hello world");
    }

    #[test]
    fn append_markdown_note_content_joins_with_blank_line() {
        let existing = create_markdown_note_content("First transcript");
        let updated = append_markdown_note_content(&existing, "Second transcript");
        assert_eq!(updated, "First transcript\n\nSecond transcript");
    }

}
