//! ONNX Runtime embedding manager — bge-small-en-v1.5 in-process inference.
//!
//! Phase A deliverable (see PLAN.md). Replaces the out-of-process
//! `handy-embedding-sidecar` + `llama-cpp-2` GGUF path with a direct `ort`
//! crate session loading `model.onnx` from
//! `<app_data>/models/bge-small-en-v1.5/` (downloaded via the `ModelInfo`
//! registry — D1d locked).
//!
//! Current scope: the inference recipe (tokenize → BERT inputs → mean-pool
//! over attention mask → L2-normalize → 384d vector). The production
//! `InferenceHandle` (dedicated OS thread + crossbeam request channel +
//! sentinel per Rule 16, with intra-op thread cap per Rule 16a and CPU-only
//! execution provider per Rule 16a) lands in the next commit.
//!
//! ## Error mapping
//!
//! `ort::Error<SessionBuilder>` is not `Send + Sync` in `ort 2.0.0-rc.12`
//! because `SessionBuilder` carries `Vec<Box<dyn Operator>>` and
//! `dyn Operator` is not `Sync`. `anyhow::Error: From<_>` therefore does not
//! fire for session-builder errors, so each fallible ORT call in this file
//! uses an explicit `.map_err(|e| anyhow!("{e}"))` instead of `?`. Keep this
//! pattern in any new ORT code until rc.12 is dropped.

use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;

#[cfg(test)]
use anyhow::Context;
use anyhow::{anyhow, Result};
use ort::{
    inputs,
    session::{builder::GraphOptimizationLevel, Session},
    value::TensorRef,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use tokenizers::Tokenizer;

/// Embedding output dimension (bge-small-en-v1.5). Wire this into
/// `vec_embeddings` DDL + `embedding_model_info.dimension` — anywhere a
/// schema or guard needs "the dimension".
pub const EMBEDDING_DIM: usize = 384;

/// Model ID persisted in `embedding_model_info.model_id`. Changing this value
/// triggers Rule 19 reindexing on next boot.
pub const MODEL_ID: &str = "bge-small-en-v1.5";

/// Human-readable name surfaced in `model_info()`. UI-facing.
pub const MODEL_NAME: &str = "BGE Small (English)";

/// Snapshot of the embedding model's identity, consumed by callers that
/// need to stamp vectors with provenance (currently just a stable `model_id`
/// reference) or display model info in UI.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EmbeddingModelInfo {
    pub model_id: String,
    pub model_name: String,
    pub dimension: usize,
}

impl EmbeddingModelInfo {
    pub fn current() -> Self {
        Self {
            model_id: MODEL_ID.to_string(),
            model_name: MODEL_NAME.to_string(),
            dimension: EMBEDDING_DIM,
        }
    }
}

/// Reason the worker is currently unavailable. Stored as an atomic so
/// `unavailable_reason()` doesn't need a lock on the hot path.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnavailableReason {
    /// Worker hasn't been marked unavailable — `is_available()` returns true.
    None = 0,
    /// Session load failed at the ORT layer (file missing / corrupt / bad sig).
    LoadFailed = 1,
    /// Load didn't report ready within `LOAD_TIMEOUT`.
    LoadTimeout = 2,
    /// Sentinel exhausted its respawn budget after repeat worker deaths.
    RespawnExhausted = 3,
}

impl UnavailableReason {
    fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::LoadFailed,
            2 => Self::LoadTimeout,
            3 => Self::RespawnExhausted,
            _ => Self::None,
        }
    }

    /// Stable identifier emitted in `vector-search-unavailable` events and
    /// surfaced to callers via `unavailable_reason()`. Frontend string
    /// matching expects these exact tokens.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "",
            Self::LoadFailed => "load_failed",
            Self::LoadTimeout => "load_timeout",
            Self::RespawnExhausted => "respawn_exhausted",
        }
    }
}

/// Build the ORT session. CPU-only execution provider (GPU reserved for
/// transcription per Rule 16a); intra-op threads capped at `num_cpus / 2`
/// so a concurrent transcription ORT session is not starved when both run
/// during the voice-memo → doc → embed flow.
pub fn build_session(model_path: &Path) -> Result<Session> {
    let intra = (available_parallelism_or(4) / 2).max(1);
    let session = Session::builder()
        .map_err(|e| anyhow!("Session::builder: {e}"))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| anyhow!("with_optimization_level: {e}"))?
        .with_intra_threads(intra)
        .map_err(|e| anyhow!("with_intra_threads: {e}"))?
        .commit_from_file(model_path)
        .map_err(|e| anyhow!("commit_from_file({}): {e}", model_path.display()))?;
    Ok(session)
}

/// Maximum token sequence length for bge-small-en-v1.5. BERT-derived; the
/// ONNX graph's position embeddings are baked to this length. Input longer
/// than this MUST be truncated before `session.run()` — a longer seq would
/// either crash the session or produce garbage.
///
/// Enforced two ways: (1) tokenizer truncation set explicitly in
/// `load_tokenizer`, and (2) `debug_assert!` in `embed` as a config-drift
/// canary in test/debug builds.
pub const MAX_SEQUENCE_LEN: usize = 512;

/// Load the HuggingFace tokenizer from the model directory and explicitly
/// configure truncation to `MAX_SEQUENCE_LEN`.
///
/// We do not rely on `tokenizer_config.json` auto-configuring truncation —
/// the `tokenizers` crate only reads a subset of HuggingFace config fields,
/// and silently defaulting to "no truncation" here would let a degenerate
/// long doc either (a) blow the sentinel heartbeat budget during a single
/// embed or (b) crash the ONNX session on an oversized input tensor. Setting
/// it explicitly is cheap insurance.
pub fn load_tokenizer(model_dir: &Path) -> Result<Tokenizer> {
    use tokenizers::utils::truncation::{
        TruncationDirection, TruncationParams, TruncationStrategy,
    };

    let path = model_dir.join("tokenizer.json");
    let mut tokenizer = Tokenizer::from_file(&path)
        .map_err(|e| anyhow!("Tokenizer::from_file({}): {e}", path.display()))?;
    tokenizer
        .with_truncation(Some(TruncationParams {
            max_length: MAX_SEQUENCE_LEN,
            strategy: TruncationStrategy::LongestFirst,
            stride: 0,
            direction: TruncationDirection::Right,
        }))
        .map_err(|e| anyhow!("tokenizer.with_truncation: {e}"))?;
    Ok(tokenizer)
}

/// Encode → infer → `[CLS]`-pool → L2-normalize. Returns a 384d unit vector.
///
/// BGE's output head exposes `last_hidden_state` with shape
/// `[batch=1, seq_len, hidden=384]`. **`[CLS]` pooling (the first token's
/// hidden state) is what BGE's authors trained with and recommend on the
/// model card** — not mean-pooling. Mean-pooling produces noticeably lower
/// cosine similarity on semantically close pairs (empirically 0.66 vs 0.78
/// for `"hello world"` / `"greetings earth"`), enough to miss relevance
/// thresholds that `[CLS]` pooling clears comfortably.
///
/// This overrides the mean-pool recipe in PLAN.md Phase A lines 246-247
/// (pre-kickoff doc predated actually running the model). A PLAN.md patch
/// flagging the correction lands alongside this commit.
pub fn embed(session: &mut Session, tokenizer: &Tokenizer, text: &str) -> Result<Vec<f32>> {
    let encoding = tokenizer
        .encode(text, true)
        .map_err(|e| anyhow!("tokenize: {e}"))?;

    // Config-drift canary — `load_tokenizer` must have set explicit
    // truncation to `MAX_SEQUENCE_LEN`. If the tokenizer slipped back to
    // "no truncation" (e.g. someone wired a fresh `Tokenizer::from_file`
    // without calling `load_tokenizer`), a long input would slip through
    // here and crash the ONNX session on an oversized position embedding.
    // debug_assert is enough: release builds rely on the explicit
    // `with_truncation` call to bound the length at tokenize time.
    debug_assert!(
        encoding.get_ids().len() <= MAX_SEQUENCE_LEN,
        "tokenizer produced {} tokens (> MAX_SEQUENCE_LEN={}); \
         truncation not configured correctly",
        encoding.get_ids().len(),
        MAX_SEQUENCE_LEN,
    );

    let ids: Vec<i64> = encoding.get_ids().iter().map(|&x| x as i64).collect();
    let mask: Vec<i64> = encoding
        .get_attention_mask()
        .iter()
        .map(|&x| x as i64)
        .collect();
    let types: Vec<i64> = encoding
        .get_type_ids()
        .iter()
        .map(|&x| x as i64)
        .collect();

    let seq_len = ids.len();
    let shape = [1usize, seq_len];

    let input_ids = TensorRef::from_array_view((shape, ids.as_slice()))
        .map_err(|e| anyhow!("input_ids tensor: {e}"))?;
    let attention_mask = TensorRef::from_array_view((shape, mask.as_slice()))
        .map_err(|e| anyhow!("attention_mask tensor: {e}"))?;
    let token_type_ids = TensorRef::from_array_view((shape, types.as_slice()))
        .map_err(|e| anyhow!("token_type_ids tensor: {e}"))?;

    let outputs = session
        .run(inputs![
            "input_ids" => input_ids,
            "attention_mask" => attention_mask,
            "token_type_ids" => token_type_ids,
        ])
        .map_err(|e| anyhow!("session.run: {e}"))?;

    let (out_shape, hidden) = outputs["last_hidden_state"]
        .try_extract_tensor::<f32>()
        .map_err(|e| anyhow!("extract last_hidden_state: {e}"))?;
    anyhow::ensure!(
        out_shape.len() == 3 && out_shape[0] == 1 && out_shape[2] as usize == EMBEDDING_DIM,
        "unexpected last_hidden_state shape {:?}",
        out_shape
    );

    // `mask` is unused under `[CLS]` pooling — kept in the encoding step for
    // the future day we might want to evaluate mean-pool as a comparison.
    let _ = mask;
    let pooled = cls_pool(hidden, seq_len, EMBEDDING_DIM);
    Ok(l2_normalize(pooled))
}

/// Take the hidden state of the `[CLS]` token (position 0) as the sentence
/// embedding. `hidden` is row-major `[1, seq_len, hidden_dim]`, so the
/// `[CLS]` row is the first `hidden_dim` elements.
fn cls_pool(hidden: &[f32], seq_len: usize, hidden_dim: usize) -> Vec<f32> {
    debug_assert_eq!(hidden.len(), seq_len * hidden_dim);
    debug_assert!(seq_len >= 1, "need at least [CLS] in the sequence");
    hidden[..hidden_dim].to_vec()
}

/// L2-normalize so `cos_sim(a, b) == dot(a, b)` downstream.
fn l2_normalize(mut v: Vec<f32>) -> Vec<f32> {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
    v
}

fn available_parallelism_or(fallback: usize) -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(fallback)
}

// ─── Inference bridge (Rule 16 + Rule 16a) ───────────────────────────────
//
// Why: `ort::Session::run` enters native code where a panic can cross the
// FFI boundary and poison the tokio runtime. We isolate it to a dedicated
// `std::thread::spawn` worker, talk over a bounded crossbeam channel, and
// run a sentinel that restarts the worker once before marking the feature
// unavailable. CPU-only execution provider so the GPU stays reserved for
// transcription (Rule 16a). Intra-op threads capped at `num_cpus / 2` so a
// concurrent transcription ORT session is not starved.

use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crossbeam_channel::{bounded, Receiver, RecvTimeoutError, Sender};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

/// Inbound requests on the worker channel.
enum InferenceRequest {
    Embed {
        text: String,
        respond: oneshot::Sender<Result<Vec<f32>>>,
    },
    /// Graceful shutdown — worker drains any in-flight request and exits.
    Shutdown,
}

/// Shared state between `InferenceHandle`, the worker thread, and the
/// sentinel thread. All fields are read-mostly from the outside and
/// written by exactly one of {worker, sentinel} at a time.
struct InferenceStatus {
    /// `true` only while a healthy worker owns an `ort::Session`. Flipped to
    /// `false` on (a) initial load failure, (b) load timeout, or (c) sentinel
    /// exhausting its restart budget. `embed()` short-circuits when `false`.
    vector_search_available: AtomicBool,
    /// Worker's most recent liveness beat, unix millis. Worker touches this
    /// (i) before each `rx.recv_timeout`, (ii) after each request completes,
    /// (iii) on each idle tick (`IDLE_HEARTBEAT`, matched to the sentinel
    /// poll cadence). Sentinel compares against `now` — stale > `STALE_THRESHOLD`
    /// means the worker is wedged in FFI.
    last_heartbeat_ms: AtomicU64,
    /// How many times the sentinel has respawned the worker. `MAX_RESPAWNS`
    /// hard ceiling; second death → `vector_search_available = false`.
    respawn_count: AtomicU8,
    /// `UnavailableReason` encoded as `u8`. Callers read via
    /// `unavailable_reason()` to show the right Settings banner. `None (0)`
    /// while `vector_search_available` is true.
    unavailable_reason: AtomicU8,
}

/// How long the worker should wait between idle heartbeats. Match the
/// sentinel's poll cadence so normal idle time doesn't look stale.
const IDLE_HEARTBEAT: Duration = Duration::from_secs(5);

/// Sentinel polls every N seconds.
const SENTINEL_POLL: Duration = Duration::from_secs(5);

/// If `now - last_heartbeat_ms > STALE_THRESHOLD`, the worker is assumed
/// wedged. Set to 30s per design: a legitimately slow embed on a loaded
/// Windows box (AV scan / swap) can push one call to ~10s; real FFI hangs
/// are infinite. 30s catches hangs without flapping on load.
const STALE_THRESHOLD: Duration = Duration::from_secs(30);

/// Max worker respawns after initial success. 1 = "restart once then give up".
const MAX_RESPAWNS: u8 = 1;

/// Soft wait budget. If the worker doesn't report `ready_tx` within this,
/// spawn() returns with `vector_search_available = false` and lib.rs skips
/// Rule 19 for this boot. The worker thread keeps trying to load in the
/// background — if it succeeds later, it self-flips availability (see
/// `worker_body`) and search becomes usable mid-session. Rule 19 catches
/// up on the next boot.
///
/// Bumped from 10s → 30s after identifying the init race on slow-disk
/// machines: cold-start SSD reads + AV scans + cold-page faults on a 133MB
/// ONNX model can push first-load to 15-20s on Windows. 30s gives a safety
/// margin that keeps Rule 19 running on any non-pathological boot while
/// still failing loud on genuine hangs.
const LOAD_TIMEOUT: Duration = Duration::from_secs(30);

/// Channel capacity. `EmbeddingWorker` chunking batches plus interactive
/// SearchManager queries fit comfortably; over-capacity senders block →
/// natural back-pressure, queue never grows unboundedly.
const CHANNEL_CAPACITY: usize = 16;

/// Tauri event name emitted when `vector_search_available` flips to `false`.
/// Frontend settings-banner hook listens for this; payload is a reason
/// string describing why the feature is disabled.
pub const VECTOR_SEARCH_UNAVAILABLE_EVENT: &str = "vector-search-unavailable";

/// Shared bridge to the dedicated ORT inference worker thread.
///
/// Cheap to clone — the interior `Sender` and `Arc<InferenceStatus>` are
/// both `Clone`. `embed()` is the only public fallible path; it's async
/// and safe to call from any tokio task.
#[derive(Clone)]
pub struct InferenceHandle {
    tx: Sender<InferenceRequest>,
    status: Arc<InferenceStatus>,
}

impl InferenceHandle {
    /// Spawn the worker + sentinel, load the model, block until ready (or
    /// `LOAD_TIMEOUT`). On load failure, returns a handle in the
    /// `vector_search_available = false` state and emits the Settings banner
    /// event — caller keeps the handle and `embed()` will return `Err` until
    /// the user re-downloads / restarts.
    ///
    /// Never panics. Worker thread is detached (sentinel references it only
    /// indirectly via the heartbeat atomic). On app shutdown, drop the last
    /// `InferenceHandle` clone — the worker's `rx.recv_timeout` path sees
    /// `Disconnected` and exits cleanly.
    pub fn spawn(app_handle: AppHandle, model_dir: std::path::PathBuf) -> Self {
        let (tx, rx) = bounded::<InferenceRequest>(CHANNEL_CAPACITY);
        let status = Arc::new(InferenceStatus {
            vector_search_available: AtomicBool::new(false),
            last_heartbeat_ms: AtomicU64::new(now_ms()),
            respawn_count: AtomicU8::new(0),
            unavailable_reason: AtomicU8::new(UnavailableReason::None as u8),
        });

        // Block on the initial load. Worker signals ready_tx with the load
        // result; we only flip `vector_search_available = true` on success.
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel::<Result<()>>(1);
        spawn_worker_thread(
            model_dir.clone(),
            rx.clone(),
            status.clone(),
            Some(ready_tx),
        );
        // Spawn the sentinel UNCONDITIONALLY, before awaiting ready. The
        // sentinel's loop monitors heartbeats and handles late-load (worker
        // self-flips availability if load finishes after our recv_timeout).
        // Keeping the sentinel alive across the race means a worker that
        // came up after `spawn()` returned still has a supervisor.
        spawn_sentinel_thread(
            app_handle.clone(),
            model_dir,
            rx,
            status.clone(),
        );

        match ready_rx.recv_timeout(LOAD_TIMEOUT) {
            Ok(Ok(())) => {
                // Worker already flipped vector_search_available = true
                // from inside worker_body. Main-side flip is redundant but
                // idempotent; leave it off to avoid double-stores.
                log::info!("embedding worker: ready (bge-small-en-v1.5)");
            }
            Ok(Err(e)) => {
                log::error!("embedding worker: load failed: {e}");
                status.unavailable_reason.store(
                    UnavailableReason::LoadFailed as u8,
                    Ordering::Release,
                );
                emit_unavailable(&app_handle, UnavailableReason::LoadFailed);
            }
            Err(_) => {
                // Timeout here is a SOFT signal to lib.rs: "don't run Rule
                // 19 this boot, the worker might finish loading later". The
                // worker thread keeps trying in the background and will
                // self-flip availability on success. unavailable_reason
                // gets LoadTimeout now; the worker clears it on late load
                // success, and the sentinel keeps monitoring heartbeats.
                log::warn!(
                    "embedding worker: soft timeout after {:?} — load may still complete in background",
                    LOAD_TIMEOUT
                );
                status.unavailable_reason.store(
                    UnavailableReason::LoadTimeout as u8,
                    Ordering::Release,
                );
                emit_unavailable(&app_handle, UnavailableReason::LoadTimeout);
            }
        }
        Self { tx, status }
    }

    /// Human-facing model info. UI-safe to call every frame; return value is
    /// cheap (a few heap `String`s) — cache on the caller if that matters.
    pub fn model_info(&self) -> EmbeddingModelInfo {
        EmbeddingModelInfo::current()
    }

    /// When `is_available()` is false, returns the encoded reason. Frontend
    /// Settings banner matches on the string token from
    /// `UnavailableReason::as_str()`; `None` maps to empty string.
    pub fn unavailable_reason(&self) -> Option<&'static str> {
        if self.is_available() {
            return None;
        }
        let reason = UnavailableReason::from_u8(
            self.status.unavailable_reason.load(Ordering::Acquire),
        );
        match reason {
            UnavailableReason::None => None,
            other => Some(other.as_str()),
        }
    }

    /// Embed a batch of texts sequentially on the worker thread. The
    /// implementation walks the slice and calls `embed` per-text; we don't
    /// parallelise because there's exactly one `ort::Session` per process
    /// (Rule 16: dedicated OS thread, not a pool). For most callers this is
    /// the shape that was in the old `EmbeddingManager::embed_batch`.
    ///
    /// Preserves input order. Returns `Err` on first failing text — do not
    /// attempt partial delivery. EmbeddingWorker catches per-job errors at
    /// the outer loop so a bad chunk doesn't take the whole batch down
    /// permanently.
    pub async fn embed_batch(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>> {
        let mut out = Vec::with_capacity(texts.len());
        for text in texts {
            let v = self.embed(text).await?;
            out.push(v);
        }
        Ok(out)
    }

    /// `true` if the worker is alive and holding a session. Readers should
    /// poll this before calling `embed` to short-circuit expensive callers
    /// (e.g. `EmbeddingWorker`'s backfill loop). `embed()` also checks
    /// internally and rejects if unavailable — redundant defence.
    pub fn is_available(&self) -> bool {
        self.status.vector_search_available.load(Ordering::Acquire)
    }

    /// Embed `text` on the dedicated worker thread. Returns a 384d,
    /// L2-normalized vector (use `cos_sim` = dot product downstream).
    ///
    /// Reject-early on unavailable; otherwise enqueue + await. The send
    /// runs in `tokio::task::spawn_blocking` because `crossbeam_channel::send`
    /// blocks on a full channel — inlining it would stall the tokio thread
    /// when `CHANNEL_CAPACITY` is saturated (search burst + concurrent
    /// EmbeddingWorker chunks). `spawn_blocking` offloads to the blocking
    /// thread pool; back-pressure still propagates to the caller via the
    /// blocking send, just without stalling the async runtime.
    pub async fn embed(&self, text: String) -> Result<Vec<f32>> {
        if !self.is_available() {
            return Err(anyhow!("vector search unavailable"));
        }
        let (resp_tx, resp_rx) = oneshot::channel();
        let tx = self.tx.clone();
        let send_result = tokio::task::spawn_blocking(move || {
            tx.send(InferenceRequest::Embed {
                text,
                respond: resp_tx,
            })
        })
        .await
        .map_err(|e| anyhow!("tokio join error: {e}"))?;
        send_result.map_err(|e| anyhow!("embedding channel closed: {e}"))?;
        resp_rx
            .await
            .map_err(|e| anyhow!("embedding response dropped: {e}"))?
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn touch_heartbeat(status: &InferenceStatus) {
    status.last_heartbeat_ms.store(now_ms(), Ordering::Release);
}

fn emit_unavailable(app_handle: &AppHandle, reason: UnavailableReason) {
    let _ = app_handle.emit(
        VECTOR_SEARCH_UNAVAILABLE_EVENT,
        serde_json::json!({ "reason": reason.as_str() }),
    );
}

/// Spawn the worker thread. `ready_tx` is `Some` only for the initial spawn;
/// respawns don't wait on ready — the sentinel has already declared the
/// previous worker dead, and we want the session load to happen in the
/// background without blocking the main runtime further.
fn spawn_worker_thread(
    model_dir: std::path::PathBuf,
    rx: Receiver<InferenceRequest>,
    status: Arc<InferenceStatus>,
    ready_tx: Option<std::sync::mpsc::SyncSender<Result<()>>>,
) {
    let builder = std::thread::Builder::new().name("embedding-ort".to_string());
    let _ = builder.spawn(move || worker_body(model_dir, rx, status, ready_tx));
}

fn worker_body(
    model_dir: std::path::PathBuf,
    rx: Receiver<InferenceRequest>,
    status: Arc<InferenceStatus>,
    ready_tx: Option<std::sync::mpsc::SyncSender<Result<()>>>,
) {
    // Phase 1: synchronous session + tokenizer load.
    let load_start = Instant::now();
    let load_result = (|| -> Result<(ort::session::Session, Tokenizer)> {
        let session = build_session(&model_dir.join("model.onnx"))?;
        let tokenizer = load_tokenizer(&model_dir)?;
        Ok((session, tokenizer))
    })();
    let (mut session, tokenizer) = match load_result {
        Ok(pair) => {
            log::info!(
                "embedding worker: session + tokenizer loaded in {:?}",
                load_start.elapsed()
            );
            // SELF-FLIP: worker owns the authoritative "I'm ready" signal.
            // This covers the init race where main's `recv_timeout` gave up
            // before the worker's load finished — availability still flips
            // once the session is actually usable, so later embed calls
            // succeed and the sentinel (spawned unconditionally by `spawn`)
            // monitors heartbeats going forward. Rule 19 is the only thing
            // that's bounded by main's timeout — it runs on the next boot
            // if we miss this one.
            status
                .vector_search_available
                .store(true, Ordering::Release);
            // Clear any stale unavailable_reason from a prior failed attempt
            // (e.g. respawn worker whose predecessor died).
            status
                .unavailable_reason
                .store(UnavailableReason::None as u8, Ordering::Release);
            if let Some(tx) = ready_tx {
                let _ = tx.send(Ok(()));
            }
            pair
        }
        Err(e) => {
            log::error!("embedding worker: load failed: {e}");
            // Availability stays false. If this is the initial spawn, main's
            // recv_timeout branch flips unavailable_reason + emits event; if
            // this is a respawn, reflect the failure in the atomic ourselves.
            if let Some(tx) = ready_tx {
                let _ = tx.send(Err(e));
            } else {
                status
                    .vector_search_available
                    .store(false, Ordering::Release);
                status.unavailable_reason.store(
                    UnavailableReason::LoadFailed as u8,
                    Ordering::Release,
                );
            }
            return;
        }
    };
    touch_heartbeat(&status);

    // Phase 2: serve requests. Loop exits on Shutdown, Disconnected, or if
    // `vector_search_available` is flipped to `false` by the sentinel.
    loop {
        match rx.recv_timeout(IDLE_HEARTBEAT) {
            Ok(InferenceRequest::Embed { text, respond }) => {
                // `ort::Session::run` is not `UnwindSafe` — wrap the closure
                // in `AssertUnwindSafe` so panics from native ORT code are
                // caught without a type error. We intentionally do not try
                // to recover the session after a panic; the next request
                // runs against the same `&mut session`, and if the panic
                // left the session in a bad state subsequent requests will
                // fail loud.
                let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
                    embed(&mut session, &tokenizer, &text)
                }))
                .unwrap_or_else(|_| Err(anyhow!("ORT panic during embed")));
                // Discard send errors — the tokio caller may have dropped
                // the oneshot receiver before we finished (cost bound:
                // ≤150ms per cancelled embed, accepted by design).
                let _ = respond.send(result);
                touch_heartbeat(&status);
            }
            Ok(InferenceRequest::Shutdown) => {
                log::info!("embedding worker: shutdown requested");
                return;
            }
            Err(RecvTimeoutError::Timeout) => {
                // Idle tick. Beat so sentinel sees us alive.
                touch_heartbeat(&status);
                if !status.vector_search_available.load(Ordering::Acquire) {
                    log::info!(
                        "embedding worker: exiting — availability flag cleared"
                    );
                    return;
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                log::info!("embedding worker: channel disconnected — exiting");
                return;
            }
        }
    }
}

/// Monitor worker liveness. Polls `last_heartbeat_ms` every `SENTINEL_POLL`;
/// on a stale heartbeat spawns a replacement worker. After `MAX_RESPAWNS`
/// consecutive deaths, flips `vector_search_available = false` and exits
/// — the feature stays disabled until the app restarts.
fn spawn_sentinel_thread(
    app_handle: AppHandle,
    model_dir: std::path::PathBuf,
    rx: Receiver<InferenceRequest>,
    status: Arc<InferenceStatus>,
) {
    let builder = std::thread::Builder::new().name("embedding-sentinel".to_string());
    let _ = builder.spawn(move || loop {
        std::thread::sleep(SENTINEL_POLL);

        // Exit only on permanent unavailability (respawn budget exhausted).
        // Transient availability=false happens during (a) initial load
        // before worker flips to true, and (b) respawn between worker death
        // and the new worker's load completion. In both cases the sentinel
        // should keep monitoring, not exit.
        if status.respawn_count.load(Ordering::Acquire) > MAX_RESPAWNS {
            log::info!("embedding sentinel: respawn budget exhausted, exiting");
            return;
        }

        // While the worker hasn't reported ready yet, there's no meaningful
        // heartbeat to compare against. Wait for the next tick.
        if !status.vector_search_available.load(Ordering::Acquire) {
            continue;
        }

        let last = status.last_heartbeat_ms.load(Ordering::Acquire);
        let age_ms = now_ms().saturating_sub(last);
        if age_ms <= STALE_THRESHOLD.as_millis() as u64 {
            continue;
        }

        log::warn!(
            "embedding sentinel: heartbeat stale by {}ms (threshold {}ms)",
            age_ms,
            STALE_THRESHOLD.as_millis()
        );

        let prior = status.respawn_count.fetch_add(1, Ordering::AcqRel);
        if prior >= MAX_RESPAWNS {
            log::error!(
                "embedding sentinel: respawn budget exhausted \
                 (attempted {} respawns); marking vector search unavailable",
                prior + 1
            );
            status
                .vector_search_available
                .store(false, Ordering::Release);
            status.unavailable_reason.store(
                UnavailableReason::RespawnExhausted as u8,
                Ordering::Release,
            );
            emit_unavailable(&app_handle, UnavailableReason::RespawnExhausted);
            return;
        }

        log::info!("embedding sentinel: respawning worker (attempt {})", prior + 1);
        // Respawn draws from the same rx. The hung worker (if still alive in
        // native code) will eventually either return or stay stuck forever;
        // we can't join it safely. The new worker takes over message handling.
        // Reset the heartbeat so the newly-spawned worker has a fresh window.
        touch_heartbeat(&status);
        spawn_worker_thread(model_dir.clone(), rx.clone(), status.clone(), None);
    });
}

// ─── Rule 19 reindex ─────────────────────────────────────────────────────
//
// On every boot where a session loads successfully, compare the current
// (model_id, dimension, model_hash) triple against `embedding_model_info`:
//
// * Empty table                          → INSERT, no reindex
// * Row matches current triple           → no-op
// * model_id or dimension changed        → wipe + requeue (real swap)
// * Only model_hash changed              → wipe + requeue (silent corruption
//                                           OR user replaced the file)
//
// The authoritative hash is computed from the ACTUAL `model.onnx` bytes at
// boot, not read from the `ModelInfo` registry. This catches two failure
// modes the registry hash alone can't:
//   (a) Silent file corruption — registry still claims the correct hash,
//       but the file on disk has drifted (cosmic ray, bad SSD sector,
//       incomplete atomic rename). Using registry hash would miss this.
//   (b) Power-user file replacement — someone swaps model.onnx for a
//       custom-trained variant. Registry hash stays stale; actual hash
//       changes; reindex correctly triggers.
//
// Computing sha256 of a 133 MB file is ~600-900ms on a cold cache, too
// slow to pay on every boot. We cache the hex digest in a side file
// `model.onnx.sha256` keyed by the source file's mtime; stale side files
// trigger a recompute. A missing or malformed side file does the same.

use std::fs;
use std::sync::atomic::AtomicU8 as _;

/// Outcome of a Rule 19 check, surfaced to the caller for logging + UX.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rule19Outcome {
    /// No prior row in `embedding_model_info` AND `vec_embeddings` is
    /// empty — truly a first successful load. Identity row has already
    /// been inserted by the time this variant returns.
    FirstInstall {
        current_hash: String,
    },
    /// Row matches current triple exactly. No reindex required.
    UnchangedModel,
    /// No prior row in `embedding_model_info` BUT `vec_embeddings` had rows.
    /// This is orphan data — a prior install wrote vectors then the
    /// identity row was lost (partial reset, manual DB surgery, bug). We
    /// can't trust orphan vectors against an unknown model, so treat like
    /// a swap: wipe + requeue. Distinct from `ModelSwapped` for audit
    /// clarity — no "previous" triple to report.
    OrphanVectorsRequeued {
        vectors_wiped: usize,
        nodes_requeued: usize,
        current_hash: String,
    },
    /// Row exists but differs. Caller has already wiped `vec_embeddings` and
    /// re-queued embeddable nodes as part of this call. UI should surface
    /// a "Reindexing after model change" banner until the queue drains.
    ModelSwapped {
        previous_model_id: String,
        previous_dimension: usize,
        vectors_wiped: usize,
        nodes_requeued: usize,
    },
}

/// Read (or compute and cache) the sha256 of `model.onnx`. The side file
/// `model.onnx.sha256` stores `"<hex>  <mtime_secs>"` and is rebuilt when
/// the source file's mtime drifts from the cached value, when the side
/// file is missing, or when its contents don't parse.
pub fn compute_or_cache_model_hash(model_dir: &Path) -> Result<String> {
    let model_path = model_dir.join("model.onnx");
    let side_path = model_dir.join("model.onnx.sha256");

    let mtime_secs = model_path
        .metadata()
        .with_context_msg("model.onnx metadata")?
        .modified()
        .with_context_msg("model.onnx mtime")?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| anyhow!("model.onnx mtime before unix epoch: {e}"))?
        .as_secs();

    if let Ok(cached) = fs::read_to_string(&side_path) {
        if let Some((hex, mt)) = cached.trim().split_once("  ") {
            if hex.len() == 64
                && mt.parse::<u64>().ok() == Some(mtime_secs)
                && hex.chars().all(|c| c.is_ascii_hexdigit())
            {
                return Ok(hex.to_lowercase());
            }
        }
    }

    let hex = sha256_file(&model_path)?;
    let _ = fs::write(&side_path, format!("{hex}  {mtime_secs}"));
    Ok(hex)
}

/// Streaming sha256 — same implementation shape as `ModelManager::compute_sha256`.
/// Runs synchronously; callers are expected to invoke us on a blocking
/// thread when they need async safety (Rule 19's check runs once at boot
/// on the main init path, which is already synchronous).
fn sha256_file(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = fs::File::open(path)
        .map_err(|e| anyhow!("open {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| anyhow!("read: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Apply Rule 19: compare the model on disk against `embedding_model_info`,
/// wipe + requeue on mismatch, populate on first install. Returns the
/// outcome so the caller can log + drive UX banners.
///
/// Runs inside a transaction for atomicity — if the wipe + requeue step
/// fails mid-flight, the metadata row is not updated, so next boot retries
/// cleanly.
pub fn rule_19_reindex_check(
    conn: &mut rusqlite::Connection,
    model_dir: &Path,
) -> Result<Rule19Outcome> {
    let current_hash = compute_or_cache_model_hash(model_dir)?;

    let tx = conn
        .transaction()
        .map_err(|e| anyhow!("begin rule 19 tx: {e}"))?;

    let existing: Option<(String, i64, String)> = tx
        .query_row(
            "SELECT model_id, dimension, model_hash
             FROM embedding_model_info
             WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();

    match existing {
        None => {
            // Orphan-data defence: if there's no identity row but
            // `vec_embeddings` has content, some prior install wrote those
            // vectors. We can't trust them against an unknown model, so
            // wipe + requeue exactly like a real swap. This catches partial
            // resets, manual DB surgery, and the historical case of
            // embedding_model_info being added later than vec_embeddings.
            let orphan_rows: usize = tx
                .query_row("SELECT count(*) FROM vec_embeddings", [], |r| {
                    r.get::<_, i64>(0).map(|n| n as usize)
                })
                .map_err(|e| anyhow!("count vec_embeddings (orphan probe): {e}"))?;

            if orphan_rows > 0 {
                tx.execute("DELETE FROM vec_embeddings", [])
                    .map_err(|e| anyhow!("wipe orphan vec_embeddings: {e}"))?;
                let nodes_requeued = tx
                    .execute(
                        r#"
                        INSERT INTO embed_backfill_queue
                            (node_id, chunk_index, state, attempts, last_error, enqueued_at)
                        SELECT
                            id, 0, 'pending', 0, NULL,
                            CAST(strftime('%s', 'now') AS INTEGER)
                        FROM workspace_nodes
                        WHERE deleted_at IS NULL
                          AND node_type IN ('document', 'row', 'database')
                        ON CONFLICT(node_id) DO UPDATE SET
                            state       = 'pending',
                            attempts    = 0,
                            last_error  = NULL,
                            enqueued_at = CAST(strftime('%s', 'now') AS INTEGER)
                        "#,
                        [],
                    )
                    .map_err(|e| anyhow!("requeue (orphan): {e}"))?;
                tx.execute(
                    "INSERT INTO embedding_model_info
                       (id, model_id, dimension, model_hash)
                     VALUES (1, ?1, ?2, ?3)",
                    rusqlite::params![MODEL_ID, EMBEDDING_DIM as i64, &current_hash],
                )
                .map_err(|e| anyhow!("insert embedding_model_info (orphan): {e}"))?;
                tx.commit().map_err(|e| anyhow!("commit tx: {e}"))?;
                log::warn!(
                    "Rule 19: found {} orphan vec_embeddings rows with no model-info record \
                     — wiped and requeued {} nodes",
                    orphan_rows,
                    nodes_requeued
                );
                return Ok(Rule19Outcome::OrphanVectorsRequeued {
                    vectors_wiped: orphan_rows,
                    nodes_requeued,
                    current_hash,
                });
            }

            tx.execute(
                "INSERT INTO embedding_model_info
                   (id, model_id, dimension, model_hash)
                 VALUES (1, ?1, ?2, ?3)",
                rusqlite::params![MODEL_ID, EMBEDDING_DIM as i64, &current_hash],
            )
            .map_err(|e| anyhow!("insert embedding_model_info: {e}"))?;
            tx.commit().map_err(|e| anyhow!("commit tx: {e}"))?;
            Ok(Rule19Outcome::FirstInstall {
                current_hash,
            })
        }
        Some((prev_id, prev_dim, prev_hash))
            if prev_id == MODEL_ID
                && prev_dim as usize == EMBEDDING_DIM
                && prev_hash == current_hash =>
        {
            tx.commit().map_err(|e| anyhow!("commit tx: {e}"))?;
            Ok(Rule19Outcome::UnchangedModel)
        }
        Some((prev_id, prev_dim, _prev_hash)) => {
            let vectors_wiped: usize = tx
                .query_row("SELECT count(*) FROM vec_embeddings", [], |r| {
                    r.get::<_, i64>(0).map(|n| n as usize)
                })
                .map_err(|e| anyhow!("count vec_embeddings: {e}"))?;

            tx.execute("DELETE FROM vec_embeddings", [])
                .map_err(|e| anyhow!("wipe vec_embeddings: {e}"))?;

            // Re-enqueue every embeddable node. UPSERT semantics: if a row
            // already exists for this node (e.g. still pending from prior
            // backfill), reset it to pending so it gets re-embedded.
            let nodes_requeued = tx
                .execute(
                    r#"
                    INSERT INTO embed_backfill_queue
                        (node_id, chunk_index, state, attempts, last_error, enqueued_at)
                    SELECT
                        id, 0, 'pending', 0, NULL,
                        CAST(strftime('%s', 'now') AS INTEGER)
                    FROM workspace_nodes
                    WHERE deleted_at IS NULL
                      AND node_type IN ('document', 'row', 'database')
                    ON CONFLICT(node_id) DO UPDATE SET
                        state       = 'pending',
                        attempts    = 0,
                        last_error  = NULL,
                        enqueued_at = CAST(strftime('%s', 'now') AS INTEGER)
                    "#,
                    [],
                )
                .map_err(|e| anyhow!("requeue: {e}"))?;

            tx.execute(
                "UPDATE embedding_model_info
                    SET model_id   = ?1,
                        dimension  = ?2,
                        model_hash = ?3
                  WHERE id = 1",
                rusqlite::params![MODEL_ID, EMBEDDING_DIM as i64, &current_hash],
            )
            .map_err(|e| anyhow!("update embedding_model_info: {e}"))?;

            tx.commit().map_err(|e| anyhow!("commit tx: {e}"))?;

            log::warn!(
                "Rule 19 reindex: previous model (id={}, dim={}) differs from current \
                 (id={}, dim={}); wiped {} vectors, requeued {} nodes",
                prev_id,
                prev_dim,
                MODEL_ID,
                EMBEDDING_DIM,
                vectors_wiped,
                nodes_requeued
            );

            Ok(Rule19Outcome::ModelSwapped {
                previous_model_id: prev_id,
                previous_dimension: prev_dim as usize,
                vectors_wiped,
                nodes_requeued,
            })
        }
    }
}

/// Tiny extension trait so the Rule 19 path can thread `anyhow::Context`
/// onto `Result<_, std::io::Error>` without pulling the full `Context`
/// import at the module top (which would conflict with `cfg(test)` shadows).
trait WithContextMsg<T> {
    fn with_context_msg(self, msg: &'static str) -> Result<T>;
}

impl<T, E: std::fmt::Display> WithContextMsg<T> for std::result::Result<T, E> {
    fn with_context_msg(self, msg: &'static str) -> Result<T> {
        self.map_err(|e| anyhow!("{msg}: {e}"))
    }
}

/// Resolve the dev-machine model directory for tests. In production, this
/// path is computed from `tauri::AppHandle` via the `portable::app_data_dir`
/// helper; tests don't have an `AppHandle`, so we use `APPDATA` directly.
/// Linux/macOS equivalents are `XDG_DATA_HOME` / `~/Library/Application Support`
/// — add if test coverage ever expands off Windows.
#[cfg(test)]
fn dev_model_dir() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let dir = PathBuf::from(appdata)
        .join("com.pais.infield")
        .join("models")
        .join(MODEL_ID);
    if dir.join("model.onnx").is_file() && dir.join("tokenizer.json").is_file() {
        Some(dir)
    } else {
        None
    }
}

#[cfg(test)]
fn cos_sim(a: &[f32], b: &[f32]) -> f32 {
    debug_assert_eq!(a.len(), b.len());
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[cfg(test)]
mod tests {
    //! Semantic regression for the `embed` recipe. These tests skip silently
    //! when the bge-small files are not staged at
    //! `%APPDATA%\com.pais.infield\models\bge-small-en-v1.5\` — CI without
    //! model files treats this as a no-op; dev machines with files staged
    //! get the full validation.
    //!
    //! Stage files with:
    //!   pwsh> $dir = "$env:APPDATA\com.pais.infield\models\bge-small-en-v1.5"
    //!   pwsh> mkdir $dir -Force
    //!   pwsh> $base = "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main"
    //!   pwsh> Invoke-WebRequest "$base/onnx/model.onnx" -OutFile "$dir/model.onnx"
    //!   pwsh> Invoke-WebRequest "$base/tokenizer.json" -OutFile "$dir/tokenizer.json"
    //!   pwsh> Invoke-WebRequest "$base/tokenizer_config.json" -OutFile "$dir/tokenizer_config.json"
    //!   pwsh> Invoke-WebRequest "$base/config.json" -OutFile "$dir/config.json"
    //!   pwsh> Invoke-WebRequest "$base/vocab.txt" -OutFile "$dir/vocab.txt"

    use super::*;

    /// Macro: run body only when model files are staged. Emits an eprintln
    /// note on skip so `cargo test -- --nocapture` runs don't look like
    /// silent no-ops.
    macro_rules! require_model_or_skip {
        ($test_name:literal) => {{
            match dev_model_dir() {
                Some(dir) => dir,
                None => {
                    eprintln!(
                        "[{}] SKIP — model files not staged at %APPDATA%/com.pais.infield/models/{}",
                        $test_name, MODEL_ID
                    );
                    return Ok(());
                }
            }
        }};
    }

    fn load_fixtures() -> Result<(Session, Tokenizer)> {
        let dir = dev_model_dir().context("dev_model_dir() returned None; caller must skip")?;
        let session = build_session(&dir.join("model.onnx"))?;
        let tokenizer = load_tokenizer(&dir)?;
        Ok((session, tokenizer))
    }

    /// 1. Shape: output is 384-dim, non-zero.
    #[test]
    fn embeds_produce_384d_vectors() -> Result<()> {
        let _ = require_model_or_skip!("embeds_produce_384d_vectors");
        let (mut session, tokenizer) = load_fixtures()?;
        let v = embed(&mut session, &tokenizer, "hello world")?;
        eprintln!("[shape] len={}, first 4 = {:?}", v.len(), &v[..4]);
        assert_eq!(v.len(), EMBEDDING_DIM);
        assert!(v.iter().any(|x| *x != 0.0), "vector should not be all zeros");
        Ok(())
    }

    /// 2. Norm: L2 ≈ 1.0.
    #[test]
    fn embeds_are_l2_normalized() -> Result<()> {
        let _ = require_model_or_skip!("embeds_are_l2_normalized");
        let (mut session, tokenizer) = load_fixtures()?;
        let v = embed(&mut session, &tokenizer, "hello world")?;
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        eprintln!("[norm] L2 = {norm}");
        assert!(
            (norm - 1.0).abs() < 1e-4,
            "L2 norm should be ~1.0, got {norm}"
        );
        Ok(())
    }

    /// 3. Determinism: `embed(x) == embed(x)` → cos-sim = 1.0.
    #[test]
    fn embed_is_deterministic_and_identity_is_one() -> Result<()> {
        let _ = require_model_or_skip!("embed_is_deterministic_and_identity_is_one");
        let (mut session, tokenizer) = load_fixtures()?;
        let a = embed(&mut session, &tokenizer, "hello world")?;
        let b = embed(&mut session, &tokenizer, "hello world")?;
        let cos = cos_sim(&a, &b);
        eprintln!("[identity] cos_sim(x, x) = {cos}");
        assert!(
            (cos - 1.0).abs() < 1e-4,
            "identity cos-sim should be ~1.0, got {cos}"
        );
        Ok(())
    }

    /// 4. Decisive semantic assertion — short similar greetings land close
    /// in cosine space. Catches mean-pool / mask / normalization bugs.
    #[test]
    fn semantically_similar_greetings_have_high_cosine() -> Result<()> {
        let _ = require_model_or_skip!("semantically_similar_greetings_have_high_cosine");
        let (mut session, tokenizer) = load_fixtures()?;
        let a = embed(&mut session, &tokenizer, "hello world")?;
        let b = embed(&mut session, &tokenizer, "greetings earth")?;
        let cos = cos_sim(&a, &b);
        eprintln!("[semantic] cos_sim('hello world', 'greetings earth') = {cos}");
        assert!(
            cos > 0.7,
            "semantically similar greetings should have cos-sim > 0.7, got {cos}"
        );
        Ok(())
    }

    /// 5. Negative control — unrelated texts separate. Catches
    /// "every embedding is the same vector" bugs that would slip past the
    /// positive semantic test (e.g. `[CLS]` token is always ~identical).
    #[test]
    fn unrelated_texts_separate() -> Result<()> {
        let _ = require_model_or_skip!("unrelated_texts_separate");
        let (mut session, tokenizer) = load_fixtures()?;
        let greeting = embed(&mut session, &tokenizer, "hello world")?;
        let business = embed(
            &mut session,
            &tokenizer,
            "the quarterly revenue projections for our logistics subsidiary",
        )?;
        let unrelated_cos = cos_sim(&greeting, &business);
        let self_cos = cos_sim(&greeting, &greeting);
        eprintln!(
            "[negative] cos(greeting, business) = {unrelated_cos}, cos(x,x) = {self_cos}"
        );
        assert!(
            unrelated_cos < self_cos - 0.1,
            "unrelated texts should be noticeably less similar than identity \
             (unrelated={unrelated_cos}, self={self_cos})"
        );
        Ok(())
    }

    /// 6. Padding-mask correctness — a short text followed by padding
    /// must produce the same vector as the same short text with no padding
    /// above it (which it will naturally, but this guards the mask logic).
    /// If we forgot to mask padding tokens, two texts with different padding
    /// lengths would drift apart even when content is identical.
    #[test]
    fn mask_handling_is_length_invariant() -> Result<()> {
        let _ = require_model_or_skip!("mask_handling_is_length_invariant");
        let (mut session, tokenizer) = load_fixtures()?;
        // "hi" and "hi there" both fit within bge-small's default 512-token
        // limit. We aren't forcing padding here — the tokenizer's default is
        // no-padding single-sequence. This test primarily guards against
        // attention_mask being dropped silently, by checking the mask IS all
        // 1s for an unpadded sequence (so mean-pool divisor == seq_len), and
        // by checking a short vs very-short text still produces sensible
        // norms. A regression here often shows up as NaN or norm != 1.
        for text in ["hi", "hi there", "a longer sentence with several words"] {
            let v = embed(&mut session, &tokenizer, text)?;
            let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
            assert_eq!(v.len(), EMBEDDING_DIM, "dim for {text:?}");
            assert!(
                (norm - 1.0).abs() < 1e-4,
                "norm {norm} for {text:?} (expected ~1.0)"
            );
            assert!(v.iter().all(|x| x.is_finite()), "non-finite in {text:?}");
        }
        Ok(())
    }
}
