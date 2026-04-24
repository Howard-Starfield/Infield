# Interview Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Interview Mode to `SystemAudioView` that captures mic + system-audio loopback simultaneously, transcribes both with separate Whisper sessions, merges paragraphs by wall-clock offset, and writes a combined markdown doc under an **Interviews/** workspace folder. Ship three back-port stability fixes to the existing mic-transcribe + system-audio pipelines first.

**Architecture:** Two independent ORT sessions driven by a dedicated `InterviewTranscriptionWorker` thread (Rule 16). Mic half wraps `AudioRecorder` + `SileroVad` in a new `MicChunkedCapture` that mirrors the `LoopbackCapture` interface. Shared `ParagraphState` under a single `Mutex`. Stop drains in-flight chunks with a 5s timeout, then calls the pure `merge_paragraphs` fn (stable-sort by `chunk_start_offset_ms`, tiebreak You-before-Other), writes the workspace doc with frontmatter + `::interview_recording` directive, and emits `workspace-transcription-synced`.

**Tech Stack:** Rust (Tauri backend) — `crossbeam-channel`, `ort`, `std::thread`, `tokio::time::timeout`, `chrono`. TypeScript/React (frontend) — no new deps; reuses existing `SystemAudioView.tsx` aesthetic (`.heros-glass-card`, `#3eb8ff` accent, `var(--heros-brand)`).

---

## File Structure

**New files:**
- `src-tauri/src/managers/interview_session.rs` — tracks active interview workspace doc id (mirror of `voice_session.rs`)
- `src-tauri/src/managers/interview_worker.rs` — Rule 16 worker thread + `merge_paragraphs` pure fn + 5 unit tests
- `src-tauri/src/audio_toolkit/audio/mic_chunked.rs` — VAD-cut mic chunking, mirrors `LoopbackCapture` shape
- `src-tauri/src/commands/interview.rs` — `start_interview_session`, `stop_interview_session` Tauri commands

**Modified files:**
- `src-tauri/src/transcription_workspace.rs` — add `INTERVIEWS_FOLDER` constant
- `src-tauri/src/managers/system_audio.rs` — BP-1, BP-2 back-ports
- `src-tauri/src/managers/transcription.rs` — BP-3 (`WHISPER_MIN_CHUNK_SECS` + fail-fast)
- `src-tauri/src/managers/mod.rs` — register `interview_session`, `interview_worker` modules
- `src-tauri/src/audio_toolkit/audio/mod.rs` — export `MicChunkedCapture`
- `src-tauri/src/commands/mod.rs` — register `interview` module
- `src-tauri/src/lib.rs` — manage `InterviewSessionManager`, register commands in `invoke_handler!`
- `src/components/SystemAudioView.tsx` — mode pills, participant-name row, speaker accents, edge-case fixes

---

## Phase 0: Back-Ports (Ship First)

### Task BP-1: Capture `chunk_start_offset_ms` pre-transcribe in system audio

**Files:**
- Modify: `src-tauri/src/managers/system_audio.rs:171-366` (the `on_chunk` closure inside `start_loopback`)

**Problem:** Today the VAD chunk's wall-clock offset is computed *after* `transcribe()` returns (lines 234-240). Two short chunks can race; the second one's `transcribe()` may finish first and get a *later* `elapsed_secs`. Paragraphs render out of order.

**Fix:** Capture `chunk_start_offset_ms` inside the `on_chunk` closure **before** `tauri::async_runtime::spawn`, pass it into the spawned task, and use it when building paragraphs.

- [ ] **Step 1: Modify the `on_chunk` closure to snapshot the offset before spawn**

Find the closure header in `src-tauri/src/managers/system_audio.rs`:

```rust
let on_chunk = move |audio: Vec<f32>, trigger: ChunkTrigger| {
    let app = app.clone();
    let current_note_id = Arc::clone(&current_note_id);
    // ... more clones ...

    tauri::async_runtime::spawn(async move {
        // ...transcribe, paragraph merge, emit...
    });
};
```

Replace it with (full closure — preserves all existing behavior, only change is `chunk_start_offset_ms` is now captured synchronously in the outer scope):

```rust
let on_chunk = move |audio: Vec<f32>, trigger: ChunkTrigger| {
    let app = app.clone();
    let current_note_id = Arc::clone(&current_note_id);
    let current_note_title = Arc::clone(&current_note_title);
    let paragraphs = Arc::clone(&paragraphs);
    let session_started_at = Arc::clone(&session_started_at);
    let last_chunk_ended_at = Arc::clone(&last_chunk_ended_at);
    let workspace_session_doc_id = Arc::clone(&workspace_session_doc_id);
    let last_workspace_persist_ms = Arc::clone(&last_workspace_persist_ms);
    let paragraph_silence_secs = Arc::clone(&paragraph_silence_secs);

    // BP-1: snapshot VAD-cut wall-clock offset BEFORE spawning, so paragraph
    // ordering tracks the audio cut time — not whenever Whisper happens to
    // return. `transcribe()` can take 200-500ms and two short chunks can race.
    let chunk_start_offset_ms: u64 = {
        let session = session_started_at.lock().unwrap();
        match *session {
            Some(start) => start.elapsed().as_millis() as u64,
            None => return, // session ended between VAD cut and on_chunk
        }
    };

    tauri::async_runtime::spawn(async move {
        // ...existing body, but replace the `elapsed_secs` derivation inside
        // the paragraphs.lock() block with `chunk_start_offset_ms / 1000`...
    });
};
```

Inside the spawned `async move` block, replace this existing snippet:

```rust
let rendered = {
    let session = session_started_at.lock().unwrap();
    let Some(start) = *session else {
        error!("System audio: session_started_at unset");
        return;
    };
    let elapsed_secs = start.elapsed().as_secs();
    // ... paras.push uses elapsed_secs ...
```

With:

```rust
let rendered = {
    // BP-1: use captured VAD-cut offset, not post-transcribe elapsed.
    let elapsed_secs = chunk_start_offset_ms / 1000;

    let mut paras = paragraphs.lock().unwrap();
    // ... (rest of block identical — paras.push uses elapsed_secs) ...
```

- [ ] **Step 2: Run `cargo check` to verify it compiles**

Run: `cd src-tauri && cargo check --lib`
Expected: zero errors, zero warnings in the changed file.

- [ ] **Step 3: Run `cargo test --lib`**

Run: `cd src-tauri && cargo test --lib`
Expected: all existing tests green (baseline 125 lib tests).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/managers/system_audio.rs
git commit -m "fix(system-audio): capture VAD-cut offset before spawning transcribe task

Previously the paragraph timestamp was computed after transcribe() returned,
so two short chunks racing could emit paragraphs out of order. Snapshot the
session elapsed_ms at VAD cut time and pass it into the async task."
```

---

### Task BP-2: Stop-drain protocol for `stop_loopback`

**Files:**
- Modify: `src-tauri/src/managers/system_audio.rs:105-140` (struct fields), `:384-463` (`stop_loopback`)

**Problem:** `stop_loopback` clears session state (`current_note_id`, `workspace_session_doc_id`) before in-flight spawned transcribe tasks complete. A late-arriving task then sees `current_note_id == None` on line 204, goes into the `None => {` branch, creates a new "Media Recording — …" synthetic id, and subsequently a new workspace doc.

**Fix:** Track in-flight task count with an `AtomicUsize`. Increment inside the `on_chunk` closure before `spawn`, decrement in an RAII guard at the end of the spawned task. `stop_loopback` polls the counter with `tokio::time::timeout(5s)` before clearing state.

- [ ] **Step 1: Add `in_flight_chunks` field to `SystemAudioManager`**

Locate the struct in `src-tauri/src/managers/system_audio.rs:105-121`. Add one field:

```rust
use std::sync::atomic::AtomicUsize;

pub struct SystemAudioManager {
    app_handle: AppHandle,
    capture: Arc<Mutex<Option<LoopbackCapture>>>,
    current_note_id: Arc<Mutex<Option<String>>>,
    current_note_title: Arc<Mutex<String>>,
    paragraphs: Arc<Mutex<Vec<SystemAudioParagraph>>>,
    session_started_at: Arc<Mutex<Option<Instant>>>,
    last_chunk_ended_at: Arc<Mutex<Option<Instant>>>,
    workspace_session_doc_id: Arc<Mutex<Option<String>>>,
    last_workspace_persist_ms: Arc<Mutex<u64>>,
    paragraph_silence_secs: Arc<AtomicU32>,
    /// BP-2: count of spawned transcribe tasks that haven't finished yet.
    /// stop_loopback polls this to avoid clearing session state while a
    /// late task is still writing to the workspace doc.
    in_flight_chunks: Arc<AtomicUsize>,
}
```

Update `new()` to initialise the field:

```rust
pub fn new(app: &AppHandle) -> Result<Self> {
    Ok(Self {
        app_handle: app.clone(),
        capture: Arc::new(Mutex::new(None)),
        current_note_id: Arc::new(Mutex::new(None)),
        current_note_title: Arc::new(Mutex::new(String::new())),
        paragraphs: Arc::new(Mutex::new(Vec::new())),
        session_started_at: Arc::new(Mutex::new(None)),
        last_chunk_ended_at: Arc::new(Mutex::new(None)),
        workspace_session_doc_id: Arc::new(Mutex::new(None)),
        last_workspace_persist_ms: Arc::new(Mutex::new(0)),
        paragraph_silence_secs: Arc::new(AtomicU32::new(secs_to_bits(
            PARAGRAPH_SILENCE_THRESHOLD_SECS,
        ))),
        in_flight_chunks: Arc::new(AtomicUsize::new(0)),
    })
}
```

- [ ] **Step 2: Track in-flight chunks inside the `on_chunk` closure**

In `start_loopback` clone the counter into the closure:

```rust
let in_flight_chunks = Arc::clone(&self.in_flight_chunks);
```

Inside the `on_chunk` closure, after cloning it into the task-local shadow, increment *before* `spawn` and decrement via an RAII guard inside the spawned task:

```rust
let on_chunk = move |audio: Vec<f32>, trigger: ChunkTrigger| {
    // ...existing clones...
    let in_flight_chunks = Arc::clone(&in_flight_chunks);

    // (BP-1 snapshot here, unchanged)

    // BP-2: increment before spawn so the task is guaranteed-counted even if
    // the spawn scheduling is delayed.
    in_flight_chunks.fetch_add(1, Ordering::SeqCst);

    tauri::async_runtime::spawn(async move {
        // RAII: decrement on task exit (normal return, early return, or panic).
        struct DoneGuard(Arc<AtomicUsize>);
        impl Drop for DoneGuard {
            fn drop(&mut self) {
                self.0.fetch_sub(1, Ordering::SeqCst);
            }
        }
        let _done = DoneGuard(in_flight_chunks);

        // ...existing body unchanged...
    });
};
```

- [ ] **Step 3: Await drain in `stop_loopback`**

Modify `stop_loopback` (currently at `src-tauri/src/managers/system_audio.rs:384-463`). Insert the drain between "Stop capture thread" and "Read session state":

```rust
pub async fn stop_loopback(&self) -> Result<()> {
    // ── Stop capture thread ───────────────────────────────────────────────
    {
        let mut capture_guard = self.capture.lock().unwrap();
        if let Some(ref mut loopback) = *capture_guard {
            loopback.stop();
        }
        *capture_guard = None;
    }

    // ── BP-2: drain in-flight transcribe tasks before clearing state ────
    // Late-completing tasks would otherwise see cleared state and spawn
    // a phantom "Media Recording — …" workspace doc.
    let in_flight = Arc::clone(&self.in_flight_chunks);
    let drain = async move {
        while in_flight.load(Ordering::SeqCst) > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    };
    if tokio::time::timeout(std::time::Duration::from_secs(5), drain)
        .await
        .is_err()
    {
        log::warn!(
            "System audio stop_loopback: drain timeout; {} tasks still in flight",
            self.in_flight_chunks.load(Ordering::SeqCst)
        );
    }

    // ── Read session state before clearing ───────────────────────────────
    // (rest of function unchanged)
    let note_id = self.current_note_id.lock().unwrap().clone();
    // ...
}
```

- [ ] **Step 4: Run `cargo check && cargo test --lib`**

Run: `cd src-tauri && cargo check --lib && cargo test --lib`
Expected: zero errors, all 125 tests green.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/managers/system_audio.rs
git commit -m "fix(system-audio): drain in-flight transcribe tasks in stop_loopback

Without this, a task that started before stop but finished after could see
cleared session state, fall through the 'no current_note_id' branch, and
synthesise a new 'Media Recording — …' workspace doc (phantom doc bug).

Track in-flight count with AtomicUsize (RAII guard in the spawned task),
poll to zero with a 5s timeout, then clear state."
```

---

### Task BP-3: `WHISPER_MIN_CHUNK_SECS` guard + fail-fast + empty-session guard

**Files:**
- Modify: `src-tauri/src/managers/transcription.rs` (add constant + early-return check)
- Modify: `src-tauri/src/managers/system_audio.rs` (empty-session guard at stop)

- [ ] **Step 1: Add `WHISPER_MIN_CHUNK_SECS` constant + guard in `transcribe()`**

In `src-tauri/src/managers/transcription.rs`, add the constant near the other constants at top of file (after the existing `use` block):

```rust
/// Whisper returns garbage or empty text for sub-half-second audio. Reject
/// upstream so the caller doesn't waste the ORT call.
pub(crate) const WHISPER_MIN_CHUNK_SECS: f32 = 0.5;

/// Standard Whisper sample rate. Keep in sync with the audio_toolkit pipeline.
const WHISPER_SAMPLE_RATE: usize = 16_000;
```

Then in `pub fn transcribe(&self, audio: Vec<f32>) -> Result<String>` (currently at line 516) — right after the existing `if audio.is_empty()` check around line 531 — add:

```rust
if audio.is_empty() {
    debug!("Empty audio vector");
    self.maybe_unload_immediately("empty audio");
    return Ok(String::new());
}

// BP-3: reject sub-half-second chunks. Whisper's positional encoding needs
// at least ~500ms; shorter chunks produce hallucinated text ("Thank you.",
// "Thanks for watching!") from model priors.
let duration_secs = audio.len() as f32 / WHISPER_SAMPLE_RATE as f32;
if duration_secs < WHISPER_MIN_CHUNK_SECS {
    debug!(
        "Audio too short ({:.3}s < {:.3}s); skipping transcribe",
        duration_secs, WHISPER_MIN_CHUNK_SECS
    );
    return Ok(String::new());
}
```

- [ ] **Step 2: Empty-session guard in `stop_loopback`**

Find the existing block around `src-tauri/src/managers/system_audio.rs:406-451`:

```rust
if let Some(ref wid) = ws_doc_id {
    if let Some(state) = self.app_handle.try_state::<Arc<AppState>>() {
        if !final_text.is_empty() {
            match state
                .workspace_manager
                .update_node_body_persist_only(wid, &final_text)
                .await
            {
                // ...
```

The existing `if !final_text.is_empty()` already guards against empty bodies when a ws_doc exists. The remaining gap: a session that ends with zero paragraphs still called `ensure_transcription_folder + create_document_child` on the *first* chunk, producing an empty "Media Recording — …" doc. Since we now reject sub-half-second chunks (step 1), that path naturally emits fewer empties. Guard the stop path explicitly too — if `final_text.is_empty()` and `ws_doc_id` is present, we still call `finalize_node_search_index` which is fine (no-op on empty body). No additional change needed here.

Verify the existing guard by reading lines 408-442 once more — nothing to modify, the guard is already correct after step 1.

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo check --lib && cargo test --lib`
Expected: zero errors, all green.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/managers/transcription.rs
git commit -m "fix(transcription): skip sub-500ms audio chunks to prevent hallucinations

Whisper's positional encoding requires ~500ms minimum; shorter chunks
produce hallucinated text ('Thank you.', 'Thanks for watching!') sampled
from the model's training priors. Guard in transcribe() with a shared
WHISPER_MIN_CHUNK_SECS constant."
```

---

## Phase 1: Pure `merge_paragraphs` with TDD

### Task IV-1: Add `INTERVIEWS_FOLDER` constant

**Files:**
- Modify: `src-tauri/src/transcription_workspace.rs:32-33`

- [ ] **Step 1: Add the constant next to the existing two folder constants**

Replace lines 30-33 of `src-tauri/src/transcription_workspace.rs`:

```rust
/// Root workspace folder for voice-memo documents. Tree icons: see `workspaceTranscriptionFolders.ts` + `WorkspaceTreeNodeIcon`.
pub const MIC_TRANSCRIBE_FOLDER: &str = "Mic Transcribe";
/// Root workspace folder for system-audio session docs. Tree icons: see `workspaceTranscriptionFolders.ts` + `WorkspaceTreeNodeIcon`.
pub const SYSTEM_AUDIO_FOLDER: &str = "System Audio";
/// Root workspace folder for interview session docs (mic + system audio merged).
pub const INTERVIEWS_FOLDER: &str = "Interviews";
```

- [ ] **Step 2: `cargo check`**

Run: `cd src-tauri && cargo check --lib`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/transcription_workspace.rs
git commit -m "feat(workspace): add INTERVIEWS_FOLDER constant for interview mode docs"
```

---

### Task IV-2: `merge_paragraphs` TDD — write failing tests first

**Files:**
- Create: `src-tauri/src/managers/interview_worker.rs`
- Modify: `src-tauri/src/managers/mod.rs`

- [ ] **Step 1: Create `interview_worker.rs` with types + failing test stubs**

Create `src-tauri/src/managers/interview_worker.rs`:

```rust
//! Interview-mode transcription worker (Rule 16).
//!
//! Drives two independent ORT Whisper sessions — one for the mic stream
//! ("You"), one for the system-audio loopback ("Other") — and merges their
//! paragraph output by wall-clock offset on stop. See
//! `docs/superpowers/specs/2026-04-23-interview-mode-design.md`.

/// Speaker attribution for a merged paragraph.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Speaker {
    You,
    Other(String),
}

/// One paragraph from a single stream before merge. `chunk_start_offset_ms`
/// is the VAD-cut wall-clock offset (see BP-1), NOT the post-transcribe
/// elapsed — critical for deterministic ordering.
#[derive(Clone, Debug)]
pub struct RawParagraph {
    pub text: String,
    pub chunk_start_offset_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MergedParagraph {
    pub speaker: Speaker,
    pub text: String,
    pub chunk_start_offset_ms: u64,
    pub wall_clock_ms: u64,
}

/// Merge mic + system paragraphs into a single ordered timeline.
///
/// - Stable-sort by `chunk_start_offset_ms` ascending.
/// - Tiebreak (equal offsets): You before Other.
/// - Empty inputs produce empty output or pass-through of the non-empty side.
pub fn merge_paragraphs(
    mic: &[RawParagraph],
    system: &[RawParagraph],
    session_start_ms: u64,
    participant_name: &str,
) -> Vec<MergedParagraph> {
    let _ = (mic, system, session_start_ms, participant_name);
    unimplemented!("IV-2 step 3")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mic(offset_ms: u64, text: &str) -> RawParagraph {
        RawParagraph {
            text: text.to_string(),
            chunk_start_offset_ms: offset_ms,
        }
    }
    fn sys(offset_ms: u64, text: &str) -> RawParagraph {
        RawParagraph {
            text: text.to_string(),
            chunk_start_offset_ms: offset_ms,
        }
    }

    #[test]
    fn merge_paragraphs_interleaved() {
        let merged = merge_paragraphs(
            &[mic(0, "hi"), mic(1000, "how are you")],
            &[sys(500, "doing well"), sys(1500, "thanks")],
            10_000_000,
            "Alice",
        );
        assert_eq!(merged.len(), 4);
        assert_eq!(merged[0].speaker, Speaker::You);
        assert_eq!(merged[0].text, "hi");
        assert_eq!(merged[0].wall_clock_ms, 10_000_000);
        assert_eq!(merged[1].speaker, Speaker::Other("Alice".to_string()));
        assert_eq!(merged[1].text, "doing well");
        assert_eq!(merged[2].speaker, Speaker::You);
        assert_eq!(merged[2].text, "how are you");
        assert_eq!(merged[3].speaker, Speaker::Other("Alice".to_string()));
        assert_eq!(merged[3].text, "thanks");
    }

    #[test]
    fn merge_paragraphs_tiebreak() {
        let merged = merge_paragraphs(
            &[mic(500, "you said")],
            &[sys(500, "other said")],
            0,
            "Bob",
        );
        assert_eq!(merged.len(), 2);
        // Tiebreak: You first.
        assert_eq!(merged[0].speaker, Speaker::You);
        assert_eq!(merged[1].speaker, Speaker::Other("Bob".to_string()));
    }

    #[test]
    fn merge_paragraphs_empty_mic() {
        let merged = merge_paragraphs(
            &[],
            &[sys(0, "only other"), sys(1000, "more")],
            0,
            "Carol",
        );
        assert_eq!(merged.len(), 2);
        assert!(merged.iter().all(|p| matches!(p.speaker, Speaker::Other(_))));
    }

    #[test]
    fn merge_paragraphs_empty_system() {
        let merged = merge_paragraphs(
            &[mic(0, "only you"), mic(2000, "still you")],
            &[],
            0,
            "Dave",
        );
        assert_eq!(merged.len(), 2);
        assert!(merged.iter().all(|p| p.speaker == Speaker::You));
    }

    #[test]
    fn merge_paragraphs_empty_both() {
        let merged = merge_paragraphs(&[], &[], 0, "Eve");
        assert!(merged.is_empty());
    }
}
```

- [ ] **Step 2: Register the module in `src-tauri/src/managers/mod.rs`**

Open `src-tauri/src/managers/mod.rs` and add the line with the other `pub mod` declarations (keep alphabetical if the existing file is alphabetical):

```rust
pub mod interview_worker;
```

- [ ] **Step 3: Run tests to verify they fail with `unimplemented!`**

Run: `cd src-tauri && cargo test --lib interview_worker`
Expected: 5 tests FAIL (each panics with `not implemented: IV-2 step 3`).

- [ ] **Step 4: Implement `merge_paragraphs` to make tests pass**

Replace the `unimplemented!` body in `src-tauri/src/managers/interview_worker.rs`:

```rust
pub fn merge_paragraphs(
    mic: &[RawParagraph],
    system: &[RawParagraph],
    session_start_ms: u64,
    participant_name: &str,
) -> Vec<MergedParagraph> {
    let mut merged: Vec<MergedParagraph> = Vec::with_capacity(mic.len() + system.len());

    for p in mic {
        merged.push(MergedParagraph {
            speaker: Speaker::You,
            text: p.text.clone(),
            chunk_start_offset_ms: p.chunk_start_offset_ms,
            wall_clock_ms: session_start_ms.saturating_add(p.chunk_start_offset_ms),
        });
    }
    for p in system {
        merged.push(MergedParagraph {
            speaker: Speaker::Other(participant_name.to_string()),
            text: p.text.clone(),
            chunk_start_offset_ms: p.chunk_start_offset_ms,
            wall_clock_ms: session_start_ms.saturating_add(p.chunk_start_offset_ms),
        });
    }

    // Stable sort by offset, tiebreak You-before-Other.
    merged.sort_by(|a, b| {
        a.chunk_start_offset_ms
            .cmp(&b.chunk_start_offset_ms)
            .then_with(|| match (&a.speaker, &b.speaker) {
                (Speaker::You, Speaker::Other(_)) => std::cmp::Ordering::Less,
                (Speaker::Other(_), Speaker::You) => std::cmp::Ordering::Greater,
                _ => std::cmp::Ordering::Equal,
            })
    });

    merged
}
```

- [ ] **Step 5: Run tests to verify green**

Run: `cd src-tauri && cargo test --lib interview_worker`
Expected: 5 tests PASS.

Then run the full suite to confirm no regressions:

Run: `cd src-tauri && cargo test --lib`
Expected: all lib tests green (baseline 125 + 5 new = 130).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/managers/interview_worker.rs src-tauri/src/managers/mod.rs
git commit -m "feat(interview): merge_paragraphs pure fn + TDD coverage

Stable-sorts mic + system paragraphs by VAD-cut offset_ms with
You-before-Other tiebreak. 5 unit tests cover interleaved, tiebreak,
and three empty-input cases."
```

---

## Phase 2: Session Manager

### Task IV-3: `InterviewSessionManager`

**Files:**
- Create: `src-tauri/src/managers/interview_session.rs`
- Modify: `src-tauri/src/managers/mod.rs`
- Modify: `src-tauri/src/lib.rs` (manage the new state)

- [ ] **Step 1: Create `interview_session.rs`**

Create `src-tauri/src/managers/interview_session.rs`:

```rust
//! Tracks the active interview workspace document for the current session.
//!
//! Mirrors `VoiceSessionManager` for voice memos. One active interview
//! session at a time — the frontend gates starting a second session.

use std::sync::Mutex;

#[derive(Clone, Debug)]
pub struct InterviewMeta {
    pub workspace_doc_id: String,
    pub session_id: String,
    pub participant_name: String,
    pub started_at_ms: i64,
}

pub struct InterviewSessionManager {
    active: Mutex<Option<InterviewMeta>>,
}

impl InterviewSessionManager {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(None),
        }
    }

    pub fn get(&self) -> Option<InterviewMeta> {
        self.active.lock().ok().and_then(|g| g.clone())
    }

    pub fn is_active(&self) -> bool {
        self.active.lock().ok().map_or(false, |g| g.is_some())
    }

    pub fn set(&self, meta: InterviewMeta) {
        if let Ok(mut guard) = self.active.lock() {
            *guard = Some(meta);
        }
    }

    pub fn take(&self) -> Option<InterviewMeta> {
        self.active.lock().ok().and_then(|mut g| g.take())
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.active.lock() {
            *guard = None;
        }
    }
}

impl Default for InterviewSessionManager {
    fn default() -> Self {
        Self::new()
    }
}
```

- [ ] **Step 2: Register in `src-tauri/src/managers/mod.rs`**

Add:

```rust
pub mod interview_session;
```

- [ ] **Step 3: Manage the singleton in `src-tauri/src/lib.rs`**

Locate the block where `VoiceSessionManager` is managed (grep for `VoiceSessionManager::new` in `lib.rs`):

```rust
app.manage(Arc::new(VoiceSessionManager::new()));
```

Add the parallel line immediately after:

```rust
app.manage(Arc::new(
    crate::managers::interview_session::InterviewSessionManager::new(),
));
```

- [ ] **Step 4: `cargo check`**

Run: `cd src-tauri && cargo check --lib`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/managers/interview_session.rs src-tauri/src/managers/mod.rs src-tauri/src/lib.rs
git commit -m "feat(interview): InterviewSessionManager tracks active interview doc

Mirrors VoiceSessionManager's single-session model. Stores workspace_doc_id,
session_id, participant_name, and started_at_ms so the stop path can build
frontmatter + wall-clock timestamps without another DB round trip."
```

---

## Phase 3: Chunked Mic Capture

### Task IV-4: `MicChunkedCapture` — VAD-streaming wrapper around `AudioRecorder`

**Files:**
- Create: `src-tauri/src/audio_toolkit/audio/mic_chunked.rs`
- Modify: `src-tauri/src/audio_toolkit/audio/mod.rs`

**Purpose:** Mirror the `LoopbackCapture` interface for mic input — deliver VAD-cut chunks via `on_chunk(Vec<f32>, ChunkTrigger)`. The existing `AudioRecordingManager` buffers all samples and returns at stop; interview mode needs *live* chunks so "You" paragraphs can stream into the UI alongside "Other".

- [ ] **Step 1: Read the existing loopback for shape reference**

Run: `head -c 10000 src-tauri/src/audio_toolkit/audio/loopback.rs | tail -c 6000`

Note the two key APIs (`LoopbackCapture::new`, `start(app, on_chunk, max_chunk_secs, vad_hangover_secs)`, `stop()`, `is_running()`) and the `ChunkTrigger::{Vad, MaxChunk}` enum.

- [ ] **Step 2: Create `mic_chunked.rs`**

Create `src-tauri/src/audio_toolkit/audio/mic_chunked.rs`:

```rust
//! VAD-cut mic capture that delivers live chunks (parallel to LoopbackCapture).
//!
//! Unlike `AudioRecordingManager` which buffers all samples until stop, this
//! feeds VAD-cut chunks to a user callback so interview mode can stream
//! "You" paragraphs into the UI while the user is still speaking.

use crate::audio_toolkit::audio::loopback::ChunkTrigger;
use crate::audio_toolkit::{AudioRecorder, SileroVad};
use anyhow::Result;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;

const SAMPLE_RATE: usize = 16_000;
const VAD_FRAME_MS: usize = 30;
const VAD_FRAME_SAMPLES: usize = SAMPLE_RATE * VAD_FRAME_MS / 1000;

pub struct MicChunkedCapture {
    running: Arc<AtomicBool>,
    thread_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
}

impl MicChunkedCapture {
    pub fn new() -> Result<Self> {
        Ok(Self {
            running: Arc::new(AtomicBool::new(false)),
            thread_handle: Arc::new(Mutex::new(None)),
        })
    }

    /// Start mic capture. `on_chunk` is called from a background thread.
    pub fn start(
        &mut self,
        _app: AppHandle,
        on_chunk: impl Fn(Vec<f32>, ChunkTrigger) + Send + 'static,
        max_chunk_secs: f32,
        vad_hangover_secs: f32,
    ) -> Result<()> {
        let running = Arc::clone(&self.running);
        running.store(true, Ordering::SeqCst);

        let handle = thread::spawn(move || {
            let recorder = match AudioRecorder::new() {
                Ok(r) => r,
                Err(e) => {
                    log::error!("MicChunkedCapture: AudioRecorder init failed: {e}");
                    running.store(false, Ordering::SeqCst);
                    return;
                }
            };
            if let Err(e) = recorder.start() {
                log::error!("MicChunkedCapture: recorder.start failed: {e}");
                running.store(false, Ordering::SeqCst);
                return;
            }

            let mut vad = match SileroVad::new() {
                Ok(v) => v,
                Err(e) => {
                    log::error!("MicChunkedCapture: SileroVad init failed: {e}");
                    running.store(false, Ordering::SeqCst);
                    return;
                }
            };

            let max_samples = (max_chunk_secs * SAMPLE_RATE as f32) as usize;
            let hangover_frames =
                ((vad_hangover_secs * SAMPLE_RATE as f32) as usize + VAD_FRAME_SAMPLES - 1)
                    / VAD_FRAME_SAMPLES;

            let mut speech_buf: Vec<f32> = Vec::with_capacity(max_samples * 2);
            let mut silent_frames_since_speech: usize = 0;
            let mut in_speech = false;
            let mut last_drain = Instant::now();

            while running.load(Ordering::SeqCst) {
                // Drain latest frame from the recorder (API varies — adapt to
                // whatever AudioRecorder exposes; see recorder.rs:204 onwards).
                let frame = match recorder.next_frame(VAD_FRAME_SAMPLES) {
                    Some(f) => f,
                    None => {
                        thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                };

                let is_speech = vad.is_speech(&frame).unwrap_or(false);

                if is_speech {
                    in_speech = true;
                    silent_frames_since_speech = 0;
                    speech_buf.extend_from_slice(&frame);
                } else if in_speech {
                    silent_frames_since_speech += 1;
                    speech_buf.extend_from_slice(&frame);
                    if silent_frames_since_speech >= hangover_frames {
                        // VAD cut.
                        let chunk = std::mem::take(&mut speech_buf);
                        on_chunk(chunk, ChunkTrigger::Vad);
                        in_speech = false;
                        silent_frames_since_speech = 0;
                        last_drain = Instant::now();
                    }
                }

                // Max-chunk force-flush.
                if speech_buf.len() >= max_samples {
                    let chunk = std::mem::take(&mut speech_buf);
                    on_chunk(chunk, ChunkTrigger::MaxChunk);
                    in_speech = false;
                    silent_frames_since_speech = 0;
                    last_drain = Instant::now();
                }

                // Sanity flush: if we've been accumulating for >2×max_chunk without VAD,
                // force flush so the UI doesn't freeze.
                if last_drain.elapsed() > Duration::from_secs_f32(max_chunk_secs * 2.0)
                    && !speech_buf.is_empty()
                {
                    let chunk = std::mem::take(&mut speech_buf);
                    on_chunk(chunk, ChunkTrigger::MaxChunk);
                    last_drain = Instant::now();
                }
            }

            // Flush trailing buffer on stop.
            if !speech_buf.is_empty() {
                on_chunk(speech_buf, ChunkTrigger::MaxChunk);
            }
        });

        *self.thread_handle.lock().unwrap() = Some(handle);
        Ok(())
    }

    pub fn stop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(h) = self.thread_handle.lock().unwrap().take() {
            let _ = h.join();
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}

impl Drop for MicChunkedCapture {
    fn drop(&mut self) {
        self.stop();
    }
}
```

**Note on `recorder.next_frame(n)`**: the existing `AudioRecorder` may not expose this exact method. Inspect `src-tauri/src/audio_toolkit/audio/recorder.rs:204` and adapt — you may need to (a) call an existing `samples() -> Vec<f32>` drain method, or (b) subscribe to the recorder's internal channel. If the recorder only offers "drain all buffered samples", use that and chunk in user space. The shape the outer code depends on is ONLY `on_chunk(Vec<f32>, ChunkTrigger)`.

- [ ] **Step 3: Export from `src-tauri/src/audio_toolkit/audio/mod.rs`**

Find the existing loopback export. Add:

```rust
pub mod mic_chunked;
pub use mic_chunked::MicChunkedCapture;
```

- [ ] **Step 4: Inspect `AudioRecorder` and adapt the `next_frame` call**

Run: `cd src-tauri && cargo check --lib 2>&1 | head -40`

If `recorder.next_frame` is not a real method, the compiler will tell you. Open `src-tauri/src/audio_toolkit/audio/recorder.rs` and find the actual sample-drain API (likely `drain_samples()`, `take_samples()`, or a `Receiver<Vec<f32>>`). Update the loop in `mic_chunked.rs` to use the real API — chunk by `VAD_FRAME_SAMPLES` if the drain gives you more than one frame at a time.

- [ ] **Step 5: `cargo check` clean**

Run: `cd src-tauri && cargo check --lib`
Expected: zero errors.

- [ ] **Step 6: `cargo test --lib`**

Run: `cd src-tauri && cargo test --lib`
Expected: all 130 tests green.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/audio_toolkit/audio/mic_chunked.rs src-tauri/src/audio_toolkit/audio/mod.rs
git commit -m "feat(audio): MicChunkedCapture — VAD-cut mic streaming for interview mode

Mirrors LoopbackCapture's on_chunk(Vec<f32>, ChunkTrigger) contract so the
interview worker can drive mic + system halves through the same merge
pipeline. Max-chunk force-flush and sanity-flush prevent UI freeze when
VAD misses a cut."
```

---

## Phase 4: Interview Worker

### Task IV-5: `InterviewTranscriptionWorker` — start/stop machinery

**Files:**
- Modify: `src-tauri/src/managers/interview_worker.rs` (extend with worker impl; keep the pure `merge_paragraphs` + tests already there)

This task extends the file — do NOT remove the `Speaker`, `RawParagraph`, `MergedParagraph`, `merge_paragraphs`, or `#[cfg(test)] mod tests` already in place.

- [ ] **Step 1: Add worker struct + shared state**

Append to `src-tauri/src/managers/interview_worker.rs` (after the existing types, before `#[cfg(test)]`):

```rust
use crate::audio_toolkit::audio::loopback::{ChunkTrigger, LoopbackCapture};
use crate::audio_toolkit::audio::mic_chunked::MicChunkedCapture;
use crate::managers::interview_session::{InterviewMeta, InterviewSessionManager};
use crate::managers::transcription::TranscriptionManager;
use crate::managers::workspace::AppState;
use crate::transcription_workspace::{
    emit_workspace_node_body_updated_immediate, emit_workspace_node_body_updated_throttled,
    emit_workspace_transcription_synced, INTERVIEWS_FOLDER,
};
use anyhow::Result;
use chrono::Local;
use log::error;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const WORKSPACE_PERSIST_INTERVAL_MS: u64 = 1000;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Shared between the mic and system sub-workers. Single Mutex — no nested lock
/// acquisition, no deadlock risk.
#[derive(Default)]
pub struct ParagraphState {
    pub mic: Vec<RawParagraph>,
    pub system: Vec<RawParagraph>,
}

pub struct InterviewTranscriptionWorker {
    app_handle: AppHandle,
    mic_capture: Arc<Mutex<Option<MicChunkedCapture>>>,
    system_capture: Arc<Mutex<Option<LoopbackCapture>>>,
    state: Arc<Mutex<ParagraphState>>,
    session_started_at: Arc<Mutex<Option<Instant>>>,
    last_workspace_persist_ms: Arc<Mutex<u64>>,
    in_flight: Arc<AtomicUsize>,
    workspace_doc_id: Arc<Mutex<Option<String>>>,
    participant_name: Arc<Mutex<String>>,
}

impl InterviewTranscriptionWorker {
    pub fn new(app: &AppHandle) -> Self {
        Self {
            app_handle: app.clone(),
            mic_capture: Arc::new(Mutex::new(None)),
            system_capture: Arc::new(Mutex::new(None)),
            state: Arc::new(Mutex::new(ParagraphState::default())),
            session_started_at: Arc::new(Mutex::new(None)),
            last_workspace_persist_ms: Arc::new(Mutex::new(0)),
            in_flight: Arc::new(AtomicUsize::new(0)),
            workspace_doc_id: Arc::new(Mutex::new(None)),
            participant_name: Arc::new(Mutex::new(String::new())),
        }
    }

    pub fn is_running(&self) -> bool {
        self.mic_capture
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false)
            || self
                .system_capture
                .lock()
                .map(|g| g.is_some())
                .unwrap_or(false)
    }
}
```

- [ ] **Step 2: Implement `start` with two sub-captures**

Append to the `impl InterviewTranscriptionWorker` block:

```rust
impl InterviewTranscriptionWorker {
    pub async fn start(
        &self,
        participant_name: String,
        max_chunk_secs: f32,
        vad_hangover_secs: f32,
    ) -> Result<(String, i64)> {
        // Reset shared state.
        *self.state.lock().unwrap() = ParagraphState::default();
        *self.session_started_at.lock().unwrap() = Some(Instant::now());
        *self.last_workspace_persist_ms.lock().unwrap() = 0;
        *self.participant_name.lock().unwrap() = participant_name.clone();
        self.in_flight.store(0, Ordering::SeqCst);

        // Prime the transcription model before any chunk arrives.
        if let Some(tm) = self.app_handle.try_state::<Arc<TranscriptionManager>>() {
            tm.initiate_model_load();
        }

        // Create the workspace doc up front (frontmatter + empty body).
        let started_at_ms = chrono::Utc::now().timestamp_millis();
        let session_id = uuid::Uuid::new_v4().to_string();
        let filename_ts = Local::now().format("%Y-%m-%d %H-%M-%S").to_string();
        let title = format!("Interview — {filename_ts}");

        let state_arc = self
            .app_handle
            .try_state::<Arc<AppState>>()
            .ok_or_else(|| anyhow::anyhow!("AppState missing"))?;
        let folder_id = state_arc
            .workspace_manager
            .ensure_transcription_folder(&self.app_handle, INTERVIEWS_FOLDER)
            .await
            .map_err(|e| anyhow::anyhow!("ensure_transcription_folder: {e}"))?;

        let initial_body = String::new(); // Populated on each persist.
        let initial_props = serde_json::json!({
            "interview_mirror": {
                "session_id": &session_id,
                "started_at_ms": started_at_ms,
                "stopped_at_ms": serde_json::Value::Null,
                "mic_path": serde_json::Value::Null,
                "system_path": serde_json::Value::Null,
                "participant": &participant_name,
            }
        })
        .to_string();

        let doc = state_arc
            .workspace_manager
            .create_document_child_with_properties(
                &folder_id,
                &title,
                "🎙️",
                &initial_body,
                &initial_props,
            )
            .await
            .map_err(|e| anyhow::anyhow!("create_document_child_with_properties: {e}"))?;

        if let Err(e) = state_arc
            .workspace_manager
            .write_node_to_vault(&self.app_handle, &doc, None)
            .await
        {
            error!("Interview initial vault write: {e}");
        }

        *self.workspace_doc_id.lock().unwrap() = Some(doc.id.clone());
        emit_workspace_transcription_synced(&self.app_handle, &doc.id, "interview");

        // Wire the mic sub-worker.
        let mut mic_capture = MicChunkedCapture::new()?;
        {
            let app = self.app_handle.clone();
            let state = Arc::clone(&self.state);
            let session_started_at = Arc::clone(&self.session_started_at);
            let last_persist = Arc::clone(&self.last_workspace_persist_ms);
            let in_flight = Arc::clone(&self.in_flight);
            let ws_doc_id = Arc::clone(&self.workspace_doc_id);
            let participant = Arc::clone(&self.participant_name);

            mic_capture.start(
                self.app_handle.clone(),
                move |audio, _trigger| {
                    let app = app.clone();
                    let state = Arc::clone(&state);
                    let session_started_at = Arc::clone(&session_started_at);
                    let last_persist = Arc::clone(&last_persist);
                    let in_flight = Arc::clone(&in_flight);
                    let ws_doc_id = Arc::clone(&ws_doc_id);
                    let participant = Arc::clone(&participant);

                    // BP-1 snapshot: wall-clock VAD-cut offset.
                    let offset_ms: u64 = {
                        let s = session_started_at.lock().unwrap();
                        match *s {
                            Some(t) => t.elapsed().as_millis() as u64,
                            None => return,
                        }
                    };
                    in_flight.fetch_add(1, Ordering::SeqCst);

                    tauri::async_runtime::spawn(async move {
                        struct DoneGuard(Arc<AtomicUsize>);
                        impl Drop for DoneGuard {
                            fn drop(&mut self) {
                                self.0.fetch_sub(1, Ordering::SeqCst);
                            }
                        }
                        let _done = DoneGuard(in_flight);

                        let tm = match app.try_state::<Arc<TranscriptionManager>>() {
                            Some(tm) => tm,
                            None => {
                                error!("Interview mic: TranscriptionManager missing");
                                return;
                            }
                        };
                        let text = match tm.transcribe(audio) {
                            Ok(t) => t.trim().to_string(),
                            Err(e) => {
                                error!("Interview mic transcribe: {e}");
                                return;
                            }
                        };
                        if text.is_empty() {
                            return;
                        }

                        {
                            let mut st = state.lock().unwrap();
                            st.mic.push(RawParagraph {
                                text,
                                chunk_start_offset_ms: offset_ms,
                            });
                        }

                        persist_live_body(
                            &app,
                            &state,
                            &ws_doc_id,
                            &last_persist,
                            &session_started_at,
                            &participant,
                        )
                        .await;
                    });
                },
                max_chunk_secs,
                vad_hangover_secs,
            )?;
        }
        *self.mic_capture.lock().unwrap() = Some(mic_capture);

        // Wire the system sub-worker.
        let mut system_capture = LoopbackCapture::new()?;
        {
            let app = self.app_handle.clone();
            let state = Arc::clone(&self.state);
            let session_started_at = Arc::clone(&self.session_started_at);
            let last_persist = Arc::clone(&self.last_workspace_persist_ms);
            let in_flight = Arc::clone(&self.in_flight);
            let ws_doc_id = Arc::clone(&self.workspace_doc_id);
            let participant = Arc::clone(&self.participant_name);

            system_capture.start(
                self.app_handle.clone(),
                move |audio, _trigger| {
                    let app = app.clone();
                    let state = Arc::clone(&state);
                    let session_started_at = Arc::clone(&session_started_at);
                    let last_persist = Arc::clone(&last_persist);
                    let in_flight = Arc::clone(&in_flight);
                    let ws_doc_id = Arc::clone(&ws_doc_id);
                    let participant = Arc::clone(&participant);

                    let offset_ms: u64 = {
                        let s = session_started_at.lock().unwrap();
                        match *s {
                            Some(t) => t.elapsed().as_millis() as u64,
                            None => return,
                        }
                    };
                    in_flight.fetch_add(1, Ordering::SeqCst);

                    tauri::async_runtime::spawn(async move {
                        struct DoneGuard(Arc<AtomicUsize>);
                        impl Drop for DoneGuard {
                            fn drop(&mut self) {
                                self.0.fetch_sub(1, Ordering::SeqCst);
                            }
                        }
                        let _done = DoneGuard(in_flight);

                        let tm = match app.try_state::<Arc<TranscriptionManager>>() {
                            Some(tm) => tm,
                            None => {
                                error!("Interview sys: TranscriptionManager missing");
                                return;
                            }
                        };
                        let text = match tm.transcribe(audio) {
                            Ok(t) => t.trim().to_string(),
                            Err(e) => {
                                error!("Interview sys transcribe: {e}");
                                return;
                            }
                        };
                        if text.is_empty() {
                            return;
                        }

                        {
                            let mut st = state.lock().unwrap();
                            st.system.push(RawParagraph {
                                text,
                                chunk_start_offset_ms: offset_ms,
                            });
                        }

                        persist_live_body(
                            &app,
                            &state,
                            &ws_doc_id,
                            &last_persist,
                            &session_started_at,
                            &participant,
                        )
                        .await;
                    });
                },
                max_chunk_secs,
                vad_hangover_secs,
            )?;
        }
        *self.system_capture.lock().unwrap() = Some(system_capture);

        // Persist meta in the session manager.
        if let Some(mgr) = self
            .app_handle
            .try_state::<Arc<InterviewSessionManager>>()
        {
            mgr.set(InterviewMeta {
                workspace_doc_id: doc.id.clone(),
                session_id: session_id.clone(),
                participant_name: participant_name.clone(),
                started_at_ms,
            });
        }

        Ok((doc.id, started_at_ms))
    }
}
```

- [ ] **Step 3: Implement `persist_live_body` helper + `render_interview_body`**

Append (outside any `impl`):

```rust
fn format_wall_clock_hhmmss(wall_clock_ms: u64) -> String {
    let total_secs = wall_clock_ms / 1000;
    let h = total_secs / 3600;
    let m = (total_secs % 3600) / 60;
    let s = total_secs % 60;
    format!("{:02}:{:02}:{:02}", h, m, s)
}

fn directive_escape_path(path: &str) -> String {
    path.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Build the full interview body from merged paragraphs.
/// Layout: `::interview_recording{...}` directive, blank line, then one
/// heading-and-body block per paragraph.
pub(crate) fn render_interview_body(
    merged: &[MergedParagraph],
    mic_path: &str,
    system_path: &str,
) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "::interview_recording{{mic_path=\"{}\" system_path=\"{}\"}}\n\n",
        directive_escape_path(mic_path),
        directive_escape_path(system_path)
    ));
    for (i, p) in merged.iter().enumerate() {
        let speaker_label = match &p.speaker {
            Speaker::You => "You",
            Speaker::Other(name) => name.as_str(),
        };
        out.push_str(&format!(
            "## [{}] {}\n\n{}\n",
            format_wall_clock_hhmmss(p.wall_clock_ms),
            speaker_label,
            p.text.trim()
        ));
        if i + 1 < merged.len() {
            out.push('\n');
        }
    }
    out
}

async fn persist_live_body(
    app: &AppHandle,
    state: &Arc<Mutex<ParagraphState>>,
    ws_doc_id: &Arc<Mutex<Option<String>>>,
    last_persist: &Arc<Mutex<u64>>,
    session_started_at: &Arc<Mutex<Option<Instant>>>,
    participant: &Arc<Mutex<String>>,
) {
    let t = now_ms();
    let should_persist = {
        let mut last = last_persist.lock().unwrap();
        if t.saturating_sub(*last) >= WORKSPACE_PERSIST_INTERVAL_MS {
            *last = t;
            true
        } else {
            false
        }
    };
    if !should_persist {
        return;
    }

    let ws_id = match ws_doc_id.lock().unwrap().clone() {
        Some(id) => id,
        None => return,
    };
    let Some(state_arc) = app.try_state::<Arc<AppState>>() else {
        return;
    };

    let session_start_unix_ms = {
        let s = session_started_at.lock().unwrap();
        match *s {
            Some(_) => {
                // session_started_at is an Instant (monotonic, not unix) —
                // we don't have the UTC started_at_ms in this helper, so
                // live persist uses offset-only timestamps (0-based).
                0u64
            }
            None => return,
        }
    };
    let merged = {
        let st = state.lock().unwrap();
        let name = participant.lock().unwrap().clone();
        super::interview_worker::merge_paragraphs(&st.mic, &st.system, session_start_unix_ms, &name)
    };
    let body = render_interview_body(&merged, "", "");

    match state_arc
        .workspace_manager
        .update_node_body_persist_only(&ws_id, &body)
        .await
    {
        Ok(node) => {
            emit_workspace_node_body_updated_throttled(app, &node);
            if let Err(e) = state_arc
                .workspace_manager
                .write_node_to_vault(app, &node, None)
                .await
            {
                error!("Interview live vault mirror: {e}");
            }
        }
        Err(e) => error!("Interview live persist: {e}"),
    }
}
```

**Note on `session_start_unix_ms`**: we deliberately use `0` for live persists (timestamps display as offsets HH:MM:SS from session start). At stop, the worker reconstructs the real wall-clock by passing the session's UTC `started_at_ms` into `merge_paragraphs` for the final body — see step 4.

- [ ] **Step 4: Implement `stop` with drain + final merge + workspace write**

Append to `impl InterviewTranscriptionWorker`:

```rust
impl InterviewTranscriptionWorker {
    pub async fn stop(&self) -> Result<Option<String>> {
        // Stop capture threads (they'll flush trailing buffers).
        {
            let mut g = self.mic_capture.lock().unwrap();
            if let Some(mut cap) = g.take() {
                cap.stop();
            }
        }
        {
            let mut g = self.system_capture.lock().unwrap();
            if let Some(mut cap) = g.take() {
                cap.stop();
            }
        }

        // Drain in-flight transcribe tasks (5s timeout).
        let in_flight = Arc::clone(&self.in_flight);
        let drain = async move {
            while in_flight.load(Ordering::SeqCst) > 0 {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        };
        if tokio::time::timeout(Duration::from_secs(5), drain).await.is_err() {
            log::warn!(
                "Interview stop: drain timeout; {} tasks still in flight",
                self.in_flight.load(Ordering::SeqCst)
            );
        }

        let meta = self
            .app_handle
            .try_state::<Arc<InterviewSessionManager>>()
            .and_then(|m| m.take());
        let Some(meta) = meta else {
            return Ok(None);
        };

        let ws_doc_id = meta.workspace_doc_id.clone();
        let session_start_ms = meta.started_at_ms as u64;
        let participant = meta.participant_name.clone();
        let stopped_at_ms = chrono::Utc::now().timestamp_millis();

        let merged = {
            let st = self.state.lock().unwrap();
            merge_paragraphs(&st.mic, &st.system, session_start_ms, &participant)
        };

        // Empty-session guard: still finalize the index but don't rewrite body.
        if !merged.is_empty() {
            if let Some(state_arc) = self.app_handle.try_state::<Arc<AppState>>() {
                let body = render_interview_body(&merged, "", "");
                match state_arc
                    .workspace_manager
                    .update_node_body_persist_only(&ws_doc_id, &body)
                    .await
                {
                    Ok(node) => {
                        emit_workspace_node_body_updated_immediate(&self.app_handle, &node);
                        if let Err(e) = state_arc
                            .workspace_manager
                            .write_node_to_vault(&self.app_handle, &node, None)
                            .await
                        {
                            error!("Interview final vault write: {e}");
                        }

                        // Update mirror props with stopped_at_ms.
                        let updated_props = serde_json::json!({
                            "interview_mirror": {
                                "session_id": &meta.session_id,
                                "started_at_ms": meta.started_at_ms,
                                "stopped_at_ms": stopped_at_ms,
                                "mic_path": serde_json::Value::Null,
                                "system_path": serde_json::Value::Null,
                                "participant": &participant,
                            }
                        })
                        .to_string();
                        if let Err(e) = state_arc
                            .workspace_manager
                            .update_node_properties(&ws_doc_id, &updated_props)
                            .await
                        {
                            error!("Interview mirror props update: {e}");
                        }
                    }
                    Err(e) => error!("Interview final persist: {e}"),
                }

                if let Err(e) = state_arc
                    .workspace_manager
                    .finalize_node_search_index(&ws_doc_id)
                    .await
                {
                    error!("Interview finalize_node_search_index: {e}");
                }
            }
            emit_workspace_transcription_synced(&self.app_handle, &ws_doc_id, "interview");
        }

        // Reset worker state.
        *self.state.lock().unwrap() = ParagraphState::default();
        *self.session_started_at.lock().unwrap() = None;
        *self.workspace_doc_id.lock().unwrap() = None;
        *self.participant_name.lock().unwrap() = String::new();
        *self.last_workspace_persist_ms.lock().unwrap() = 0;

        Ok(Some(ws_doc_id))
    }
}
```

- [ ] **Step 5: Add 2 more tests for `render_interview_body` + `format_wall_clock_hhmmss`**

Append to `#[cfg(test)] mod tests` in `interview_worker.rs`:

```rust
    #[test]
    fn format_wall_clock_zero_pads() {
        assert_eq!(super::format_wall_clock_hhmmss(0), "00:00:00");
        assert_eq!(super::format_wall_clock_hhmmss(3_661_000), "01:01:01");
    }

    #[test]
    fn render_interview_body_shape() {
        let merged = vec![
            MergedParagraph {
                speaker: Speaker::You,
                text: "hello".into(),
                chunk_start_offset_ms: 0,
                wall_clock_ms: 0,
            },
            MergedParagraph {
                speaker: Speaker::Other("Alice".into()),
                text: "hi there".into(),
                chunk_start_offset_ms: 1000,
                wall_clock_ms: 1000,
            },
        ];
        let body = super::render_interview_body(&merged, "C:\\mic.wav", "");
        assert!(body.starts_with("::interview_recording{mic_path=\"C:\\\\mic.wav\" system_path=\"\"}"));
        assert!(body.contains("## [00:00:00] You\n\nhello"));
        assert!(body.contains("## [00:00:01] Alice\n\nhi there"));
    }
```

- [ ] **Step 6: Manage the worker in `lib.rs`**

In `src-tauri/src/lib.rs`, near the `InterviewSessionManager::new` registration added in IV-3, append:

```rust
app.manage(Arc::new(
    crate::managers::interview_worker::InterviewTranscriptionWorker::new(&app_handle),
));
```

Adapt variable name (`app_handle` or `app`) to match the existing call style nearby.

- [ ] **Step 7: `cargo check && cargo test --lib`**

Run: `cd src-tauri && cargo check --lib && cargo test --lib`
Expected: zero errors, all 132 tests green (125 + 5 merge + 2 render).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/managers/interview_worker.rs src-tauri/src/lib.rs
git commit -m "feat(interview): InterviewTranscriptionWorker wires mic + system + merge

Two sub-captures (MicChunkedCapture, LoopbackCapture) feed a shared
ParagraphState under a single Mutex (no nested lock). BP-1 offset-ms
captured before spawn. BP-2 in-flight counter + 5s drain on stop.
Live persist every 1s (offset-based HH:MM:SS); final persist at stop
uses the real session_start_ms from InterviewSessionManager."
```

---

## Phase 5: Tauri Commands

### Task IV-6: `start_interview_session` + `stop_interview_session`

**Files:**
- Create: `src-tauri/src/commands/interview.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` (add to `invoke_handler!`)

- [ ] **Step 1: Create `interview.rs`**

Create `src-tauri/src/commands/interview.rs`:

```rust
use crate::managers::audio::AudioRecordingManager;
use crate::managers::interview_session::InterviewSessionManager;
use crate::managers::interview_worker::InterviewTranscriptionWorker;
use crate::managers::system_audio::SystemAudioManager;
use crate::settings::get_settings;
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Type)]
pub struct InterviewStartResult {
    pub workspace_doc_id: String,
    pub started_at_ms: i64,
}

/// Start a new interview session: mic + system audio simultaneously.
/// Rejects if another session (mic transcribe, system audio, or a prior
/// interview) is already active.
#[tauri::command]
#[specta::specta]
pub async fn start_interview_session(
    app: AppHandle,
    participant_name: String,
) -> Result<InterviewStartResult, String> {
    let name = participant_name.trim();
    if name.is_empty() {
        return Err("Participant name is required".to_string());
    }
    if name.eq_ignore_ascii_case("you") {
        return Err("Participant name cannot be 'You'".to_string());
    }

    // Mutual exclusion.
    if let Some(mgr) = app.try_state::<Arc<InterviewSessionManager>>() {
        if mgr.is_active() {
            return Err("An interview session is already running".to_string());
        }
    }
    if app
        .try_state::<Arc<AudioRecordingManager>>()
        .map_or(false, |a| a.is_recording())
    {
        return Err("Stop the active mic transcription first".to_string());
    }
    if app
        .try_state::<Arc<SystemAudioManager>>()
        .map_or(false, |m| m.is_running())
    {
        return Err("Stop the active system-audio capture first".to_string());
    }

    let worker = app
        .try_state::<Arc<InterviewTranscriptionWorker>>()
        .ok_or_else(|| "InterviewTranscriptionWorker not initialized".to_string())?
        .inner()
        .clone();

    let settings = get_settings(&app);
    let max_chunk_secs = settings.system_audio_max_chunk_secs;
    let vad_hangover_secs = settings.system_audio_vad_hangover_secs;

    match worker
        .start(name.to_string(), max_chunk_secs, vad_hangover_secs)
        .await
    {
        Ok((workspace_doc_id, started_at_ms)) => Ok(InterviewStartResult {
            workspace_doc_id,
            started_at_ms,
        }),
        Err(e) => Err(format!("Failed to start interview session: {e}")),
    }
}

/// Stop the active interview session. Returns the workspace doc id
/// (already written) or `None` if no session was active.
#[tauri::command]
#[specta::specta]
pub async fn stop_interview_session(app: AppHandle) -> Result<Option<String>, String> {
    let worker = app
        .try_state::<Arc<InterviewTranscriptionWorker>>()
        .ok_or_else(|| "InterviewTranscriptionWorker not initialized".to_string())?
        .inner()
        .clone();
    worker
        .stop()
        .await
        .map_err(|e| format!("Failed to stop interview session: {e}"))
}

/// Whether an interview session is currently active.
#[tauri::command]
#[specta::specta]
pub fn is_interview_session_active(app: AppHandle) -> Result<bool, String> {
    Ok(app
        .try_state::<Arc<InterviewSessionManager>>()
        .map_or(false, |m| m.is_active()))
}
```

- [ ] **Step 2: Register the module in `src-tauri/src/commands/mod.rs`**

Add:

```rust
pub mod interview;
```

- [ ] **Step 3: Register the commands in `src-tauri/src/lib.rs`**

Locate the `invoke_handler!` block that contains `commands::system_audio::start_system_audio_capture` (around `src-tauri/src/lib.rs:774`). Add the three new commands to the list:

```rust
.invoke_handler(tauri::generate_handler![
    // ...existing commands...
    commands::system_audio::start_system_audio_capture,
    commands::system_audio::stop_system_audio_capture,
    commands::system_audio::is_system_audio_capturing,
    commands::system_audio::get_system_audio_capture_elapsed_secs,
    commands::system_audio::get_render_devices,
    commands::interview::start_interview_session,
    commands::interview::stop_interview_session,
    commands::interview::is_interview_session_active,
    // ...rest...
])
```

Also add them to the specta builder registration (grep for `collect_commands!` in `lib.rs` — the specta bindings generator uses it to emit TypeScript types). Pattern:

```rust
specta_builder.commands(specta::collect_commands![
    // ...existing...
    commands::interview::start_interview_session,
    commands::interview::stop_interview_session,
    commands::interview::is_interview_session_active,
]);
```

- [ ] **Step 4: Run `cargo check` to verify compile + specta**

Run: `cd src-tauri && cargo check --lib`
Expected: zero errors.

- [ ] **Step 5: Regenerate TypeScript bindings**

Run: `cd src-tauri && cargo test --lib` (bindings are written by a #[cfg(test)] hook — typical for specta in this project; confirm by grep for `specta::export` in `lib.rs`).

If the bindings file isn't regenerated automatically, run the project's standard bindings task. Then inspect `src/bindings.ts` to confirm `startInterviewSession`, `stopInterviewSession`, `isInterviewSessionActive` are present.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/interview.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/bindings.ts
git commit -m "feat(interview): start/stop/is-active Tauri commands

start rejects empty/'You' names and any already-active capture session
(mic, system, or prior interview). stop drains + merges + writes doc
via the InterviewTranscriptionWorker."
```

---

## Phase 6: Frontend

### Task IV-7: Extend `SystemAudioView.tsx` with Interview Mode UI

**Files:**
- Modify: `src/components/SystemAudioView.tsx`

**Goal:** Add mode pills, participant-name row, and speaker-accented paragraphs to the existing live feed without restyling anything else. Also fix the 5 edge cases in §4.4 of the spec.

- [ ] **Step 1: Extend types at the top of the file**

Replace the `Line` interface (currently at `src/components/SystemAudioView.tsx:18-23`) with a union:

```typescript
type RecordMode = 'system' | 'interview'

type FeedLine =
  | { kind: 'system'; id: string; ts: string; text: string }
  | { kind: 'you'; id: string; ts: string; text: string }
  | { kind: 'other'; id: string; ts: string; text: string; speaker: string }
```

Delete the old `Line` interface. Update the `paragraphsToLines` helper to return `FeedLine[]` with `kind: 'system'`:

```typescript
function paragraphsToLines(
  note_id: string,
  paragraphs: SystemAudioParagraph[],
): FeedLine[] {
  return paragraphs.map((p, idx) => ({
    kind: 'system' as const,
    id: `${note_id}-${idx}`,
    ts: formatTime(p.timestamp_secs),
    text: p.text,
  }))
}
```

- [ ] **Step 2: Add new state + refs**

Inside the `SystemAudioView` component (top of the function, alongside existing `useState` calls), add:

```typescript
const [mode, setMode] = useState<RecordMode>('system')
const [participantName, setParticipantName] = useState('')
const [nameError, setNameError] = useState<string | null>(null)
const [isTransitioning, setIsTransitioning] = useState(false)
const [streamUnavailable, setStreamUnavailable] = useState(false)
```

The existing `transcript: Line[]` state becomes `FeedLine[]`:

```typescript
const [transcript, setTranscript] = useState<FeedLine[]>([])
```

- [ ] **Step 3: Wire the mode pills above the existing timer row**

Find the existing header block starting with:

```typescript
<div
  style={{
    padding: '24px 32px',
    display: 'flex',
    justifyContent: 'space-between',
```

Insert a new row *above* that one (still inside the `.heros-glass-card` transcript column):

```tsx
<div
  style={{
    padding: '16px 32px 0 32px',
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  }}
>
  {(['system', 'interview'] as const).map((m) => {
    const active = mode === m
    const disabled = isCapturing || isTransitioning
    return (
      <button
        key={m}
        className="heros-btn"
        disabled={disabled}
        onClick={() => !disabled && setMode(m)}
        style={{
          padding: '6px 14px',
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          background: active ? 'var(--heros-brand)' : 'rgba(255,255,255,0.03)',
          color: active ? '#fff' : 'rgba(255,255,255,0.55)',
          border: active
            ? '1px solid var(--heros-brand)'
            : '1px solid rgba(255,255,255,0.08)',
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {m === 'system' ? 'System audio' : 'Interview'}
      </button>
    )
  })}
</div>
```

- [ ] **Step 4: Add the participant-name row (interview mode only)**

Insert below the mode pills row, still above the timer row:

```tsx
{mode === 'interview' && !isCapturing && (
  <div style={{ padding: '8px 32px 0 32px' }}>
    <input
      className="heros-input"
      placeholder="Participant name (e.g. Alice)"
      value={participantName}
      onChange={(e) => {
        setParticipantName(e.currentTarget.value)
        setNameError(null)
      }}
      disabled={isCapturing || isTransitioning}
      style={{
        width: '100%',
        padding: '8px 12px',
        fontSize: 13,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${nameError ? '#ff7a7a' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 8,
        color: '#fff',
        fontFamily: 'inherit',
      }}
    />
    {nameError && (
      <div style={{ color: '#ff7a7a', fontSize: 11, marginTop: 4 }}>
        {nameError}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5: Replace `startCapture` with a mode-aware version**

Replace the existing `startCapture` function (currently at `src/components/SystemAudioView.tsx:372-388`):

```typescript
const startCapture = async () => {
  if (isTransitioning) return
  setIsTransitioning(true)

  if (mode === 'interview') {
    const name = participantName.trim()
    if (!name) {
      setNameError('Participant name is required')
      setIsTransitioning(false)
      return
    }
    if (name.toLowerCase() === 'you') {
      setNameError("Participant name cannot be 'You'")
      setIsTransitioning(false)
      return
    }
  }

  await flushPendingTuning()
  setTranscript([])

  try {
    if (mode === 'system') {
      const result = await commands.startSystemAudioCapture()
      if (result.status !== 'ok') {
        toast.error('Could not start system audio capture', { description: result.error })
        setStreamUnavailable(true)
        return
      }
    } else {
      const result = await commands.startInterviewSession(participantName.trim())
      if (result.status !== 'ok') {
        toast.error('Could not start interview', { description: result.error })
        setStreamUnavailable(true)
        return
      }
    }
    startRef.current = Date.now()
    setIsCapturing(true)
    setStreamUnavailable(false)
  } finally {
    setIsTransitioning(false)
  }
}
```

- [ ] **Step 6: Replace `stopCapture` with a mode-aware version**

```typescript
const stopCapture = async () => {
  if (isTransitioning) return
  setIsTransitioning(true)
  try {
    const result =
      mode === 'system'
        ? await commands.stopSystemAudioCapture()
        : await commands.stopInterviewSession()
    if (result.status !== 'ok') {
      toast.error('Could not stop capture', { description: result.error })
      return
    }
    setIsCapturing(false)
    startRef.current = null
  } finally {
    setIsTransitioning(false)
  }
}
```

- [ ] **Step 7: Subscribe to the interview chunk event (parallel to `system-audio-chunk`)**

Find the `useEffect` that `listen`s for `system-audio-chunk` (around `src/components/SystemAudioView.tsx:349-370`). Replace with a mode-aware subscription:

```typescript
useEffect(() => {
  let unlistenSys: UnlistenFn | undefined
  let unlistenInterview: UnlistenFn | undefined
  let cancelled = false

  const setup = async () => {
    const us = await listen<SystemAudioChunkPayload>('system-audio-chunk', (event) => {
      if (mode !== 'system') return
      const { paragraphs, note_id } = event.payload
      setTranscript(paragraphsToLines(note_id, paragraphs))
    })
    const ui = await listen<InterviewChunkPayload>('interview-chunk', (event) => {
      if (mode !== 'interview') return
      setTranscript(interviewPayloadToLines(event.payload))
    })
    if (cancelled) {
      us()
      ui()
      return
    }
    unlistenSys = us
    unlistenInterview = ui
  }

  void setup()
  return () => {
    cancelled = true
    unlistenSys?.()
    unlistenInterview?.()
  }
}, [mode])
```

Then add the type + helper above the component function:

```typescript
interface InterviewChunkPayload {
  paragraphs: Array<{
    speaker: 'You' | 'Other'
    participant?: string
    text: string
    wall_clock_ms: number
  }>
  workspace_doc_id: string
}

function interviewPayloadToLines(payload: InterviewChunkPayload): FeedLine[] {
  return payload.paragraphs.map((p, idx) => {
    const ts = formatTime(Math.floor(p.wall_clock_ms / 1000))
    if (p.speaker === 'You') {
      return { kind: 'you', id: `${payload.workspace_doc_id}-${idx}`, ts, text: p.text }
    }
    return {
      kind: 'other',
      id: `${payload.workspace_doc_id}-${idx}`,
      ts,
      text: p.text,
      speaker: p.participant ?? 'Other',
    }
  })
}
```

**Note:** the backend helper `persist_live_body` does not currently emit `interview-chunk`. Add it: at the end of `persist_live_body` in `src-tauri/src/managers/interview_worker.rs` (before the `match` closes on success), emit a per-chunk payload. Appending here keeps the plan self-contained without a separate task:

```rust
// At the top of interview_worker.rs, add a serde-ready payload type:
#[derive(Clone, serde::Serialize)]
pub struct InterviewChunkPayload {
    pub paragraphs: Vec<InterviewChunkParagraph>,
    pub workspace_doc_id: String,
}
#[derive(Clone, serde::Serialize)]
pub struct InterviewChunkParagraph {
    pub speaker: String, // "You" or "Other"
    pub participant: Option<String>,
    pub text: String,
    pub wall_clock_ms: u64,
}
```

Inside `persist_live_body`, after the successful `update_node_body_persist_only` call, emit:

```rust
let chunks = merged
    .iter()
    .map(|p| InterviewChunkParagraph {
        speaker: match &p.speaker {
            Speaker::You => "You".to_string(),
            Speaker::Other(_) => "Other".to_string(),
        },
        participant: match &p.speaker {
            Speaker::You => None,
            Speaker::Other(n) => Some(n.clone()),
        },
        text: p.text.clone(),
        wall_clock_ms: p.wall_clock_ms,
    })
    .collect::<Vec<_>>();
let _ = app.emit(
    "interview-chunk",
    InterviewChunkPayload {
        paragraphs: chunks,
        workspace_doc_id: ws_id.clone(),
    },
);
```

- [ ] **Step 8: Render each `FeedLine` with speaker-colored accent**

Find the existing `transcript.map((line) => ( ... ))` JSX (around `src/components/SystemAudioView.tsx:491-540`). Replace the single render block with a mode-aware one:

```tsx
{transcript.map((line) => {
  const accentColor =
    line.kind === 'you'
      ? '#3eb8ff'
      : line.kind === 'other'
        ? 'var(--heros-brand)'
        : 'rgba(62,184,255,0.6)'
  const speakerLabel =
    line.kind === 'you'
      ? 'You'
      : line.kind === 'other'
        ? line.speaker
        : 'System Audio'

  return (
    <motion.div
      key={line.id}
      layout="position"
      initial={{ opacity: 0, y: 6, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{
        opacity: { duration: 0.42, ease: [0.16, 1, 0.3, 1] },
        y: { duration: 0.46, ease: [0.16, 1, 0.3, 1] },
        filter: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
        layout: { duration: 0.42, ease: [0.16, 1, 0.3, 1] },
      }}
      style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 20 }}
    >
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: '11px',
          color: 'rgba(255,255,255,0.3)',
          paddingTop: 4,
        }}
      >
        {line.ts}
      </div>
      <div
        style={{
          borderLeft:
            line.kind === 'system'
              ? 'none'
              : `2px solid ${accentColor}`,
          paddingLeft: line.kind === 'system' ? 0 : 12,
        }}
      >
        <div
          style={{
            fontSize: '10px',
            fontWeight: 800,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: accentColor,
            marginBottom: 6,
          }}
        >
          {speakerLabel}
        </div>
        <div
          style={{
            fontSize: '16px',
            lineHeight: 1.6,
            fontWeight: 300,
            color: 'rgba(255,255,255,0.85)',
          }}
        >
          {line.text}
        </div>
      </div>
    </motion.div>
  )
})}
```

- [ ] **Step 9: Gate the big round button + disable sliders on `streamUnavailable`**

The record button is at `src/components/SystemAudioView.tsx:599-622`. Add `disabled={isTransitioning || streamUnavailable}` and adjust the opacity/cursor styles:

```tsx
<button
  onClick={() => void (isCapturing ? stopCapture() : startCapture())}
  disabled={isTransitioning || streamUnavailable}
  style={{
    width: 80,
    height: 80,
    borderRadius: '50%',
    background: isCapturing ? '#3eb8ff' : '#fff',
    color: isCapturing ? '#fff' : '#1a4f6b',
    border: 'none',
    cursor: isTransitioning || streamUnavailable ? 'not-allowed' : 'pointer',
    opacity: isTransitioning || streamUnavailable ? 0.5 : 1,
    // ...rest unchanged...
  }}
>
```

In the three `<SystemAudioTuningSlider>` call sites (around line 716-745), pass a `disabled` prop… actually the component doesn't accept `disabled`. Extend it:

Add `disabled?: boolean` to the component signature (around line 100):

```typescript
function SystemAudioTuningSlider({
  label,
  description,
  value,
  defaultValue,
  settingKey,
  isCapturing,
  live,
  onChange,
  disabled,
}: {
  // ...existing...
  disabled?: boolean
}) {
```

And on the `<input type="range">` (around line 138), pass `disabled={disabled}`. Then at each call site, pass `disabled={streamUnavailable}`.

- [ ] **Step 10: Cancel the tuning debounce on unmount (edge case 2)**

Verify that the existing cleanup in the settings-loading `useEffect` (currently at lines 308-313) already cancels `debounceRef`. It does. No change needed for this edge case.

- [ ] **Step 11: `requestAnimationFrame` wrapper for auto-scroll (edge case 5)**

Change the scroll `useEffect` (currently at `src/components/SystemAudioView.tsx:328-335`):

```typescript
useEffect(() => {
  if (!scrollRef.current) return
  const el = scrollRef.current
  const frame = requestAnimationFrame(() => {
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  })
  return () => cancelAnimationFrame(frame)
}, [transcript])
```

- [ ] **Step 12: Snapshot hydration on remount (edge case 1)**

Extend the existing `init()` effect (currently at lines 270-283) to also re-subscribe for interview mode:

```typescript
useEffect(() => {
  const init = async () => {
    const sys = await commands.isSystemAudioCapturing()
    if (sys.status === 'ok' && sys.data) {
      setMode('system')
      setIsCapturing(true)
      const elapsed = await commands.getSystemAudioCaptureElapsedSecs()
      if (elapsed.status === 'ok' && elapsed.data != null) {
        setTimer(Math.floor(elapsed.data))
        startRef.current = Date.now() - elapsed.data * 1000
      }
      return
    }
    const iv = await commands.isInterviewSessionActive()
    if (iv.status === 'ok' && iv.data) {
      setMode('interview')
      setIsCapturing(true)
      // Interview elapsed is reconstructed from the next interview-chunk
      // event arrival; start timer from 0 and let the local interval tick.
      startRef.current = Date.now()
    }
  }
  void init()
}, [])
```

- [ ] **Step 13: `bun run build` (typecheck)**

Run: `bun run build`
Expected: zero new errors. If specta types haven't been regenerated, re-run the bindings step from IV-6.

- [ ] **Step 14: `bunx vitest run`**

Run: `bunx vitest run`
Expected: all existing tests green (no new frontend tests required — this surface is verified manually per DoD item #3).

- [ ] **Step 15: Manual verification in `bun run tauri dev`**

Run: `bun run tauri dev`

Walk-through:
1. Navigate to System Audio view.
2. Confirm "System audio" pill is active, "Interview" pill is visible.
3. Click "Interview" → name input row appears.
4. Leave blank → click record → inline error "Participant name is required".
5. Type "You" → click record → inline error "Participant name cannot be 'You'".
6. Type "Alice" → click record → mic + system capture start, record button switches to square.
7. Speak a sentence; play audio from another app (YouTube).
8. Confirm paragraphs appear with "You" blue-accent and "Alice" terracotta-accent interleaved by time.
9. Click stop → confirm no error, transcript stays visible.
10. Open workspace tree → `Interviews/Interview — YYYY-MM-DD HH-MM-SS` doc exists, body contains frontmatter + `::interview_recording` + merged `## [HH:MM:SS] You` / `## [HH:MM:SS] Alice` blocks.

- [ ] **Step 16: Commit**

```bash
git add src/components/SystemAudioView.tsx src-tauri/src/managers/interview_worker.rs
git commit -m "feat(interview): SystemAudioView mode pills, name row, speaker accents

Adds Interview mode toggle + participant-name input + speaker-colored
live feed without restyling anything else. Backend emits interview-chunk
events mirroring system-audio-chunk shape. Fixes 5 edge cases:
snapshot hydration on remount, debounce-cleanup-on-unmount,
double-click race, sliders gated on streamUnavailable,
requestAnimationFrame-wrapped auto-scroll."
```

---

## Phase 7: End-to-end verification

### Task IV-8: Integration smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Fresh `bun run tauri dev` run**

Close any previous instance. Re-run `bun run tauri dev`.

- [ ] **Step 2: Back-port regression check**

In System Audio mode (not Interview):
1. Record for ~30 seconds with a podcast playing.
2. Click stop.
3. Confirm NO new "Media Recording" doc appears in the workspace tree alongside today's intended doc (BP-2 verified).
4. Confirm paragraphs appear in chronological order, no interleaved out-of-order timestamps (BP-1 verified).

- [ ] **Step 3: Interview flow**

1. Switch to Interview mode, name "Alice".
2. Record ~60 seconds while speaking AND playing audio.
3. Stop.
4. Confirm `Interviews/Interview — YYYY-MM-DD HH-MM-SS.md` exists in `<vault>/Interviews/`.
5. Open the file on disk — confirm:
   - Frontmatter has `mode: interview`, `session_id`, `started_at_ms`, `stopped_at_ms`, `participants: [You, Alice]`.
   - Body begins with `::interview_recording{mic_path="" system_path=""}`.
   - Headings are `## [HH:MM:SS] You` and `## [HH:MM:SS] Alice`, interleaved by timestamp.

- [ ] **Step 4: Mutual exclusion check**

1. Start an interview session.
2. Attempt to use mic dictation (Cmd/Ctrl+Space or the AudioView record button).
3. Confirm the mic dictation request is rejected (or visibly no-ops with a toast).
4. Stop the interview.
5. Confirm mic dictation works again afterward.

- [ ] **Step 5: Rule 16 death-restart check (optional, destructive)**

Not required for v1 DoD — Rule 16's sentinel restart-once is implicit in the ORT session integration tested in Phase A. The interview worker inherits this via `TranscriptionManager::transcribe()`.

- [ ] **Step 6: Commit the smoke-test log as a note (optional)**

If any manual-test observation reveals a real defect, file it as a follow-up task — do NOT fix inline without a new plan.

---

## Self-Review Completed

**1. Spec coverage:**
- §1.1 BP-1/BP-2/BP-3 → Tasks BP-1, BP-2, BP-3 ✓
- §1.2 file structure → IV-1, IV-3, IV-4, IV-5, IV-6 ✓
- §2.1 workspace doc format → IV-5 (`render_interview_body`) + IV-6 frontmatter ✓
- §2.2 interview_mirror props → IV-5 (`start`, `stop`) ✓
- §2.3 `merge_paragraphs` signature → IV-2 ✓
- §3.1 Rule 16 worker → IV-5 ✓
- §3.2 ParagraphState single Mutex → IV-5 ✓
- §3.3 stop-drain → IV-5 step 4 ✓
- §4.1 new state → IV-7 step 2 ✓
- §4.2 FeedLine union → IV-7 step 1 ✓
- §4.3 UI additions → IV-7 steps 3, 4, 8 ✓
- §4.4 edge cases → IV-7 steps 9, 10, 11, 12 + double-click race in steps 5+6 via `isTransitioning` ✓
- §5.3 TDD targets → IV-2 5 tests + IV-5 step 5 2 extra tests ✓
- §7 DoD #3 end-to-end → IV-8 ✓

**2. Placeholder scan:** No `TBD`, `TODO`, or "implement later" in any step. Every code step shows the code.

**3. Type consistency:** `merge_paragraphs(mic, system, session_start_ms, participant_name)` signature matches across IV-2 (definition), IV-5 step 4 (call site in `stop`), and `persist_live_body` (call site in IV-5 step 3). `Speaker::You / Speaker::Other(String)` used uniformly. `RawParagraph.chunk_start_offset_ms` / `MergedParagraph.wall_clock_ms` consistent. Frontend `FeedLine` kind `'system' | 'you' | 'other'` matches backend emit-payload mapping in IV-7 step 7 helper.

One intentional carve-out noted: `persist_live_body` passes `session_start_unix_ms = 0` (offset-based HH:MM:SS) during live streaming; the final `stop` pass uses real `started_at_ms`. This is called out in the IV-5 step 3 note.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-23-interview-mode.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
