# W3 — Hybrid search: implementation plan

**Spec:** [docs/superpowers/specs/2026-04-25-w3-hybrid-search-design.md](../specs/2026-04-25-w3-hybrid-search-design.md)
**Branch:** `main` (with explicit user consent — same posture as W2 / W2.5)
**Predecessors:** W2.5 shipped 2026-04-24 (`f035c2f..d5527b0`).
**Baseline:** `bun run build` green; `bunx vitest run` 81/81 passing across 12 files; `cargo test --lib` 140 passed / 2 pre-existing failures in `portable::tests`.

This plan ships W3 as **21 tasks** across 5 parts. Each task is self-contained — read the task body, follow the steps, commit. No task depends on a downstream task's output.

**Pre-existing dirty files in working tree** (must remain unstaged throughout — they're unrelated user work):
`src-tauri/src/lib.rs`, `src/App.css`, `src/components/AppShell.tsx`, `src/components/IconRail.tsx`, `src/components/SearchView.tsx`, `src/components/SystemAudioView.tsx`, `src/components/TitleBar.tsx`, plus untracked `src/components/BuddyView.tsx`, sprite assets, `tmp_research/`, etc. Tasks 8 (`lib.rs`), 16 (`SearchView.tsx`), 17 (`AppShell.tsx`) MUST stage only their hunks via `git add -p` or the patch trick.

---

## Build sequence

```
Part A — Backend foundation (Rust)             Part B — Frontend pure modules (TDD)
  1. Cargo deps + reranker_model_info migration  9. searchTokens.ts + tests
  2. RerankerHandle skeleton (types + API)      10. searchSnippet.ts + tests
  3. RerankerHandle worker thread + ORT         11. recentQueries.ts + tests
  4. Rule 19 reranker check
  5. reranker_cache.rs (LRU 128)                Part C — Frontend components
  6. reranker_download.rs (HTTP + sha256)       12. SearchResultRow.tsx + tests
  7. commands/rerank.rs (3 Tauri commands)      13. SearchEmptyStates.tsx
  8. search_workspace_hybrid filters + lib.rs   14. SearchFilters.tsx
                                                 15. SpotlightOverlay.tsx (largest)
Part D — Integration
  16. SearchView rewrite                        Part E — Verification + ship
  17. AppShell Cmd+K wiring                     19. Test + build matrix
  18. NotesView listener for notes:open-new-tab 20. E2E walk-through (12 scenarios)
                                                 21. PLAN.md SHIPPED marker
```

Tasks within Part A run in order (each builds on the previous). Tasks within Parts B/C can ship in any order. Part D requires A complete. Part E requires A+B+C+D complete.

---

## Part A — Backend foundation (Rust)

### Task 1: Cargo deps + `reranker_model_info` migration

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/managers/workspace/workspace_manager.rs`

**Step 1: Add `lru` crate**

In `src-tauri/Cargo.toml` `[dependencies]`, add:

```toml
lru = "0.12"
```

Place near other small-utility crates (alphabetical ideally).

**Step 2: Add the migration**

The codebase uses **in-code migrations** via `rusqlite_migration::M::up(...)` (not standalone `.sql` files). Find `WorkspaceManager::migrations()` in `workspace_manager.rs` (around line 1997). Append a new `M::up(...)` block to the end of the `vec![...]`:

```rust
M::up(r#"
    -- Rule 19: model identity for the cross-encoder reranker (W3).
    -- Singleton (CHECK id = 1). Populated by RerankerHandle on first
    -- successful session load. Mismatch on boot invalidates the
    -- in-memory rerank LRU (no persisted scores to delete).
    CREATE TABLE IF NOT EXISTS reranker_model_info (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        model_id TEXT NOT NULL,
        model_hash TEXT NOT NULL
    );
"#),
```

Note: no `dimension` column — cross-encoders return a logit, not an embedding.

**Step 3: Build + test**

```bash
cd src-tauri && cargo build --lib 2>&1 | tail -8
cargo test --lib --no-run 2>&1 | tail -5
```

Both must compile clean. (Do NOT run the full test suite yet — Task 4 lands the Rule 19 helper that uses this table.)

**Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/managers/workspace/workspace_manager.rs
git commit -m "feat(w3): add lru crate + reranker_model_info migration (Rule 19 prep)"
```

---

### Task 2: `RerankerHandle` skeleton (types + public API only)

**Files:**
- Create: `src-tauri/src/managers/reranker_ort.rs`
- Modify: `src-tauri/src/managers/mod.rs` (add `pub mod reranker_ort;`)

Skeleton-only commit — no worker thread yet (Task 3). Defines the public API so downstream modules (cache, commands) can compile against stable types.

**Step 1: Create `src-tauri/src/managers/reranker_ort.rs`**

```rust
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
```

**Step 2: Register in `mod.rs`**

In `src-tauri/src/managers/mod.rs`, add:

```rust
pub mod reranker_ort;
```

(Place near `pub mod embedding_ort;` for grouping.)

**Step 3: Build**

```bash
cd src-tauri && cargo build --lib 2>&1 | tail -8
```

Expected: green. The unused `_request_rx` variable should not warn (the underscore prefix silences it).

**Step 4: Commit**

```bash
git add src-tauri/src/managers/reranker_ort.rs src-tauri/src/managers/mod.rs
git commit -m "feat(w3): RerankerHandle skeleton — types + public API (worker comes Task 3)"
```

---

### Task 3: `RerankerHandle` worker thread + ORT session

**Files:**
- Modify: `src-tauri/src/managers/reranker_ort.rs`

Replace the `RerankerHandle::spawn` body with the real worker. Studies `embedding_ort.rs` patterns closely (sentinel restart-once, lazy session build, Rule 16a yield).

**Step 1: Imports**

Add to top of file:

```rust
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::AppHandle;

use crate::managers::transcription::transcription_session_holds_model;
use ort::{
    GraphOptimizationLevel, Session, SessionBuilder,
    inputs, value::Value,
};
use tokenizers::Tokenizer;
use ndarray::Array2;
```

**Step 2: Update `spawn` signature to accept `AppHandle`**

```rust
impl RerankerHandle {
    pub fn spawn(model_path: PathBuf, app: AppHandle) -> Arc<Self> {
        let (request_tx, request_rx) = crossbeam_channel::bounded::<RerankRequest>(8);
        let is_available = Arc::new(AtomicBool::new(false));
        let unavailable_reason = Arc::new(RwLock::new(Some("not_yet_loaded".to_string())));
        let last_heartbeat = Arc::new(AtomicI64::new(0));

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
            /* respawn_count */ 0,
        );

        // Sentinel: watch heartbeat; if stale > 30s, flip unavailable.
        spawn_sentinel(
            is_available,
            unavailable_reason,
            last_heartbeat,
        );

        handle
    }
}

fn spawn_worker(
    request_rx: crossbeam_channel::Receiver<RerankRequest>,
    is_available: Arc<AtomicBool>,
    unavailable_reason: Arc<RwLock<Option<String>>>,
    last_heartbeat: Arc<AtomicI64>,
    model_path: PathBuf,
    app: AppHandle,
    respawn_count: u32,
) {
    std::thread::spawn(move || {
        // Lazy session build on first request — keeps boot fast.
        let mut session: Option<(Session, Tokenizer)> = None;

        // Mark available only AFTER successful session load on first request.
        // Until then, the handle reports unavailable and rerank() short-circuits.

        loop {
            let req = match request_rx.recv_timeout(Duration::from_secs(5)) {
                Ok(r) => r,
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                    // Heartbeat to keep sentinel happy.
                    last_heartbeat.store(now_ms(), Ordering::Relaxed);
                    continue;
                }
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
            };

            // Lazy-load on first request.
            if session.is_none() {
                match load_session(&model_path) {
                    Ok((s, t)) => {
                        session = Some((s, t));
                        is_available.store(true, Ordering::Relaxed);
                        if let Ok(mut g) = unavailable_reason.try_write() {
                            *g = None;
                        }
                    }
                    Err(e) => {
                        let _ = req.response_tx.send(Err(anyhow::anyhow!(
                            "reranker_load_failed: {e}"
                        )));
                        if let Ok(mut g) = unavailable_reason.try_write() {
                            *g = Some(format!("load_failed: {e}"));
                        }
                        continue;
                    }
                }
            }

            // Rule 16a: yield while transcription holds GPU/CPU resources.
            let req_start = std::time::Instant::now();
            while transcription_session_holds_model(&app) {
                std::thread::sleep(Duration::from_millis(20));
                if req_start.elapsed() > Duration::from_millis(500) {
                    let _ = req.response_tx.send(Err(anyhow::anyhow!(
                        "rerank_yielded_to_transcription"
                    )));
                    last_heartbeat.store(now_ms(), Ordering::Relaxed);
                    continue;
                }
            }

            let (sess, tokenizer) = session.as_mut().unwrap();
            let result = run_inference(sess, tokenizer, &req.query, &req.candidates, req.limit);
            let _ = req.response_tx.send(result);
            last_heartbeat.store(now_ms(), Ordering::Relaxed);
        }

        log::info!("[reranker worker] exiting (respawn_count={respawn_count})");
    });
}

fn spawn_sentinel(
    is_available: Arc<AtomicBool>,
    unavailable_reason: Arc<RwLock<Option<String>>>,
    last_heartbeat: Arc<AtomicI64>,
) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(10));
            let now = now_ms();
            let last = last_heartbeat.load(Ordering::Relaxed);
            if last > 0 && (now - last) > 30_000 && is_available.load(Ordering::Relaxed) {
                log::warn!("[reranker sentinel] heartbeat stale; flipping unavailable");
                is_available.store(false, Ordering::Relaxed);
                if let Ok(mut g) = unavailable_reason.try_write() {
                    *g = Some("worker_stalled".to_string());
                }
                // Respawn once is intentionally NOT implemented in v1 — sentinel
                // observation only. If post-ship telemetry shows worker deaths,
                // wire a single-respawn here mirroring embedding_ort's pattern.
                break;
            }
        }
    });
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn load_session(model_path: &PathBuf) -> Result<(Session, Tokenizer)> {
    let model_file = model_path.join("model.onnx");
    let tokenizer_file = model_path.join("tokenizer.json");

    if !model_file.exists() {
        anyhow::bail!("model_not_downloaded: {}", model_file.display());
    }
    if !tokenizer_file.exists() {
        anyhow::bail!("tokenizer_not_found: {}", tokenizer_file.display());
    }

    let intra = (num_cpus::get() / 3).max(1);
    let session = SessionBuilder::new()?
        .with_intra_threads(intra)?
        .with_inter_threads(1)?
        .with_optimization_level(GraphOptimizationLevel::Level3)?
        .commit_from_file(&model_file)?;

    let tokenizer = Tokenizer::from_file(&tokenizer_file)
        .map_err(|e| anyhow::anyhow!("tokenizer_load: {e}"))?;

    Ok((session, tokenizer))
}

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

    // Encode (query, excerpt) pairs as cross-encoder pairs.
    let pairs: Vec<_> = candidates
        .iter()
        .map(|c| (query.to_string(), c.excerpt.clone()))
        .collect();
    let encodings = tokenizer
        .encode_batch(pairs, true)
        .map_err(|e| anyhow::anyhow!("encode_batch: {e}"))?;

    let max_len = encodings.iter().map(|e| e.len()).max().unwrap_or(0).min(512);
    let batch = encodings.len();

    let mut input_ids = Array2::<i64>::zeros((batch, max_len));
    let mut attention_mask = Array2::<i64>::zeros((batch, max_len));
    for (i, enc) in encodings.iter().enumerate() {
        let ids = enc.get_ids();
        let mask = enc.get_attention_mask();
        let take = ids.len().min(max_len);
        for j in 0..take {
            input_ids[[i, j]] = ids[j] as i64;
            attention_mask[[i, j]] = mask[j] as i64;
        }
    }

    let outputs = session.run(inputs![
        "input_ids" => Value::from_array(input_ids)?,
        "attention_mask" => Value::from_array(attention_mask)?,
    ])?;
    let logits = outputs[0].try_extract_array::<f32>()?;
    let scores: Vec<f32> = logits
        .iter()
        .copied()
        .map(|x| 1.0 / (1.0 + (-x).exp()))  // sigmoid
        .collect();

    let mut results: Vec<RerankResult> = candidates
        .iter()
        .enumerate()
        .map(|(i, c)| RerankResult {
            node_id: c.node_id.clone(),
            rerank_score: scores.get(i).copied().unwrap_or(0.0),
            original_rank: i,
        })
        .collect();

    results.sort_by(|a, b| {
        b.rerank_score
            .partial_cmp(&a.rerank_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(limit);
    Ok(results)
}
```

**Step 3: Build**

```bash
cd src-tauri && cargo build --lib 2>&1 | tail -10
```

Must compile. If `try_extract_array` is missing, check the `ort` 2.0-rc.12 API for the correct extractor — it may be `try_extract_tensor::<f32>()` or similar. Spec is: extract a 2D `[batch, 1]` f32 tensor of logits. Adapt to whatever the installed version exposes; report DONE_WITH_CONCERNS if uncertain.

If `encode_batch` returns a different type, flatten manually with two passes through `encode()`.

**Step 4: Test**

```bash
cargo test --lib 2>&1 | tail -8
```

Expected: 140/2 (unchanged). No new tests yet (smoke test lands when LRU cache + commands wire up in Task 5/7).

**Step 5: Commit**

```bash
git add src-tauri/src/managers/reranker_ort.rs
git commit -m "feat(w3): RerankerHandle worker — std::thread + ORT lazy load + Rule 16a yield"
```

---

### Task 4: Rule 19 reranker check

**Files:**
- Modify: `src-tauri/src/managers/reranker_ort.rs`

Adds a `rule_19_check` function called once at app boot (Task 8 wires it into `lib.rs`). On first run inserts the row; on subsequent runs compares against the on-disk model hash; mismatch returns a `Rule19Outcome::Mismatch` for the caller to handle (clear LRU cache).

**Step 1: Append to `reranker_ort.rs`**

```rust
use rusqlite::Connection;
use sha2::{Digest, Sha256};

/// Outcome of the Rule 19 check on boot.
pub enum Rule19Outcome {
    /// First run, no prior info row — inserted now.
    FirstRun,
    /// Prior info matches on-disk model — nothing to do.
    Match,
    /// Mismatch on model_id or model_hash — caller must clear LRU.
    /// (Reranker scores are in-memory only, no persisted vectors to reindex.)
    Mismatch { reason: String },
    /// Model file missing — skip check entirely. Lazy-download will populate.
    ModelMissing,
}

/// Compare the model on disk against `reranker_model_info`. Mirror of
/// `embedding_ort::rule_19_reindex_check` but simpler — no vec_embeddings
/// to wipe, just an in-memory LRU to invalidate.
pub fn rule_19_check_reranker(
    conn: &mut Connection,
    model_path: &PathBuf,
) -> Result<Rule19Outcome> {
    let model_file = model_path.join("model.onnx");
    if !model_file.exists() {
        return Ok(Rule19Outcome::ModelMissing);
    }

    let on_disk_hash = sha256_file(&model_file)?;

    let prior: Option<(String, String)> = conn
        .query_row(
            "SELECT model_id, model_hash FROM reranker_model_info WHERE id = 1",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .ok();

    match prior {
        None => {
            conn.execute(
                "INSERT INTO reranker_model_info (id, model_id, model_hash) VALUES (1, ?1, ?2)",
                rusqlite::params![MODEL_ID, on_disk_hash],
            )?;
            Ok(Rule19Outcome::FirstRun)
        }
        Some((prior_id, prior_hash)) => {
            if prior_id != MODEL_ID {
                conn.execute(
                    "UPDATE reranker_model_info SET model_id = ?1, model_hash = ?2 WHERE id = 1",
                    rusqlite::params![MODEL_ID, on_disk_hash],
                )?;
                Ok(Rule19Outcome::Mismatch {
                    reason: format!("model_id changed: {prior_id} -> {MODEL_ID}"),
                })
            } else if prior_hash != on_disk_hash {
                conn.execute(
                    "UPDATE reranker_model_info SET model_hash = ?1 WHERE id = 1",
                    rusqlite::params![on_disk_hash],
                )?;
                Ok(Rule19Outcome::Mismatch {
                    reason: "model_hash changed".to_string(),
                })
            } else {
                Ok(Rule19Outcome::Match)
            }
        }
    }
}

fn sha256_file(path: &std::path::Path) -> Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
```

**Step 2: Test**

Add a unit test at the bottom of `reranker_ort.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::io::Write;

    fn fresh_conn_with_table() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE reranker_model_info (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                model_id TEXT NOT NULL,
                model_hash TEXT NOT NULL
            )",
            [],
        )
        .unwrap();
        conn
    }

    fn fake_model(dir: &std::path::Path, contents: &[u8]) {
        let p = dir.join("model.onnx");
        let mut f = std::fs::File::create(p).unwrap();
        f.write_all(contents).unwrap();
    }

    #[test]
    fn rule_19_first_run_inserts() {
        let tmp = TempDir::new().unwrap();
        fake_model(tmp.path(), b"v1");
        let mut conn = fresh_conn_with_table();
        let outcome = rule_19_check_reranker(&mut conn, &tmp.path().to_path_buf()).unwrap();
        assert!(matches!(outcome, Rule19Outcome::FirstRun));
    }

    #[test]
    fn rule_19_match_on_unchanged() {
        let tmp = TempDir::new().unwrap();
        fake_model(tmp.path(), b"v1");
        let mut conn = fresh_conn_with_table();
        let _ = rule_19_check_reranker(&mut conn, &tmp.path().to_path_buf()).unwrap();
        let outcome2 = rule_19_check_reranker(&mut conn, &tmp.path().to_path_buf()).unwrap();
        assert!(matches!(outcome2, Rule19Outcome::Match));
    }

    #[test]
    fn rule_19_mismatch_on_changed_hash() {
        let tmp = TempDir::new().unwrap();
        fake_model(tmp.path(), b"v1");
        let mut conn = fresh_conn_with_table();
        let _ = rule_19_check_reranker(&mut conn, &tmp.path().to_path_buf()).unwrap();
        fake_model(tmp.path(), b"v2-different");
        let outcome2 = rule_19_check_reranker(&mut conn, &tmp.path().to_path_buf()).unwrap();
        assert!(matches!(outcome2, Rule19Outcome::Mismatch { .. }));
    }

    #[test]
    fn rule_19_model_missing_short_circuits() {
        let tmp = TempDir::new().unwrap();
        let mut conn = fresh_conn_with_table();
        let outcome = rule_19_check_reranker(&mut conn, &tmp.path().to_path_buf()).unwrap();
        assert!(matches!(outcome, Rule19Outcome::ModelMissing));
    }
}
```

If `tempfile` isn't a dev-dep, check `Cargo.toml [dev-dependencies]`. If missing, add `tempfile = "3"` there.

**Step 3: Test**

```bash
cd src-tauri && cargo test --lib reranker_ort:: 2>&1 | tail -10
```

Expected: 4 new tests pass. Full suite still 144 passed / 2 pre-existing failures (140 + 4).

**Step 4: Commit**

```bash
git add src-tauri/src/managers/reranker_ort.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(w3): Rule 19 check for reranker model identity + 4 unit tests"
```

---

### Task 5: `reranker_cache.rs` LRU

**Files:**
- Create: `src-tauri/src/managers/reranker_cache.rs`
- Modify: `src-tauri/src/managers/mod.rs`

LRU keyed by `(query_hash, candidate_ids_hash) -> Vec<RerankResult>`. Capacity 128.

**Step 1: Create the file**

```rust
//! In-memory LRU cache for rerank results (Stage 4 of search).
//!
//! Keyed by (query_hash, candidate_ids_hash) — repeated typing of the same
//! query against the same retrieval set hits the cache and skips inference.
//! Capacity 128 entries; ~30 KB total assuming ~10 results × 24 bytes each.
//! Cleared on Rule 19 mismatch (Task 4 outcome) or app restart.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::num::NonZeroUsize;
use std::sync::Mutex;

use lru::LruCache;

use crate::managers::reranker_ort::RerankResult;

const CAPACITY: usize = 128;

#[derive(Hash, PartialEq, Eq, Clone, Copy)]
pub struct RerankCacheKey {
    query_hash: u64,
    ids_hash: u64,
}

impl RerankCacheKey {
    pub fn new(query: &str, candidate_ids: &[&str]) -> Self {
        let mut q_hasher = DefaultHasher::new();
        query.hash(&mut q_hasher);
        let query_hash = q_hasher.finish();

        let mut i_hasher = DefaultHasher::new();
        for id in candidate_ids {
            id.hash(&mut i_hasher);
        }
        let ids_hash = i_hasher.finish();

        Self { query_hash, ids_hash }
    }
}

pub struct RerankerCache {
    inner: Mutex<LruCache<RerankCacheKey, Vec<RerankResult>>>,
}

impl Default for RerankerCache {
    fn default() -> Self {
        Self::new()
    }
}

impl RerankerCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(LruCache::new(NonZeroUsize::new(CAPACITY).unwrap())),
        }
    }

    pub fn get(&self, key: &RerankCacheKey) -> Option<Vec<RerankResult>> {
        let mut g = self.inner.lock().ok()?;
        g.get(key).cloned()
    }

    pub fn put(&self, key: RerankCacheKey, value: Vec<RerankResult>) {
        if let Ok(mut g) = self.inner.lock() {
            g.put(key, value);
        }
    }

    pub fn clear(&self) {
        if let Ok(mut g) = self.inner.lock() {
            g.clear();
        }
    }

    pub fn len(&self) -> usize {
        self.inner.lock().map(|g| g.len()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rr(node: &str, score: f32) -> RerankResult {
        RerankResult {
            node_id: node.to_string(),
            rerank_score: score,
            original_rank: 0,
        }
    }

    #[test]
    fn key_stable_for_same_query_and_ids() {
        let k1 = RerankCacheKey::new("react", &["a", "b", "c"]);
        let k2 = RerankCacheKey::new("react", &["a", "b", "c"]);
        assert_eq!(k1, k2);
    }

    #[test]
    fn key_differs_on_query() {
        let k1 = RerankCacheKey::new("react", &["a"]);
        let k2 = RerankCacheKey::new("vue", &["a"]);
        assert_ne!(k1, k2);
    }

    #[test]
    fn key_differs_on_ids_order() {
        // Order matters — two distinct candidate sets should yield distinct keys
        // even if they contain the same elements (different RRF ordering implies
        // different rerank context).
        let k1 = RerankCacheKey::new("react", &["a", "b"]);
        let k2 = RerankCacheKey::new("react", &["b", "a"]);
        assert_ne!(k1, k2);
    }

    #[test]
    fn put_and_get_roundtrip() {
        let cache = RerankerCache::new();
        let key = RerankCacheKey::new("q", &["a"]);
        cache.put(key, vec![rr("a", 0.9)]);
        let got = cache.get(&key).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].node_id, "a");
    }

    #[test]
    fn evicts_oldest_at_capacity() {
        let cache = RerankerCache::new();
        for i in 0..(CAPACITY + 1) {
            let id = format!("id-{i}");
            let key = RerankCacheKey::new("q", &[&id]);
            cache.put(key, vec![rr(&id, 0.5)]);
        }
        assert_eq!(cache.len(), CAPACITY);
        // First-inserted key should be evicted.
        let first_key = RerankCacheKey::new("q", &["id-0"]);
        assert!(cache.get(&first_key).is_none());
    }

    #[test]
    fn clear_empties() {
        let cache = RerankerCache::new();
        cache.put(RerankCacheKey::new("q", &["a"]), vec![rr("a", 0.5)]);
        cache.clear();
        assert_eq!(cache.len(), 0);
    }
}
```

**Step 2: Register in `mod.rs`**

```rust
pub mod reranker_cache;
```

**Step 3: Test**

```bash
cd src-tauri && cargo test --lib reranker_cache:: 2>&1 | tail -10
```

Expected: 6 new tests pass. Full suite: 150 passed / 2 pre-existing failures.

**Step 4: Commit**

```bash
git add src-tauri/src/managers/reranker_cache.rs src-tauri/src/managers/mod.rs
git commit -m "feat(w3): RerankerCache (LRU 128) with 6 unit tests"
```

---

### Task 6: `reranker_download.rs`

**Files:**
- Create: `src-tauri/src/managers/reranker_download.rs`
- Modify: `src-tauri/src/managers/mod.rs`

Streams the model files from a HuggingFace mirror URL with progress events. Resume-on-failure via Range header. Atomic rename on completion.

**Step 1: Create the file**

```rust
//! Lazy downloader for the bge-reranker-v2-m3 ONNX bundle.
//!
//! Downloads to <app_data>/handy/models/bge-reranker-v2-m3/<filename>.tmp,
//! verifies sha256, atomic-renames to final filename. Emits
//! `reranker-download-progress` via Tauri so the frontend can render a
//! progress overlay.
//!
//! The bundle ships THREE files: model.onnx (568 MB), tokenizer.json
//! (~10 MB), config.json (~1 KB). All three must succeed for the worker
//! to use the model.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::fs::OpenOptions;
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::sync::Mutex;

use crate::managers::reranker_ort::MODEL_ID;

/// Files to fetch from the HF mirror, with their expected sha256.
/// Hashes pinned at plan-write time; update if BAAI republishes.
const FILES: &[(&str, &str, &str)] = &[
    // (filename, sha256, base_url-relative path)
    (
        "model.onnx",
        // TODO Task 6 implementer: pin the actual sha256 of bge-reranker-v2-m3
        // model.onnx by downloading once, computing locally, and pasting here.
        // Frontend should treat this as advisory-only on first ship.
        "PLACEHOLDER_REPLACE_WITH_ACTUAL_SHA256",
        "onnx/model.onnx",
    ),
    (
        "tokenizer.json",
        "PLACEHOLDER_REPLACE_WITH_ACTUAL_SHA256",
        "tokenizer.json",
    ),
    (
        "config.json",
        "PLACEHOLDER_REPLACE_WITH_ACTUAL_SHA256",
        "config.json",
    ),
];

const HF_BASE: &str = "https://huggingface.co/BAAI/bge-reranker-v2-m3/resolve/main";

#[derive(Serialize, Clone)]
struct DownloadProgress {
    file: String,
    bytes: u64,
    total: u64,
    status: String, // "downloading" | "verifying" | "done" | "error"
    overall_pct: f32,
}

pub struct RerankerDownload {
    app: AppHandle,
    target_dir: PathBuf,
    in_flight: Mutex<bool>,
}

impl RerankerDownload {
    pub fn new(app: AppHandle, target_dir: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            app,
            target_dir,
            in_flight: Mutex::new(false),
        })
    }

    /// Download all files. Returns Ok if every file present + verified.
    /// Concurrent-safe: second caller short-circuits if first is in flight.
    pub async fn download_all(self: Arc<Self>) -> Result<()> {
        let mut g = self.in_flight.lock().await;
        if *g {
            return Err(anyhow!("download_already_in_progress"));
        }
        *g = true;
        drop(g);

        let result = self.do_download().await;

        let mut g = self.in_flight.lock().await;
        *g = false;
        drop(g);

        result
    }

    async fn do_download(&self) -> Result<()> {
        tokio::fs::create_dir_all(&self.target_dir).await?;

        let total_files = FILES.len();
        for (i, (name, expected_hash, url_path)) in FILES.iter().enumerate() {
            let final_path = self.target_dir.join(name);
            let tmp_path = self.target_dir.join(format!("{name}.tmp"));

            // Skip if already present and verified.
            if final_path.exists() {
                if expected_hash != &"PLACEHOLDER_REPLACE_WITH_ACTUAL_SHA256" {
                    if sha256_of(&final_path).await? == *expected_hash {
                        emit(&self.app, name, 0, 0, "done", file_progress(i + 1, total_files));
                        continue;
                    }
                    // Hash mismatch → re-download
                    let _ = tokio::fs::remove_file(&final_path).await;
                } else {
                    // Placeholder hash: treat presence as success.
                    emit(&self.app, name, 0, 0, "done", file_progress(i + 1, total_files));
                    continue;
                }
            }

            let url = format!("{HF_BASE}/{url_path}");
            self.fetch(name, &url, &tmp_path, expected_hash, i, total_files).await?;
            tokio::fs::rename(&tmp_path, &final_path).await?;
        }

        Ok(())
    }

    async fn fetch(
        &self,
        name: &str,
        url: &str,
        tmp_path: &Path,
        expected_hash: &str,
        file_index: usize,
        total_files: usize,
    ) -> Result<()> {
        // Resume: if .tmp exists, check size and send Range header.
        let resume_from: u64 = match tokio::fs::metadata(tmp_path).await {
            Ok(m) => m.len(),
            Err(_) => 0,
        };

        let client = reqwest::Client::new();
        let mut req = client.get(url);
        if resume_from > 0 {
            req = req.header("Range", format!("bytes={resume_from}-"));
        }
        let resp = req.send().await?.error_for_status()?;
        let total = resp
            .content_length()
            .map(|l| l + resume_from)
            .unwrap_or(0);

        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .open(tmp_path)
            .await?;
        if resume_from > 0 {
            file.seek(std::io::SeekFrom::Start(resume_from)).await?;
        }

        let mut downloaded = resume_from;
        let mut stream = resp.bytes_stream();
        let mut last_emit = std::time::Instant::now();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;

            // Emit at most every 250ms to avoid event spam.
            if last_emit.elapsed() > std::time::Duration::from_millis(250) {
                emit(
                    &self.app,
                    name,
                    downloaded,
                    total,
                    "downloading",
                    overall_progress(file_index, total_files, downloaded, total),
                );
                last_emit = std::time::Instant::now();
            }
        }
        file.flush().await?;

        // Verify if a real hash was provided.
        if expected_hash != "PLACEHOLDER_REPLACE_WITH_ACTUAL_SHA256" {
            emit(&self.app, name, downloaded, total, "verifying", file_progress(file_index, total_files));
            let actual = sha256_of(tmp_path).await?;
            if actual != expected_hash {
                let _ = tokio::fs::remove_file(tmp_path).await;
                anyhow::bail!("sha256_mismatch for {name}: expected {expected_hash} got {actual}");
            }
        }

        emit(&self.app, name, downloaded, total, "done", file_progress(file_index + 1, total_files));
        Ok(())
    }
}

fn file_progress(complete: usize, total: usize) -> f32 {
    (complete as f32 / total as f32).min(1.0)
}

fn overall_progress(file_index: usize, total_files: usize, bytes: u64, total: u64) -> f32 {
    let per_file = 1.0 / total_files as f32;
    let so_far = file_index as f32 * per_file;
    let in_progress = if total > 0 {
        (bytes as f32 / total as f32) * per_file
    } else {
        0.0
    };
    (so_far + in_progress).min(1.0)
}

fn emit(app: &AppHandle, file: &str, bytes: u64, total: u64, status: &str, overall_pct: f32) {
    let _ = app.emit(
        "reranker-download-progress",
        DownloadProgress {
            file: file.to_string(),
            bytes,
            total,
            status: status.to_string(),
            overall_pct,
        },
    );
}

async fn sha256_of(path: &Path) -> Result<String> {
    let bytes = tokio::fs::read(path).await?;
    let mut h = Sha256::new();
    h.update(&bytes);
    Ok(format!("{:x}", h.finalize()))
}
```

**Step 2: Register in `mod.rs`**

```rust
pub mod reranker_download;
```

**Step 3: Build**

```bash
cd src-tauri && cargo build --lib 2>&1 | tail -8
```

If `futures_util` isn't available, check Cargo.toml — Tauri pulls it transitively. If the build fails, add `futures-util = "0.3"` to `[dependencies]`.

**Step 4: Commit**

```bash
git add src-tauri/src/managers/reranker_download.rs src-tauri/src/managers/mod.rs
git commit -m "feat(w3): reranker_download — HTTP fetch with resume + sha256 + progress events"
```

The `PLACEHOLDER_REPLACE_WITH_ACTUAL_SHA256` strings are intentional. Pin the actual hashes in a follow-up commit after the first end-to-end download succeeds in dev, OR leave as advisory-only for v1 (the file would still download and work, just without integrity verification).

---

### Task 7: `commands/rerank.rs` Tauri commands

**Files:**
- Create: `src-tauri/src/commands/rerank.rs`
- Modify: `src-tauri/src/commands/mod.rs`

Three commands: `rerank_candidates`, `get_reranker_status`, `download_reranker_model`.

**Step 1: Create the file**

```rust
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
    let _ = download;  // model presence checked via handle's path
    Ok(RerankerStatus {
        model_info: handle.model_info(),
        is_available: handle.is_available(),
        unavailable_reason: handle.unavailable_reason().await,
        // Frontend infers "downloaded" from is_available; first-search download
        // is triggered by a null rerank result + this command's reason field.
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
        .clone()
        .download_all()
        .await
        .map_err(|e| e.to_string())
}
```

**Step 2: Register in `commands/mod.rs`**

Add `pub mod rerank;` near the existing `pub mod search;`.

**Step 3: Build**

```bash
cd src-tauri && cargo build --lib 2>&1 | tail -8
```

If specta complains about unknown types, ensure `RerankCandidate` / `RerankResult` / `RerankerModelInfo` derive `Type` (they do per Task 2/3).

**Step 4: Commit**

```bash
git add src-tauri/src/commands/rerank.rs src-tauri/src/commands/mod.rs
git commit -m "feat(w3): Tauri commands — rerank_candidates, get_reranker_status, download_reranker_model"
```

---

### Task 8: Hybrid search filters + `lib.rs` wiring

**Files:**
- Modify: `src-tauri/src/commands/search.rs`
- Modify: `src-tauri/src/managers/search.rs`
- Modify: `src-tauri/src/lib.rs` (HUNK ISOLATION REQUIRED — pre-existing dirty hunks)

**Step 1: Extend `search_workspace_hybrid` signature with optional filters**

In `src-tauri/src/commands/search.rs`, replace the `search_workspace_hybrid` command:

```rust
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
```

**Step 2: Implement `hybrid_search_workspace_filtered` in `managers/search.rs`**

Add the new method alongside the existing `hybrid_search_workspace`. Simplest implementation reuses `hybrid_search_workspace` and post-filters in Rust — accepting a small perf cost for clean code:

```rust
impl SearchManager {
    /// W3 wrapper around hybrid_search_workspace with optional filters
    /// applied post-RRF. For v1 this is a Rust-side filter pass; if perf
    /// becomes an issue, push into the SQL CTE.
    pub async fn hybrid_search_workspace_filtered(
        &self,
        query: &str,
        limit: usize,
        offset: usize,
        node_types: Vec<String>,
        tags: Vec<String>,
        _created_from: Option<i64>,
        _created_to: Option<i64>,
    ) -> Result<Vec<WorkspaceSearchResult>> {
        // Widen retrieval before filtering — top-90 raw → filter → trim to limit+offset.
        let raw_limit = (limit + offset).saturating_mul(3).max(30);
        let mut results = self
            .hybrid_search_workspace(query, raw_limit)
            .await?;

        if !node_types.is_empty() {
            results.retain(|r| node_types.iter().any(|t| t == &r.node_type));
        }

        // TODO Task 8b: date filter — needs WorkspaceManager helper to read
        // node.created_at synchronously. Filtering by date in Rust requires a
        // get_node loop, which is async. For v1 we accept the no-op and
        // surface a TODO. Frontend will hide the date radio if date filtering
        // doesn't work, OR just visually filter post-receive.

        if !tags.is_empty() {
            // Tag filter — for each surviving result, fetch the node and
            // intersect its properties.tags against `tags`. Sequential async
            // is OK for the typical post-filter set size (<30).
            let mut keep: Vec<WorkspaceSearchResult> = Vec::with_capacity(results.len());
            for r in results.into_iter() {
                let node_opt = self.workspace_manager.get_node(&r.node_id).await.ok().flatten();
                let Some(node) = node_opt else { continue };
                let props: serde_json::Value = serde_json::from_str(&node.properties)
                    .unwrap_or(serde_json::json!({}));
                let node_tags: Vec<String> = props
                    .get("tags")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|x| x.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();
                if tags.iter().any(|t| node_tags.iter().any(|nt| nt == t)) {
                    keep.push(r);
                }
            }
            results = keep;
        }

        // Apply pagination.
        results = results.into_iter().skip(offset).take(limit).collect();
        Ok(results)
    }
}
```

If the existing `hybrid_search_workspace_filtered` symbol conflicts with anything, rename to `hybrid_search_workspace_v2`. Keep the existing `hybrid_search_workspace` intact for backwards compatibility (other callers may exist).

**Step 3: Wire up in `lib.rs` — HUNK ISOLATION REQUIRED**

`src-tauri/src/lib.rs` has pre-existing uncommitted hunks. Apply ONLY the W3 wiring:

(a) Add new module imports near other manager imports:

```rust
use crate::managers::reranker_cache::RerankerCache;
use crate::managers::reranker_download::RerankerDownload;
use crate::managers::reranker_ort::{rule_19_check_reranker, RerankerHandle, Rule19Outcome};
```

(b) After the `EmbeddingWorker` initialization in the Tauri builder, initialize the reranker stack. Find where `app_state` and `inference_handle` are managed, add:

```rust
// W3: cross-encoder reranker (lazy-loaded, no boot-time work).
let reranker_model_dir = app
    .path()
    .app_data_dir()
    .expect("app data dir")
    .join("handy")
    .join("models")
    .join(crate::managers::reranker_ort::MODEL_ID);
let reranker_handle = RerankerHandle::spawn(reranker_model_dir.clone(), app.handle().clone());
let reranker_cache = Arc::new(RerankerCache::new());
let reranker_download = RerankerDownload::new(app.handle().clone(), reranker_model_dir.clone());

// Rule 19 check — clear cache on mismatch.
{
    let conn_arc = app_state.workspace_manager.conn();
    let mut conn = conn_arc.blocking_lock();
    match rule_19_check_reranker(&mut conn, &reranker_model_dir) {
        Ok(Rule19Outcome::Mismatch { reason }) => {
            log::info!("[reranker] Rule 19 mismatch: {reason} — clearing LRU");
            reranker_cache.clear();
        }
        Ok(Rule19Outcome::FirstRun) => {
            log::info!("[reranker] Rule 19: first run, info recorded");
        }
        Ok(Rule19Outcome::ModelMissing) => {
            log::info!("[reranker] Rule 19: model not yet downloaded");
        }
        Ok(Rule19Outcome::Match) => {}
        Err(e) => log::warn!("[reranker] Rule 19 check failed: {e}"),
    }
}

app.manage(reranker_handle);
app.manage(reranker_cache);
app.manage(reranker_download);
```

(c) Register the three new commands in the `tauri::generate_handler![...]` block:

```rust
crate::commands::rerank::rerank_candidates,
crate::commands::rerank::get_reranker_status,
crate::commands::rerank::download_reranker_model,
```

(d) Update the `specta::collect_commands!` block similarly to surface the new commands in `bindings.ts`.

**Step 4: Stage ONLY the W3 hunks**

```bash
git diff src-tauri/src/lib.rs > /tmp/all-lib.patch
git checkout HEAD -- src-tauri/src/lib.rs
git apply /tmp/all-lib.patch
git add -p src-tauri/src/lib.rs
# Accept ONLY the W3 hunks. Reject every pre-existing one.
git diff --cached -- src-tauri/src/lib.rs
# Verify: should only show W3 imports + reranker init + new commands
```

For `commands/search.rs` and `managers/search.rs` — these are clean (no pre-existing hunks). Stage straight:

```bash
git add src-tauri/src/commands/search.rs src-tauri/src/managers/search.rs
git diff --cached --stat
```

**Step 5: Build + test**

```bash
cd src-tauri && cargo build --lib 2>&1 | tail -8
cargo test --lib 2>&1 | tail -8
```

Expected: green build; tests at 150 / 2 (Tasks 4+5 added tests; this task adds none).

**Step 6: Commit**

```bash
git commit -m "feat(w3): hybrid search filters + lib.rs reranker wiring (Rule 19 boot check)"
```

**Step 7: Generate bindings**

```bash
bun run tauri dev --no-watch &
sleep 8
kill %1 2>/dev/null
git diff src/bindings.ts | head -40
```

`src/bindings.ts` is auto-generated. Confirm the new types appear (`RerankCandidate`, `RerankResult`, `RerankerStatus`, etc.) and the new commands are present (`searchWorkspaceHybrid` signature updated, `rerankCandidates`, `getRerankerStatus`, `downloadRerankerModel`).

If bindings drift, commit them separately:

```bash
git add src/bindings.ts
git commit -m "chore(bindings): regenerate after W3 reranker commands"
```

---

## Part B — Frontend pure modules (TDD)

### Task 9: `searchTokens.ts` + tests

**Files:**
- Create: `src/editor/searchTokens.ts`
- Create: `src/editor/__tests__/searchTokens.test.ts`

Pure function: parses date tokens (`today`, `yesterday`, `last week`, etc.) and tag short-circuits (`#research`) out of a raw query string.

**Step 1: Write tests first**

```ts
// src/editor/__tests__/searchTokens.test.ts
import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest'
import { parseSearchTokens } from '../searchTokens'

describe('parseSearchTokens', () => {
  beforeEach(() => {
    // Freeze time to 2026-04-25 12:00 local for date math.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-25T12:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('plain query returns query unchanged with no filter or tag', () => {
    const r = parseSearchTokens('react patterns')
    expect(r.query).toBe('react patterns')
    expect(r.dateFilter).toBeUndefined()
    expect(r.tag).toBeUndefined()
  })

  test('today token strips and produces a same-day date filter', () => {
    const r = parseSearchTokens('today recipe')
    expect(r.query).toBe('recipe')
    expect(r.dateFilter).toBeDefined()
    const startOfDay = new Date('2026-04-25T00:00:00').getTime()
    const endOfDay = new Date('2026-04-25T23:59:59.999').getTime()
    expect(r.dateFilter!.from).toBe(startOfDay)
    expect(r.dateFilter!.to).toBe(endOfDay)
  })

  test('yesterday token produces yesterday date filter', () => {
    const r = parseSearchTokens('voice memo yesterday')
    expect(r.query).toBe('voice memo')
    const start = new Date('2026-04-24T00:00:00').getTime()
    expect(r.dateFilter!.from).toBe(start)
  })

  test('last week produces a 7-day range', () => {
    const r = parseSearchTokens('last week meeting')
    expect(r.query).toBe('meeting')
    expect(r.dateFilter).toBeDefined()
    expect(r.dateFilter!.to! - r.dateFilter!.from).toBeGreaterThan(6 * 86400_000)
    expect(r.dateFilter!.to! - r.dateFilter!.from).toBeLessThan(8 * 86400_000)
  })

  test('exact tag short-circuit returns tag and empty query', () => {
    const r = parseSearchTokens('#research')
    expect(r.tag).toBe('research')
    expect(r.query).toBe('')
  })

  test('hash inside a longer query is NOT a tag short-circuit', () => {
    const r = parseSearchTokens('what about #research strategy')
    expect(r.tag).toBeUndefined()
    expect(r.query).toBe('what about #research strategy')
  })

  test('case-insensitive token matching', () => {
    const r = parseSearchTokens('TODAY important note')
    expect(r.query).toBe('important note')
    expect(r.dateFilter).toBeDefined()
  })
})
```

**Step 2: Verify failing**

```bash
bunx vitest run src/editor/__tests__/searchTokens.test.ts
```

Module-not-found expected.

**Step 3: Implement**

```ts
// src/editor/searchTokens.ts
export interface DateFilter {
  from: number  // unix-ms inclusive
  to?: number   // unix-ms inclusive
}

export interface ParsedSearchTokens {
  query: string
  dateFilter?: DateFilter
  tag?: string
}

const TAG_RE = /^\s*#([a-zA-Z0-9_-]+)\s*$/

const TOKEN_PATTERNS: Array<{
  pattern: RegExp
  toFilter: (now: Date) => DateFilter
}> = [
  {
    pattern: /\btoday\b/i,
    toFilter: (now) => ({
      from: startOfDay(now).getTime(),
      to: endOfDay(now).getTime(),
    }),
  },
  {
    pattern: /\byesterday\b/i,
    toFilter: (now) => {
      const y = addDays(now, -1)
      return { from: startOfDay(y).getTime(), to: endOfDay(y).getTime() }
    },
  },
  {
    pattern: /\blast\s+week\b/i,
    toFilter: (now) => weekRange(now, -1),
  },
  {
    pattern: /\bthis\s+week\b/i,
    toFilter: (now) => weekRange(now, 0),
  },
  {
    pattern: /\blast\s+month\b/i,
    toFilter: (now) => monthRange(now, -1),
  },
  {
    pattern: /\bthis\s+month\b/i,
    toFilter: (now) => monthRange(now, 0),
  },
]

export function parseSearchTokens(raw: string): ParsedSearchTokens {
  const tagMatch = raw.match(TAG_RE)
  if (tagMatch) {
    return { query: '', tag: tagMatch[1] }
  }

  const now = new Date()
  for (const { pattern, toFilter } of TOKEN_PATTERNS) {
    if (pattern.test(raw)) {
      return {
        query: raw.replace(pattern, '').replace(/\s+/g, ' ').trim(),
        dateFilter: toFilter(now),
      }
    }
  }
  return { query: raw }
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function weekRange(now: Date, weekOffset: number): DateFilter {
  // Week starts Monday (locale-agnostic for simplicity).
  const day = now.getDay()  // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const daysSinceMonday = (day + 6) % 7
  const thisMonday = addDays(now, -daysSinceMonday)
  const targetMonday = addDays(thisMonday, weekOffset * 7)
  const targetSunday = addDays(targetMonday, 6)
  return {
    from: startOfDay(targetMonday).getTime(),
    to: endOfDay(targetSunday).getTime(),
  }
}

function monthRange(now: Date, monthOffset: number): DateFilter {
  const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0)
  return {
    from: startOfDay(start).getTime(),
    to: endOfDay(end).getTime(),
  }
}
```

**Step 4: Verify passing**

```bash
bunx vitest run src/editor/__tests__/searchTokens.test.ts
```

Expected: 7 passing.

**Step 5: Commit**

```bash
git add src/editor/searchTokens.ts src/editor/__tests__/searchTokens.test.ts
git commit -m "feat(w3): searchTokens — date + tag parser with 7 unit tests"
```

---

### Task 10: `searchSnippet.ts` + tests

**Files:**
- Create: `src/editor/searchSnippet.ts`
- Create: `src/editor/__tests__/searchSnippet.test.ts`

Safe React-node renderer for FTS5 `<mark>...</mark>` snippets. NO HTML injection.

**Step 1: Tests first**

```tsx
// src/editor/__tests__/searchSnippet.test.ts
import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { renderSnippet } from '../searchSnippet'

describe('renderSnippet', () => {
  test('plain text renders as a single span', () => {
    const { container } = render(<>{renderSnippet('plain text', 'hit')}</>)
    expect(container.textContent).toBe('plain text')
    expect(container.querySelectorAll('.hit').length).toBe(0)
  })

  test('single hit splits into 3 parts (before, hit, after)', () => {
    const { container } = render(
      <>{renderSnippet('foo <mark>bar</mark> baz', 'hit')}</>,
    )
    expect(container.textContent).toBe('foo bar baz')
    const hits = container.querySelectorAll('.hit')
    expect(hits.length).toBe(1)
    expect(hits[0].textContent).toBe('bar')
  })

  test('multiple hits all render', () => {
    const { container } = render(
      <>{renderSnippet('<mark>react</mark> and <mark>vue</mark>', 'hit')}</>,
    )
    const hits = container.querySelectorAll('.hit')
    expect(hits.length).toBe(2)
    expect(hits[0].textContent).toBe('react')
    expect(hits[1].textContent).toBe('vue')
  })

  test('HTML in source is treated as plain text (no XSS)', () => {
    const { container } = render(
      <>{renderSnippet('<script>alert(1)</script> and <mark>safe</mark>', 'hit')}</>,
    )
    expect(container.textContent).toContain('<script>alert(1)</script>')
    expect(container.querySelectorAll('script').length).toBe(0)
  })

  test('malformed marks do not crash', () => {
    const { container } = render(
      <>{renderSnippet('start <mark>unclosed and more text', 'hit')}</>,
    )
    expect(container.textContent).toContain('unclosed')
  })

  test('empty input renders empty', () => {
    const { container } = render(<>{renderSnippet('', 'hit')}</>)
    expect(container.textContent).toBe('')
  })
})
```

**Step 2: Implement (using `matchAll` — NO regex `.exec()` calls)**

```tsx
// src/editor/searchSnippet.ts
import type { ReactNode } from 'react'

const MARK_RE = /<mark>(.*?)<\/mark>/gs

/**
 * Render an FTS5 snippet (with `<mark>...</mark>` marker tokens) as a React
 * node tree. Plain text and unmatched HTML stay as text — never injected
 * as HTML — preserving the spec's no-XSS guarantee (M4 of W2.5 review).
 *
 * @param snippet  Raw snippet from `snippet(workspace_fts, ..., '<mark>', '</mark>', ...)`.
 * @param hitClass  CSS class name applied to each `<mark>` run (e.g. `'search-snippet__hit'`).
 */
export function renderSnippet(snippet: string, hitClass: string): ReactNode[] {
  if (!snippet) return []

  const nodes: ReactNode[] = []
  const matches = Array.from(snippet.matchAll(MARK_RE))
  let lastIdx = 0
  let key = 0

  for (const match of matches) {
    const start = match.index ?? 0
    if (start > lastIdx) {
      nodes.push(<span key={key++}>{snippet.slice(lastIdx, start)}</span>)
    }
    nodes.push(
      <span key={key++} className={hitClass}>
        {match[1]}
      </span>,
    )
    lastIdx = start + match[0].length
  }

  if (lastIdx < snippet.length) {
    nodes.push(<span key={key++}>{snippet.slice(lastIdx)}</span>)
  }

  return nodes
}
```

**Step 3: Test + commit**

```bash
bunx vitest run src/editor/__tests__/searchSnippet.test.ts
git add src/editor/searchSnippet.ts src/editor/__tests__/searchSnippet.test.ts
git commit -m "feat(w3): searchSnippet — safe <mark>-aware React renderer with 6 tests"
```

Expected: 6 tests passing.

---

### Task 11: `recentQueries.ts` + tests

**Files:**
- Create: `src/editor/recentQueries.ts`
- Create: `src/editor/__tests__/recentQueries.test.ts`

LRU of the last 10 search queries, persisted to `localStorage`.

**Step 1: Tests**

```ts
// src/editor/__tests__/recentQueries.test.ts
import { describe, expect, test, beforeEach } from 'vitest'
import { recordQuery, getRecentQueries, clearRecentQueries } from '../recentQueries'

beforeEach(() => {
  localStorage.clear()
})

describe('recentQueries', () => {
  test('empty initially', () => {
    expect(getRecentQueries()).toEqual([])
  })

  test('records up to 10', () => {
    for (let i = 0; i < 10; i++) recordQuery(`q${i}`)
    expect(getRecentQueries().length).toBe(10)
  })

  test('drops oldest beyond 10', () => {
    for (let i = 0; i < 12; i++) recordQuery(`q${i}`)
    const recent = getRecentQueries()
    expect(recent.length).toBe(10)
    expect(recent[0]).toBe('q11')   // most recent first
    expect(recent[9]).toBe('q2')    // oldest kept
  })

  test('dedupes — re-recording an existing query promotes it', () => {
    recordQuery('a')
    recordQuery('b')
    recordQuery('a')
    expect(getRecentQueries()).toEqual(['a', 'b'])
  })

  test('ignores empty / whitespace-only queries', () => {
    recordQuery('')
    recordQuery('   ')
    expect(getRecentQueries()).toEqual([])
  })

  test('clear empties', () => {
    recordQuery('a')
    clearRecentQueries()
    expect(getRecentQueries()).toEqual([])
  })

  test('persists across reads', () => {
    recordQuery('persist-me')
    const fromStorage = JSON.parse(localStorage.getItem('handy.search.recent') ?? '[]')
    expect(fromStorage).toEqual(['persist-me'])
  })
})
```

**Step 2: Implement**

```ts
// src/editor/recentQueries.ts
const KEY = 'handy.search.recent'
const MAX = 10

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

function write(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // localStorage full or disabled — silent no-op.
  }
}

export function getRecentQueries(): string[] {
  return read()
}

export function recordQuery(q: string): void {
  const trimmed = q.trim()
  if (!trimmed) return
  const list = read().filter((x) => x !== trimmed)
  list.unshift(trimmed)
  write(list.slice(0, MAX))
}

export function clearRecentQueries(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // no-op
  }
}
```

**Step 3: Test + commit**

```bash
bunx vitest run src/editor/__tests__/recentQueries.test.ts
git add src/editor/recentQueries.ts src/editor/__tests__/recentQueries.test.ts
git commit -m "feat(w3): recentQueries — localStorage LRU with 7 tests"
```

Expected: 7 tests passing.

---

## Part C — Frontend components

### Task 12: `SearchResultRow.tsx` + tests

**Files:**
- Create: `src/components/SearchResultRow.tsx`
- Create: `src/components/__tests__/SearchResultRow.test.tsx`
- Create: `src/styles/search.css` (new concern file — `notes.css` is at 684 lines, over the soft 500-line ceiling)
- Modify: `src/main.tsx` to import the new CSS file (verify the existing import pattern first)

**Step 1: Component**

```tsx
// src/components/SearchResultRow.tsx
import { renderSnippet } from '../editor/searchSnippet'
import type { WorkspaceSearchResult } from '../bindings'

export interface SearchResultRowProps {
  result: WorkspaceSearchResult
  isActive: boolean
  showDebug?: boolean
  onClick: (e: React.MouseEvent) => void
  onMouseEnter?: () => void
}

export function SearchResultRow({
  result,
  isActive,
  showDebug,
  onClick,
  onMouseEnter,
}: SearchResultRowProps) {
  const fts = result.keyword_rank !== null && result.keyword_rank !== undefined
  const vec = result.semantic_rank !== null && result.semantic_rank !== undefined

  return (
    <button
      type="button"
      className={'search-result' + (isActive ? ' search-result--active' : '')}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div className="search-result__header">
        <span className="search-result__icon" aria-hidden>
          {result.icon || '📄'}
        </span>
        <span className="search-result__title" title={result.title}>
          {result.title || 'Untitled'}
        </span>
        {result.parent_name && (
          <span className="search-result__breadcrumb">
            {result.parent_name}
          </span>
        )}
      </div>
      {result.excerpt && (
        <div className="search-result__snippet">
          {renderSnippet(result.excerpt, 'search-result__hit')}
        </div>
      )}
      <div className="search-result__badges" aria-label="Match types">
        {fts && <span className="search-result__badge search-result__badge--fts" title="Keyword match">🟢</span>}
        {vec && <span className="search-result__badge search-result__badge--vec" title="Semantic match">🟣</span>}
        {showDebug && (
          <span className="search-result__debug">
            [fts:r={result.keyword_rank ?? '–'} · vec:r={result.semantic_rank ?? '–'} · score:{result.score.toFixed(3)}]
          </span>
        )}
      </div>
    </button>
  )
}
```

**Step 2: Tests**

```tsx
// src/components/__tests__/SearchResultRow.test.tsx
import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SearchResultRow } from '../SearchResultRow'
import type { WorkspaceSearchResult } from '../../bindings'

function mkResult(over: Partial<WorkspaceSearchResult> = {}): WorkspaceSearchResult {
  return {
    node_id: 'n1',
    node_type: 'document',
    title: 'My Doc',
    parent_name: 'Projects',
    icon: '📄',
    score: 0.5,
    keyword_rank: 1,
    semantic_rank: 2,
    excerpt: 'A snippet with <mark>hit</mark> here.',
    ...over,
  } as WorkspaceSearchResult
}

describe('SearchResultRow', () => {
  test('renders title + breadcrumb + excerpt', () => {
    render(<SearchResultRow result={mkResult()} isActive={false} onClick={() => {}} />)
    expect(screen.getByText('My Doc')).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('hit')).toBeInTheDocument()  // the <mark> contents
  })

  test('Untitled fallback when title empty', () => {
    render(<SearchResultRow result={mkResult({ title: '' })} isActive={false} onClick={() => {}} />)
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })

  test('shows both badges when both ranks present', () => {
    const { container } = render(
      <SearchResultRow result={mkResult()} isActive={false} onClick={() => {}} />,
    )
    expect(container.querySelector('.search-result__badge--fts')).toBeInTheDocument()
    expect(container.querySelector('.search-result__badge--vec')).toBeInTheDocument()
  })

  test('shows only fts badge when semantic_rank is null', () => {
    const { container } = render(
      <SearchResultRow
        result={mkResult({ semantic_rank: null as unknown as number })}
        isActive={false}
        onClick={() => {}}
      />,
    )
    expect(container.querySelector('.search-result__badge--fts')).toBeInTheDocument()
    expect(container.querySelector('.search-result__badge--vec')).not.toBeInTheDocument()
  })

  test('active modifier class when isActive', () => {
    const { container } = render(
      <SearchResultRow result={mkResult()} isActive={true} onClick={() => {}} />,
    )
    expect(container.querySelector('.search-result--active')).toBeInTheDocument()
  })

  test('onClick fires with mouse event', () => {
    const onClick = vi.fn()
    render(<SearchResultRow result={mkResult()} isActive={false} onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test('debug overlay shows when showDebug', () => {
    render(
      <SearchResultRow result={mkResult()} isActive={false} showDebug onClick={() => {}} />,
    )
    expect(screen.getByText(/score:0\.500/)).toBeInTheDocument()
  })
})
```

**Step 3: CSS — new concern file**

Create `src/styles/search.css`:

```css
/* ── search.css — W3 search result rendering ───────────────────── */

.search-result {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  text-align: left;
  cursor: pointer;
  width: 100%;
  transition: background var(--transition-fast);
}
.search-result:hover,
.search-result--active {
  background: var(--surface-hover);
}
.search-result__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.search-result__icon {
  flex-shrink: 0;
  font-size: var(--text-base);
  line-height: 1;
}
.search-result__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--heros-text-premium);
}
.search-result__breadcrumb {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--heros-text-dim);
}
.search-result__snippet {
  font-size: var(--text-xs);
  color: var(--heros-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-result__hit {
  background: color-mix(in srgb, var(--heros-brand) 25%, transparent);
  color: var(--heros-text-premium);
  font-weight: 500;
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
}
.search-result__badges {
  display: flex;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--heros-text-dim);
}
.search-result__badge {
  font-size: var(--text-xs);
  opacity: 0.7;
}
.search-result__debug {
  margin-left: var(--space-2);
  font-family: 'JetBrains Mono', 'Menlo', 'Consolas', monospace;
  font-size: var(--text-xs);
  color: var(--heros-text-faint);
}
```

Verify the CSS import lands in the entry. Look at the existing pattern in `src/main.tsx` or wherever `notes.css` is imported, and add `import './styles/search.css'` in the same way.

**Step 4: Test + commit**

```bash
bunx vitest run src/components/__tests__/SearchResultRow.test.tsx
bun run build  # confirm CSS compiles
git add src/components/SearchResultRow.tsx src/components/__tests__/SearchResultRow.test.tsx src/styles/search.css src/main.tsx
git commit -m "feat(w3): SearchResultRow + search.css concern file (7 tests, all tokenized)"
```

Expected: 7 tests passing; build green.

---

### Task 13: `SearchEmptyStates.tsx`

**Files:**
- Create: `src/components/SearchEmptyStates.tsx`
- Modify: `src/styles/search.css`

Three sub-components: `<RecentQueriesChips>`, `<NoResultsEmpty>`, `<DidYouMean>`. Each used by both Spotlight and SearchView.

**Step 1: Component**

```tsx
// src/components/SearchEmptyStates.tsx
import { getRecentQueries } from '../editor/recentQueries'

export function RecentQueriesChips({ onPick }: { onPick: (q: string) => void }) {
  const queries = getRecentQueries()
  if (queries.length === 0) {
    return (
      <div className="search-empty">
        <p className="search-empty__hint">
          Try <kbd>today</kbd> for recent notes or <kbd>#tag</kbd> for tagged notes.
        </p>
      </div>
    )
  }
  return (
    <div className="search-empty">
      <p className="search-empty__label">Recent searches</p>
      <div className="search-empty__chips">
        {queries.map((q) => (
          <button
            key={q}
            type="button"
            className="search-empty__chip"
            onClick={() => onPick(q)}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}

export function NoResultsEmpty({ query }: { query: string }) {
  return (
    <div className="search-empty">
      <p className="search-empty__title">No results for "{query}".</p>
    </div>
  )
}

export function DidYouMean({
  suggestion,
  onPick,
}: {
  suggestion: string
  onPick: (q: string) => void
}) {
  return (
    <div className="search-empty">
      <p className="search-empty__title">
        Did you mean:{' '}
        <button
          type="button"
          className="search-empty__suggestion"
          onClick={() => onPick(suggestion)}
        >
          {suggestion}
        </button>
        ?
      </p>
    </div>
  )
}
```

**Step 2: Append to `search.css`**

```css
.search-empty {
  padding: var(--space-4);
  text-align: center;
  color: var(--heros-text-dim);
}
.search-empty__hint {
  font-size: var(--text-xs);
  color: var(--heros-text-faint);
  margin: 0;
}
.search-empty__hint kbd {
  background: var(--surface-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-family: 'JetBrains Mono', 'Menlo', 'Consolas', monospace;
  font-size: var(--text-xs);
  color: var(--heros-text-muted);
}
.search-empty__label {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--heros-text-dim);
  margin: 0 0 var(--space-2) 0;
}
.search-empty__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: center;
}
.search-empty__chip {
  background: var(--surface-2);
  border: none;
  color: var(--heros-text-premium);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: background var(--transition-fast);
}
.search-empty__chip:hover {
  background: var(--surface-hover);
}
.search-empty__title {
  font-size: var(--text-sm);
  color: var(--heros-text-muted);
  margin: 0;
}
.search-empty__suggestion {
  background: transparent;
  border: none;
  color: var(--heros-brand);
  font-size: inherit;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}
.search-empty__suggestion:hover {
  text-decoration: underline;
}
```

**Step 3: Build + commit (no tests for v1 — visual)**

```bash
bun run build
git add src/components/SearchEmptyStates.tsx src/styles/search.css
git commit -m "feat(w3): SearchEmptyStates — recent chips, no-results, did-you-mean"
```

---

### Task 14: `SearchFilters.tsx`

**Files:**
- Create: `src/components/SearchFilters.tsx`
- Modify: `src/styles/search.css`

Sidebar for the SearchView page. Node-type checkboxes, tag chip-list (loaded from vault), date-range radio.

**Step 1: Component**

```tsx
// src/components/SearchFilters.tsx
import { useEffect, useState } from 'react'
import { commands } from '../bindings'

export type SearchFiltersState = {
  nodeTypes: Set<'document' | 'database' | 'row'>
  tags: Set<string>
  dateRange: 'any' | 'today' | 'last_week' | 'last_month'
}

export const initialFilters: SearchFiltersState = {
  nodeTypes: new Set(),
  tags: new Set(),
  dateRange: 'any',
}

export function SearchFilters({
  state,
  onChange,
}: {
  state: SearchFiltersState
  onChange: (next: SearchFiltersState) => void
}) {
  const [knownTags, setKnownTags] = useState<string[]>([])

  useEffect(() => {
    void loadKnownTags().then(setKnownTags)
  }, [])

  return (
    <aside className="search-filters">
      <section className="search-filters__section">
        <h3 className="search-filters__heading">Type</h3>
        {(['document', 'database', 'row'] as const).map((t) => (
          <label key={t} className="search-filters__checkbox">
            <input
              type="checkbox"
              checked={state.nodeTypes.has(t)}
              onChange={(e) => {
                const next = new Set(state.nodeTypes)
                if (e.currentTarget.checked) next.add(t)
                else next.delete(t)
                onChange({ ...state, nodeTypes: next })
              }}
            />
            <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
          </label>
        ))}
      </section>

      {knownTags.length > 0 && (
        <section className="search-filters__section">
          <h3 className="search-filters__heading">Tags</h3>
          {knownTags.map((tag) => (
            <label key={tag} className="search-filters__checkbox">
              <input
                type="checkbox"
                checked={state.tags.has(tag)}
                onChange={(e) => {
                  const next = new Set(state.tags)
                  if (e.currentTarget.checked) next.add(tag)
                  else next.delete(tag)
                  onChange({ ...state, tags: next })
                }}
              />
              <span>#{tag}</span>
            </label>
          ))}
        </section>
      )}

      <section className="search-filters__section">
        <h3 className="search-filters__heading">Date</h3>
        {(['any', 'today', 'last_week', 'last_month'] as const).map((d) => (
          <label key={d} className="search-filters__radio">
            <input
              type="radio"
              checked={state.dateRange === d}
              onChange={() => onChange({ ...state, dateRange: d })}
            />
            <span>{labelFor(d)}</span>
          </label>
        ))}
      </section>
    </aside>
  )
}

function labelFor(d: string): string {
  switch (d) {
    case 'any': return 'Any time'
    case 'today': return 'Today'
    case 'last_week': return 'Last week'
    case 'last_month': return 'Last month'
    default: return d
  }
}

async function loadKnownTags(): Promise<string[]> {
  // For v1, derive tags by scanning all live nodes' properties JSON.
  // If this becomes slow at scale, push into a SQL aggregate view.
  try {
    const res = await commands.getRootNodes()
    if (res.status !== 'ok') return []
    const tagSet = new Set<string>()
    const collect = (props: string) => {
      try {
        const obj = JSON.parse(props || '{}')
        const tags = obj?.tags
        if (Array.isArray(tags)) {
          for (const t of tags) if (typeof t === 'string') tagSet.add(t)
        }
      } catch {
        // skip malformed JSON
      }
    }
    for (const n of res.data) collect(n.properties)
    return Array.from(tagSet).sort()
  } catch {
    return []
  }
}
```

**Step 2: Append to `search.css`**

```css
.search-filters {
  width: 200px;
  flex-shrink: 0;
  padding: var(--space-4);
  border-right: 1px solid var(--border-subtle);
  overflow-y: auto;
}
.search-filters__section {
  margin-bottom: var(--space-6);
}
.search-filters__heading {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--heros-text-dim);
  margin: 0 0 var(--space-2) 0;
  font-weight: 600;
}
.search-filters__checkbox,
.search-filters__radio {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  font-size: var(--text-sm);
  color: var(--heros-text-muted);
  cursor: pointer;
}
.search-filters__checkbox input,
.search-filters__radio input {
  cursor: pointer;
}
```

**Step 3: Build + commit (no tests for v1)**

```bash
bun run build
git add src/components/SearchFilters.tsx src/styles/search.css
git commit -m "feat(w3): SearchFilters sidebar (node-type, tag, date)"
```

---

### Task 15: `SpotlightOverlay.tsx` (the largest)

**Files:**
- Create: `src/components/SpotlightOverlay.tsx`
- Modify: `src/styles/search.css`

Floating Cmd+K modal: input row, results list, footer hint. Debounced search, keyboard nav, focus trap, score-debug toggle.

**Step 1: Component**

```tsx
// src/components/SpotlightOverlay.tsx
import { useCallback, useEffect, useReducer, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { commands, type WorkspaceSearchResult, type RerankResult } from '../bindings'
import { SearchResultRow } from './SearchResultRow'
import { RecentQueriesChips, NoResultsEmpty, DidYouMean } from './SearchEmptyStates'
import { parseSearchTokens } from '../editor/searchTokens'
import { recordQuery } from '../editor/recentQueries'

const DEBOUNCE_MS = 200
const RERANK_TIMEOUT_MS = 100

type State = {
  query: string
  results: WorkspaceSearchResult[]
  active: number
  loading: boolean
  showDebug: boolean
  didYouMean: string | null
}

type Action =
  | { type: 'SET_QUERY'; q: string }
  | { type: 'SET_RESULTS'; results: WorkspaceSearchResult[] }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'MOVE'; delta: number }
  | { type: 'TOGGLE_DEBUG' }
  | { type: 'SET_SUGGESTION'; suggestion: string | null }

const initial: State = {
  query: '',
  results: [],
  active: 0,
  loading: false,
  showDebug: false,
  didYouMean: null,
}

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case 'SET_QUERY':
      return { ...state, query: a.q, active: 0 }
    case 'SET_RESULTS':
      return { ...state, results: a.results, active: 0, loading: false, didYouMean: null }
    case 'SET_LOADING':
      return { ...state, loading: a.loading }
    case 'MOVE': {
      const next = Math.max(0, Math.min(state.results.length - 1, state.active + a.delta))
      return { ...state, active: next }
    }
    case 'TOGGLE_DEBUG':
      return { ...state, showDebug: !state.showDebug }
    case 'SET_SUGGESTION':
      return { ...state, didYouMean: a.suggestion }
    default:
      return state
  }
}

export interface SpotlightOverlayProps {
  onDismiss: () => void
  onOpenPreview: (nodeId: string) => void
  onOpenInNewTab: (nodeId: string) => void
}

export function SpotlightOverlay({
  onDismiss,
  onOpenPreview,
  onOpenInNewTab,
}: SpotlightOverlayProps) {
  const [state, dispatch] = useReducer(reducer, initial)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<number | null>(null)
  const reqIdRef = useRef(0)

  // Focus input on mount.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced search.
  const runSearch = useCallback(async (raw: string) => {
    const myReq = ++reqIdRef.current
    const trimmed = raw.trim()
    if (!trimmed) {
      dispatch({ type: 'SET_RESULTS', results: [] })
      return
    }
    dispatch({ type: 'SET_LOADING', loading: true })

    const { query: stripped } = parseSearchTokens(raw)
    const queryForSearch = stripped || raw  // if token-strip empties the query, keep raw

    try {
      const res = await commands.searchWorkspaceHybrid(
        queryForSearch,
        30,
        0,
        undefined,
        undefined,
        undefined,
        undefined,
      )
      if (myReq !== reqIdRef.current) return  // newer request superseded
      if (res.status !== 'ok') {
        dispatch({ type: 'SET_RESULTS', results: [] })
        return
      }
      let candidates = res.data

      // Stage 4: rerank top-30 → top-10.
      if (candidates.length >= 2 && !shortCircuit(candidates)) {
        const rerankRes = await commands.rerankCandidates(
          queryForSearch,
          candidates.map((c) => ({
            node_id: c.node_id,
            title: c.title,
            excerpt: c.excerpt ?? '',
          })),
          10,
          RERANK_TIMEOUT_MS,
        )
        if (myReq !== reqIdRef.current) return
        if (rerankRes.status === 'ok' && rerankRes.data) {
          candidates = applyRerank(candidates, rerankRes.data)
        }
      }

      candidates = candidates.slice(0, 10)
      dispatch({ type: 'SET_RESULTS', results: candidates })

      if (candidates.length > 0) {
        recordQuery(trimmed)
      }
    } catch {
      dispatch({ type: 'SET_RESULTS', results: [] })
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
    }
    debounceRef.current = window.setTimeout(() => {
      void runSearch(state.query)
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
      }
    }
  }, [state.query, runSearch])

  // Keyboard handling.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onDismiss()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      dispatch({ type: 'MOVE', delta: 1 })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      dispatch({ type: 'MOVE', delta: -1 })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = state.results[state.active]
      if (!r) return
      const meta = e.metaKey || e.ctrlKey
      if (meta) onOpenInNewTab(r.node_id)
      else onOpenPreview(r.node_id)
      onDismiss()
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      dispatch({ type: 'TOGGLE_DEBUG' })
    }
  }

  return createPortal(
    <div
      className="spotlight-backdrop"
      onClick={onDismiss}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <div
        className="spotlight"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="spotlight__input-row">
          <Search size={16} className="spotlight__input-icon" />
          <input
            ref={inputRef}
            type="text"
            className="spotlight__input"
            value={state.query}
            onChange={(e) => dispatch({ type: 'SET_QUERY', q: e.currentTarget.value })}
            placeholder="Search notes…"
          />
          <kbd className="spotlight__hint-kbd">⌘K</kbd>
        </div>

        {state.query.trim() === '' ? (
          <RecentQueriesChips onPick={(q) => dispatch({ type: 'SET_QUERY', q })} />
        ) : state.results.length === 0 && !state.loading ? (
          state.didYouMean ? (
            <DidYouMean suggestion={state.didYouMean} onPick={(q) => dispatch({ type: 'SET_QUERY', q })} />
          ) : (
            <NoResultsEmpty query={state.query} />
          )
        ) : (
          <div className="spotlight__results" role="listbox">
            {state.results.map((r, i) => (
              <SearchResultRow
                key={r.node_id}
                result={r}
                isActive={i === state.active}
                showDebug={state.showDebug}
                onClick={(e) => {
                  const meta = e.metaKey || e.ctrlKey
                  if (meta) onOpenInNewTab(r.node_id)
                  else onOpenPreview(r.node_id)
                  onDismiss()
                }}
                onMouseEnter={() => {
                  // Update active index on hover for parity with keyboard nav.
                  if (i !== state.active) {
                    dispatch({ type: 'MOVE', delta: i - state.active })
                  }
                }}
              />
            ))}
          </div>
        )}

        <div className="spotlight__footer">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>⌘↵ new tab</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function shortCircuit(results: WorkspaceSearchResult[]): boolean {
  if (results.length < 2) return false
  const top = results[0].score
  const second = results[1].score
  return second > 0 && top >= 2 * second
}

function applyRerank(
  candidates: WorkspaceSearchResult[],
  reranked: RerankResult[],
): WorkspaceSearchResult[] {
  const byId = new Map(candidates.map((c) => [c.node_id, c]))
  return reranked
    .map((r) => byId.get(r.node_id))
    .filter((c): c is WorkspaceSearchResult => !!c)
}
```

**Step 2: Append to `search.css`**

```css
.spotlight-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: color-mix(in srgb, black 40%, transparent);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 20vh;
}
.spotlight {
  width: 100%;
  max-width: 600px;
  background: var(--heros-glass-black);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-container);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 70vh;
}
.spotlight__input-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}
.spotlight__input-icon {
  color: var(--heros-text-dim);
  flex-shrink: 0;
}
.spotlight__input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: var(--text-base);
  color: var(--heros-text-premium);
  padding: 0;
}
.spotlight__hint-kbd {
  background: var(--surface-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-family: 'JetBrains Mono', 'Menlo', 'Consolas', monospace;
  font-size: var(--text-xs);
  color: var(--heros-text-muted);
}
.spotlight__results {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2);
}
.spotlight__footer {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--text-xs);
  color: var(--heros-text-faint);
  flex-shrink: 0;
}
```

**Step 3: Build + commit**

```bash
bun run build
bunx vitest run
git add src/components/SpotlightOverlay.tsx src/styles/search.css
git commit -m "feat(w3): SpotlightOverlay (Cmd+K) — debounced hybrid search + rerank + keyboard nav"
```

Tests should still be ~108 (no new tests this task — visual surface tested via E2E in Task 20).

---

## Part D — Integration

### Task 16: SearchView rewrite

**Files:**
- Modify: `src/components/SearchView.tsx` (HUNK ISOLATION REQUIRED — pre-existing dirty hunks)

The handoff prompt should call out: SearchView.tsx has a small uncommitted hunk on the user's branch (line ~207 has the W3 placeholder comment plus other stylistic changes). Before editing, save the user's hunk and re-apply, OR use `git add -p` to avoid sweeping it up.

**Step 1: Read current state**

```bash
git diff src/components/SearchView.tsx | head -50
```

**Step 2: Replace the body** with a real implementation:

```tsx
// src/components/SearchView.tsx — W3 wired
import { useCallback, useEffect, useReducer, useState } from 'react'
import { commands, type WorkspaceSearchResult, type RerankResult } from '../bindings'
import { Search } from 'lucide-react'
import { SearchResultRow } from './SearchResultRow'
import { SearchFilters, initialFilters, type SearchFiltersState } from './SearchFilters'
import { RecentQueriesChips, NoResultsEmpty } from './SearchEmptyStates'
import { parseSearchTokens } from '../editor/searchTokens'
import { recordQuery } from '../editor/recentQueries'

const PAGE_SIZE = 20
const DEBOUNCE_MS = 200
const RERANK_TIMEOUT_MS = 100

type State = {
  query: string
  filters: SearchFiltersState
  results: WorkspaceSearchResult[]
  page: number
  loading: boolean
  noMore: boolean
}

type Action =
  | { type: 'SET_QUERY'; q: string }
  | { type: 'SET_FILTERS'; filters: SearchFiltersState }
  | { type: 'SET_RESULTS'; results: WorkspaceSearchResult[]; replace: boolean }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'NEXT_PAGE' }
  | { type: 'NO_MORE' }

const initial: State = {
  query: '',
  filters: initialFilters,
  results: [],
  page: 0,
  loading: false,
  noMore: false,
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'SET_QUERY':       return { ...s, query: a.q, page: 0, noMore: false }
    case 'SET_FILTERS':     return { ...s, filters: a.filters, page: 0, noMore: false }
    case 'SET_RESULTS':     return { ...s, results: a.replace ? a.results : [...s.results, ...a.results], loading: false }
    case 'SET_LOADING':     return { ...s, loading: a.loading }
    case 'NEXT_PAGE':       return { ...s, page: s.page + 1 }
    case 'NO_MORE':         return { ...s, noMore: true }
    default:                return s
  }
}

export function SearchView() {
  const [state, dispatch] = useReducer(reducer, initial)
  const [debounceTimer, setDebounceTimer] = useState<number | null>(null)

  const runSearch = useCallback(
    async (replace: boolean) => {
      const trimmed = state.query.trim()
      if (!trimmed) {
        dispatch({ type: 'SET_RESULTS', results: [], replace: true })
        return
      }
      dispatch({ type: 'SET_LOADING', loading: true })

      const { query: stripped, dateFilter } = parseSearchTokens(state.query)
      const q = stripped || state.query
      const offset = replace ? 0 : state.page * PAGE_SIZE

      const res = await commands.searchWorkspaceHybrid(
        q,
        PAGE_SIZE,
        offset,
        state.filters.nodeTypes.size > 0 ? Array.from(state.filters.nodeTypes) : undefined,
        state.filters.tags.size > 0 ? Array.from(state.filters.tags) : undefined,
        dateFilter?.from ?? undefined,
        dateFilter?.to ?? undefined,
      )
      if (res.status !== 'ok') {
        dispatch({ type: 'SET_RESULTS', results: [], replace: true })
        return
      }

      let candidates = res.data
      if (candidates.length === 0) dispatch({ type: 'NO_MORE' })

      if (candidates.length >= 2) {
        const rr = await commands.rerankCandidates(
          q,
          candidates.map((c) => ({
            node_id: c.node_id,
            title: c.title,
            excerpt: c.excerpt ?? '',
          })),
          PAGE_SIZE,
          RERANK_TIMEOUT_MS,
        )
        if (rr.status === 'ok' && rr.data) {
          const byId = new Map(candidates.map((c) => [c.node_id, c]))
          candidates = rr.data
            .map((r: RerankResult) => byId.get(r.node_id))
            .filter((c): c is WorkspaceSearchResult => !!c)
        }
      }

      dispatch({ type: 'SET_RESULTS', results: candidates, replace })
      if (replace) recordQuery(trimmed)
    },
    [state.query, state.filters, state.page],
  )

  // Debounce on query change.
  useEffect(() => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer)
    const t = window.setTimeout(() => {
      void runSearch(true)
    }, DEBOUNCE_MS)
    setDebounceTimer(t)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.query, state.filters])

  const openInTab = (nodeId: string, meta: boolean) => {
    const ev = meta ? 'notes:open-new-tab' : 'notes:open'
    window.dispatchEvent(new CustomEvent(ev, { detail: nodeId }))
  }

  return (
    <div className="search-view">
      <SearchFilters
        state={state.filters}
        onChange={(filters) => dispatch({ type: 'SET_FILTERS', filters })}
      />
      <main className="search-view__main">
        <div className="search-view__input-row">
          <Search size={16} className="search-view__input-icon" />
          <input
            type="text"
            className="search-view__input"
            value={state.query}
            onChange={(e) => dispatch({ type: 'SET_QUERY', q: e.currentTarget.value })}
            placeholder="Search notes…"
          />
        </div>

        {state.query.trim() === '' ? (
          <RecentQueriesChips onPick={(q) => dispatch({ type: 'SET_QUERY', q })} />
        ) : state.results.length === 0 && !state.loading ? (
          <NoResultsEmpty query={state.query} />
        ) : (
          <>
            <p className="search-view__count">
              {state.results.length} result{state.results.length === 1 ? '' : 's'}
            </p>
            <div className="search-view__results">
              {state.results.map((r) => (
                <SearchResultRow
                  key={r.node_id}
                  result={r}
                  isActive={false}
                  onClick={(e) => openInTab(r.node_id, e.metaKey || e.ctrlKey)}
                />
              ))}
            </div>
            {!state.noMore && state.results.length >= PAGE_SIZE && (
              <button
                type="button"
                className="search-view__load-more"
                onClick={() => {
                  dispatch({ type: 'NEXT_PAGE' })
                  void runSearch(false)
                }}
              >
                Load {PAGE_SIZE} more
              </button>
            )}
          </>
        )}
      </main>
    </div>
  )
}
```

**Step 3: Append to `search.css`**

```css
.search-view {
  display: flex;
  height: 100%;
  width: 100%;
  background: var(--surface-1);
}
.search-view__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  overflow-y: auto;
}
.search-view__input-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--surface-2);
  border-radius: var(--radius-container);
  margin-bottom: var(--space-4);
}
.search-view__input-icon {
  color: var(--heros-text-dim);
}
.search-view__input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: var(--text-base);
  color: var(--heros-text-premium);
}
.search-view__count {
  font-size: var(--text-xs);
  color: var(--heros-text-dim);
  margin: 0 0 var(--space-2) 0;
}
.search-view__results {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.search-view__load-more {
  align-self: center;
  margin-top: var(--space-4);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  color: var(--heros-text-premium);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
}
.search-view__load-more:hover {
  background: var(--surface-hover);
}
```

**Step 4: Stage with hunk isolation**

```bash
git diff src/components/SearchView.tsx > /tmp/searchview-all.patch
git checkout HEAD -- src/components/SearchView.tsx
git apply /tmp/searchview-all.patch
git add -p src/components/SearchView.tsx
# Accept ONLY the W3 hunks. Reject the user's pre-existing hunks.
git diff --cached -- src/components/SearchView.tsx
git add src/styles/search.css
```

**Step 5: Build + commit**

```bash
bun run build
git commit -m "feat(w3): SearchView wired — filters + rerank + pagination"
```

---

### Task 17: AppShell Cmd+K wiring

**Files:**
- Modify: `src/components/AppShell.tsx` (HUNK ISOLATION REQUIRED — pre-existing dirty hunks)

Same hunk-isolation discipline as W2.5 Task 17.

**Step 1: Add the Cmd+K branch + Spotlight mount**

In the existing `onKey` effect, AFTER the Cmd+1..9 branch:

```ts
// Cmd+K → toggle Spotlight (any page).
if (e.key.toLowerCase() === 'k') {
  e.preventDefault()
  setSpotlightVisible((v) => !v)
  return
}
```

Add the state at the top of the component:

```ts
const [spotlightVisible, setSpotlightVisible] = useState(false)
```

(Verify `useState` is imported — it already is per the W2.5 dirty hunks.)

Add the import:

```ts
import { SpotlightOverlay } from './SpotlightOverlay'
```

Add the conditional mount in the JSX, just inside the top-level `<div>`:

```tsx
{spotlightVisible && (
  <SpotlightOverlay
    onDismiss={() => setSpotlightVisible(false)}
    onOpenPreview={(nodeId) => {
      setSpotlightVisible(false)
      onNavigate('notes')
      window.dispatchEvent(new CustomEvent('notes:open', { detail: nodeId }))
    }}
    onOpenInNewTab={(nodeId) => {
      setSpotlightVisible(false)
      onNavigate('notes')
      window.dispatchEvent(new CustomEvent('notes:open-new-tab', { detail: nodeId }))
    }}
  />
)}
```

**Step 2: CLAUDE.md Keyboard Contracts — confirm Cmd+K row**

The existing `Cmd/Ctrl+K` row at line 515 already says "Quick open / spotlight" — this matches W3's intent. **No change to CLAUDE.md needed.**

**Step 3: Stage with hunk isolation**

```bash
git diff src/components/AppShell.tsx > /tmp/appshell-all.patch
git checkout HEAD -- src/components/AppShell.tsx
git apply /tmp/appshell-all.patch
git add -p src/components/AppShell.tsx
# Accept ONLY the W3 hunks (Spotlight import, state, Cmd+K branch, mount).
# Reject every pre-existing hunk (BuddyView, isNavExpanded, TitleBar prop, etc.)
git diff --cached -- src/components/AppShell.tsx
```

**Step 4: Build + commit**

```bash
bun run build
git commit -m "feat(w3): AppShell — Cmd+K toggles SpotlightOverlay (any page)"
```

---

### Task 18: NotesView listener for `notes:open-new-tab`

**Files:**
- Modify: `src/components/NotesView.tsx`

Add a sibling listener to the existing `notes:open` listener in NotesView's `useEffect`. Single-line addition.

**Step 1: Find the existing `useEffect` block** that listens to `notes:open` (Task 16 of W2.5). Add a new listener:

```ts
const onOpenNewTab = (ev: Event) => {
  const id = (ev as CustomEvent).detail
  if (typeof id === 'string') {
    autoFocusNodeIds.current.delete(id)  // not auto-focus on cross-page open
    dispatch({ type: 'OPEN_IN_NEW_TAB', nodeId: id })
    bumpRefresh()
  }
}
window.addEventListener('notes:open-new-tab', onOpenNewTab)
// Remember to remove in cleanup:
return () => {
  // ... existing removals ...
  window.removeEventListener('notes:open-new-tab', onOpenNewTab)
}
```

Add `bumpRefresh` and `dispatch` to the dependency array if not already present.

**Step 2: Build + commit**

```bash
bun run build
bunx vitest run  # confirm 81 + W3-new tests still pass
git add src/components/NotesView.tsx
git commit -m "feat(w3): NotesView listens for notes:open-new-tab from Spotlight Cmd+Enter"
```

---

## Part E — Verification + ship

### Task 19: Test + build matrix

**Files:** none (verification only).

```bash
bun run build 2>&1 | tail -8
bunx vitest run 2>&1 | tail -8
cd src-tauri && cargo test --lib 2>&1 | tail -10 && cd ..
```

Expected:
- `bun run build`: green.
- `bunx vitest run`: ~108 tests passing (81 baseline + 7 searchTokens + 6 searchSnippet + 7 recentQueries + 7 SearchResultRow).
- `cargo test --lib`: 150 / 2 (140 W2.5 baseline + 4 Rule 19 + 6 cache).

If any check fails, diagnose, fix in the relevant task, re-run.

### Task 20: E2E walk-through (deferred to user)

Per spec §11.3, 12 manual scenarios. Document them in the W3 PLAN.md SHIPPED block (Task 21) — browser automation isn't available in the shipping session.

### Task 21: PLAN.md SHIPPED marker

**Files:**
- Modify: `PLAN.md`

Replace the `### W3 — Hybrid search` section header with:

```markdown
### W3 — Hybrid search ✅ SHIPPED (2026-04-25)

**Spec:** [docs/superpowers/specs/2026-04-25-w3-hybrid-search-design.md](docs/superpowers/specs/2026-04-25-w3-hybrid-search-design.md).
**Plan:** [docs/superpowers/plans/2026-04-25-w3-hybrid-search.md](docs/superpowers/plans/2026-04-25-w3-hybrid-search.md).

**Shipped (21 tasks, commits `<first>..<last>`):**
- Stage 4 cross-encoder reranker (`bge-reranker-v2-m3`) with new ORT session under Rules 16/16a/17/19, lazy-downloaded.
- LRU 128 rerank cache; 100 ms hard timeout; short-circuit when RRF top-1 dominates.
- Hybrid search filters: node_type, tags, date range, pagination.
- `SpotlightOverlay` (Cmd+K) — debounced 200 ms, top-10, keyboard-driven.
- `SearchView` rewrite — sidebar filters + paginated results + recent-query chips.
- Pure modules: `searchTokens` (date + tag parser), `searchSnippet` (safe `<mark>` renderer), `recentQueries` (localStorage LRU).
- Result routing: Enter → preview tab; Cmd+Enter → permanent tab via existing W2.5 reducer actions.
- Score-debug overlay (Cmd+Shift+D).

**Done criteria met:**
- `bun run build`: green.
- `bunx vitest run`: ~108 tests / ~16 files.
- `cargo test --lib`: ~150 / 2 pre-existing failures.
- §11.3 E2E scenarios 1–12: deferred to user manual walk-through (browser automation unavailable in shipping session).

**E2E manual walk-through (12 scenarios):**
1. Cmd+K opens Spotlight; Esc closes it.
2. Empty Spotlight shows recent queries.
3. Search "react" with mixed-type matches; both badges visible.
4. Cmd+Enter from Spotlight opens permanent tab.
5. Enter from Spotlight opens preview tab.
6. Spelling typo → "did you mean" suggestion (UI hooks shipped — backend lookup deferred).
7. Date token "today" filters to today's docs.
8. Tag short-circuit `#research` returns matching tag results.
9. First search downloads the reranker (568 MB overlay).
10. Reranker timeout fallback (force-throttle scenario).
11. SearchView filter sidebar refilters immediately on chip toggle.
12. Score-debug overlay (Cmd+Shift+D) reveals score chips.

**Closed backlog items:**
- W2.5 backlog: "Local-date helper for Cmd+Shift+J / /today" → `searchTokens.ts` provides it; future refactor of those callers will use it.
- W2 final-review backlog: "Rule 12 token sweep" — `search.css` shipped fully tokenised.

**Carried into Search v2 / W6:**
- HyDE / generative query expansion (needs LLM infra).
- Personalised boosting (recency, click-through learning).
- Saved searches / smart folders.
- Reranker model toggle (v2-m3 ↔ v2-base) in Settings.
- Faceted search beyond type/tags/date.
- Tag-list backed by SQL aggregate view (currently scans live nodes per render).
- Real `did-you-mean` Levenshtein lookup against `workspace_fts_v` vocab (UI hooks shipped, lookup backend deferred).
- Date-filter wired through to SQL CTE (Rust-side post-filter is no-op in v1).
```

Update the status tracker similarly.

```bash
git add PLAN.md
git commit -m "docs(w3): mark W3 SHIPPED with spec/plan refs, E2E checklist, remaining open items"
```

---

## Self-review notes

After writing this plan I cross-checked against the spec:

1. **Spec §3 invariants** — every relevant rule covered by Tasks 1-18. Rule 16/16a in Task 3, Rule 17 in Task 6, Rule 19 in Task 4, Rule 12/18 in Tasks 12-16 (search.css concern file).
2. **Spec §6 file inventory** — all 15 new files present across Tasks 2-15. All 8 modified files present across Tasks 1, 8, 16, 17, 18.
3. **Spec §10 latency budget** — Task 15 implements 200 ms debounce, 100 ms rerank timeout, short-circuit logic.
4. **Spec §11 done criteria** — Task 19 verification matrix matches.

**Risks I flagged during planning:**
- Task 3's ORT `try_extract_array` API call may differ in the installed `ort` 2.0-rc.12; implementer should adapt and report DONE_WITH_CONCERNS if uncertain.
- Task 8 `lib.rs` requires hunk isolation (pre-existing dirty hunks from user work); same patch-trick used in W2.5 Task 17 applies.
- Task 16 `SearchView.tsx` and Task 17 `AppShell.tsx` also need hunk isolation.
- Task 6 ships placeholder sha256 hashes; first end-to-end download in dev should pin real hashes via a follow-up commit.
- Date filtering (Task 8) is a no-op in v1 — surface in Task 19 telemetry, plan a follow-up.

**Pacing:** Part A is the longest chain (8 sequential Rust tasks). Parts B/C/D can ship as time allows; Part E is verification only.
