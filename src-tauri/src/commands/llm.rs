use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::managers::llm::{LlmManager, LlmStatus};
use crate::settings::{get_default_settings, get_settings, write_settings, LLMPrompt};

const INTERNAL_NOTE_PROMPT_ID: &str = "auto_tag";
const BUILTIN_NOTE_PROMPT_IDS: &[&str] = &["auto_tag", "summarize", "action_items"];

// Phase A Commit 3 — `ask_ai` and `get_ai_responses` commands deleted with
// NotesManager. Both wrote to `notes.ai_responses` which no longer exists.
// If/when workspace-scoped AI-response storage is wanted, Phase G's
// Gemini/Vertex rewrite is the right home (same storage pattern, different
// backend). The `note_prompts` settings list survives — it's LLM config,
// not notes data, and may migrate to "document_prompts" or similar later.

#[tauri::command]
#[specta::specta]
pub async fn get_note_prompts(app_handle: AppHandle) -> Result<Vec<LLMPrompt>, String> {
    Ok(get_settings(&app_handle)
        .note_prompts
        .into_iter()
        .filter(|prompt| prompt.id != INTERNAL_NOTE_PROMPT_ID)
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn get_llm_status(llm_manager: State<'_, Arc<LlmManager>>) -> Result<LlmStatus, String> {
    Ok(llm_manager.status())
}

#[tauri::command]
#[specta::specta]
pub async fn add_note_prompt(
    app_handle: AppHandle,
    name: String,
    prompt: String,
) -> Result<LLMPrompt, String> {
    let trimmed_name = name.trim();
    let trimmed_prompt = prompt.trim();
    if trimmed_name.is_empty() {
        return Err("Prompt name cannot be empty".to_string());
    }
    if trimmed_prompt.is_empty() {
        return Err("Prompt body cannot be empty".to_string());
    }

    let mut settings = get_settings(&app_handle);
    let new_prompt = LLMPrompt {
        id: Uuid::new_v4().to_string(),
        name: trimmed_name.to_string(),
        prompt: trimmed_prompt.to_string(),
    };
    settings.note_prompts.push(new_prompt.clone());
    write_settings(&app_handle, settings);
    emit_note_prompt_settings_changed(&app_handle);
    Ok(new_prompt)
}

#[tauri::command]
#[specta::specta]
pub async fn update_note_prompt(
    app_handle: AppHandle,
    id: String,
    name: String,
    prompt: String,
) -> Result<(), String> {
    let trimmed_name = name.trim();
    let trimmed_prompt = prompt.trim();
    if trimmed_name.is_empty() {
        return Err("Prompt name cannot be empty".to_string());
    }
    if trimmed_prompt.is_empty() {
        return Err("Prompt body cannot be empty".to_string());
    }

    let mut settings = get_settings(&app_handle);
    let existing_prompt = settings
        .note_prompts
        .iter_mut()
        .find(|existing_prompt| existing_prompt.id == id)
        .ok_or_else(|| format!("Prompt '{}' not found", id))?;

    existing_prompt.name = trimmed_name.to_string();
    existing_prompt.prompt = trimmed_prompt.to_string();
    write_settings(&app_handle, settings);
    emit_note_prompt_settings_changed(&app_handle);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_note_prompt(app_handle: AppHandle, id: String) -> Result<(), String> {
    if BUILTIN_NOTE_PROMPT_IDS.contains(&id.as_str()) {
        return Err(format!("Built-in prompt '{}' cannot be deleted", id));
    }

    let mut settings = get_settings(&app_handle);
    let original_len = settings.note_prompts.len();
    settings.note_prompts.retain(|prompt| prompt.id != id);
    if settings.note_prompts.len() == original_len {
        return Err(format!("Prompt '{}' not found", id));
    }

    write_settings(&app_handle, settings);
    emit_note_prompt_settings_changed(&app_handle);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_default_note_prompts() -> Result<Vec<LLMPrompt>, String> {
    Ok(get_default_settings()
        .note_prompts
        .into_iter()
        .filter(|prompt| prompt.id != INTERNAL_NOTE_PROMPT_ID)
        .collect())
}

fn emit_note_prompt_settings_changed(app_handle: &AppHandle) {
    let _ = app_handle.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "note_prompts",
        }),
    );
}
