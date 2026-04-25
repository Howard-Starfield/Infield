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
//!
//! ## ORT 2.0-rc.12 idioms (mirrored from embedding_ort.rs)
//!
//! * `ort::Error<SessionBuilder>` is not `Send + Sync` — every fallible ORT
//!   call uses an explicit `.map_err(|e| anyhow!("{e}"))`. Don't try to use `?`.
//! * `try_extract_tensor::<f32>()` returns `(shape: &[i64], data: &[f32])` —
//!   row-major flat slice, NOT an ndarray view.
//! * `TensorRef::from_array_view((shape, slice))` builds input tensors.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Result};
use crossbeam_channel::{bounded, Receiver, RecvTimeoutError, Sender};
use ort::{
    inputs,
    session::{builder::GraphOptimizationLevel, Session},
    value::TensorRef,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;
use tokenizers::Tokenizer;
use tokio::sync::{oneshot, RwLock};

use crate::managers::transcription::transcription_session_holds_model;

pub const MODEL_ID: &str = "bge-reranker-v2-m3";
pub const MODEL_NAME: &str = "BAAI bge-reranker-v2-m3 (multilingual XLM-RoBERTa)";

/// XLM-RoBERTa max sequence length. The bge-reranker-v2-m3 ONNX graph's
/// position embeddings are baked to 512.
const MAX_SEQUENCE_LEN: usize = 512;

/// Worker request channel capacity. Reranker is a tail-stage pipeline; bursts
/// of 8 concurrent search calls is generous for a single user.
const CHANNEL_CAPACITY: usize = 8;

/// Sentinel poll cadence + idle heartbeat tick.
const HEARTBEAT_TICK: Duration = Duration::from_secs(5);
const SENTINEL_POLL: Duration = Duration::from_secs(10);

/// Stale-heartbeat threshold. Beyond this, sentinel assumes worker is wedged
/// in FFI and either respawns once or marks unavailable.
const STALE_THRESHOLD: Duration = Duration::from_secs(30);

/// Rule 16a yield budget. Before each `session.run()`, the worker polls
/// transcription. If transcription is active for longer than this, the rerank
/// request bails with "yielded_to_transcription" rather than starving the
/// latency-sensitive transcription session.
const YIELD_BUDGET: Duration = Duration::from_millis(500);
const YIELD_POLL: Duration = Duration::from_millis(50);

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
    #[allow(dead_code)]
    model_path: PathBuf,
}

impl RerankerHandle {
    /// Spawn the worker thread + sentinel. Idle until first request — session
    /// is lazy-loaded inside the worker on first `RerankRequest`.
    pub fn spawn(model_path: PathBuf, app: AppHandle) -> Arc<Self> {
        let (request_tx, request_rx) = bounded::<RerankRequest>(CHANNEL_CAPACITY);
        let is_available = Arc::new(AtomicBool::new(false));
        let unavailable_reason = Arc::new(RwLock::new(Some("not_yet_loaded".to_string())));
        let last_heartbeat = Arc::new(AtomicI64::new(now_ms()));

        let handle = Arc::new(Self {
            request_tx: request_tx.clone(),
            is_available: is_available.clone(),
            unavailable_reason: unavailable_reason.clone(),
            last_heartbeat: last_heartbeat.clone(),
            model_path: model_path.clone(),
        });

        spawn_worker(
            request_rx,
            is_available.clone(),
            unavailable_reason.clone(),
            last_heartbeat.clone(),
            model_path.clone(),
            app.clone(),
            0,
        );

        spawn_sentinel(
            is_available,
            unavailable_reason,
            last_heartbeat,
        );

        handle
    }

    pub fn is_available(&self) -> bool {
        self.is_available.load(Ordering::Acquire)
    }

    pub async fn unavailable_reason(&self) -> Option<String> {
        self.unavailable_reason.read().await.clone()
    }

    pub fn model_info(&self) -> RerankerModelInfo {
        RerankerModelInfo {
            model_id: MODEL_ID.to_string(),
            model_hash: None,  // populated by Task 4 (Rule 19) wiring
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
            Duration::from_millis(timeout_ms),
            response_rx,
        )
        .await
        {
            Ok(Ok(Ok(results))) => Some(results),
            _ => None,
        }
    }
}

// ─── Worker / sentinel ───────────────────────────────────────────────────

/// Spawn the dedicated OS-thread worker. Lazy-loads the ORT session on first
/// `RerankRequest` — boot-time cost is paid only when search actually escalates
/// to the rerank stage. On respawn, `respawn_count > 0` signals the sentinel
/// has restarted us at least once; a second death will be terminal.
fn spawn_worker(
    rx: Receiver<RerankRequest>,
    is_available: Arc<AtomicBool>,
    unavailable_reason: Arc<RwLock<Option<String>>>,
    last_heartbeat: Arc<AtomicI64>,
    model_path: PathBuf,
    app: AppHandle,
    respawn_count: u8,
) {
    let builder = std::thread::Builder::new().name("reranker-ort".to_string());
    let _ = builder.spawn(move || {
        worker_body(
            rx,
            is_available,
            unavailable_reason,
            last_heartbeat,
            model_path,
            app,
            respawn_count,
        );
    });
}

fn worker_body(
    rx: Receiver<RerankRequest>,
    is_available: Arc<AtomicBool>,
    unavailable_reason: Arc<RwLock<Option<String>>>,
    last_heartbeat: Arc<AtomicI64>,
    model_path: PathBuf,
    app: AppHandle,
    respawn_count: u8,
) {
    last_heartbeat.store(now_ms(), Ordering::Release);

    // Lazy-load: don't touch the 568 MB model until the first request lands.
    // `loaded` is `Option<(Session, Tokenizer)>` so we can defer initialization.
    let mut loaded: Option<(Session, Tokenizer)> = None;

    log::info!(
        "reranker worker: started (respawn_count={}, model_dir={})",
        respawn_count,
        model_path.display()
    );

    loop {
        match rx.recv_timeout(HEARTBEAT_TICK) {
            Ok(req) => {
                last_heartbeat.store(now_ms(), Ordering::Release);

                // Lazy session load on first request.
                if loaded.is_none() {
                    log::info!("reranker worker: first request — loading session");
                    let load_start = std::time::Instant::now();
                    match load_session(&model_path) {
                        Ok((sess, tok)) => {
                            log::info!(
                                "reranker worker: session loaded in {:?}",
                                load_start.elapsed()
                            );
                            loaded = Some((sess, tok));
                            is_available.store(true, Ordering::Release);
                            // Clear the "not_yet_loaded" reason in a detached
                            // tokio task — RwLock::write is async and we're on
                            // a sync thread. Best-effort; acceptable race with
                            // a concurrent unavailable_reason() reader.
                            let unavailable_reason_clone = unavailable_reason.clone();
                            tokio::spawn(async move {
                                *unavailable_reason_clone.write().await = None;
                            });
                        }
                        Err(e) => {
                            log::error!("reranker worker: session load failed: {e}");
                            let reason = format!("load_failed: {e}");
                            let unavailable_reason_clone = unavailable_reason.clone();
                            tokio::spawn(async move {
                                *unavailable_reason_clone.write().await = Some(reason);
                            });
                            let _ = req.response_tx.send(Err(anyhow!(
                                "reranker session load failed: {e}"
                            )));
                            // Continue loop — sentinel will eventually mark us
                            // unavailable if loads keep failing on subsequent
                            // requests. Don't return; respawn budget is meant
                            // for FFI hangs, not load failures.
                            last_heartbeat.store(now_ms(), Ordering::Release);
                            continue;
                        }
                    }
                }

                let (session, tokenizer) = loaded.as_mut().unwrap();

                // Rule 16a: yield to transcription. Poll briefly; if the
                // transcription session holds the model past YIELD_BUDGET,
                // bail rather than competing for CPU/GPU.
                let yield_start = std::time::Instant::now();
                let mut yielded = false;
                while transcription_session_holds_model(&app) {
                    if yield_start.elapsed() > YIELD_BUDGET {
                        yielded = true;
                        break;
                    }
                    std::thread::sleep(YIELD_POLL);
                    last_heartbeat.store(now_ms(), Ordering::Release);
                }
                if yielded {
                    log::debug!(
                        "reranker worker: yielded to transcription after {:?}",
                        yield_start.elapsed()
                    );
                    let _ = req.response_tx.send(Err(anyhow!(
                        "rerank_yielded_to_transcription"
                    )));
                    last_heartbeat.store(now_ms(), Ordering::Release);
                    continue;
                }

                // Run inference. Wrap in catch_unwind so a native ORT panic
                // doesn't take the worker thread down — the sentinel can't
                // distinguish "panicked" from "wedged in FFI" otherwise.
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    run_inference(
                        session,
                        tokenizer,
                        &req.query,
                        &req.candidates,
                        req.limit,
                    )
                }))
                .unwrap_or_else(|_| Err(anyhow!("ORT panic during rerank")));

                let _ = req.response_tx.send(result);
                last_heartbeat.store(now_ms(), Ordering::Release);
            }
            Err(RecvTimeoutError::Timeout) => {
                // Idle tick — refresh heartbeat so sentinel sees us alive.
                last_heartbeat.store(now_ms(), Ordering::Release);
            }
            Err(RecvTimeoutError::Disconnected) => {
                log::info!("reranker worker: channel disconnected — exiting");
                return;
            }
        }
    }
}

/// Sentinel: monitor the worker's heartbeat. If stale > `STALE_THRESHOLD`,
/// flip `is_available = false` so callers stop dispatching. (Respawn lives in
/// Task 8 wiring — this Task 3 implementation deliberately keeps the sentinel
/// simple: detect stale, mark unavailable, exit. A future iteration can pull
/// the model_path + app handle in to spawn a replacement worker if desired.)
fn spawn_sentinel(
    is_available: Arc<AtomicBool>,
    unavailable_reason: Arc<RwLock<Option<String>>>,
    last_heartbeat: Arc<AtomicI64>,
) {
    let builder = std::thread::Builder::new().name("reranker-sentinel".to_string());
    let _ = builder.spawn(move || loop {
        std::thread::sleep(SENTINEL_POLL);

        let last = last_heartbeat.load(Ordering::Acquire);
        // last == 0 only if the worker hasn't beaten yet — give it grace.
        if last == 0 {
            continue;
        }
        let age_ms = now_ms().saturating_sub(last);
        if age_ms <= STALE_THRESHOLD.as_millis() as i64 {
            continue;
        }

        log::warn!(
            "reranker sentinel: heartbeat stale by {}ms (threshold {}ms) — \
             marking unavailable",
            age_ms,
            STALE_THRESHOLD.as_millis()
        );
        is_available.store(false, Ordering::Release);
        let unavailable_reason_clone = unavailable_reason.clone();
        tokio::spawn(async move {
            *unavailable_reason_clone.write().await =
                Some("worker_wedged".to_string());
        });
        return;
    });
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ─── Session load + inference ────────────────────────────────────────────

/// Build the ORT session + tokenizer. CPU only (Rule 16a — GPU reserved for
/// transcription). `intra_threads = max(num_cpus / 3, 1)` so a concurrent
/// embedding + transcription session aren't starved.
fn load_session(model_dir: &Path) -> Result<(Session, Tokenizer)> {
    let model_path = model_dir.join("model.onnx");
    let tokenizer_path = model_dir.join("tokenizer.json");

    if !model_path.is_file() {
        return Err(anyhow!(
            "reranker model.onnx missing at {}",
            model_path.display()
        ));
    }
    if !tokenizer_path.is_file() {
        return Err(anyhow!(
            "reranker tokenizer.json missing at {}",
            tokenizer_path.display()
        ));
    }

    // Rule 16a thread cap: divide by 3 since at peak we run reranker +
    // embedding + transcription concurrently. Floor at 1.
    let cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let intra = (cpus / 3).max(1);

    let session = Session::builder()
        .map_err(|e| anyhow!("Session::builder: {e}"))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| anyhow!("with_optimization_level: {e}"))?
        .with_intra_threads(intra)
        .map_err(|e| anyhow!("with_intra_threads: {e}"))?
        .commit_from_file(&model_path)
        .map_err(|e| anyhow!("commit_from_file({}): {e}", model_path.display()))?;

    // Configure tokenizer truncation explicitly. The XLM-RoBERTa tokenizer
    // for bge-reranker-v2-m3 ships with config that the `tokenizers` crate
    // may or may not honour — set explicitly so an oversized cross-encoder
    // pair can't blow past MAX_SEQUENCE_LEN.
    use tokenizers::utils::truncation::{
        TruncationDirection, TruncationParams, TruncationStrategy,
    };
    let mut tokenizer = Tokenizer::from_file(&tokenizer_path)
        .map_err(|e| anyhow!("Tokenizer::from_file({}): {e}", tokenizer_path.display()))?;
    tokenizer
        .with_truncation(Some(TruncationParams {
            max_length: MAX_SEQUENCE_LEN,
            strategy: TruncationStrategy::LongestFirst,
            stride: 0,
            direction: TruncationDirection::Right,
        }))
        .map_err(|e| anyhow!("tokenizer.with_truncation: {e}"))?;

    Ok((session, tokenizer))
}

/// Encode `(query, excerpt)` cross-encoder pairs, run the session in one
/// batched forward pass, sigmoid the logits, sort descending, truncate to
/// `limit`. `original_rank` preserves the input position so callers can show
/// "moved from #7 → #1" debug info.
fn run_inference(
    session: &mut Session,
    tokenizer: &Tokenizer,
    query: &str,
    candidates: &[RerankCandidate],
    limit: usize,
) -> Result<Vec<RerankResult>> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    // Build cross-encoder inputs. `tokenizer.encode_batch` with
    // `EncodeInput::Dual((query, doc))` produces the `[CLS] query [SEP] doc
    // [SEP]` shape that XLM-RoBERTa cross-encoders expect — same as the
    // HuggingFace `AutoTokenizer` would.
    use tokenizers::EncodeInput;
    let pairs: Vec<EncodeInput> = candidates
        .iter()
        .map(|c| {
            // Use title + excerpt as the document side. Empty title is fine
            // (just becomes "\n\n<excerpt>"); pure-excerpt is also fine if
            // the title field is empty.
            let doc = if c.title.is_empty() {
                c.excerpt.clone()
            } else if c.excerpt.is_empty() {
                c.title.clone()
            } else {
                format!("{}\n\n{}", c.title, c.excerpt)
            };
            EncodeInput::Dual(query.into(), doc.into())
        })
        .collect();

    let encodings = tokenizer
        .encode_batch(pairs, true)
        .map_err(|e| anyhow!("encode_batch: {e}"))?;

    let batch = encodings.len();
    // Right-pad to the batch's longest sequence so we can build a single
    // [batch, max_len] tensor. Pad ID for XLM-RoBERTa = 1 (configured in
    // tokenizer.json's padding section, but encode_batch without explicit
    // padding leaves ragged lengths — we pad manually here for full control).
    let max_len = encodings
        .iter()
        .map(|e| e.get_ids().len())
        .max()
        .unwrap_or(0)
        .min(MAX_SEQUENCE_LEN);

    // XLM-RoBERTa pad token id is 1 (per HuggingFace `xlm-roberta-base`
    // tokenizer config). Attention mask 0 for pad positions ensures the
    // model ignores them.
    const XLMR_PAD_ID: i64 = 1;

    let mut input_ids = vec![XLMR_PAD_ID; batch * max_len];
    let mut attention_mask = vec![0i64; batch * max_len];

    for (row, enc) in encodings.iter().enumerate() {
        let ids = enc.get_ids();
        let mask = enc.get_attention_mask();
        let n = ids.len().min(max_len);
        let row_off = row * max_len;
        for i in 0..n {
            input_ids[row_off + i] = ids[i] as i64;
            attention_mask[row_off + i] = mask[i] as i64;
        }
    }

    let shape = [batch, max_len];

    let input_ids_tensor = TensorRef::from_array_view((shape, input_ids.as_slice()))
        .map_err(|e| anyhow!("input_ids tensor: {e}"))?;
    let attention_mask_tensor = TensorRef::from_array_view((shape, attention_mask.as_slice()))
        .map_err(|e| anyhow!("attention_mask tensor: {e}"))?;

    // bge-reranker-v2-m3 (XLM-RoBERTa) takes `input_ids` + `attention_mask`
    // only — no `token_type_ids` (XLM-RoBERTa drops segment embeddings). The
    // graph output is `logits` of shape `[batch, 1]` — raw scores, NOT
    // sigmoid'd. We sigmoid below.
    let outputs = session
        .run(inputs![
            "input_ids" => input_ids_tensor,
            "attention_mask" => attention_mask_tensor,
        ])
        .map_err(|e| anyhow!("session.run: {e}"))?;

    let (logits_shape, logits) = outputs["logits"]
        .try_extract_tensor::<f32>()
        .map_err(|e| anyhow!("extract logits: {e}"))?;

    anyhow::ensure!(
        logits_shape.len() == 2 && logits_shape[0] as usize == batch,
        "unexpected logits shape {:?} (expected [{}, 1])",
        logits_shape,
        batch
    );

    // Logits is `[batch, 1]` row-major → one f32 per row.
    let logits_per_row = (logits.len() / batch).max(1);
    let mut scored: Vec<RerankResult> = candidates
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let logit = logits[i * logits_per_row];
            RerankResult {
                node_id: c.node_id.clone(),
                rerank_score: sigmoid(logit),
                original_rank: i,
            }
        })
        .collect();

    // Sort descending by score. Stable sort so ties keep original_rank order.
    scored.sort_by(|a, b| {
        b.rerank_score
            .partial_cmp(&a.rerank_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    scored.truncate(limit);
    Ok(scored)
}

#[inline]
fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}
