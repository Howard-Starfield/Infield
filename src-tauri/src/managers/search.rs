//! Search orchestration — FTS + vector via `vec_embeddings`.
//!
//! Post Phase A Commit 3: notes path deleted entirely. All search goes
//! through `workspace_fts` (keyword) + `vec_embeddings` (semantic), merged
//! via reciprocal rank fusion. The legacy `HybridSearchResult` + notes
//! `hybrid_search` surface have been retired.
//!
//! When `inference_handle.is_available() == false` every semantic path
//! returns empty and callers transparently fall back to FTS-only results
//! via the RRF merge (semantic contributes 0 candidates).

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use log::{info, warn};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use specta::Type;
use zerocopy::IntoBytes;

use crate::managers::embedding_ort::InferenceHandle;
use crate::managers::embedding_worker::EmbeddingWorker;
use crate::managers::workspace::WorkspaceManager;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct WorkspaceSearchResult {
    pub node_id: String,
    pub node_type: String,
    pub title: String,
    pub parent_name: Option<String>,
    pub icon: String,
    pub score: f64,
    pub keyword_rank: Option<usize>,
    pub semantic_rank: Option<usize>,
    pub excerpt: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct WorkspaceTitleResult {
    pub id: String,
    pub name: String,
    pub node_type: String,
    pub icon: String,
    pub parent_name: Option<String>,
}

pub struct SearchManager {
    inference_handle: Arc<InferenceHandle>,
    workspace_manager: Arc<WorkspaceManager>,
    embedding_worker: Arc<EmbeddingWorker>,
}

impl SearchManager {
    pub fn new(
        inference_handle: Arc<InferenceHandle>,
        workspace_manager: Arc<WorkspaceManager>,
        embedding_worker: Arc<EmbeddingWorker>,
    ) -> Self {
        Self {
            inference_handle,
            workspace_manager,
            embedding_worker,
        }
    }

    /// FTS-only search against workspace_fts. Returns (node_id, title, body, bm25_rank).
    pub async fn workspace_fts_search(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<WorkspaceFtsHit>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        let conn = self.workspace_manager.conn();
        let conn_locked = conn.lock().await;
        let limit = limit.clamp(1, 100);

        let escaped = trimmed.replace('"', "\"\"");
        let fts_query = format!("\"{}\"", escaped);

        let mut stmt = conn_locked.prepare(
            "SELECT node_id, title, body, bm25(workspace_fts) AS rank
             FROM workspace_fts
             WHERE workspace_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )?;

        let hits = stmt
            .query_map(params![fts_query, limit as i64], |row| {
                Ok(WorkspaceFtsHit {
                    node_id: row.get(0)?,
                    title: row.get(1)?,
                    body: row.get(2)?,
                    rank: row.get::<_, f64>("rank")?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(hits)
    }

    /// Hybrid search for workspace nodes: FTS + vec_embeddings KNN, merged
    /// via reciprocal rank fusion. When `InferenceHandle` is unavailable,
    /// semantic returns empty and the result is effectively FTS-only — the
    /// RRF merge handles this transparently.
    pub async fn hybrid_search_workspace(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<WorkspaceSearchResult>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        let limit = limit.clamp(1, 100);
        let fetch_limit = limit.saturating_mul(3);

        let fts_hits = self.workspace_fts_search(trimmed, fetch_limit).await?;
        let semantic_hits = self.workspace_semantic_search(trimmed, fetch_limit).await;

        let mut merged: HashMap<String, WorkspaceCandidate> = HashMap::new();

        for (index, hit) in fts_hits.into_iter().enumerate() {
            let rank = index + 1;
            let cand = merged.entry(hit.node_id.clone()).or_default();
            cand.keyword_rank = Some(rank);
            cand.title = hit.title;
            cand.body = hit.body;
            cand.score += reciprocal_rank_fusion(rank);
        }

        for (index, result) in semantic_hits.into_iter().enumerate() {
            let rank = index + 1;
            let cand = merged.entry(result.node_id.clone()).or_default();
            cand.semantic_rank = Some(rank);
            cand.score += reciprocal_rank_fusion(rank);
        }

        let mut results = Vec::new();
        for (node_id, mut cand) in merged {
            if cand.title.is_empty() {
                if let Ok(Some(node)) = self.workspace_manager.get_node(&node_id).await {
                    cand.title = node.name;
                }
            }

            let parent_name =
                if let Ok(Some(node)) = self.workspace_manager.get_node(&node_id).await {
                    if let Some(ref pid) = node.parent_id {
                        if let Ok(Some(parent)) = self.workspace_manager.get_node(pid).await {
                            Some(parent.name)
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };

            let excerpt = if cand.body.len() > 200 {
                Some(cand.body[..200].to_string())
            } else if cand.body.is_empty() {
                None
            } else {
                Some(cand.body.clone())
            };

            results.push(WorkspaceSearchResult {
                node_id,
                node_type: String::new(),
                title: cand.title,
                parent_name,
                icon: String::new(),
                score: cand.score,
                keyword_rank: cand.keyword_rank,
                semantic_rank: cand.semantic_rank,
                excerpt,
            });
        }

        results.sort_by(|l, r| {
            r.score
                .partial_cmp(&l.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(limit);

        Ok(results)
    }

    /// Title-only FTS search for wikilink autocomplete.
    pub fn workspace_title_search(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<WorkspaceTitleResult>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        let conn = self.workspace_manager.conn();
        let conn_locked = conn.blocking_lock();
        let limit = limit.clamp(1, 50);

        let escaped = trimmed.replace('"', "\"\"");
        let fts_query = format!("\"{}\"", escaped);

        let mut stmt = conn_locked.prepare(
            "SELECT w.node_id, w.title, n.icon,
                    (SELECT p.name FROM workspace_nodes p WHERE p.id = n.parent_id) AS parent_name
             FROM workspace_fts w
             JOIN workspace_nodes n ON n.id = w.node_id
             WHERE w.workspace_fts MATCH ?1
               AND n.deleted_at IS NULL
             ORDER BY bm25(w.workspace_fts)
             LIMIT ?2",
        )?;

        let results = stmt
            .query_map(params![fts_query, limit as i64], |row| {
                Ok(WorkspaceTitleResult {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    node_type: String::new(),
                    icon: row.get(2)?,
                    parent_name: row.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(results)
    }

    /// Enqueue a workspace node for vector indexing. Call this on update_node.
    pub fn enqueue_workspace_index(&self, node_id: String, plain_text: String) {
        self.embedding_worker.enqueue_index(node_id, plain_text);
    }

    /// Enqueue deletion of a workspace node from the vector index.
    #[allow(dead_code)]
    pub fn enqueue_workspace_delete(&self, node_id: String) {
        self.embedding_worker.enqueue_delete(node_id);
    }

    /// KNN over `vec_embeddings`. Returns one hit per matching (node_id,
    /// chunk_index) — the caller's RRF merge deduplicates by node_id.
    ///
    /// Short-circuits when `InferenceHandle` is unavailable (boot still
    /// loading, load failed, respawn exhausted) so the caller degrades to
    /// FTS-only without blocking.
    async fn workspace_semantic_search(
        &self,
        query: &str,
        limit: usize,
    ) -> Vec<WorkspaceVectorHit> {
        if !self.inference_handle.is_available() {
            info!("workspace_semantic_search: inference unavailable — FTS-only fallback");
            return Vec::new();
        }

        let query_vector = match self.inference_handle.embed(query.to_string()).await {
            Ok(v) => v,
            Err(e) => {
                warn!("workspace_semantic_search embed failed: {e}");
                return Vec::new();
            }
        };

        let query_bytes: Vec<u8> = query_vector.as_slice().as_bytes().to_vec();
        let conn = self.workspace_manager.conn();
        let conn_locked = conn.lock().await;
        let k = limit.clamp(1, 100) as i64;

        let mut stmt = match conn_locked.prepare(
            "SELECT node_id, chunk_index, distance
               FROM vec_embeddings
              WHERE embedding MATCH ?1
                AND k = ?2
              ORDER BY distance",
        ) {
            Ok(s) => s,
            Err(e) => {
                warn!("vec_embeddings prepare failed: {e}");
                return Vec::new();
            }
        };

        let hits = match stmt.query_map(params![query_bytes, k], |row| {
            Ok(WorkspaceVectorHit {
                node_id: row.get::<_, String>(0)?,
                chunk_index: row.get::<_, i64>(1)?,
                distance: row.get::<_, f64>(2)?,
            })
        }) {
            Ok(it) => it.filter_map(|r| r.ok()).collect::<Vec<_>>(),
            Err(e) => {
                warn!("vec_embeddings query_map failed: {e}");
                return Vec::new();
            }
        };

        hits
    }
}

pub(crate) struct WorkspaceFtsHit {
    node_id: String,
    title: String,
    body: String,
    #[allow(dead_code)]
    rank: f64,
}

struct WorkspaceVectorHit {
    node_id: String,
    #[allow(dead_code)]
    chunk_index: i64,
    #[allow(dead_code)]
    distance: f64,
}

#[derive(Default)]
struct WorkspaceCandidate {
    title: String,
    body: String,
    score: f64,
    keyword_rank: Option<usize>,
    semantic_rank: Option<usize>,
}

fn reciprocal_rank_fusion(rank: usize) -> f64 {
    1.0 / (60.0 + rank as f64)
}
