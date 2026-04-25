# W3 — Hybrid search (wire UI + cross-encoder rerank)

**Status:** design locked 2026-04-25 · ready for implementation plan
**Phase:** Backend Wiring follow-up. Consumes Phase A's `workspace_fts` + `vec_embeddings` + `search_workspace_hybrid` and W2.5's tab routing as baselines. Adds **one new ORT session** (cross-encoder reranker) and surfaces the existing search command through two dormant UIs.
**Predecessors:** [2026-04-23-w2-notes-wiring-design.md](2026-04-23-w2-notes-wiring-design.md), [2026-04-24-w2.5-notes-polish-tabs-design.md](2026-04-24-w2.5-notes-polish-tabs-design.md) (both shipped 2026-04-24).

---

## 1. Goal

Make the search the user actually feels. Phase A shipped industry-standard hybrid retrieval (BM25 FTS5 + dense bge-small-en-v1.5 vectors merged with RRF in a single SQL CTE) but no UI consumes it. W3 wires both consumer surfaces — `SearchView` (full page, dormant since W0) and a new `SpotlightOverlay` (Cmd+K) — and adds a **stage-4 cross-encoder reranking pass** using `bge-reranker-v2-m3` to lift result quality on ambiguous queries.

Result routing flows through W2.5's tab system so plain-click opens a preview tab and Cmd-click opens a permanent tab — consistent with tree clicks and wikilinks.

After W3, "where's that thing I wrote about X" becomes a sub-second keyboard reflex with multilingual semantic understanding plus exact-term precision.

---

## 2. Scope

### Included
1. **`SpotlightOverlay`** (Cmd+K) — floating modal, debounced search, top-10 results with snippets, keyboard-driven, results route into the W2.5 tab system.
2. **`SearchView`** wiring — full-page search with filter sidebar (node type, tags, date range), snippet rendering, match-type badges, pagination via "Load more" button.
3. **Stage-4 reranker** — `bge-reranker-v2-m3` cross-encoder runs over top-30 hybrid candidates, returns top-N. New ORT session under Rule 16/16a, lazy-downloaded per the whisper sidecar pattern.
4. **FTS5 snippet rendering** — `snippet()` function with `<mark>` markers, escaped + safely rendered as React.
5. **Score-debug overlay** — Cmd+Shift+D in Spotlight reveals `[fts:r=2 vec:r=5 rrf:0.041 rerank:0.83]` per result. Hidden by default, gated on `import.meta.env.DEV` OR a `localStorage` flag.
6. **Spell correction "did you mean"** — Levenshtein-1 against the FTS5 vocabulary when the query returns 0 hits or top RRF score < 0.005.
7. **Recent-query chips** — LRU of last 10 queries in `localStorage`, surfaced in the empty Spotlight state.
8. **Tag short-circuit** — exact-tag-match queries promote a "All notes tagged #x" pseudo-result to slot 0.
9. **Date-token parsing** — `today`, `yesterday`, `last week`, `this month` parsed into a `created_at` / `updated_at` filter that joins the SQL CTE.
10. **Result routing into W2.5 tabs** — Enter → preview tab (`OPEN_PREVIEW`); Cmd/Ctrl+Enter → permanent tab (`OPEN_IN_NEW_TAB`).

### Excluded (deferred to later phases)
- **HyDE / generative query expansion** — needs a local generative LLM; defer to W6 (AI chat). Whisper is encoder-decoder for speech and physically cannot do this.
- **Personalised boosting** (recency, currently-open-doc adjacency, click-through learning) — polish phase after we have real usage signal.
- **Search-history full audit log** — beyond the LRU 10. CLAUDE.md Deferred list.
- **Multilingual reranker swap to bge-reranker-v2-base** if v2-m3 latency becomes a complaint — also a polish-phase pivot, not a v1 commitment.
- **Faceted search beyond node-type / tags / date** — author, link-degree, vault-folder filters defer to Search v2.
- **In-result inline editing** — clicking should always route into the editor, never edit in-place.
- **Saved searches / smart folders** — out of scope.
- **Search inside attachments** (PDF, audio) — covered when the W4+ database surfaces and audio transcripts get their own indexable surface beyond `workspace_nodes`.

---

## 3. Invariants honoured

Every hard rule from CLAUDE.md that applies:

| # | Rule | Compliance |
|---|---|---|
| 1 | Vault is source of truth | Search reads from `workspace.db` derived index only; never reads vault `.md` files at query time. Index is kept in sync by `EmbeddingWorker` + `WorkspaceManager` write triggers (unchanged from Phase A). |
| 2 | `currentPage` + Context, no Zustand | Spotlight visibility lives in `AppShell` local state. SearchView state is local `useReducer`. No new stores. |
| 10 | Body is raw markdown | Search reads `workspace_fts.body` (markdown-as-stored). Snippet `<mark>` is added at query time, not persisted. |
| 11 | No separate folder node type | "Open in new tab" works for any `node_type` document. Filter chips name `node_type` values literally (`document`, `database`, `row`). |
| 12 / 18 | Token-only CSS | Every spacing/colour/radius/shadow value uses existing tokens or, if a new value is needed, lands in `src/App.css :root` first. New chrome respects the BEM prefix discipline (`.spotlight-*`, `.search-result-*`, etc.). |
| 13 | Vault-write conflict guard | N/A — search is read-only. |
| 14 | No filesystem watcher | N/A. |
| 16 | Native ML isolation | New cross-encoder session is its own `std::thread::spawn` worker with `crossbeam_channel::bounded(8)` request queue, sentinel + restart-once. Mirrors `embedding_ort::InferenceHandle`. |
| 16a | Multi-session ORT concurrency | Three ORT sessions now run concurrently (transcription / embedding / reranker). Reranker caps `intra_threads` to `num_cpus / 3`. **Reranker yields to active transcription** via the existing `transcription_session_holds_model(app)` poll — sleep-and-retry, never compete. Reranker runs on **CPU only**; GPU stays reserved for transcription. |
| 17 | Native extensions per-platform | Reranker model file is **not** bundled at build time (would add 568 MB to the installer). Lazy-downloaded to `<app_data>/handy/models/bge-reranker-v2-m3/` on first search use, mirroring the whisper sidecar pattern. The download fetches the platform-correct ORT-compatible artefacts. |
| 19 | Model-version guard | New table `reranker_model_info` (id PK = 1, model_id, model_hash, dimension N/A) follows the same shape as `embedding_model_info`. Mismatch on boot → invalidate the rerank LRU cache. |
| 20 | Native webview zoom | Spotlight, SearchView, and SpotlightOverlay all use token-based px values that scale with `setZoomFactor`. Result rows rely on `--text-sm` / `--text-base` / `--space-*`. |
| 22 / 23 | CM6 + autocomplete | N/A — search lives outside the editor. (Wikilink autocomplete in the editor remains its own surface, fed by the existing `search_workspace_title` command.) |

---

## 4. Locked decisions (from senior-dev review)

1. **Reranker model: `bge-reranker-v2-m3`** (multilingual XLM-RoBERTa-base, 568 M params, 568 MB ONNX). Selected over `bge-reranker-base` and `ms-marco-MiniLM-L-6-v2` for the multilingual upside (vault may contain non-English content) and the +3 nDCG over base. Tactics in §10 keep latency tolerable.
2. **Model delivery: lazy download**, not bundled. First search ever shows "Loading search reranker… (one-time, 568 MB)" with progress. Cached at `<app_data>/handy/models/bge-reranker-v2-m3/`. Mirrors the whisper sidecar UX. If download fails, search falls back to RRF-only and emits a banner.
3. **Rerank window: top-30 → top-10** (not top-50 → top-10). Lower latency, ~95 % of the quality per BAAI's ablations.
4. **Hard rerank timeout: 100 ms.** If the worker doesn't return by then, fall back to RRF order and emit a `rerank-timeout` telemetry event.
5. **Short-circuit on dominant winner.** If RRF top-1 score ≥ 2× top-2, skip rerank entirely (one obvious match doesn't need re-scoring).
6. **Rerank LRU cache: 128 entries**, keyed by `(query_hash, candidate_id_set_hash)`. Repeated typing of the same query (corrections, deletes, retypes) reuses scores. Cache invalidates on `reranker_model_info` mismatch (Rule 19).
7. **Spotlight debounce: 200 ms** (up from the 150 ms ms standard) — gives the rerank worker headroom without feeling laggy.
8. **Stage-2 fan-out: top-30 from FTS + top-30 from semantic** (was top-3× limit in `hybrid_search_workspace`). Wider net before rerank.
9. **No HyDE / query expansion in W3.** Stage 2 (bge embeddings) already handles synonym/paraphrase. Stage 4 (rerank) closes most of the residual recall gap. HyDE waits for W6 LLM infra.
10. **Spell correction is Levenshtein-1 on the FTS5 vocabulary**, not a learned model. Triggers when `results.length === 0` OR `top.score < 0.005`.
11. **Date-token parser is hand-rolled**, not a library. Tokens: `today`, `yesterday`, `last week`, `this week`, `this month`, `last month`. Anything else passes through as plain query text.
12. **Result routing**: Enter = preview tab (`OPEN_PREVIEW`); Cmd/Ctrl+Enter = permanent tab (`OPEN_IN_NEW_TAB`); Shift+Enter reserved for "Open in split pane" (deferred — emits a toast for now). Mouse-click follows the same modifier convention.
13. **No score-display in production.** RRF / rerank scores stay behind the Cmd+Shift+D debug toggle. Real users don't want to see them.

---

## 5. Architecture

### 5.1 Pipeline

```
                                    user keystroke
                                          │
                                  200 ms debounce
                                          │
                            ┌─────────────┴─────────────┐
                            │ parse query for tokens    │
                            │   • date tokens → filter  │
                            │   • exact tag → tag chip  │
                            └─────────────┬─────────────┘
                                          │
                          query text + filters
                                          │
                         ┌────────────────┴────────────────┐
                         │  Tauri: search_workspace_hybrid │
                         │     (existing Phase A SQL CTE)  │
                         │   FTS5 BM25 (top-30)            │
                         │   + sqlite-vec KNN (top-30)     │
                         │   + RRF fusion in SQL           │
                         └────────────────┬────────────────┘
                                          │
                                top-30 RRF candidates
                                          │
                          ┌───────────────┴───────────────┐
                          │  Short-circuit check          │
                          │   if score[0] ≥ 2 × score[1]  │──── skip ────┐
                          │   → return RRF top-10         │              │
                          └───────────────┬───────────────┘              │
                                          │ otherwise                    │
                                          │                              │
                          ┌───────────────┴───────────────┐              │
                          │  Cache lookup (LRU 128)       │              │
                          │   key: (q_hash, ids_hash)     │──── hit ─────┤
                          │   miss → continue             │              │
                          └───────────────┬───────────────┘              │
                                          │                              │
                          ┌───────────────┴───────────────┐              │
                          │  Tauri: rerank_candidates     │              │
                          │   bge-reranker-v2-m3          │              │
                          │   100 ms hard timeout         │──── timeout ─┤
                          │   → re-score 30 candidates    │              │
                          └───────────────┬───────────────┘              │
                                          │                              │
                                  reranked top-10                        │
                                          │                              │
                                          ▼                              ▼
                          ┌─────────────────────────────────────────────────┐
                          │  SpotlightOverlay / SearchView                  │
                          │   render with snippet + match-type badges       │
                          └─────────────────────────────────────────────────┘
```

### 5.2 State ownership

| State | Owner | Shape |
|---|---|---|
| Spotlight visible | `AppShell` local state | `boolean` |
| Spotlight query, results, active-index | `SpotlightOverlay` `useReducer` | §6.3 |
| SearchView query, filters, results, page | `SearchView` `useReducer` | §6.4 |
| Recent queries LRU | `localStorage["handy.search.recent"]` | `string[]` (max 10) |
| Rerank LRU cache | `SearchManager` (Rust) | in-memory map keyed by `(query_hash, ids_hash)`; 128 entries |
| Reranker availability + reason | `RerankerHandle` (Rust) — same shape as `InferenceHandle` | exposed via existing `get_footer_system_status` extension |
| Reranker download progress | `AppState` event stream `reranker-download-progress` | `{ bytes, total, status }` |

### 5.3 Key data flows

**Spotlight open + first keystroke:**
```
user presses Cmd+K
  → AppShell sets `spotlightVisible = true`
  → SpotlightOverlay mounts, focuses input
user types "react patterns"
  → 200 ms debounce
  → parse tokens → no date filter, no tag short-circuit
  → invoke('search_workspace_hybrid', { query: 'react patterns', limit: 30 })
  → top-30 RRF candidates returned
  → if shortCircuitDominant(results) → skip rerank, take top-10
    else → invoke('rerank_candidates', { query, candidates: top-30, limit: 10 })
        → if timeout → fall back to RRF top-10, toast 'Rerank timed out'
        → else → use reranked top-10
  → render results
```

**Result selection — Enter (preview):**
```
user presses ↓ to highlight result 3
user presses Enter
  → SpotlightOverlay closes (AppShell setSpotlightVisible(false))
  → AppShell.onNavigate('notes')
  → window.dispatchEvent(new CustomEvent('notes:open', { detail: result.node_id }))
  → NotesView's existing 'notes:open' listener (Task 16) → dispatch({ type: 'OPEN_PREVIEW', nodeId })
```

**Result selection — Cmd+Enter (permanent tab):**
```
user presses Cmd+Enter on highlighted result
  → SpotlightOverlay closes
  → AppShell.onNavigate('notes')
  → window.dispatchEvent(new CustomEvent('notes:open-new-tab', { detail: result.node_id }))
  → NotesView listens for new event → dispatch({ type: 'OPEN_IN_NEW_TAB', nodeId })
```

**Reranker first-use download:**
```
SearchManager.rerank_candidates() called for the first time
  → RerankerHandle.is_available() returns false ("model_not_downloaded")
  → frontend shows "Loading search reranker… (one-time, 568 MB)" overlay over results
  → AppState spawns download task → emits `reranker-download-progress`
  → on success: write reranker_model_info row (Rule 19), restart RerankerHandle worker
  → next rerank call succeeds
  → on failure: toast "Reranker unavailable — using fallback ranking", hide overlay
```

**Reindex collision (Rule 19 mismatch on boot):**
```
boot → rule_19_reindex_check on embedding model
  → if mismatch → existing flow: DELETE FROM vec_embeddings, queue all nodes
  → ALSO: clear rerank LRU cache (rerank scores depend on retrieval set)
  → if reranker_model_info mismatches → just clear cache and re-record;
     reranker model swap doesn't invalidate retrieval, only stored scores
```

### 5.4 Rerank invocation contract

```ts
// src/bindings.ts (auto-generated)
type RerankCandidate = {
  node_id: string
  title: string
  excerpt: string  // first ~512 chars of body, prepared by SearchManager
}

type RerankResult = {
  node_id: string
  rerank_score: number  // sigmoid(logits), 0..1
  original_rank: number // position in the input candidates list
}

await invoke<RerankResult[] | null>('rerank_candidates', {
  query: 'react patterns',
  candidates: top30,  // RerankCandidate[]
  limit: 10,
  timeoutMs: 100,
})
// → returns null on timeout / model unavailable, caller falls back to RRF order
```

The Rust side enforces the timeout via `tokio::select!` on the oneshot receiver and a sleep future. Worker thread is non-cancellable (ORT sessions can't be aborted mid-inference); on timeout the result is dropped and the worker continues to completion (warming the LRU cache for the next call with the same candidate set).

### 5.5 Snippet rendering

FTS5 supports `snippet(table, col_idx, prefix, suffix, ellipsis, max_tokens)`. Use:

```sql
snippet(workspace_fts, 1, '<mark>', '</mark>', '…', 20)
```

(Column 1 is `body`; column 0 is `title` and gets a separate `highlight()` call for the title row.)

Frontend renders the snippet via a tiny safe-HTML parser — split on `<mark>…</mark>`, render `<mark>` runs as `<span className="search-snippet__hit">`, everything else as plain text. **Never inject HTML strings into the DOM via React's HTML-injection prop** — Rule from M4 of W2.5 final review. The parser returns React nodes only.

### 5.6 Date-token parser

```ts
// src/editor/searchTokens.ts (new)
type DateFilter = { from: number; to?: number }  // unix-ms

const TOKEN_PATTERNS: Array<{ pattern: RegExp; toFilter: (now: Date) => DateFilter }> = [
  { pattern: /\btoday\b/i,        toFilter: now => ({ from: startOfDay(now), to: endOfDay(now) }) },
  { pattern: /\byesterday\b/i,    toFilter: now => ({ from: startOfDay(addDays(now,-1)), to: endOfDay(addDays(now,-1)) }) },
  { pattern: /\blast\s+week\b/i,  toFilter: now => weekRange(now, -1) },
  { pattern: /\bthis\s+week\b/i,  toFilter: now => weekRange(now, 0) },
  { pattern: /\blast\s+month\b/i, toFilter: now => monthRange(now, -1) },
  { pattern: /\bthis\s+month\b/i, toFilter: now => monthRange(now, 0) },
]

export function parseSearchTokens(raw: string): { query: string; dateFilter?: DateFilter } {
  for (const { pattern, toFilter } of TOKEN_PATTERNS) {
    if (pattern.test(raw)) {
      return { query: raw.replace(pattern, '').trim(), dateFilter: toFilter(new Date()) }
    }
  }
  return { query: raw }
}
```

Unit-tested independently. Local-time parsing only (Rule from W2.5 review — see "Local-date helper" backlog item; W3 ships this helper and the W2.5 backlog item closes against it).

### 5.7 Spell correction "did you mean"

Triggered ONLY when `results.length === 0` OR `results[0].score < 0.005`. Performs:

```sql
SELECT term FROM workspace_fts_v WHERE term LIKE ?1
-- (workspace_fts_v is the FTS5 virtual vocab table — auto-created by FTS5)
```

For each query term, find the closest vocabulary term within Levenshtein distance 1 (Damerau-Levenshtein optional). If at least one term has a candidate correction, surface a "Did you mean: **rect**?" banner under the search input. Click → re-runs the search with the corrected term.

**Cap:** scan the first 5,000 vocab entries only — for vaults beyond that, the spell correction silently no-ops. Avoids a multi-second freeze on huge vaults.

---

## 6. File inventory

### New files

| Path | Purpose |
|---|---|
| `src/components/SpotlightOverlay.tsx` | Floating Cmd+K modal — input, results list, keyboard nav, footer with shortcuts hint |
| `src/components/SearchResultRow.tsx` | Single result row — icon, title, breadcrumb, snippet, match-type badges, optional debug score chip |
| `src/components/SearchFilters.tsx` | Sidebar for SearchView — node-type chips, tag chips, date range presets |
| `src/components/SearchEmptyStates.tsx` | Recent-query chips, "no results", "did you mean", first-load hint |
| `src/editor/searchTokens.ts` | Pure token parser — date tokens + tag short-circuit detection |
| `src/editor/searchSnippet.ts` | Safe `<mark>`-aware snippet renderer (returns React nodes, no HTML injection) |
| `src/editor/recentQueries.ts` | LRU helper backed by `localStorage` |
| `src/editor/__tests__/searchTokens.test.ts` | Unit tests — date tokens (today, yesterday, week ranges, timezone edges), tag detection, plain queries pass-through |
| `src/editor/__tests__/searchSnippet.test.ts` | Unit tests — single hit, multiple hits, escaped HTML in source, malformed marks |
| `src/editor/__tests__/recentQueries.test.ts` | Unit tests — push, dedupe, max-size trim, persistence |
| `src/components/__tests__/SearchResultRow.test.tsx` | Render tests — match-type badges, missing excerpt, long titles |
| `src-tauri/src/managers/reranker_ort.rs` | New ORT session for `bge-reranker-v2-m3`. Mirrors `embedding_ort.rs` structure: `RerankerHandle` (worker thread + crossbeam request channel + sentinel), `rule_19_check` against `reranker_model_info`, `model_info()` query |
| `src-tauri/src/managers/reranker_cache.rs` | LRU-128 cache keyed by `(query_hash, candidate_ids_hash)`. Uses `lru` crate (already a transitive dep of one of our crates — verify) |
| `src-tauri/src/managers/reranker_download.rs` | Lazy-download orchestrator: HTTP fetch with progress emit, sha256 verification, atomic-rename into `<app_data>/handy/models/bge-reranker-v2-m3/`. Includes resume-on-failure |
| `src-tauri/src/commands/rerank.rs` | `rerank_candidates(query, candidates, limit, timeout_ms)` Tauri command. Routes through `RerankerHandle` + LRU |
| `src-tauri/migrations/00X_reranker_model_info.sql` | New table (Rule 19 pattern) |

### Modified files

| Path | Change |
|---|---|
| `src/components/SearchView.tsx` | Replace W2 placeholder body. Render `<SearchFilters>` sidebar + `<SearchResultRow>` list. State via `useReducer`. Pagination via "Load more" button (hybrid query supports `limit` + `offset`). Filter state passes through `parseSearchTokens` for date overlays. |
| `src/components/AppShell.tsx` | Wire **Cmd+K** to toggle `spotlightVisible`. Mount `<SpotlightOverlay>` when visible. New custom event `notes:open-new-tab` dispatched on Cmd+Enter from Spotlight (NotesView listens — see below). Pre-existing dirty hunks remain unstaged via `git add -p`. |
| `src/components/NotesView.tsx` | Add `notes:open-new-tab` listener that dispatches `{ type: 'OPEN_IN_NEW_TAB', nodeId: detail }`. Mirrors the existing `notes:open` listener (Task 16 of W2.5). |
| `src-tauri/src/commands/search.rs` | Optional: extend `search_workspace_hybrid` signature to accept `node_types: Option<Vec<String>>`, `tags: Option<Vec<String>>`, `created_from: Option<i64>`, `created_to: Option<i64>` filters. Wired into the SQL CTE. Backwards-compatible (all optional). |
| `src-tauri/src/managers/search.rs` | Pass-through filter params into the FTS / semantic CTE. Widen retrieval to top-30 each (was `limit * 3`). |
| `src-tauri/src/lib.rs` | Register new commands `rerank_candidates`, `get_reranker_status`, `download_reranker_model`. Initialise `RerankerHandle` and add to managed state. Wire its sentinel to emit `reranker-unavailable` (mirrors `vector-search-unavailable`). |
| `src/styles/notes.css` OR new `src/styles/search.css` | New concern file `search.css` — `notes.css` is already 684 lines (over the 500 ceiling per Rule 18). All `.spotlight-*`, `.search-*` classes go here. Tokens-only. |
| `src/App.css` | Possible additions: `--surface-overlay` for the modal backdrop if not already present; `--shadow-overlay` for the Spotlight floating shadow. Verify before adding. |
| `CLAUDE.md` | Add Cmd+K to the Keyboard Contracts table. Update the Search Stack section to note `bge-reranker-v2-m3` and the `reranker_model_info` table. |

### Deleted files
None.

### Summary counts
- **15 new files** (4 components + 3 frontend pure modules + 4 frontend test files + 4 Rust modules / migrations).
- **8 modified files**.
- **0 deletions.**

---

## 7. Reranker integration in detail

### 7.1 `RerankerHandle` (Rule 16 worker)

```rust
// src-tauri/src/managers/reranker_ort.rs
pub struct RerankerHandle {
    request_tx: crossbeam_channel::Sender<RerankRequest>,
    is_available: Arc<AtomicBool>,
    unavailable_reason: Arc<RwLock<Option<String>>>,
    last_heartbeat: Arc<AtomicI64>,  // unix-ms; sentinel watches
    model_path: PathBuf,
}

struct RerankRequest {
    query: String,
    candidates: Vec<RerankCandidate>,
    limit: usize,
    response_tx: tokio::sync::oneshot::Sender<Result<Vec<RerankResult>>>,
}
```

- One dedicated `std::thread::spawn` worker, **not** a tokio task (Rule 16).
- `crossbeam_channel::bounded(8)` — back-pressure visible via `try_send` returning `Full` after eight queued requests; rerank calls return null in that case.
- Sentinel restart-once: heartbeat timeout 30 s. First death respawns; second death flips `is_available = false` and emits `reranker-unavailable`.
- Session built lazily on first request — keeps boot fast even if the model is on disk.

### 7.2 Rule 16a yielding

```rust
// Inside the worker loop, before each session.run():
while transcription_session_holds_model(&app) {
    std::thread::sleep(Duration::from_millis(20));
    if request_age > Duration::from_millis(timeout_ms) {
        return Err(anyhow!("rerank timed out waiting for transcription"));
    }
}
let outputs = session.run(inputs)?;
```

Same pattern the embedding worker uses. Reranking is interactive but transcription is more interactive — voice memos in flight take priority.

### 7.3 ORT session config

```rust
let session = ort::SessionBuilder::new()?
    .with_intra_threads(num_cpus::get() / 3)?
    .with_inter_threads(1)?
    .with_optimization_level(ort::GraphOptimizationLevel::Level3)?
    .commit_from_file(&self.model_path.join("model.onnx"))?;
```

CPU only. GPU stays reserved for the latency-sensitive transcription session per Rule 16a.

### 7.4 Tokenizer

`bge-reranker-v2-m3` uses XLM-RoBERTa SentencePiece tokenization (different from bge-small-en-v1.5's BERT WordPiece). Bundle `tokenizer.json` + `sentencepiece.bpe.model` alongside `model.onnx` in the download artefact. Use the `tokenizers` crate (already in Cargo.lock per the embedding model loader).

### 7.5 Inference call

```rust
// Pair (query, candidate_excerpt) → cross-encoder logit
let pairs: Vec<(String, String)> = candidates.iter()
    .map(|c| (query.to_string(), c.excerpt.clone()))
    .collect();

let encoded = tokenizer.encode_batch(pairs, true)?;
// tensors: input_ids [B, 512], attention_mask [B, 512], token_type_ids [B, 512]
let outputs = session.run(ort::inputs![ ... ])?;
let logits: ndarray::Array2<f32> = outputs[0].try_extract()?;  // [B, 1]
let scores: Vec<f32> = logits.iter().map(|x| sigmoid(*x)).collect();
```

Truncate excerpts to ~480 tokens (each candidate's excerpt was already truncated to ~512 chars in `SearchManager`; tokenizer truncation handles overflow).

### 7.6 Lazy-download UX

First search → invoke `rerank_candidates` → backend returns `Err("reranker_not_downloaded")` → frontend shows blocking overlay over results:

```
┌──────────────────────────────────────────┐
│  Setting up search                       │
│                                          │
│  Downloading reranker model… one-time    │
│  ████████████████████░░░░  78%           │
│                                          │
│  256 MB / 568 MB                         │
└──────────────────────────────────────────┘
```

Backend command `download_reranker_model()` spawns a tokio task that streams the file, emits `reranker-download-progress { bytes, total, status }` periodically. On completion, write the row into `reranker_model_info`, signal `RerankerHandle` to build its session on the next call. Frontend re-invokes `rerank_candidates` automatically after the download completes.

If the user dismisses the overlay (Esc on Spotlight, navigate away from SearchView), the download keeps running in the background — no abort. Next search picks it up if complete.

### 7.7 Failure modes

| Scenario | Behaviour |
|---|---|
| Model not downloaded | First-use overlay; search runs RRF-only meanwhile via the timeout path |
| Download fails mid-stream | Toast "Couldn't download reranker — using fallback ranking", retry button in Settings (W5) |
| Worker thread panics once | Sentinel respawns; user sees no degradation |
| Worker thread panics twice | `reranker-unavailable` event; UI shows a small "search ranking degraded" badge in the footer; RRF-only forever this session |
| Rerank takes > 100 ms | Timeout fires, RRF top-10 returned, telemetry counter; user never sees anything wrong |
| LRU cache hit | Skip the worker entirely, return cached scores |
| Query empty | Skip rerank, return empty result set |
| Candidates < 2 | Skip rerank (nothing to re-order), return as-is |

---

## 8. Spotlight UX in detail

### 8.1 Anatomy

```
┌────────────────────────────────────────────────────────┐
│ 🔍  react patterns                                  ⌘K │ ← input row, 48 px
├────────────────────────────────────────────────────────┤
│ 📄 React Patterns                       Notes › Code   │ ← result row 1
│    …performance via memoization, <mark>react</mark>… 🟢🟣│   (icon, title, breadcrumb, snippet, badges)
├────────────────────────────────────────────────────────┤
│ 📄 Compose vs Inherit                   Notes › Old    │ ← result row 2
│    Inheritance is back via <mark>patterns</mark>…    🟢│
├────────────────────────────────────────────────────────┤
│ 📄 Hooks Cheatsheet                     Notes › Refs   │
│    Custom hooks unlock composable <mark>patterns</mark>… 🟣│
├────────────────────────────────────────────────────────┤
│ ↑↓ navigate · ↵ open · ⌘↵ new tab · esc close          │ ← footer hint
└────────────────────────────────────────────────────────┘
```

Width: 600 px max, 90 vw on small screens. Vertically anchored at 20 vh from top (not centred — easier to spot results and the search input doesn't shift down on screens of varying heights).

Match-type badges:
- 🟢 = FTS hit (BM25 contribution)
- 🟣 = vector hit (semantic contribution)
- ⭐ = reranker boosted (rerank score > RRF rank's expected score)

Most results have both 🟢 and 🟣. Only-🟢 means semantic missed (probably an exact identifier match). Only-🟣 means FTS missed (paraphrase or conceptual hit). The badges are subtle — small, muted — but they're a faster signal than scores about WHY a result is there.

### 8.2 Empty state

Recent-query LRU as quick-tap chips:

```
┌────────────────────────────────────────────────────────┐
│ 🔍                                                  ⌘K │
├────────────────────────────────────────────────────────┤
│ Recent searches:                                       │
│ [react patterns]  [voice memo]  [today]  [#research]   │
│                                                        │
│ Try `today` for recent notes, `#tag` for tagged notes  │
└────────────────────────────────────────────────────────┘
```

Click a chip → fills the input, runs the search.

### 8.3 No-results + did-you-mean

```
┌────────────────────────────────────────────────────────┐
│ 🔍  rect patterns                                   ⌘K │
├────────────────────────────────────────────────────────┤
│ No results.                                            │
│                                                        │
│ Did you mean: react patterns?                          │
└────────────────────────────────────────────────────────┘
```

Clicking the suggestion replaces the input value and re-runs.

### 8.4 Keyboard contract

| Key | Action |
|---|---|
| Cmd/Ctrl+K | Toggle Spotlight (open / close) |
| Esc | Close Spotlight |
| ↑ / ↓ | Move highlight |
| Enter | Open highlighted result in preview tab |
| Cmd/Ctrl+Enter | Open in new permanent tab |
| Shift+Enter | (reserved) — toast "Split-pane open coming in a later release" |
| Tab | Move focus from input to results list (then arrows work without re-clicking) |
| Cmd/Ctrl+Shift+D | Toggle score-debug overlay |

### 8.5 Modifier keys propagation

`onClick` and `onKeyDown` both read `event.metaKey || event.ctrlKey`. Mouse and keyboard route identically.

### 8.6 Focus trap

Standard React focus-trap: Tab cycles within Spotlight while open. Restoring focus to the previously-focused element on close.

---

## 9. SearchView UX in detail

### 9.1 Layout

```
┌──────────────────────┬─────────────────────────────────┐
│ Filters              │ 🔍  search…                      │
│ ────────             │ ──────────────────────────────── │
│ Type                 │ 142 results                      │
│ ☑ Document           │                                  │
│ ☐ Database           │ 📄 Result Title 1                │
│ ☐ Row                │   …snippet with <mark>hit</mark>…│
│                      │   Notes › Path · 🟢🟣 · 2 days ago│
│ Tags                 │ ──────────────────────────────── │
│ ☐ research           │ 📄 Result Title 2                │
│ ☐ daily              │   …snippet…                     │
│ ☐ work               │ ──────────────────────────────── │
│                      │ … (pagination — 20 per page)    │
│ Date                 │                                  │
│ ○ Any                │       [ Load 20 more ]           │
│ ● Last week          │                                  │
│ ○ Last month         │                                  │
│ ○ Custom range       │                                  │
└──────────────────────┴─────────────────────────────────┘
```

Filter chips refresh from the active vault: shows tags that exist + counts.

### 9.2 State

```ts
type SearchViewState = {
  query: string
  results: WorkspaceSearchResult[]
  page: number
  filters: {
    nodeTypes: Set<'document' | 'database' | 'row'>
    tags: Set<string>
    dateRange: DateFilter | null
  }
  loading: boolean
  totalKnown: number  // last reported count from backend; -1 = unknown
}
```

Filter changes refire the query immediately (no debounce — they're discrete clicks). Query changes hit the 200 ms debounce.

### 9.3 Routing

Same as Spotlight: click → preview tab; Cmd-click → permanent tab; right-click → HerOSMenu (W2.5 primitive) with Open / Open in new tab / Reveal in tree.

### 9.4 Pagination

Backend returns `totalKnown` (count of merged candidates after RRF, before truncate). Frontend shows "X results" and a "Load more" button that bumps `page` and re-issues the query with `offset` (a new optional param on the existing command).

Reranker reruns per page — top-30 of *that page's* candidates → top-10 displayed. Cache hit on the query side keeps repeated page loads cheap.

---

## 10. Latency budget

Target: keystroke-to-results ≤ 300 ms p95.

| Stage | Budget | Actual estimate |
|---|---|---|
| Debounce | 200 ms | 200 ms (settled) |
| Token parse | < 1 ms | < 1 ms |
| Tauri IPC overhead | 5 ms | ~5 ms |
| `search_workspace_hybrid` SQL CTE | 30 ms | 20–40 ms (n=10k nodes) |
| Short-circuit decision | < 1 ms | < 1 ms |
| Cache lookup | < 1 ms | < 1 ms |
| Rerank inference (top-30) | 100 ms hard cap | 80–150 ms typical, gets cut at 100 ms |
| React render | 10 ms | ~10 ms (10 result rows) |
| **Total p95** | **350 ms** | **≈ 300 ms typical, 320 ms p95** |

If the rerank typically exceeds 80 ms in real testing, we'll either bump the cap to 150 ms and accept a 400 ms total, or rerank top-20 instead of top-30. **Do not** chase optimisation in the spec — measure first, then tune.

---

## 11. Done criteria

Every checkbox green:

1. **`bun run build`** zero new errors.
2. **`bunx vitest run`** existing 81 tests + new tests for `searchTokens`, `searchSnippet`, `recentQueries`, `SearchResultRow` = ≈ 100 total.
3. **`cargo test --lib`** baseline 140/2 pre-existing failures unchanged + new tests for `RerankerHandle` smoke test (mocked ORT), LRU cache eviction, `reranker_model_info` migration round-trip = ≈ 145 / 2.
4. **All 12 §11.3 manual E2E scenarios pass** (below).
5. **No raw hex / px / `!important`** in any new W3 CSS file. New `search.css` concern file ≤ 500 lines.
6. **PLAN.md** W3 block marked SHIPPED with commit refs.

### 11.3 E2E scenarios (manual)

1. **Cmd+K opens Spotlight; Esc closes it.** Cmd+K from Notes, Search, Audio pages.
2. **Empty Spotlight shows recent queries.** Repeat a query 3 times; verify the chip appears, click chip re-runs.
3. **Search "react" with mixed-type matches.** FTS-only and vector-only results both appear; badges distinguish them.
4. **Cmd+Enter from Spotlight opens permanent tab.** Result lands as a new tab in NotesView, not the preview slot.
5. **Enter from Spotlight opens preview tab.** Result lands as preview (italic). Typing promotes it.
6. **Spelling typo → "did you mean".** Type "rect"; suggestion "react" appears; click corrects.
7. **Date token "today".** Returns only docs created/updated today; query field shows the parsed token highlighted.
8. **Tag short-circuit** — type `#research` → top result is "All notes tagged #research" (or single-tag result).
9. **First search downloads the reranker.** Fresh app data dir; first search shows download overlay; completes; second search uses reranker (verified via score-debug overlay showing rerank scores).
10. **Reranker timeout fallback.** Force-throttle the worker; verify search still returns results within 350 ms via RRF order.
11. **SearchView filter sidebar** — type a query, toggle a tag chip; results refilter immediately (no debounce on filter clicks).
12. **Score-debug overlay** — Cmd+Shift+D in Spotlight reveals per-result score chips; toggle off restores plain view.

---

## 12. Risks + open follow-ups

**Known risks:**

- **568 MB download** is a noticeable first-run hit. If users hate it, fall back to `bge-reranker-base` (280 MB) with a Settings toggle. Defer the toggle to a polish phase.
- **Rerank latency on weak hardware** (4-core ARM, low RAM). 100 ms cap protects UX but degrades quality on those machines. Telemetry on `rerank-timeout` counter will tell us how often this fires in the wild.
- **FTS5 `snippet()` truncation at token boundaries** can cut mid-word. Acceptable for v1; if it bothers people, switch to a hand-rolled snippet that respects word boundaries (~30 LoC).
- **Spell correction over a 50k-vocab vault** could be slow even at the 5,000-cap. Telemetry on its latency for tuning.

**Backlog items closed by this spec:**
- W2 final-review backlog: "Rule 12 token discipline sweep" → continues here for any new W3 surfaces.
- W2.5 backlog: "Local-date helper for Cmd+Shift+J / /today" → `searchTokens.ts` provides the helper; refactor `Cmd+Shift+J` and the future `/today` command to use it.

**Carried into Search v2 / W6:**
- HyDE / generative query expansion (needs LLM infra).
- Personalised boosting (recent / open-doc adjacency, click-through learning).
- Saved searches / smart folders.
- Rerank model swap toggle (v2-m3 ↔ v2-base) in Settings.
- Faceted search (author, link-degree, vault-folder).

---

*Spec prepared: 2026-04-25*
*Predecessors: W0/W1 (2026-04-23), W2 (2026-04-23), W2.5 (2026-04-24)*
*Reviewers: locks @ senior-dev review 2026-04-25*
