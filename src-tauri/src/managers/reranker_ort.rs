//! Cross-encoder reranker (Stage 4 of the search pipeline).
//!
//! Uses BAAI/bge-reranker-v2-m3 (XLM-RoBERTa-base, multilingual, 568 MB).
//! Lazy-downloaded to <app_data>/handy/models/bge-reranker-v2-m3/ on first
//! use; never bundled with the installer.
//!
//! Mirrors `embedding_ort::InferenceHandle` — dedicated `std::thread::spawn`
//! worker (Rule 16), bounded crossbeam request channel, sentinel +
//! restart-once. CPU only. Caps `intra_threads` to `num_cpus / 3` and
//! yields to the transcription session per Rule 16a.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI64};

use anyhow::Result;
use crossbeam_channel::Sender;
use serde::{Deserialize, Serialize};
use specta::Type;
use tokio::sync::{oneshot, RwLock};

pub const MODEL_ID: &str = "bge-reranker-v2-m3";
pub const MODEL_NAME: &str = "BAAI bge-reranker-v2-m3 (multilingual XLM-RoBERTa)";

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct RerankerModelInfo {
    pub model_id: String,
    pub model_hash: Option<String>,  // None until first load completes
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct RerankCandidate {
    pub node_id: String,
    pub title: String,
    pub excerpt: String,  // first ~512 chars of body
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct RerankResult {
    pub node_id: String,
    pub rerank_score: f32,        // sigmoid(logit), 0..1
    pub original_rank: usize,     // 0-based position in input
}

pub(crate) struct RerankRequest {
    pub query: String,
    pub candidates: Vec<RerankCandidate>,
    pub limit: usize,
    pub response_tx: oneshot::Sender<Result<Vec<RerankResult>>>,
}

pub struct RerankerHandle {
    request_tx: Sender<RerankRequest>,
    is_available: Arc<AtomicBool>,
    unavailable_reason: Arc<RwLock<Option<String>>>,
    last_heartbeat: Arc<AtomicI64>,
    model_path: PathBuf,
}

impl RerankerHandle {
    /// Spawn the worker thread + sentinel. Idle until first request.
    pub fn spawn(model_path: PathBuf) -> Arc<Self> {
        let (request_tx, _request_rx) = crossbeam_channel::bounded::<RerankRequest>(8);
        let is_available = Arc::new(AtomicBool::new(false));
        let unavailable_reason = Arc::new(RwLock::new(Some("not_yet_loaded".to_string())));
        let last_heartbeat = Arc::new(AtomicI64::new(0));

        // TODO Task 3: spawn worker + sentinel here.

        Arc::new(Self {
            request_tx,
            is_available,
            unavailable_reason,
            last_heartbeat,
            model_path,
        })
    }

    pub fn is_available(&self) -> bool {
        self.is_available.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub async fn unavailable_reason(&self) -> Option<String> {
        self.unavailable_reason.read().await.clone()
    }

    pub fn model_info(&self) -> RerankerModelInfo {
        RerankerModelInfo {
            model_id: MODEL_ID.to_string(),
            model_hash: None,  // populated by Task 3 worker on session load
        }
    }

    /// Submit a rerank request. Returns `None` on timeout / unavailable.
    pub async fn rerank(
        &self,
        query: String,
        candidates: Vec<RerankCandidate>,
        limit: usize,
        timeout_ms: u64,
    ) -> Option<Vec<RerankResult>> {
        if !self.is_available() {
            return None;
        }
        let (response_tx, response_rx) = oneshot::channel();
        if self
            .request_tx
            .try_send(RerankRequest {
                query,
                candidates,
                limit,
                response_tx,
            })
            .is_err()
        {
            // Channel full — back-pressure visible.
            return None;
        }

        match tokio::time::timeout(
            std::time::Duration::from_millis(timeout_ms),
            response_rx,
        )
        .await
        {
            Ok(Ok(Ok(results))) => Some(results),
            _ => None,
        }
    }
}
