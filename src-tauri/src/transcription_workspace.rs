//! Shared workspace routing for microphone and system-audio transcriptions.
//!
//! Voice memo writes are now workspace-only (see CLAUDE.md Rule 9). The legacy
//! `on_voice_memo_note_*` / `resolve_or_create_voice_memo_mirror_doc_id` helpers
//! that bridged notes.db → workspace.db were removed with the double-write fix.

use crate::managers::voice_session::VoiceSessionManager;
use crate::managers::workspace::{AppState, WorkspaceNode};
use log::error;
use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// Minimum gap between `workspace-node-body-updated` emits per node (live transcript UI).
const BODY_EMIT_INTERVAL_MS: u64 = 1000;

static LAST_BODY_EMIT_MS_BY_NODE: Lazy<Mutex<HashMap<String, u64>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Root workspace folder for voice-memo documents. Tree icons: see `workspaceTranscriptionFolders.ts` + `WorkspaceTreeNodeIcon`.
pub const MIC_TRANSCRIBE_FOLDER: &str = "Mic Transcribe";
/// Root workspace folder for system-audio session docs. Tree icons: see `workspaceTranscriptionFolders.ts` + `WorkspaceTreeNodeIcon`.
pub const SYSTEM_AUDIO_FOLDER: &str = "System Audio";

#[derive(Clone, Serialize)]
pub struct WorkspaceTranscriptionSyncedPayload {
    pub node_id: String,
    pub source: String,
}

#[derive(Clone, Serialize)]
pub struct WorkspaceNodeBodyUpdatedPayload {
    pub node_id: String,
    pub body: String,
    pub updated_at: i64,
}

fn body_updated_payload(node: &WorkspaceNode) -> WorkspaceNodeBodyUpdatedPayload {
    WorkspaceNodeBodyUpdatedPayload {
        node_id: node.id.clone(),
        body: node.body.clone(),
        updated_at: node.updated_at,
    }
}

/// Push latest body to the UI (no throttle). Use after final persist so the editor never lags the last chunk.
pub fn emit_workspace_node_body_updated_immediate(app: &AppHandle, node: &WorkspaceNode) {
    let _ = app.emit(
        "workspace-node-body-updated",
        body_updated_payload(node),
    );
}

/// Throttle live body pushes to ~1s per workspace node id.
pub fn emit_workspace_node_body_updated_throttled(app: &AppHandle, node: &WorkspaceNode) {
    let now = now_ms();
    let mut map = LAST_BODY_EMIT_MS_BY_NODE.lock().unwrap();
    let last = map.get(&node.id).copied().unwrap_or(0);
    if now.saturating_sub(last) < BODY_EMIT_INTERVAL_MS {
        return;
    }
    map.insert(node.id.clone(), now);
    drop(map);
    emit_workspace_node_body_updated_immediate(app, node);
}

/// Fire `workspace-transcription-synced` so the frontend can auto-jump (voice_memo)
/// or just refresh tree metadata (system_audio) depending on `source`.
pub fn emit_workspace_transcription_synced(app: &AppHandle, node_id: &str, source: &str) {
    let _ = app.emit(
        "workspace-transcription-synced",
        WorkspaceTranscriptionSyncedPayload {
            node_id: node_id.to_string(),
            source: source.to_string(),
        },
    );
}

/// Re-run full indexing for the active voice workspace doc (after a transcribe session / append chain).
pub async fn finalize_active_voice_workspace_index(app: &AppHandle) {
    let Some(voice) = app.try_state::<Arc<VoiceSessionManager>>() else {
        return;
    };
    let Some(ws_id) = voice.get_workspace_doc_id() else {
        return;
    };
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return;
    };
    if let Err(e) = state
        .workspace_manager
        .finalize_node_search_index(&ws_id)
        .await
    {
        error!("finalize_active_voice_workspace_index: {e}");
    }
}

/// Finalize vector index for the active voice memo workspace doc and clear the session pointer.
pub async fn finalize_voice_workspace_mirror(app: &AppHandle) {
    let Some(ws_id) = app
        .try_state::<Arc<VoiceSessionManager>>()
        .and_then(|v| v.take_workspace_doc_id())
    else {
        return;
    };
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return;
    };
    if let Err(e) = state
        .workspace_manager
        .finalize_node_search_index(&ws_id)
        .await
    {
        error!("finalize_node_search_index for voice workspace doc: {e}");
    }
}
