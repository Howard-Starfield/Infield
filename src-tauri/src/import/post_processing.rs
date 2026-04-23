//! Post-processing for long-form file import (chunked when transcript is long).

use crate::settings::{get_settings, AppSettings, PostProcessProvider};
use tauri::AppHandle;

const CHUNK_THRESHOLD_CHARS: usize = 40_000;
const TARGET_CHUNK_CHARS: usize = 10_000;

fn strip_invisible_chars(s: &str) -> String {
    s.replace(['\u{200B}', '\u{200C}', '\u{200D}', '\u{FEFF}'], "")
}

fn chunk_context(i: usize, n: usize) -> &'static str {
    if n <= 1 {
        ""
    } else if i == 0 {
        "This is the beginning of the transcript."
    } else if i + 1 == n {
        "This is the end of the transcript."
    } else {
        "This is a middle section of a longer transcript. Do not add any introduction, summary, or wrap-up — continue naturally from the previous section."
    }
}

fn split_into_chunks(body: &str) -> Vec<String> {
    if body.chars().count() <= CHUNK_THRESHOLD_CHARS {
        return vec![body.to_string()];
    }
    let mut pieces: Vec<String> = Vec::new();
    let mut cur = String::new();
    for para in body.split("\n\n") {
        if cur.chars().count() + para.chars().count() + 2 > TARGET_CHUNK_CHARS && !cur.is_empty() {
            pieces.push(cur.trim().to_string());
            cur = para.to_string();
        } else if cur.is_empty() {
            cur = para.to_string();
        } else {
            cur.push_str("\n\n");
            cur.push_str(para);
        }
    }
    if !cur.trim().is_empty() {
        pieces.push(cur.trim().to_string());
    }
    if pieces.is_empty() {
        vec![body.to_string()]
    } else {
        pieces
    }
}

fn resolve_import_prompt_template(settings: &AppSettings) -> Option<String> {
    let id = settings
        .import_post_process_prompt_id
        .as_deref()
        .unwrap_or("default_clean_long_form");
    settings
        .post_process_prompts
        .iter()
        .find(|p| p.id == id)
        .map(|p| p.prompt.clone())
}

async fn llm_clean_chunk(
    settings: &AppSettings,
    provider: &PostProcessProvider,
    api_key: String,
    model: &str,
    prompt_template: &str,
    chunk: &str,
    chunk_ctx: &str,
) -> Option<String> {
    let mut prompt = prompt_template.to_string();
    prompt = prompt.replace("${chunk_context}", chunk_ctx);
    prompt = prompt.replace("${output}", chunk);
    match crate::llm_client::send_chat_completion(
        provider,
        api_key,
        model,
        prompt,
        Some(settings.local_llm_num_ctx),
    )
    .await
    {
        Ok(Some(content)) => Some(strip_invisible_chars(&content)),
        _ => None,
    }
}

/// Run post-processing for a completed import transcript (single or chunked LLM pass).
pub async fn post_process_import_transcript(app: &AppHandle, raw: &str) -> String {
    let settings = get_settings(app);
    if !settings.post_process_enabled {
        return raw.to_string();
    }
    let Some(prompt_template) = resolve_import_prompt_template(&settings) else {
        return raw.to_string();
    };
    let Some(provider) = settings.active_post_process_provider().cloned() else {
        return raw.to_string();
    };
    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();
    if model.trim().is_empty() {
        return raw.to_string();
    }
    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let chunks = split_into_chunks(raw);
    let n = chunks.len();
    if n == 1 {
        let ctx = chunk_context(0, 1);
        return llm_clean_chunk(
            &settings,
            &provider,
            api_key,
            &model,
            &prompt_template,
            &chunks[0],
            ctx,
        )
        .await
        .unwrap_or_else(|| raw.to_string());
    }

    let mut out = Vec::new();
    for (i, ch) in chunks.iter().enumerate() {
        let ctx = chunk_context(i, n);
        let piece = llm_clean_chunk(
            &settings,
            &provider,
            api_key.clone(),
            &model,
            &prompt_template,
            ch,
            ctx,
        )
        .await
        .unwrap_or_else(|| ch.clone());
        out.push(piece);
    }
    out.join("\n\n")
}
