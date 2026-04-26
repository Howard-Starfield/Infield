//! Background embedding worker.
//!
//! Pulls pending work from the `embed_backfill_queue` SQLite table, chunks
//! each node's body, embeds every chunk via `InferenceHandle` (bge-small
//! ONNX — 384d), writes into `vec_embeddings`, and drops the queue row on
//! success or flips `state='error'` on failure.
//!
//! Phase A deliverable 10 (the flip): replaces the previous
//! `EmbeddingManager` + `VectorStore` (usearch) duo with an in-DB sqlite-vec
//! path. The worker owns its own `rusqlite::Connection` to `workspace.db`
//! — SQLite WAL mode handles multi-connection concurrency, and we avoid
//! contending for `WorkspaceManager`'s tokio mutex on the background path.
//!
//! Rule 16a: the drain loop yields to transcription via
//! `transcription_session_holds_model` before pulling each batch. Rule 19
//! reindex hook (`rule_19_reindex_check`) runs at lib.rs init; this worker
//! just drains whatever the queue has.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use log::{error, info, warn};
use rusqlite::{params_from_iter, Connection};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;
use zerocopy::IntoBytes;

use crate::managers::buddy::BuddyManager;
use crate::managers::chunking::ChunkPipeline;
use crate::managers::embedding_ort::InferenceHandle;
use crate::managers::transcription::transcription_session_holds_model;
use tauri::Manager;

/// Max rows pulled from `embed_backfill_queue` per drain iteration.
const BATCH_SIZE: usize = 10;

/// Sleep when the queue is empty and nothing has woken us up. The drain
/// loop races this timeout against `wake.notified()` so a fresh enqueue
/// takes effect within a few ms, but an idle app doesn't spin.
const DRAIN_IDLE_POLL: Duration = Duration::from_secs(5);

/// Tiny pause between batches when the queue has more work. Keeps the loop
/// from hot-spinning the CPU when there are thousands of pending nodes; at
/// ~10-20ms per embed on bge-small CPU, a 50ms gap per batch is noise.
const DRAIN_ACTIVE_POLL: Duration = Duration::from_millis(50);

/// How long to sleep between transcription-status polls before re-checking
/// whether we can process the next batch. Matches the original Rule 16a
/// gate cadence from the pre-flip worker.
const TRANSCRIPTION_GATE_POLL: Duration = Duration::from_millis(500);

pub struct EmbeddingWorker {
    app_handle: AppHandle,
    chunk_pipeline: Arc<ChunkPipeline>,
    inference_handle: Arc<InferenceHandle>,
    /// Worker-owned connection to `workspace.db`. Separate from
    /// `WorkspaceManager::conn` so the background drain loop doesn't
    /// contend for the main manager's tokio mutex on autosave/write paths.
    /// SQLite WAL supports the multi-connection reader+writer pattern.
    db: Arc<tokio::sync::Mutex<Connection>>,
    /// Wakes the drain loop immediately when `enqueue_index` writes a new
    /// row. Without this, new work waits up to `DRAIN_IDLE_POLL` (5s) before
    /// pickup — unacceptable for the "edit a note → re-embed" UX.
    wake: Arc<Notify>,
}

impl EmbeddingWorker {
    pub fn new(
        app_handle: &AppHandle,
        chunk_pipeline: Arc<ChunkPipeline>,
        inference_handle: Arc<InferenceHandle>,
        workspace_db_path: PathBuf,
    ) -> Arc<Self> {
        let conn = open_worker_conn(&workspace_db_path)
            .expect("embedding worker failed to open its workspace.db connection");

        let this = Arc::new(Self {
            app_handle: app_handle.clone(),
            chunk_pipeline,
            inference_handle,
            db: Arc::new(tokio::sync::Mutex::new(conn)),
            wake: Arc::new(Notify::new()),
        });

        // On boot, flip any rows left as `in_progress` back to `pending`.
        // A prior run may have crashed mid-embed — those rows need to be
        // picked up again rather than stuck forever in a non-terminal state.
        {
            let boot_this = this.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = boot_this.requeue_in_progress_on_boot().await {
                    warn!("requeue_in_progress_on_boot failed: {e}");
                }
                // Nudge the drain loop to pick up the resurrected work.
                boot_this.wake.notify_one();
            });
        }

        let drain_this = this.clone();
        tauri::async_runtime::spawn(async move {
            drain_this.drain_loop().await;
        });

        this
    }

    /// Request a fresh embed for `node_id`. Writes (or resets) a pending
    /// row in `embed_backfill_queue`, then wakes the drain loop.
    ///
    /// The `_note_plain_text` parameter is kept for call-site compatibility
    /// but ignored — the worker re-reads the current `name + body` from
    /// `workspace_nodes` at process time so we always embed the latest
    /// content (avoids stale-snapshot races when a user saves twice in
    /// quick succession).
    pub fn enqueue_index(&self, node_id: String, _note_plain_text: String) {
        let db = self.db.clone();
        let wake = self.wake.clone();
        tauri::async_runtime::spawn(async move {
            let conn = db.lock().await;
            let result = conn.execute(
                r#"
                INSERT INTO embed_backfill_queue
                    (node_id, chunk_index, state, attempts, last_error, enqueued_at)
                VALUES
                    (?1, 0, 'pending', 0, NULL,
                     CAST(strftime('%s','now') AS INTEGER))
                ON CONFLICT(node_id) DO UPDATE SET
                    state       = 'pending',
                    attempts    = 0,
                    last_error  = NULL,
                    enqueued_at = CAST(strftime('%s','now') AS INTEGER)
                "#,
                [node_id.as_str()],
            );
            if let Err(e) = result {
                warn!("enqueue_index write failed for {node_id}: {e}");
                return;
            }
            wake.notify_one();
        });
    }

    /// Delete all vectors for `node_id` + drop any pending queue row.
    /// Fire-and-forget; surfaces a `note-embeddings-deleted` event on success
    /// to unblock UI reindex-progress listeners.
    pub fn enqueue_delete(&self, node_id: String) {
        let db = self.db.clone();
        let app_handle = self.app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let conn = db.lock().await;
            let deleted_vecs = conn
                .execute(
                    "DELETE FROM vec_embeddings WHERE node_id = ?1",
                    [node_id.as_str()],
                )
                .unwrap_or_else(|e| {
                    warn!("enqueue_delete vec_embeddings for {node_id}: {e}");
                    0
                });
            let _ = conn.execute(
                "DELETE FROM embed_backfill_queue WHERE node_id = ?1",
                [node_id.as_str()],
            );
            if deleted_vecs > 0 {
                info!(
                    "embeddings deleted for {}: {} vector rows",
                    node_id, deleted_vecs
                );
            }
            emit_embedding_event(
                &app_handle,
                "note-embeddings-deleted",
                &EmbeddingEventPayload {
                    note_id: node_id,
                    chunk_count: 0,
                },
            );
        });
    }

    /// Idempotent boot-time hygiene: any rows left as `in_progress` are
    /// re-enqueued as `pending`. Covers mid-embed crashes without ever
    /// silently dropping work.
    async fn requeue_in_progress_on_boot(&self) -> Result<()> {
        let conn = self.db.lock().await;
        let n = conn
            .execute(
                "UPDATE embed_backfill_queue
                    SET state = 'pending',
                        last_error = NULL
                  WHERE state = 'in_progress'",
                [],
            )
            .map_err(|e| anyhow!("requeue in_progress: {e}"))?;
        if n > 0 {
            info!(
                "embedding worker: requeued {} rows stuck in 'in_progress' from prior run",
                n
            );
        }
        Ok(())
    }

    async fn drain_loop(&self) {
        loop {
            // Rule 16a — transcription gets the CPU while recording.
            if transcription_session_holds_model(&self.app_handle) {
                tokio::time::sleep(TRANSCRIPTION_GATE_POLL).await;
                continue;
            }

            // Wait for InferenceHandle readiness. Early in boot the handle
            // may still be loading; periodically retry without thrashing.
            if !self.inference_handle.is_available() {
                tokio::time::sleep(DRAIN_IDLE_POLL).await;
                continue;
            }

            let batch = match self.take_pending_batch(BATCH_SIZE).await {
                Ok(b) => b,
                Err(e) => {
                    error!("take_pending_batch: {e}");
                    tokio::time::sleep(DRAIN_IDLE_POLL).await;
                    continue;
                }
            };
            if batch.is_empty() {
                // Idle: wait for either a fresh enqueue or the idle timeout.
                tokio::select! {
                    _ = self.wake.notified() => {}
                    _ = tokio::time::sleep(DRAIN_IDLE_POLL) => {}
                }
                continue;
            }

            for (node_id, _chunk_index) in batch {
                self.process_queue_entry(&node_id).await;
            }

            tokio::time::sleep(DRAIN_ACTIVE_POLL).await;
        }
    }

    /// Atomically flip up to `n` pending rows to `in_progress` and return
    /// (node_id, chunk_index) pairs. The tx ensures a second worker thread
    /// (if any were ever added) can't claim the same rows.
    async fn take_pending_batch(&self, n: usize) -> Result<Vec<(String, i64)>> {
        let mut conn = self.db.lock().await;
        let tx = conn
            .transaction()
            .map_err(|e| anyhow!("begin batch tx: {e}"))?;

        let rows: Vec<(String, i64)> = {
            let mut stmt = tx
                .prepare(
                    "SELECT node_id, chunk_index
                       FROM embed_backfill_queue
                      WHERE state = 'pending'
                      ORDER BY enqueued_at
                      LIMIT ?1",
                )
                .map_err(|e| anyhow!("prepare pending: {e}"))?;
            let it = stmt
                .query_map([n as i64], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                })
                .map_err(|e| anyhow!("query pending: {e}"))?;
            it.filter_map(Result::ok).collect()
        };

        if rows.is_empty() {
            return Ok(rows);
        }

        let placeholders: Vec<String> =
            (0..rows.len()).map(|i| format!("?{}", i + 1)).collect();
        let sql = format!(
            "UPDATE embed_backfill_queue
                SET state   = 'in_progress',
                    attempts = attempts + 1
              WHERE node_id IN ({})",
            placeholders.join(", ")
        );
        let id_refs: Vec<&str> = rows.iter().map(|(id, _)| id.as_str()).collect();
        tx.execute(&sql, params_from_iter(id_refs.iter()))
            .map_err(|e| anyhow!("mark in_progress: {e}"))?;

        tx.commit().map_err(|e| anyhow!("commit batch tx: {e}"))?;
        Ok(rows)
    }

    async fn process_queue_entry(&self, node_id: &str) {
        // Fetch body + name from workspace_nodes. Soft-deleted nodes and
        // stale queue rows (node gone since enqueue) are treated as "done"
        // and the queue row is dropped.
        let body_result: Option<(String, String)> = {
            let conn = self.db.lock().await;
            conn.query_row(
                "SELECT name, body
                   FROM workspace_nodes
                  WHERE id = ?1 AND deleted_at IS NULL",
                [node_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .ok()
        };

        let (name, body) = match body_result {
            Some(pair) => pair,
            None => {
                // Unknown or deleted — drop the queue row silently.
                let _ = self.drop_queue_row(node_id).await;
                return;
            }
        };

        // Empty-body skip — nodes can gain body later; re-enqueue on update.
        // Mark `state='error'` so the UI / audit tools can surface the skip,
        // but don't retry on the same body.
        if body.trim().is_empty() {
            self.mark_queue_error(node_id, "empty body, skipped").await;
            return;
        }

        // Simple concatenation for Commit 2. Row-specific formatting is
        // Phase E territory; this keeps the worker agnostic to node_type
        // while still indexing the important text for search.
        let text = format!("{name}\n{body}");

        let chunks = self.chunk_pipeline.chunk_text(node_id, &text);
        if chunks.is_empty() {
            self.mark_queue_error(node_id, "chunker returned no chunks").await;
            return;
        }

        let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
        let chunk_count = chunks.len();
        let embeddings = match self.inference_handle.embed_batch(texts).await {
            Ok(v) => v,
            Err(e) => {
                self.mark_queue_error(node_id, &format!("embed: {e}")).await;
                return;
            }
        };
        if embeddings.len() != chunk_count {
            self.mark_queue_error(
                node_id,
                &format!(
                    "chunk/embedding count mismatch: {chunk_count} vs {}",
                    embeddings.len()
                ),
            )
            .await;
            return;
        }

        // Write vec_embeddings inside one transaction — atomic replace of
        // this node's chunks. A write failure leaves the prior vectors
        // intact (the DELETE and INSERTs roll back together).
        let write_result = self.write_vec_embeddings(node_id, &embeddings).await;
        match write_result {
            Ok(()) => {
                if let Err(e) = self.drop_queue_row(node_id).await {
                    warn!("drop_queue_row after success for {node_id}: {e}");
                }
                // B1.12 — advance buddy embedding milestones. Failures here
                // MUST NOT crash the worker or fail the embed op; just log.
                // BuddyManager is registered via app_handle.manage(...) in
                // lib.rs after EmbeddingWorker::new returns, so we look it
                // up at tick time rather than constructor-injecting (the
                // manager doesn't exist yet at construction).
                if let Some(buddy_mgr) = self
                    .app_handle
                    .try_state::<Arc<BuddyManager>>()
                {
                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as i64)
                        .unwrap_or(0);
                    let delta = chunk_count as i64;
                    for milestone in ["embeddings-100", "embeddings-1000"] {
                        if let Err(e) = buddy_mgr
                            .tick_milestone(milestone, delta, now_ms)
                            .await
                        {
                            warn!("buddy::tick_milestone({milestone}): {e}");
                        }
                    }
                }
                emit_embedding_event(
                    &self.app_handle,
                    "note-indexed",
                    &EmbeddingEventPayload {
                        note_id: node_id.to_string(),
                        chunk_count,
                    },
                );
            }
            Err(e) => {
                self.mark_queue_error(node_id, &format!("write: {e}")).await;
            }
        }
    }

    async fn write_vec_embeddings(
        &self,
        node_id: &str,
        embeddings: &[Vec<f32>],
    ) -> Result<()> {
        let mut conn = self.db.lock().await;
        let tx = conn
            .transaction()
            .map_err(|e| anyhow!("begin write tx: {e}"))?;
        tx.execute(
            "DELETE FROM vec_embeddings WHERE node_id = ?1",
            [node_id],
        )
        .map_err(|e| anyhow!("delete old vectors: {e}"))?;
        for (i, embedding) in embeddings.iter().enumerate() {
            tx.execute(
                "INSERT INTO vec_embeddings(node_id, chunk_index, embedding)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![
                    node_id,
                    i as i64,
                    embedding.as_slice().as_bytes()
                ],
            )
            .map_err(|e| anyhow!("insert vec row {i}: {e}"))?;
        }
        tx.commit().map_err(|e| anyhow!("commit write tx: {e}"))?;
        Ok(())
    }

    async fn drop_queue_row(&self, node_id: &str) -> Result<()> {
        let conn = self.db.lock().await;
        conn.execute(
            "DELETE FROM embed_backfill_queue WHERE node_id = ?1",
            [node_id],
        )
        .map_err(|e| anyhow!("drop queue row {node_id}: {e}"))?;
        Ok(())
    }

    async fn mark_queue_error(&self, node_id: &str, msg: &str) {
        {
            let conn = self.db.lock().await;
            if let Err(e) = conn.execute(
                "UPDATE embed_backfill_queue
                    SET state = 'error',
                        last_error = ?2
                  WHERE node_id = ?1",
                rusqlite::params![node_id, msg],
            ) {
                warn!("mark_queue_error {node_id}: {e}");
            }
        }
        warn!("embedding failed for {node_id}: {msg}");
        // Emit a terminal event so reindex-progress listeners unblock — they
        // can't distinguish "failed" from "succeeded with 0 chunks" here,
        // which matches the old worker's behavior and is acceptable for
        // Commit 2. Phase B onboarding UX can split the signals.
        emit_embedding_event(
            &self.app_handle,
            "note-indexed",
            &EmbeddingEventPayload {
                note_id: node_id.to_string(),
                chunk_count: 0,
            },
        );
    }
}

fn open_worker_conn(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)
        .map_err(|e| anyhow!("open workspace.db: {e}"))?;
    // Use the canonical workspace PRAGMA helper — identical settings across
    // every connection opened against workspace.db (main + worker + future).
    crate::managers::workspace::workspace_manager::apply_workspace_conn_pragmas(&conn)?;
    Ok(conn)
}

#[derive(Serialize)]
struct EmbeddingEventPayload {
    note_id: String,
    chunk_count: usize,
}

fn emit_embedding_event(app_handle: &AppHandle, event_name: &str, payload: &EmbeddingEventPayload) {
    if let Err(error) = app_handle.emit(event_name, payload) {
        error!("Failed to emit {event_name}: {error}");
    }
}
