# Knowledge Import Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the dormant `Import → Files` tab to the existing `ImportQueueService` (drag-drop, file picker, header buttons, real queue lists). Extract shared queue-list components so URL and Files tabs share one stateful CompletedPanel. Fix shared-pipeline bugs found during inspection: specta digit-snake-case TS drift, queue cross-leaking, all-or-nothing path enqueue, missing duplicate guard, missing cloud-sync placeholder filter.

**Architecture:** Four phases. Phase 1 = Rust backend (specta rename + partial-success enqueue + dedup + cloud-sync filter + tests). Phase 2 = regenerate `bindings.ts` via one `tauri dev` boot. Phase 3 = frontend shared extraction (`src/utils/importJobs.ts` + `src/components/ImportQueueLists.tsx`, refactor URL tab to use them — behavior unchanged). Phase 4 = wire Files tab (kind-filtered queue, Tauri webview drag-drop, plugin-dialog file picker, prop-threaded `onNavigate`).

**Tech Stack:** Rust (tokio, specta `=2.0.0-rc.22`, tauri-specta `=2.0.0-rc.21`), React 19 + TypeScript + Vite, Tauri 2 (`@tauri-apps/plugin-dialog`, `@tauri-apps/api/webview`), motion/react, sonner toasts, vanilla CSS (Rule 18).

**Spec:** [`docs/superpowers/specs/2026-04-26-knowledge-import-wiring-design.md`](../specs/2026-04-26-knowledge-import-wiring-design.md)

---

## File Map

- **Modify** `src-tauri/src/import/web_media.rs:265-270` — per-variant `#[specta(rename = …)]` on `WebMediaFormat`.
- **Modify** `src-tauri/src/import/mod.rs` — add `EnqueuePathRejection`, `EnqueuePathsResult`, `is_cloud_sync_placeholder`, `active_source_paths`. Refactor `enqueue_paths` to partial-success. Extend tests.
- **Modify** `src-tauri/src/commands/import_queue.rs:6` — change `enqueue_import_paths` return type to `Result<EnqueuePathsResult, String>`.
- **Auto-regenerate** `src/bindings.ts` (do not hand-edit; `bun run tauri dev` triggers regen via tauri-specta).
- **Create** `src/utils/importJobs.ts` — `formatBytes`, `formatDuration`, `jobProgress`, `jobStatusLine`, `jobTitle`, `TERMINAL_STATES`.
- **Create** `src/components/ImportQueueLists.tsx` — `<ImportProcessingList>`, `<ImportCompletedList>`.
- **Modify** `src/components/ImportUrlTab.tsx` — delete inlined helpers/components, import shared, filter `kind === 'web_media'`, provide `renderUrlThumb`.
- **Modify** `src/components/ImportFilesTab.tsx` — full wiring: prop signature, `useImportQueue` filter, drag-drop, file picker, header buttons, source-chip disabled state, h1 rename, real queue lists.
- **Modify** `src/components/ImportView.tsx` — accept and forward `onNavigate` prop.
- **Modify** `src/components/AppShell.tsx:148` — pass `onNavigate` into `<ImportView />`.
- **Modify** `src/styles/import.css` — `.import-source-chip--disabled` class.

---

## Phase 1 — Rust backend

### Task 1: Pin specta wire format on `WebMediaFormat`

**Files:**
- Modify: `src-tauri/src/import/web_media.rs:264-270`

- [ ] **Step 1: Replace the enum definition**

Find the current code at `src-tauri/src/import/web_media.rs:264-270`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WebMediaFormat {
    Mp3Audio,
    Mp4Video { max_height: u32 },
}
```

Replace with:

```rust
// Wire format: serde produces "mp3_audio" / "mp4_video" (snake_case is byte-correct on
// digits). specta-2.0.0-rc.22's snake_case derive treats digit boundaries as word breaks
// and emits "mp_3_audio" / "mp_4_video" — wrong. Per-variant `#[specta(rename = "...")]`
// pins the literal output. Do NOT replace with `#[specta(rename_all = "snake_case")]`:
// that re-runs the broken algorithm. The serde test below pins runtime; tsc --noEmit
// pins TS bindings.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WebMediaFormat {
    #[specta(rename = "mp3_audio")]
    Mp3Audio,
    #[specta(rename = "mp4_video")]
    Mp4Video { max_height: u32 },
}
```

- [ ] **Step 2: Run cargo check**

Run: `cd src-tauri && cargo check --lib`
Expected: builds without warnings about unknown attribute. If the `specta` attribute is rejected, the version may differ — verify with `grep specta Cargo.toml` and consult specta-2.0.0-rc.22 docs.

- [ ] **Step 3: Run existing serde test to confirm wire format unchanged**

Run: `cd src-tauri && cargo test --lib web_media_format_serializes_with_snake_case_kind -- --nocapture`
Expected: PASS — both assertions about `"mp3_audio"` and `"mp4_video"` still hold.

- [ ] **Step 4: Stage** (do NOT commit yet — Phase 1 is one atomic commit at Task 8)

```bash
git -C C:/AI_knowledge_workspace/Handy-main add src-tauri/src/import/web_media.rs
```

---

### Task 2: Add `EnqueuePathRejection` and `EnqueuePathsResult` types

**Files:**
- Modify: `src-tauri/src/import/mod.rs` (near other DTOs around line 78-99)

- [ ] **Step 1: Add new types after `ImportJobDto`**

Locate the `ImportJobDto` struct near `src-tauri/src/import/mod.rs:78`. Immediately after the closing `}` of `ImportJobDto`, insert:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EnqueuePathRejection {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EnqueuePathsResult {
    /// Job IDs for files that successfully entered the queue.
    pub accepted: Vec<String>,
    /// Files rejected before being queued (unsupported type, cloud-sync placeholder,
    /// duplicate of an in-flight import, missing file). Each entry has the original
    /// path string and a user-readable reason for the toast.
    pub rejected: Vec<EnqueuePathRejection>,
}
```

- [ ] **Step 2: Run cargo check**

Run: `cd src-tauri && cargo check --lib`
Expected: builds.

---

### Task 3: Add `is_cloud_sync_placeholder` helper with tests

**Files:**
- Modify: `src-tauri/src/import/mod.rs` (insert near `classify_path` around line 182)

- [ ] **Step 1: Write the failing test**

Add to the existing `#[cfg(test)] mod tests` block near the bottom of `src-tauri/src/import/mod.rs`. Locate that block, then insert:

```rust
#[test]
fn is_cloud_sync_placeholder_recognizes_known_patterns() {
    use std::path::Path;
    assert!(is_cloud_sync_placeholder(Path::new("foo.mp3.icloud")));
    assert!(is_cloud_sync_placeholder(Path::new("paper.pdf.tmp")));
    assert!(is_cloud_sync_placeholder(Path::new("note (conflict 2026-04-26).md")));
    assert!(is_cloud_sync_placeholder(Path::new("note.conflicted.md")));
    assert!(is_cloud_sync_placeholder(Path::new(".DS_Store")));
    assert!(is_cloud_sync_placeholder(Path::new("Thumbs.db")));
    assert!(is_cloud_sync_placeholder(Path::new("desktop.ini")));
    assert!(!is_cloud_sync_placeholder(Path::new("normal.mp3")));
    assert!(!is_cloud_sync_placeholder(Path::new("paper.pdf")));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib is_cloud_sync_placeholder -- --nocapture`
Expected: FAIL with `cannot find function 'is_cloud_sync_placeholder'`.

- [ ] **Step 3: Add the helper**

Find `fn classify_path(path: &Path) -> ImportJobKind {` at `src-tauri/src/import/mod.rs:182`. Immediately before it, insert:

```rust
/// Detect filenames that look like cloud-sync placeholders or scratch files we should
/// never enqueue. Aligned with CLAUDE.md Rule 13a (vault path normalization).
fn is_cloud_sync_placeholder(path: &Path) -> bool {
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n.to_ascii_lowercase(),
        None => return false,
    };
    name.ends_with(".icloud")
        || name.ends_with(".tmp")
        || name.ends_with(".conflicted.md")
        || name.contains(" (conflict ")
        || name == ".ds_store"
        || name == "thumbs.db"
        || name == "desktop.ini"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib is_cloud_sync_placeholder -- --nocapture`
Expected: PASS.

---

### Task 4: Add `active_source_paths` helper

**Files:**
- Modify: `src-tauri/src/import/mod.rs` (inside `impl ImportQueueService` near `enqueue_paths`)

- [ ] **Step 1: Add helper method**

Locate `impl ImportQueueService { ... pub async fn enqueue_paths` at `src-tauri/src/import/mod.rs:1387`. Immediately before `pub async fn enqueue_paths`, insert:

```rust
    /// Snapshot of source paths currently queued or in-flight (non-terminal states),
    /// excluding `WebMedia` jobs whose `source_path` is a synthetic URL string. Used
    /// by `enqueue_paths` to dedupe concurrent imports of the same file.
    async fn active_source_paths(&self) -> std::collections::HashSet<PathBuf> {
        let jobs = self.inner.jobs.lock().await;
        jobs.iter()
            .filter(|j| !matches!(
                j.state,
                ImportJobState::Done | ImportJobState::Error | ImportJobState::Cancelled
            ))
            .filter(|j| j.kind != ImportJobKind::WebMedia)
            .map(|j| {
                j.source_path
                    .canonicalize()
                    .unwrap_or_else(|_| j.source_path.clone())
            })
            .collect()
    }
```

- [ ] **Step 2: Run cargo check**

Run: `cd src-tauri && cargo check --lib`
Expected: builds.

---

### Task 5: Extract `classify_for_enqueue` free function + refactor `enqueue_paths`

Why a free function: existing tests in `import/mod.rs` never instantiate `ImportQueueService` (the constructor needs a real `AppHandle` + `WorkspaceManager` + `TaskManager`). Refactoring the rejection logic into a pure `(path, active_set) → outcome` function lets us test it directly with `TempDir` + `HashSet` — no harness required.

**Files:**
- Modify: `src-tauri/src/import/mod.rs` (add free function near `classify_path`, replace `enqueue_paths` body)

- [ ] **Step 1: Add the `EnqueueOutcome` enum and `classify_for_enqueue` function**

Insert immediately after the `is_cloud_sync_placeholder` function added in Task 3:

```rust
/// Result of pre-flight validation for a single path before enqueueing.
/// Pure (no `&self`, no async) so tests can drive it without a service harness.
pub(super) enum EnqueueOutcome {
    Accept(ImportJobKind),
    Reject(String),
}

/// Pre-flight validation: missing-file, cloud-sync placeholder, unsupported type,
/// or duplicate-of-active. Returns `Accept(kind)` for queue-eligible paths, otherwise
/// `Reject(reason)`. Caller is responsible for inserting the canonical path into
/// `active` after a successful Accept (this function does NOT mutate `active`).
pub(super) fn classify_for_enqueue(
    path: &Path,
    active: &std::collections::HashSet<PathBuf>,
) -> EnqueueOutcome {
    if !path.is_file() {
        return EnqueueOutcome::Reject("File not found".into());
    }
    if is_cloud_sync_placeholder(path) {
        return EnqueueOutcome::Reject(
            "Cloud-sync placeholder — wait for download to complete".into(),
        );
    }
    let kind = classify_path(path);
    if kind == ImportJobKind::Unknown {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("?");
        return EnqueueOutcome::Reject(format!("Unsupported type: .{}", ext));
    }
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if active.contains(&canonical) {
        return EnqueueOutcome::Reject("Already importing this file".into());
    }
    EnqueueOutcome::Accept(kind)
}
```

- [ ] **Step 2: Write the partial-success test**

Add to `#[cfg(test)] mod tests`:

```rust
#[test]
fn classify_for_enqueue_partial_success() {
    use std::collections::HashSet;
    use std::io::Write;
    let tmp = tempfile::TempDir::new().unwrap();
    let valid_mp3 = tmp.path().join("valid.mp3");
    std::fs::File::create(&valid_mp3).unwrap().write_all(b"fake").unwrap();
    let invalid = tmp.path().join("invalid.docx");
    std::fs::File::create(&invalid).unwrap().write_all(b"fake").unwrap();
    let valid_pdf = tmp.path().join("valid.pdf");
    std::fs::File::create(&valid_pdf).unwrap().write_all(b"fake").unwrap();

    let active: HashSet<PathBuf> = HashSet::new();

    assert!(matches!(
        classify_for_enqueue(&valid_mp3, &active),
        EnqueueOutcome::Accept(ImportJobKind::Audio),
    ));
    match classify_for_enqueue(&invalid, &active) {
        EnqueueOutcome::Reject(reason) => {
            assert!(
                reason.to_lowercase().contains("unsupported"),
                "expected 'unsupported', got: {reason}",
            );
        }
        _ => panic!(".docx should be rejected"),
    }
    assert!(matches!(
        classify_for_enqueue(&valid_pdf, &active),
        EnqueueOutcome::Accept(ImportJobKind::Pdf),
    ));
}
```

- [ ] **Step 3: Run test**

Run: `cd src-tauri && cargo test --lib classify_for_enqueue_partial_success -- --nocapture`
Expected: PASS.

- [ ] **Step 4: Replace `enqueue_paths` body to use `classify_for_enqueue`**

Find the existing implementation at `src-tauri/src/import/mod.rs:1387-1435`. Replace the entire `pub async fn enqueue_paths` block with:

```rust
    pub async fn enqueue_paths(&self, paths: Vec<String>) -> Result<EnqueuePathsResult, String> {
        let mut accepted = Vec::new();
        let mut rejected = Vec::new();
        let mut active = self.active_source_paths().await;

        for raw in paths {
            let path_str = raw.trim().to_string();
            let path = PathBuf::from(&path_str);

            let kind = match classify_for_enqueue(&path, &active) {
                EnqueueOutcome::Accept(k) => k,
                EnqueueOutcome::Reject(reason) => {
                    rejected.push(EnqueuePathRejection { path: path_str, reason });
                    continue;
                }
            };

            // Mirror classify_for_enqueue's canonicalization so duplicates within
            // the same call are caught.
            let canonical = path.canonicalize().unwrap_or_else(|_| path.clone());
            active.insert(canonical);

            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("import")
                .to_string();
            let id = uuid::Uuid::new_v4().to_string();
            let job = ImportJob {
                id: id.clone(),
                file_name,
                source_path: path,
                kind,
                state: ImportJobState::Queued,
                message: None,
                note_id: None,
                cancel_requested: Arc::new(AtomicBool::new(false)),
                progress: 0.0,
                segment_index: 0,
                segment_count: 0,
                current_step: None,
                web_meta: None,
                web_opts: None,
                download_bytes: None,
                download_total_bytes: None,
                download_speed_human: None,
                draft_node_id: None,
                local_audio_path: None,
                media_dir: None,
            };
            self.inner.jobs.lock().await.push(job);
            accepted.push(id);
        }

        if !accepted.is_empty() {
            emit_snapshot(&self.inner).await;
            self.inner.wake.notify_one();
        }
        Ok(EnqueuePathsResult { accepted, rejected })
    }
```

- [ ] **Step 5: Run cargo check**

Run: `cd src-tauri && cargo check --lib`
Expected: builds without warnings about unused variables or imports.

---

### Task 6: Add cloud-sync rejection test (free-function)

**Files:**
- Modify: `src-tauri/src/import/mod.rs` (test module)

- [ ] **Step 1: Write the test**

Add to `#[cfg(test)] mod tests`:

```rust
#[test]
fn classify_for_enqueue_rejects_cloud_sync_placeholder() {
    use std::collections::HashSet;
    use std::io::Write;
    let tmp = tempfile::TempDir::new().unwrap();
    let placeholder = tmp.path().join("foo.mp3.icloud");
    std::fs::File::create(&placeholder).unwrap().write_all(b"x").unwrap();
    let active: HashSet<PathBuf> = HashSet::new();

    match classify_for_enqueue(&placeholder, &active) {
        EnqueueOutcome::Reject(reason) => assert!(
            reason.to_lowercase().contains("cloud-sync"),
            "expected cloud-sync mention, got: {reason}",
        ),
        _ => panic!("placeholder should be rejected"),
    }
}
```

- [ ] **Step 2: Run test**

Run: `cd src-tauri && cargo test --lib classify_for_enqueue_rejects_cloud_sync -- --nocapture`
Expected: PASS.

---

### Task 7: Add duplicate-guard test (free-function)

**Files:**
- Modify: `src-tauri/src/import/mod.rs` (test module)

- [ ] **Step 1: Write the test**

```rust
#[test]
fn classify_for_enqueue_dedupes_active() {
    use std::collections::HashSet;
    use std::io::Write;
    let tmp = tempfile::TempDir::new().unwrap();
    let mp3 = tmp.path().join("song.mp3");
    std::fs::File::create(&mp3).unwrap().write_all(b"fake").unwrap();

    // First call: empty active set → accepted.
    let mut active: HashSet<PathBuf> = HashSet::new();
    assert!(matches!(
        classify_for_enqueue(&mp3, &active),
        EnqueueOutcome::Accept(ImportJobKind::Audio),
    ));

    // Insert canonical path and re-check: should reject as duplicate.
    let canonical = mp3.canonicalize().unwrap();
    active.insert(canonical);
    match classify_for_enqueue(&mp3, &active) {
        EnqueueOutcome::Reject(reason) => assert!(
            reason.to_lowercase().contains("already"),
            "expected 'already' mention, got: {reason}",
        ),
        _ => panic!("duplicate should be rejected"),
    }
}
```

- [ ] **Step 2: Run test**

Run: `cd src-tauri && cargo test --lib classify_for_enqueue_dedupes -- --nocapture`
Expected: PASS.

---

### Task 8: Update `enqueue_import_paths` Tauri command + commit Phase 1

**Files:**
- Modify: `src-tauri/src/commands/import_queue.rs:4-11`

- [ ] **Step 1: Update command signature and import**

Replace lines 1-11 of `src-tauri/src/commands/import_queue.rs`:

```rust
use crate::import::{EnqueuePathsResult, ImportQueueService, ImportQueueSnapshot};
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn enqueue_import_paths(
    service: State<'_, ImportQueueService>,
    paths: Vec<String>,
) -> Result<EnqueuePathsResult, String> {
    service.enqueue_paths(paths).await
}
```

- [ ] **Step 2: Re-export new types from `import` module**

Locate the `pub use` exports near the top of `src-tauri/src/import/mod.rs` (search for `pub use` if not at the top — they may be at the bottom of the module). Add `EnqueuePathRejection` and `EnqueuePathsResult` to whatever export list is appropriate. If there are no existing exports for `ImportQueueService` etc., the names will be path-resolved as `crate::import::EnqueuePathsResult` automatically since they're declared at module root with `pub`.

- [ ] **Step 3: Run full lib test suite**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS — all 125 baseline tests + 4 new ones (1 specta still passes, 1 partial-success, 1 cloud-sync, 1 dedup, 1 cloud-sync-placeholder-helper).

- [ ] **Step 4: Run cargo build to confirm Tauri command registers**

Run: `cd src-tauri && cargo build --lib`
Expected: builds without warnings about unused imports.

- [ ] **Step 5: Commit Phase 1**

```bash
git -C C:/AI_knowledge_workspace/Handy-main add \
  src-tauri/src/import/web_media.rs \
  src-tauri/src/import/mod.rs \
  src-tauri/src/commands/import_queue.rs
git -C C:/AI_knowledge_workspace/Handy-main commit -m "$(cat <<'EOF'
feat(import): partial-success enqueue + dedup + cloud-sync filter + specta fix

- Pin specta TS output for WebMediaFormat via per-variant rename;
  fixes TS2820 errors caused by digit-snake-case bug in specta-2.0.0-rc.22.
- enqueue_import_paths now returns EnqueuePathsResult { accepted, rejected }:
  unsupported/missing/cloud-sync/duplicate paths land in rejected[] with
  user-readable reasons instead of short-circuiting the whole batch.
- Cloud-sync placeholder filter (.icloud / .tmp / *(conflict *).md / .conflicted.md
  / .DS_Store / Thumbs.db / desktop.ini) per Rule 13a.
- In-flight duplicate guard via canonical source-path comparison.
- Tests: is_cloud_sync_placeholder_recognizes_known_patterns,
  classify_for_enqueue_partial_success,
  classify_for_enqueue_rejects_cloud_sync_placeholder,
  classify_for_enqueue_dedupes_active.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Regenerate bindings.ts

### Task 9: Boot tauri dev to regenerate bindings

**Files:**
- Auto-modify: `src/bindings.ts`

- [ ] **Step 1: Boot the app long enough for tauri-specta to write bindings**

```bash
cd C:/AI_knowledge_workspace/Handy-main
bun run tauri dev
```

Wait until the Vite dev server prints `Local: http://localhost:1420/` and the Rust side prints `App started` (or equivalent). Once you see the app window open, kill the dev server (Ctrl+C). The `bindings.ts` file is regenerated by tauri-specta during init.

- [ ] **Step 2: Verify the bindings updated**

Run:
```bash
grep -n 'WebMediaFormat' C:/AI_knowledge_workspace/Handy-main/src/bindings.ts
grep -n 'EnqueuePathsResult\|EnqueuePathRejection' C:/AI_knowledge_workspace/Handy-main/src/bindings.ts
grep -n 'clearCompletedImports' C:/AI_knowledge_workspace/Handy-main/src/bindings.ts
```

Expected:
- `WebMediaFormat = { kind: "mp3_audio" } | { kind: "mp4_video"; max_height: number }` (no underscores around digits)
- `EnqueuePathsResult` and `EnqueuePathRejection` types both appear
- `enqueueImportPaths` declares `Promise<Result<EnqueuePathsResult, string>>`
- `clearCompletedImports` is declared

If `WebMediaFormat` still shows `mp_3_audio`, the `#[specta(rename = …)]` attribute was not respected — check specta version and consider `#[serde(rename = …)]` as a complementary annotation.

- [ ] **Step 3: Verify TypeScript no longer reports the three target errors**

Run:
```bash
cd C:/AI_knowledge_workspace/Handy-main && bun run tsc --noEmit 2>&1 | grep -E 'ImportUrlTab\.tsx.*(TS2820|TS2339.*clearCompletedImports)' || echo "Target TS errors gone"
```

Expected: prints `Target TS errors gone`. Pre-existing unrelated errors remain — that's accepted per CLAUDE.md DoD ("zero **new** errors").

- [ ] **Step 4: Commit bindings**

```bash
git -C C:/AI_knowledge_workspace/Handy-main add src/bindings.ts
git -C C:/AI_knowledge_workspace/Handy-main commit -m "$(cat <<'EOF'
chore(bindings): regenerate after WebMediaFormat specta fix + new EnqueuePaths types

Auto-generated by tauri-specta. Picks up WebMediaFormat correct snake_case
('mp3_audio' / 'mp4_video'), EnqueuePathsResult / EnqueuePathRejection,
and clearCompletedImports.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Frontend shared utilities

### Task 10: Create `src/utils/importJobs.ts`

**Files:**
- Create: `src/utils/importJobs.ts`

- [ ] **Step 1: Create the file with shared helpers**

```ts
import type { ImportJobDto } from '../bindings';

export const TERMINAL_STATES: ReadonlySet<ImportJobDto['state']> = new Set([
  'done',
  'error',
  'cancelled',
]);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function jobProgress(job: ImportJobDto): number {
  if (job.state === 'done') return 100;
  if (job.state === 'fetching_meta') return 5;
  if (job.state === 'downloading') {
    const t = job.download_total_bytes ?? 0;
    const b = job.download_bytes ?? 0;
    if (t > 0) return Math.min(50, 10 + Math.round((b / t) * 40));
    return 20;
  }
  if (job.state === 'preparing' || job.state === 'segmenting') return 55;
  if (job.state === 'transcribing') {
    if (job.segment_count > 0) {
      return 60 + Math.round((job.segment_index / job.segment_count) * 30);
    }
    return 65;
  }
  if (job.state === 'post_processing' || job.state === 'finalizing') return 95;
  return 0;
}

export function jobStatusLine(job: ImportJobDto): string {
  switch (job.state) {
    case 'queued':
      return 'Queued';
    case 'fetching_meta':
      return 'Fetching metadata…';
    case 'downloading': {
      const b = job.download_bytes ?? 0;
      const t = job.download_total_bytes;
      const sizeStr = t ? `${formatBytes(b)} / ${formatBytes(t)}` : formatBytes(b);
      return `Downloading · ${sizeStr}${
        job.download_speed_human ? ` · ${job.download_speed_human}` : ''
      }`;
    }
    case 'preparing':
    case 'segmenting':
      return job.current_step ?? 'Preparing audio…';
    case 'transcribing':
      return job.segment_count > 0
        ? `Transcribing · ${job.segment_index} / ${job.segment_count}`
        : 'Transcribing…';
    case 'post_processing':
    case 'finalizing':
      return 'Finalizing…';
    case 'done':
      return 'Saved';
    case 'error':
      return job.message ?? 'Error';
    case 'cancelled':
      return 'Cancelled';
    default:
      return job.state;
  }
}

export function jobTitle(job: ImportJobDto): string {
  return job.web_meta?.title ?? job.file_name;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd C:/AI_knowledge_workspace/Handy-main && bun run tsc --noEmit 2>&1 | grep importJobs`
Expected: no output (no errors in this new file).

---

### Task 11: Add a smoke test for `importJobs.ts`

**Files:**
- Create: `src/utils/__tests__/importJobs.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  formatDuration,
  jobProgress,
  jobStatusLine,
  jobTitle,
  TERMINAL_STATES,
} from '../importJobs';
import type { ImportJobDto } from '../../bindings';

function fakeJob(overrides: Partial<ImportJobDto> = {}): ImportJobDto {
  return {
    id: 'job-1',
    file_name: 'song.mp3',
    source_path: '/tmp/song.mp3',
    kind: 'audio',
    state: 'queued',
    message: null,
    note_id: null,
    progress: 0,
    segment_index: 0,
    segment_count: 0,
    current_step: null,
    ...overrides,
  } as ImportJobDto;
}

describe('formatBytes', () => {
  it('formats < 1 KB', () => expect(formatBytes(512)).toBe('512 B'));
  it('formats KB', () => expect(formatBytes(2048)).toBe('2.0 KB'));
  it('formats MB', () => expect(formatBytes(5_242_880)).toBe('5.0 MB'));
  it('formats GB', () => expect(formatBytes(1_073_741_824)).toBe('1.00 GB'));
});

describe('formatDuration', () => {
  it('formats sub-hour', () => expect(formatDuration(125)).toBe('2:05'));
  it('formats with hours', () => expect(formatDuration(3725)).toBe('1:02:05'));
});

describe('jobProgress', () => {
  it('returns 100 when done', () =>
    expect(jobProgress(fakeJob({ state: 'done' }))).toBe(100));
  it('scales transcribing by segment ratio', () => {
    const j = fakeJob({ state: 'transcribing', segment_count: 10, segment_index: 5 });
    expect(jobProgress(j)).toBe(75);
  });
});

describe('jobStatusLine', () => {
  it('honors current_step during preparing', () => {
    const j = fakeJob({ state: 'preparing', current_step: 'Detecting speech…' });
    expect(jobStatusLine(j)).toBe('Detecting speech…');
  });
  it('falls back when current_step null', () => {
    const j = fakeJob({ state: 'preparing', current_step: null });
    expect(jobStatusLine(j)).toBe('Preparing audio…');
  });
});

describe('jobTitle', () => {
  it('prefers web_meta.title', () => {
    const j = fakeJob({
      web_meta: { title: 'YouTube Vid', thumbnail_url: null, platform: 'youtube' } as any,
    });
    expect(jobTitle(j)).toBe('YouTube Vid');
  });
  it('falls back to file_name', () => {
    expect(jobTitle(fakeJob())).toBe('song.mp3');
  });
});

describe('TERMINAL_STATES', () => {
  it('contains exactly done/error/cancelled', () => {
    expect(TERMINAL_STATES.has('done')).toBe(true);
    expect(TERMINAL_STATES.has('error')).toBe(true);
    expect(TERMINAL_STATES.has('cancelled')).toBe(true);
    expect(TERMINAL_STATES.has('queued')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd C:/AI_knowledge_workspace/Handy-main && bunx vitest run src/utils/__tests__/importJobs.test.ts`
Expected: PASS — all 13 assertions green.

---

### Task 12: Create `src/components/ImportQueueLists.tsx`

**Files:**
- Create: `src/components/ImportQueueLists.tsx`

- [ ] **Step 1: Create the file**

```tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import type { ImportJobDto } from '../bindings';
import { ScrollShadow } from './ScrollShadow';
import { jobProgress, jobStatusLine, jobTitle } from '../utils/importJobs';

interface ListBaseProps {
  jobs: ImportJobDto[];
  renderThumb: (job: ImportJobDto) => React.ReactNode;
}

export function ImportProcessingList({ jobs, renderThumb }: ListBaseProps) {
  if (jobs.length === 0) return null;
  return (
    <section
      className="heros-glass-card"
      style={{
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: 8,
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '13px', fontWeight: 600 }}>
          <Clock size={15} color="rgba(255,255,255,0.4)" />
          Processing
          <span
            style={{
              padding: '3px 9px',
              fontSize: '10px',
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 14,
              color: 'var(--heros-text-dim)',
            }}
          >
            {jobs.length} active
          </span>
        </div>
      </div>

      <ScrollShadow style={{ maxHeight: 280 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <AnimatePresence initial={false}>
            {jobs.map((job, i) => (
              <motion.div
                key={job.id}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: i * 0.05 }}
                className="import-row-hover"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 1fr auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: 'rgba(0,0,0,0.14)',
                  border: '1px solid rgba(255,255,255,0.04)',
                  transition: 'all 0.2s',
                }}
              >
                {renderThumb(job)}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '12.5px',
                      color: '#fff',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {jobTitle(job)}
                  </div>
                  <div
                    style={{
                      fontSize: '10.5px',
                      color: 'var(--heros-text-dim)',
                      marginTop: 1,
                      fontFamily: 'monospace',
                    }}
                  >
                    {jobStatusLine(job)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 80,
                      height: 4,
                      background: 'rgba(0,0,0,0.28)',
                      borderRadius: 2,
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${jobProgress(job)}%` }}
                      className="shimmer-bar"
                      style={{
                        height: '100%',
                        background: 'linear-gradient(90deg, #f0d8d0, #fff)',
                        borderRadius: 2,
                        boxShadow: '0 0 8px rgba(253,249,243,0.5)',
                      }}
                    />
                  </div>
                  <div
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '4px 8px',
                      borderRadius: 8,
                      background: 'rgba(255,255,255,0.08)',
                      color: 'var(--heros-text-dim)',
                      fontFamily: 'monospace',
                    }}
                  >
                    {jobProgress(job)}%
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </ScrollShadow>
    </section>
  );
}

interface CompletedListProps extends ListBaseProps {
  onClear: () => void;
}

export function ImportCompletedList({ jobs, renderThumb, onClear }: CompletedListProps) {
  const [autoExpanded, setAutoExpanded] = useState(false);
  const [manualExpanded, setManualExpanded] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recentIds, setRecentIds] = useState<Set<string>>(new Set());

  const expanded = autoExpanded || manualExpanded;

  useEffect(() => {
    if (!initializedRef.current) {
      jobs.forEach((j) => seenIdsRef.current.add(j.id));
      initializedRef.current = true;
      return;
    }
    const newOnes = jobs.filter((j) => !seenIdsRef.current.has(j.id));
    if (newOnes.length === 0) return;
    newOnes.forEach((j) => seenIdsRef.current.add(j.id));
    setRecentIds((prev) => {
      const next = new Set(prev);
      newOnes.forEach((j) => next.add(j.id));
      return next;
    });
    setAutoExpanded(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setAutoExpanded(false);
      setRecentIds(new Set());
    }, 1000);
  }, [jobs]);

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  const visibleJobs = useMemo(() => {
    if (manualExpanded) return jobs;
    if (autoExpanded) return jobs.filter((j) => recentIds.has(j.id));
    return [];
  }, [jobs, manualExpanded, autoExpanded, recentIds]);

  if (jobs.length === 0) return null;

  return (
    <motion.section
      layout
      className="heros-glass-card"
      style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setManualExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setManualExpanded((v) => !v);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: 8,
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          cursor: 'pointer',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '13px', fontWeight: 600 }}>
          <CheckCircle2 size={15} color="#9cf0c9" />
          Completed
          <span
            style={{
              padding: '3px 9px',
              fontSize: '10px',
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 14,
              color: 'var(--heros-text-dim)',
            }}
          >
            {jobs.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="heros-btn"
            style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, opacity: 0.7 }}
            title="Clear completed history"
          >
            Clear
          </button>
          {manualExpanded ? (
            <ChevronUp size={14} color="rgba(255,255,255,0.4)" />
          ) : (
            <ChevronDown size={14} color="rgba(255,255,255,0.4)" />
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="completed-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: 'hidden' }}
          >
            <ScrollShadow style={{ maxHeight: 320 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <AnimatePresence initial={false}>
                  {visibleJobs.map((job) => {
                    const isRecent = recentIds.has(job.id);
                    return (
                      <motion.div
                        key={job.id}
                        layout
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        className="import-row-hover"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '32px 1fr auto',
                          gap: 12,
                          alignItems: 'center',
                          padding: '10px 12px',
                          borderRadius: 12,
                          background: isRecent ? 'rgba(16,185,129,0.10)' : 'rgba(0,0,0,0.14)',
                          border: `1px solid ${
                            isRecent ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.04)'
                          }`,
                          opacity: isRecent ? 1 : 0.72,
                          transition: 'background 200ms ease, border 200ms ease',
                        }}
                      >
                        {renderThumb(job)}
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '12.5px',
                              color: '#fff',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {jobTitle(job)}
                          </div>
                          <div
                            style={{
                              fontSize: '10.5px',
                              color: 'var(--heros-text-dim)',
                              marginTop: 1,
                              fontFamily: 'monospace',
                            }}
                          >
                            {jobStatusLine(job)}
                          </div>
                        </div>
                        <div
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '4px 8px',
                            borderRadius: 8,
                            background:
                              job.state === 'done'
                                ? 'rgba(16,185,129,0.18)'
                                : 'rgba(239,68,68,0.18)',
                            color: job.state === 'done' ? '#9cf0c9' : '#ffb4b4',
                            textTransform: 'uppercase',
                            letterSpacing: '0.1em',
                          }}
                        >
                          {job.state}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </ScrollShadow>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd C:/AI_knowledge_workspace/Handy-main && bun run tsc --noEmit 2>&1 | grep ImportQueueLists`
Expected: no output.

---

### Task 13: Refactor `ImportUrlTab.tsx` to use shared components

**Files:**
- Modify: `src/components/ImportUrlTab.tsx`

- [ ] **Step 1: Replace top-of-file imports**

Find the top imports of `src/components/ImportUrlTab.tsx`. Replace lines 1-19 with:

```tsx
import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileText, Globe, Download } from 'lucide-react';
import { commands } from '../bindings';
import { useImportQueue } from '../hooks/useImportQueue';
import { useYtDlpPlugin } from '../hooks/useYtDlpPlugin';
import { PlaylistSelectorModal } from './PlaylistSelectorModal';
import { ImportProcessingList, ImportCompletedList } from './ImportQueueLists';
import { TERMINAL_STATES, formatDuration } from '../utils/importJobs';
import type {
  ImportJobDto,
  UrlMetadataResult,
  AlreadyImportedHit,
  PlaylistEnvelope,
  PlaylistEntry,
  WebMediaImportOpts,
} from '../bindings';
import '../styles/import.css';
```

(`Link2`, `Clock`, `CheckCircle2`, `ChevronDown`, `ChevronUp` are no longer needed in this file — they live inside `ImportQueueLists`.)

- [ ] **Step 2: Delete the inlined helpers**

Delete the following from `ImportUrlTab.tsx`:
- The local `TERMINAL_STATES` constant (around line 21)
- The `formatDuration` function (now imported)
- The `formatBytes` function
- The `jobProgress` function
- The `jobStatusLine` function
- The `jobTitle` function
- The entire `JobThumb` component
- The entire `ProcessingPanel` component
- The entire `CompletedPanel` component

The `detectUrls`, `PLAYLIST_RE`, `PreviewState` type, `Format` type, `UrlPreviewCard`, `FormatToggle`, `PluginMissingBanner`, and `shorten` function all stay.

- [ ] **Step 3: Update queue filtering and replace panel JSX**

Inside `export function ImportUrlTab() { ... }`, find the lines that currently look like:

```tsx
const processing = jobs.filter(j => !TERMINAL_STATES.has(j.state));
const completed = jobs.filter(j => TERMINAL_STATES.has(j.state));
```

Replace with:

```tsx
const processing = jobs.filter(
  (j) => j.kind === 'web_media' && !TERMINAL_STATES.has(j.state),
);
const completed = jobs.filter(
  (j) => j.kind === 'web_media' && TERMINAL_STATES.has(j.state),
);
```

- [ ] **Step 4: Add `renderUrlThumb` helper inside the component**

Right above the `return` statement of `ImportUrlTab`, add:

```tsx
function renderUrlThumb(job: ImportJobDto) {
  const thumb = job.web_meta?.thumbnail_url;
  if (thumb) {
    return (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          overflow: 'hidden',
          background: 'rgba(255,255,255,0.08)',
        }}
      >
        <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }
  const platform = job.web_meta?.platform ?? '';
  const Icon = platform.toLowerCase().includes('youtube') ? Globe : FileText;
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 9,
        background: 'rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon size={14} />
    </div>
  );
}
```

- [ ] **Step 5: Replace the `<ProcessingPanel>` / `<CompletedPanel>` call sites**

Find the JSX (was at the bottom of the return tree, around lines 405-409 of the current file):

```tsx
<ProcessingPanel jobs={processing} />
<CompletedPanel jobs={completed} />
```

Replace with:

```tsx
<ImportProcessingList jobs={processing} renderThumb={renderUrlThumb} />
<ImportCompletedList
  jobs={completed}
  renderThumb={renderUrlThumb}
  onClear={() => commands.clearCompletedImports()}
/>
```

- [ ] **Step 6: Verify TypeScript**

Run: `cd C:/AI_knowledge_workspace/Handy-main && bun run tsc --noEmit 2>&1 | grep -E 'ImportUrlTab|ImportQueueLists|importJobs'`
Expected: no output. (Pre-existing errors elsewhere remain.)

- [ ] **Step 7: Run vitest**

Run: `cd C:/AI_knowledge_workspace/Handy-main && bunx vitest run`
Expected: all tests pass, including the new `importJobs.test.ts`.

- [ ] **Step 8: Manual smoke check (URL tab still works)**

Run: `cd C:/AI_knowledge_workspace/Handy-main && bun run tauri dev`

Open the app, navigate to `Import → Downloader`. Paste a YouTube URL, click Fetch, click Download. Confirm:
- Job appears in Processing with thumbnail
- Progress advances
- Job lands in Completed with auto-expand highlight
- "Clear" button empties the Completed list

Kill dev server.

- [ ] **Step 9: Commit Phase 3**

```bash
git -C C:/AI_knowledge_workspace/Handy-main add \
  src/utils/importJobs.ts \
  src/utils/__tests__/importJobs.test.ts \
  src/components/ImportQueueLists.tsx \
  src/components/ImportUrlTab.tsx
git -C C:/AI_knowledge_workspace/Handy-main commit -m "$(cat <<'EOF'
refactor(import): extract shared queue lists + formatters

- src/utils/importJobs.ts: shared formatBytes / formatDuration /
  jobProgress / jobStatusLine / jobTitle + TERMINAL_STATES.
- src/components/ImportQueueLists.tsx: ImportProcessingList +
  ImportCompletedList (auto-expand-on-new-arrival state stays here).
- ImportUrlTab now consumes shared components, filters jobs to
  kind === 'web_media' (closes the leak that showed file-import
  jobs in the URL tab).
- jobStatusLine honors job.current_step for preparing/segmenting
  states so file imports surface their richer labels.

No URL-tab behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Files-tab wiring

### Task 14: Thread `onNavigate` prop through AppShell → ImportView

**Files:**
- Modify: `src/components/AppShell.tsx:148`
- Modify: `src/components/ImportView.tsx`

- [ ] **Step 1: Update `AppShell.tsx`**

Find `src/components/AppShell.tsx:148`:

```tsx
{currentPage === 'import' && <ImportView />}
```

Replace with:

```tsx
{currentPage === 'import' && <ImportView onNavigate={onNavigate} />}
```

- [ ] **Step 2: Update `ImportView.tsx` to accept and forward the prop**

Find the top of `src/components/ImportView.tsx`:

```tsx
import { useState } from 'react';
import { ImportFilesTab } from './ImportFilesTab';
import { ImportUrlTab } from './ImportUrlTab';

type Tab = 'files' | 'url';

export function ImportView() {
```

Replace the import and signature with:

```tsx
import { useState } from 'react';
import { ImportFilesTab } from './ImportFilesTab';
import { ImportUrlTab } from './ImportUrlTab';

type Tab = 'files' | 'url';

interface ImportViewProps {
  onNavigate: (page: string) => void;
}

export function ImportView({ onNavigate }: ImportViewProps) {
```

Find the conditional render at the bottom of the file:

```tsx
{tab === 'files' ? <ImportFilesTab /> : <ImportUrlTab />}
```

Replace with:

```tsx
{tab === 'files' ? <ImportFilesTab onNavigate={onNavigate} /> : <ImportUrlTab />}
```

- [ ] **Step 3: Verify tsc**

Run: `cd C:/AI_knowledge_workspace/Handy-main && bun run tsc --noEmit 2>&1 | grep -E 'ImportView|AppShell|ImportFilesTab' | grep -v 'ImportFilesTab.tsx'`
Expected: ImportFilesTab will report a missing `onNavigate` prop or unknown prop — that's expected; we wire the receiver in Task 15.

---

### Task 15: Rewrite `ImportFilesTab.tsx`

**Files:**
- Modify: `src/components/ImportFilesTab.tsx` (full rewrite)

- [ ] **Step 1: Replace the entire file contents**

```tsx
import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Upload,
  Database,
  FileText,
  Music,
  Film,
  File as FileIcon,
  Plus,
  FolderOpen,
  Globe,
  BookOpen,
  Ghost,
} from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { commands } from '../bindings';
import type { ImportJobDto } from '../bindings';
import { useImportQueue } from '../hooks/useImportQueue';
import { ImportProcessingList, ImportCompletedList } from './ImportQueueLists';
import { TERMINAL_STATES } from '../utils/importJobs';
import '../styles/import.css';

const SUPPORTED_EXTS = [
  'md','markdown','mdx','txt','log','csv','pdf',
  'wav','mp3','m4a','aac','flac','ogg','opus',
  'mp4','mov','mkv','avi','webm','mpeg','mpg','wmv',
];

const DOC_EXTS = ['md','markdown','mdx','txt','log','csv','pdf'];
const AUDIO_EXTS = ['wav','mp3','m4a','aac','flac','ogg','opus'];
const VIDEO_EXTS = ['mp4','mov','mkv','avi','webm','mpeg','mpg','wmv'];

interface ImportFilesTabProps {
  onNavigate: (page: string) => void;
}

export function ImportFilesTab({ onNavigate }: ImportFilesTabProps) {
  const { jobs } = useImportQueue();
  const [isDragging, setIsDragging] = useState(false);

  // Filter to non-WebMedia jobs (URL imports live in the Downloader tab).
  const processing = jobs.filter(
    (j) => j.kind !== 'web_media' && j.kind !== 'unknown' && !TERMINAL_STATES.has(j.state),
  );
  const completed = jobs.filter(
    (j) => j.kind !== 'web_media' && j.kind !== 'unknown' && TERMINAL_STATES.has(j.state),
  );

  // Tauri webview drag-drop event — gives real OS paths, unlike HTML5 dataTransfer.
  // Listener is scoped to this tab's mount lifecycle (ImportView only renders one tab
  // at a time), so no global drop handler when the URL tab is active.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      const webview = getCurrentWebview();
      unlisten = await webview.onDragDropEvent((event) => {
        switch (event.payload.type) {
          case 'enter':
          case 'over':
            setIsDragging(true);
            break;
          case 'leave':
            setIsDragging(false);
            break;
          case 'drop':
            setIsDragging(false);
            void enqueuePaths(event.payload.paths);
            break;
        }
      });
    })();
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickFiles() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: true,
      filters: [
        { name: 'All supported', extensions: SUPPORTED_EXTS },
        { name: 'Documents', extensions: DOC_EXTS },
        { name: 'Audio', extensions: AUDIO_EXTS },
        { name: 'Video', extensions: VIDEO_EXTS },
      ],
    });
    if (Array.isArray(result)) await enqueuePaths(result);
    else if (typeof result === 'string') await enqueuePaths([result]);
  }

  async function enqueuePaths(paths: string[]) {
    if (paths.length === 0) return;
    const res = await commands.enqueueImportPaths(paths);
    if (res.status === 'error') {
      toast.error(res.error);
      return;
    }
    if (res.data.rejected.length > 0) {
      const summary =
        res.data.rejected.length === 1
          ? `${basename(res.data.rejected[0].path)}: ${res.data.rejected[0].reason}`
          : `${res.data.rejected.length} files skipped — see console`;
      toast.warning(summary);
      if (res.data.rejected.length > 1) {
        // eslint-disable-next-line no-console
        console.warn('[Knowledge Import] rejected:', res.data.rejected);
      }
    }
  }

  const sourceChips = [
    { name: 'Notion', icon: <Database size={13} /> },
    { name: 'Obsidian', icon: <Plus size={13} /> },
    { name: 'Readwise', icon: <BookOpen size={13} /> },
    { name: 'Bear', icon: <Ghost size={13} /> },
    { name: 'Apple Notes', icon: <FileText size={13} /> },
    { name: 'Browser', icon: <Globe size={13} /> },
  ];

  return (
    <div
      className="heros-page-container"
      style={{
        position: 'relative',
        zIndex: 5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '40px',
      }}
    >
      <header style={{ marginBottom: '48px', textAlign: 'center', flexShrink: 0 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            background: 'linear-gradient(135deg, var(--heros-brand) 0%, #ff8566 100%)',
            margin: '0 auto 24px auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 12px 32px rgba(var(--heros-brand-rgb, 204, 76, 43), 0.2)',
          }}
        >
          <Upload size={32} color="#fff" />
        </div>
        <h1
          style={{
            fontSize: '32px',
            fontWeight: 800,
            color: 'var(--heros-text-premium)',
            marginBottom: '8px',
          }}
        >
          Knowledge Import
        </h1>
        <p style={{ color: 'var(--heros-text-muted)', fontSize: '16px' }}>
          Bring external knowledge in. Everything is indexed and embedded locally.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: '24px' }}>
          <button
            className="heros-btn"
            onClick={() => onNavigate('notes')}
            style={{ padding: '10px 20px', borderRadius: 12, fontSize: '13px' }}
          >
            <FolderOpen size={15} /> Imports folder
          </button>
          <button
            className="heros-btn heros-btn-brand"
            onClick={pickFiles}
            style={{ padding: '10px 20px', borderRadius: 12, fontSize: '13px' }}
          >
            <Plus size={15} /> New Knowledge Batch
          </button>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 1.6fr',
          gap: 20,
          minHeight: 0,
        }}
      >
        {/* Left: Dropzone & Sources */}
        <section
          className="heros-glass-card"
          style={{
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            height: 'fit-content',
          }}
        >
          <div
            onClick={pickFiles}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void pickFiles();
              }
            }}
            style={{
              flex: 1,
              minHeight: 180,
              borderRadius: 18,
              background: 'rgba(0,0,0,0.18)',
              border: `2px dashed ${
                isDragging ? 'var(--heros-brand)' : 'rgba(253,249,243,0.2)'
              }`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: 32,
              transition: 'all 0.25s',
              cursor: 'pointer',
            }}
          >
            <motion.div
              animate={{ y: isDragging ? -10 : 0 }}
              style={{ color: isDragging ? 'var(--heros-brand)' : 'rgba(253,249,243,0.3)' }}
            >
              <Upload size={42} strokeWidth={1.2} />
            </motion.div>
            <h3 style={{ fontSize: '16px', fontWeight: 500, margin: '8px 0 0' }}>
              Drop files here
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--heros-text-dim)', margin: 0 }}>
              PDFs, markdown, audio, video — up to 2 GB per batch
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              className="eyebrow"
              style={{
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
                color: 'var(--heros-text-dim)',
              }}
            >
              Or connect a source
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {sourceChips.map((chip) => (
                <div
                  key={chip.name}
                  className="heros-btn import-source-chip--disabled"
                  title="Connector coming soon"
                  style={{
                    padding: '6px 12px',
                    borderRadius: 20,
                    fontSize: '11px',
                    gap: 6,
                    display: 'inline-flex',
                    alignItems: 'center',
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                  }}
                >
                  {chip.icon} {chip.name}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Right: Real queue lists */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minHeight: 0 }}>
          <ImportProcessingList jobs={processing} renderThumb={renderFileThumb} />
          <ImportCompletedList
            jobs={completed}
            renderThumb={renderFileThumb}
            onClear={() => commands.clearCompletedImports()}
          />
        </div>
      </div>
    </div>
  );
}

function renderFileThumb(job: ImportJobDto) {
  const Icon =
    job.kind === 'audio'
      ? Music
      : job.kind === 'video'
        ? Film
        : job.kind === 'pdf' || job.kind === 'markdown' || job.kind === 'plain_text'
          ? FileText
          : FileIcon;
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 9,
        background: 'rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon size={14} />
    </div>
  );
}

function basename(path: string): string {
  const m = path.match(/[^/\\]+$/);
  return m ? m[0] : path;
}
```

- [ ] **Step 2: Verify tsc passes for all changed files**

Run: `cd C:/AI_knowledge_workspace/Handy-main && bun run tsc --noEmit 2>&1 | grep -E 'ImportFilesTab|ImportView|AppShell|ImportUrlTab|ImportQueueLists|importJobs'`
Expected: no output.

---

### Task 16: Add disabled-chip CSS

**Files:**
- Modify: `src/styles/import.css`

- [ ] **Step 1: Append the new class**

Append to the bottom of `src/styles/import.css`:

```css
/* Disabled source chips (Notion / Obsidian / Readwise / Bear / Apple Notes / Browser).
   Each connector is a separate brainstorm — chips are visible placeholders communicating
   planned coverage, not interactive. */
.import-source-chip--disabled {
  opacity: 0.45;
  cursor: default;
  user-select: none;
}
.import-source-chip--disabled:hover {
  /* defeat .heros-btn :hover lift */
  background: rgba(255, 255, 255, 0.08) !important; /* match the in-line background — there is no functional hover for these */
  transform: none;
}
```

The `!important` is justified because `.heros-btn` uses an inline-style background that we want to keep stable on hover; the comment above explains it (Rule 18 §5).

---

### Task 17: Full validation

**Files:** none (validation only)

- [ ] **Step 1: Run static checks**

```bash
cd C:/AI_knowledge_workspace/Handy-main
bun run tsc --noEmit > /tmp/tsc-after.txt 2>&1
bunx vitest run
cd src-tauri && cargo test --lib
```

Expected:
- `tsc --noEmit` — only pre-existing errors remain. Compare to baseline (Task 0 implicit) via `diff` if needed; no new errors in any file we changed.
- `bunx vitest run` — green, including `importJobs.test.ts`.
- `cargo test --lib` — green, including 4 new tests.

- [ ] **Step 2: Manual smoke walkthrough**

Run: `cd C:/AI_knowledge_workspace/Handy-main && bun run tauri dev`

Execute each step. Mark each ✓ before moving on.

1. Files tab loads. Header reads **"Knowledge Import"**. ✓
2. Drop one `.mp3` from the OS file explorer onto the page. Job appears in Processing. ✓
3. Wait for job to finish. Job moves to Completed with green highlight, auto-collapses after 1 s. ✓
4. Switch to Notes tab. "Imported Files" 📁 visible at tree root, contains the imported audio doc. ✓
5. Back to Files tab. Click "Imports folder" → Notes tab opens. ✓
6. Click "New Knowledge Batch". File picker opens. Select 3 files (mix of `.pdf` / `.md` / `.mp3`). All 3 enqueue. ✓
7. Drag a `.docx` onto the page. Toast: `"X.docx: Unsupported type: .docx"`. Nothing enqueued. ✓
8. Drop one valid + one invalid in the same drop event. Valid enqueues; toast for invalid. ✓
9. Drop the same `.pdf` twice quickly. Second drop toasts `"Already importing this file"`. ✓
10. Touch a placeholder `foo.mp3.icloud` file. Drop it. Toast contains `"Cloud-sync placeholder"`. ✓
11. Cancel a transcribing job (click ✕ if surfaced; else wait). Job lands in Completed with `cancelled` badge. ✓
12. Click Completed → "Clear". List empties. ✓
13. Source chips: hover shows "Connector coming soon" tooltip; clicking does nothing. ✓
14. Switch to URL tab during a file import. File jobs do **not** appear there. Switch back; file jobs reappear. ✓

If any step fails, halt and triage before commit.

- [ ] **Step 3: Commit Phase 4**

```bash
git -C C:/AI_knowledge_workspace/Handy-main add \
  src/components/AppShell.tsx \
  src/components/ImportView.tsx \
  src/components/ImportFilesTab.tsx \
  src/styles/import.css
git -C C:/AI_knowledge_workspace/Handy-main commit -m "$(cat <<'EOF'
feat(import): wire Knowledge Import (Files tab) end-to-end

- Drag-drop via Tauri getCurrentWebview().onDragDropEvent — real OS paths.
- File picker via @tauri-apps/plugin-dialog with grouped extension filters.
- Replace mock processing/completed lists with useImportQueue() filtered to
  non-WebMedia jobs.
- "Imports folder" button → onNavigate('notes'); "New Knowledge Batch" →
  file picker; dropzone clickable.
- Source chips greyed out with "Connector coming soon" tooltip — visible
  placeholders communicating planned coverage, each connector is its own
  brainstorm.
- Header rename "Intelligence Ingestion" → "Knowledge Import".
- onNavigate prop threaded AppShell → ImportView → ImportFilesTab.

Backend already partial-success-friendly via Phase 1; toast surfaces rejected
paths (unsupported type, cloud-sync placeholder, duplicate, missing file).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist (post-implementation)

After Phase 4 commit, run the verification-before-completion check:

- [ ] `bun run tsc --noEmit` — no new errors vs. baseline
- [ ] `bunx vitest run` — green
- [ ] `cd src-tauri && cargo test --lib` — green (≥ 129 tests)
- [ ] All 14 manual smoke steps from Task 17.2 complete
- [ ] No `console.log` debug statements left in changed files
- [ ] No new files outside the File Map
- [ ] CLAUDE.md "Files Never to Modify" not touched (only `bindings.ts` changes are auto-regenerated and committed in Phase 2)
- [ ] No new Zustand stores (Rule 2)
- [ ] No filesystem watcher added (Rule 14)

---

## Rollback plan

Each phase is one commit. To roll back:
- Phase 4 only: `git revert <phase-4-sha>` — leaves shared extraction in place; Files tab returns to dormant state.
- Phase 3+4: `git revert <phase-4-sha> <phase-3-sha>` — URL tab returns to inlined helpers.
- All phases: `git revert <phase-4-sha> <phase-3-sha> <phase-2-sha> <phase-1-sha>` — full restore, but the next `tauri dev` will overwrite `bindings.ts` again unless Phase 1 Rust changes also revert.

Phase 1's Rust changes are independent of Phase 3/4 frontend work — they can ship alone if frontend wiring needs to wait.
