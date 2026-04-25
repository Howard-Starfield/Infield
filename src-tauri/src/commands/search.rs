use std::sync::Arc;

use log::info;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::managers::embedding_ort::{
    EmbeddingModelInfo, InferenceHandle, EMBEDDING_DIM, MODEL_ID, MODEL_NAME,
};
use crate::managers::embedding_worker::EmbeddingWorker;
use crate::managers::search::{
    SearchManager, WorkspaceSearchResult, WorkspaceTitleResult,
};
use crate::managers::workspace::AppState;

/// Extended status that includes the on-disk index file size.
///
/// Phase A migrated vectors into `vec_embeddings` (a sqlite-vec virtual
/// table inside `workspace.db`); "index file" is no longer a meaningful
/// concept — counts come from SQL `SELECT count(*)` against the table.
/// We keep the `index_size_bytes` field in the struct for shape-compat
/// with the frontend binding and return 0.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct VectorIndexStatus {
    pub dimension: usize,
    pub model_name: String,
    pub total_chunks: i64,
    pub stale_chunks: i64,
    pub is_empty: bool,
    pub index_size_bytes: u64,
    pub health: String, // "good" | "stale" | "empty"
}

/// Post-Commit-3: `notes_db_*` fields retired with NotesManager. Only
/// embedding availability flows through the footer status. If workspace.db
/// health probing ever lands, add `workspace_db_healthy` alongside.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct FooterSystemStatus {
    pub embedding_available: bool,
    pub embedding_summary: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_vector_index_status(
    app: AppHandle,
) -> Result<VectorIndexStatus, String> {
    // Query vec_embeddings directly. "Stale" is no longer meaningful under
    // Rule 19 (reindex-on-swap is automatic); report 0 and let the frontend
    // deprecate the badge at its leisure.
    let app_state = app.state::<Arc<AppState>>();
    let conn = app_state.workspace_manager.conn();
    let total_chunks: i64 = {
        let conn = conn.lock().await;
        conn.query_row("SELECT count(*) FROM vec_embeddings", [], |r| r.get(0))
            .map_err(|e| e.to_string())?
    };
    let is_empty = total_chunks == 0;
    Ok(VectorIndexStatus {
        dimension: EMBEDDING_DIM,
        model_name: MODEL_NAME.to_string(),
        total_chunks,
        stale_chunks: 0,
        is_empty,
        index_size_bytes: 0,
        health: if is_empty { "empty" } else { "good" }.to_string(),
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_footer_system_status(
    inference_handle: State<'_, Arc<InferenceHandle>>,
) -> Result<FooterSystemStatus, String> {
    let embedding_available = inference_handle.is_available();
    Ok(FooterSystemStatus {
        embedding_available,
        embedding_summary: if embedding_available {
            None
        } else {
            inference_handle
                .unavailable_reason()
                .map(|s| s.to_string())
                .or_else(|| Some("Embeddings offline".to_string()))
        },
    })
}

/// Model info surfaced to UI. Replaces the old `get_embedding_debug_info`
/// (deleted under D1b — runtime model swap removed). Returns identity info
/// + availability; frontend can key the Settings banner / bge-small row
/// off `is_available` plus the `vector-search-unavailable` event stream.
#[tauri::command]
#[specta::specta]
pub fn get_embedding_model_info(
    inference_handle: State<'_, Arc<InferenceHandle>>,
) -> EmbeddingModelStatus {
    EmbeddingModelStatus {
        model_id: MODEL_ID.to_string(),
        info: inference_handle.model_info(),
        is_available: inference_handle.is_available(),
        unavailable_reason: inference_handle.unavailable_reason().map(|s| s.to_string()),
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct EmbeddingModelStatus {
    pub model_id: String,
    pub info: EmbeddingModelInfo,
    pub is_available: bool,
    pub unavailable_reason: Option<String>,
}

// `search_notes_hybrid` deleted with NotesManager. Callers should use
// `search_workspace_hybrid` instead; workspace nodes are the only indexed
// surface post-Commit 3.

/// Rebuild the entire embedding index. Enqueues every live workspace node
/// for re-embed via `embed_backfill_queue`. The worker drains in the
/// background; `vector-search-unavailable` / `note-indexed` events stream
/// progress.
///
/// Unlike pre-flip, we don't "clear the index first" — the worker's per-node
/// transaction DELETEs existing rows before INSERTing fresh ones, so the
/// old vectors get replaced in-place. Prevents the "no search hits during
/// reindex" window that the old rebuild had.
#[tauri::command]
#[specta::specta]
pub async fn reindex_all_embeddings(app: AppHandle) -> Result<usize, String> {
    let embedding_worker = app.state::<Arc<EmbeddingWorker>>();
    let app_state = app.state::<Arc<AppState>>();
    let workspace_summaries = app_state
        .workspace_manager
        .all_workspace_index_summaries()
        .await
        .unwrap_or_else(|e| {
            log::warn!("Failed to enumerate workspace nodes for reindex: {e}");
            Vec::new()
        });
    let total_workspace = workspace_summaries.len();
    let mut queued_workspace = 0usize;
    for (node_id, plain_text) in workspace_summaries {
        if !plain_text.trim().is_empty() {
            embedding_worker.enqueue_index(node_id, plain_text);
            queued_workspace += 1;
        }
    }

    info!(
        "Reindex started: {queued_workspace} workspace nodes queued \
         (of {total_workspace} eligible)"
    );
    let _ = app.emit(
        "reindex-started",
        serde_json::json!({
            "total_workspace_nodes": total_workspace,
            "queued_workspace_nodes": queued_workspace,
            "queued_total": queued_workspace,
        }),
    );

    Ok(queued_workspace)
}

/// Hybrid search for workspace nodes (FTS + vector, merged via RRF).
/// W3 adds optional filters for node_type, tags, date range, and pagination.
#[tauri::command]
#[specta::specta]
pub async fn search_workspace_hybrid(
    search_manager: State<'_, Arc<SearchManager>>,
    query: String,
    limit: Option<usize>,
    offset: Option<usize>,
    node_types: Option<Vec<String>>,
    tags: Option<Vec<String>>,
    created_from: Option<i64>,
    created_to: Option<i64>,
) -> Result<Vec<WorkspaceSearchResult>, String> {
    search_manager
        .hybrid_search_workspace_filtered(
            &query,
            limit.unwrap_or(20),
            offset.unwrap_or(0),
            node_types.unwrap_or_default(),
            tags.unwrap_or_default(),
            created_from,
            created_to,
        )
        .await
        .map_err(|e| e.to_string())
}

/// Title-only search for workspace nodes (wikilink autocomplete).
#[tauri::command]
#[specta::specta]
pub fn search_workspace_title(
    search_manager: State<'_, Arc<SearchManager>>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<WorkspaceTitleResult>, String> {
    search_manager
        .workspace_title_search(&query, limit.unwrap_or(10))
        .map_err(|e| e.to_string())
}
