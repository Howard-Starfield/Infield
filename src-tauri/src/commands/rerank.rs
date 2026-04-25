//! Tauri commands for Stage 4 reranking + model download.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

use crate::managers::reranker_cache::{RerankCacheKey, RerankerCache};
use crate::managers::reranker_download::RerankerDownload;
use crate::managers::reranker_ort::{
    RerankCandidate, RerankResult, RerankerHandle, RerankerModelInfo,
};

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct RerankerStatus {
    pub model_info: RerankerModelInfo,
    pub is_available: bool,
    pub unavailable_reason: Option<String>,
    pub model_downloaded: bool,
}

/// Stage 4: re-score top-N candidates via cross-encoder. Returns null on
/// timeout, model unavailable, or internal error — caller falls back to RRF.
#[tauri::command]
#[specta::specta]
pub async fn rerank_candidates(
    handle: State<'_, Arc<RerankerHandle>>,
    cache: State<'_, Arc<RerankerCache>>,
    query: String,
    candidates: Vec<RerankCandidate>,
    limit: usize,
    timeout_ms: Option<u64>,
) -> Result<Option<Vec<RerankResult>>, String> {
    if candidates.is_empty() || query.trim().is_empty() {
        return Ok(Some(Vec::new()));
    }

    // Cache lookup.
    let ids: Vec<&str> = candidates.iter().map(|c| c.node_id.as_str()).collect();
    let key = RerankCacheKey::new(&query, &ids);
    if let Some(cached) = cache.get(&key) {
        return Ok(Some(cached.into_iter().take(limit).collect()));
    }

    let timeout = timeout_ms.unwrap_or(100);
    let result = handle.rerank(query, candidates, limit, timeout).await;

    if let Some(ref r) = result {
        cache.put(key, r.clone());
    }
    Ok(result)
}

/// Footer / settings status surface.
#[tauri::command]
#[specta::specta]
pub async fn get_reranker_status(
    handle: State<'_, Arc<RerankerHandle>>,
    download: State<'_, Arc<RerankerDownload>>,
) -> Result<RerankerStatus, String> {
    let _ = download; // model presence checked via handle's path
    Ok(RerankerStatus {
        model_info: handle.model_info(),
        is_available: handle.is_available(),
        unavailable_reason: handle.unavailable_reason().await,
        model_downloaded: handle.is_available(),
    })
}

/// Trigger lazy download. Frontend invokes this on first search if status
/// reports !is_available. Concurrent calls return the same in-flight result.
#[tauri::command]
#[specta::specta]
pub async fn download_reranker_model(
    download: State<'_, Arc<RerankerDownload>>,
) -> Result<(), String> {
    download
        .inner()
        .clone()
        .download_all()
        .await
        .map_err(|e| e.to_string())
}
