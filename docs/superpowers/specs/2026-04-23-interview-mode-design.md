# Interview Mode Design — 2026-04-23

## Overview

Extend `SystemAudioView` with an **Interview Mode** toggle that captures mic + system-audio loopback simultaneously, transcribes both streams with separate Whisper sessions, merges the paragraph feed by wall-clock offset, and writes a combined markdown doc per session under an **Interviews/** workspace folder. Speaker attribution uses "You" (mic) and the user-supplied participant name (system audio). The UI reuses the existing SystemAudioView aesthetic exactly — only three additions: mode pills, a name-input row, and speaker accent colors in the live feed.

This spec also covers back-port stability fixes to the existing mic-transcribe and system-audio pipelines that were discovered during the interview-mode review.

---

## 1. Architecture

### 1.1 Back-ports (ship first)

Three fixes applied to existing paths before any new code lands:

**BP-1 — VAD-cut timestamp captured pre-transcribe**
`src-tauri/src/managers/system_audio.rs`: the VAD callback must snapshot `chunk_start_offset_ms = session_start_elapsed_ms` *before* queuing the audio buffer to the transcription worker. Currently the offset is captured post-transcribe, which produces out-of-order paragraphs when two short chunks race.

**BP-2 — Stop-drain protocol**
`stop_loopback` must await all in-flight spawned transcribe tasks before clearing session state. Timeout: 5 s. Without this, tasks completing after the session pointer is cleared write paragraphs to a stale or newly-created "Media Recording" doc (phantom doc bug).

**BP-3 — Whisper min-chunk guard + fail-fast + empty-session guard**
- `WHISPER_MIN_CHUNK_SECS = 0.5` constant in `managers/transcription.rs` — VAD must not queue buffers shorter than this; Whisper returns garbage on sub-half-second audio.
- Fail-fast on model unavailable: surface `streamUnavailable` state in the frontend immediately rather than silently queuing.
- Empty-session guard: do not emit `workspace-transcription-synced` or write a workspace doc when the merged paragraph list is empty.

### 1.2 New components

```
src-tauri/src/
  managers/
    interview_session.rs         # InterviewSessionManager (mirrors VoiceSessionManager)
    interview_worker.rs          # InterviewTranscriptionWorker (Rule 16 thread)
  transcription_workspace.rs     # +INTERVIEWS_FOLDER constant
  commands/
    audio.rs                     # +start_interview_session, stop_interview_session commands

src/components/
  SystemAudioView.tsx            # extended in-place (mode pills, name row, speaker colors)
```

No new top-level files in `src/components/`. No new Zustand stores (Rule 2).

---

## 2. Data Model

### 2.1 Workspace document

**Location**: `Interviews/Interview — YYYY-MM-DD HH-MM-SS.md`

**Frontmatter**:
```yaml
---
mode: interview
session_id: <uuid>
started_at_ms: <unix_ms>
stopped_at_ms: <unix_ms>
participants:
  - You
  - <participant_name>
---
```

**Body** (one block per merged paragraph, ordered by wall-clock offset):
```markdown
::interview_recording{mic_path="<abs_path_or_empty>" system_path="<abs_path_or_empty>"}

## [HH:MM:SS] You

Paragraph text from mic stream.

## [HH:MM:SS] Alice

Paragraph text from system audio stream.
```

Timestamps are wall-clock: `session_start_ms + chunk_start_offset_ms` → formatted as `HH:MM:SS`.

### 2.2 Workspace node properties

```json
{
  "interview_mirror": {
    "session_id": "<uuid>",
    "started_at_ms": <ms>,
    "stopped_at_ms": <ms>,
    "mic_path": "<path|null>",
    "system_path": "<path|null>",
    "participant": "<name>"
  }
}
```

Mirrors the `voice_memo_mirror` pattern from `VoiceSessionManager`.

### 2.3 Paragraph merge

```rust
pub struct MergedParagraph {
    pub speaker: Speaker,            // You | Other(name)
    pub text: String,
    pub chunk_start_offset_ms: u64,
    pub wall_clock_ms: u64,          // session_start_ms + chunk_start_offset_ms
}

pub fn merge_paragraphs(
    mic: &[RawParagraph],
    system: &[RawParagraph],
    session_start_ms: u64,
    participant_name: &str,
) -> Vec<MergedParagraph>
```

Sort: stable-sort by `chunk_start_offset_ms` ascending. Tiebreak: You before Other. Both inputs carry `chunk_start_offset_ms` captured at VAD-cut time (BP-1).

---

## 3. Concurrency

### 3.1 InterviewTranscriptionWorker (Rule 16)

- One dedicated `std::thread::spawn` worker thread; communicates via `crossbeam_channel::bounded(16)`.
- Internal state: two sub-workers (mic half, system half), each a `crossbeam_channel::bounded(8)` queue draining to separate `ort::Session` instances (Rule 16a: independent Session per stream).
- Sentinel restart-once: heartbeat monitored at 30 s; on death respawn once; second death → emit `interview-unavailable`, fall back to standard System Audio mode.
- Intra-op thread cap: `num_cpus::get() / 2` per ORT session (Rule 16a — two sessions share CPU).
- During active interview session: existing `TranscriptionManager` must not start a third ORT session (lock: check `transcription_session_holds_model()` before allowing mic-transcribe or system-audio starts).

### 3.2 ParagraphState

Single `Arc<Mutex<ParagraphState>>` shared between mic and system halves. No nested lock acquisition — eliminates deadlock. Structure:

```rust
struct ParagraphState {
    mic_paragraphs: Vec<RawParagraph>,
    system_paragraphs: Vec<RawParagraph>,
    session_start_ms: u64,
}
```

### 3.3 Stop-drain protocol

`stop_interview_session` command:
1. Signal both sub-workers to stop accepting new audio.
2. `tokio::time::timeout(5s, drain_in_flight_tasks())`.
3. On timeout: log warning, proceed with partial results (do not deadlock).
4. Call `merge_paragraphs()`, write workspace doc, emit `workspace-transcription-synced` (source: `"interview"`).
5. Clear session state, tear down ORT sessions.

---

## 4. Frontend Shape

### 4.1 State additions to `SystemAudioView.tsx`

```typescript
type RecordMode = 'system' | 'interview'

const [mode, setMode] = useState<RecordMode>('system')
const [participantName, setParticipantName] = useState('')
const [nameError, setNameError] = useState<string | null>(null)
const [isTransitioning, setIsTransitioning] = useState(false)
const [isFinalizing, setIsFinalizing] = useState(false)
const [justFinished, setJustFinished] = useState(false)
const [streamUnavailable, setStreamUnavailable] = useState(false)
```

No other existing state is removed or renamed.

### 4.2 Line type union

```typescript
type FeedLine =
  | { kind: 'system'; text: string; ts: number }
  | { kind: 'you'; text: string; ts: number }
  | { kind: 'other'; speaker: string; text: string; ts: number }
```

### 4.3 UI additions (existing SystemAudioView aesthetic)

Three additions only — no redesign:

1. **Mode pills** (top, above recording controls): `System Audio` | `Interview` segmented control using existing `.heros-btn` + active state via `var(--heros-brand)`.
2. **Name-input row** (visible only when `mode === 'interview'` and not recording): `<HerOSInput>` placeholder "Participant name", inline error if blank or "You" (case-insensitive). Disabled while recording.
3. **Speaker accent** in live feed:
   - "You" paragraphs: `#3eb8ff` left border + label (existing blue accent already used for system-audio).
   - Other paragraphs: `var(--heros-brand)` (terracotta) left border + participant name label.
   - System-only mode: unchanged (no speaker label, no accent border).

All colors via CSS tokens or existing project constants — no new hardcoded literals (Rule 12 carve-out: `#3eb8ff` is already used in SystemAudioView for the existing accent).

### 4.4 Edge cases fixed in existing SystemAudioView

- **No snapshot hydration on remount**: on mount, if `isRecording` is already true in backend state, re-subscribe to live events and restore `lines` from any buffered chunks.
- **Tuning debounce dropped on unmount**: cancel the debounce timer in the cleanup function.
- **Double-click race on start/stop**: `isTransitioning` flag gates the button; set true on click, clear on command resolve or error.
- **Sliders editable on load failure**: disable chunk-size and overlap sliders when `streamUnavailable`.
- **Scroll jank**: use `requestAnimationFrame` wrapper around the auto-scroll `scrollIntoView` call.

---

## 5. Build Order and TDD

### 5.1 Back-ports (BP-1 → BP-3)

Apply and verify before any interview code. Each fix is one targeted edit — no new tests needed beyond confirming existing `cargo test --lib` stays green.

### 5.2 Interview Mode tasks

| # | Layer | Deliverable |
|---|---|---|
| IV-1 | Rust | `InterviewSessionManager` + `INTERVIEWS_FOLDER` constant |
| IV-2 | Rust (TDD) | `merge_paragraphs` pure fn + 5 unit tests (see below) |
| IV-3 | Rust | `InterviewTranscriptionWorker` (Rule 16 thread + sentinel) |
| IV-4 | Rust | `start_interview_session` + `stop_interview_session` Tauri commands; workspace write |
| IV-5 | Frontend | Extend `SystemAudioView.tsx` with mode pills, name input, speaker colors, edge-case fixes |
| IV-6 | Integration | End-to-end smoke: start → speak → stop → verify Interviews/ doc in workspace |

### 5.3 TDD targets for `merge_paragraphs`

```
merge_paragraphs_interleaved    → You@0ms, Other@500ms → [You, Other]
merge_paragraphs_tiebreak       → You@500ms, Other@500ms → [You, Other]
merge_paragraphs_empty_mic      → only Other chunks → [Other, Other, ...]
merge_paragraphs_empty_system   → only You chunks → [You, You, ...]
merge_paragraphs_empty_both     → [] → []
```

Tests live in `src-tauri/src/managers/interview_worker.rs` as `#[cfg(test)]` inline — no separate test file needed.

---

## 6. Out of Scope

- Speaker diarization (same-mic, multiple humans) — deferred per CLAUDE.md
- Auto-translation of transcripts — deferred until W6
- AI auto-edits / filler removal — deferred until W6
- Separate Interview view / page — not needed; Interview Mode lives inside SystemAudioView
- eBay wiring — never
- Custom interview-mode visual theme — explicitly declined; reuse existing SystemAudioView aesthetic

---

## 7. Definition of Done

1. `bun run build` zero new errors.
2. `bunx vitest run` + `cargo test --lib` green; all 5 `merge_paragraphs` tests pass; no regressions.
3. Feature works end-to-end in `bun run tauri dev`: start interview session → speak both streams → stop → Interviews/ doc present in workspace tree with correct frontmatter, directive, and merged paragraphs in timestamp order.
4. Back-ports verified: no phantom docs on stop, paragraphs ordered correctly in system-audio-only mode.
5. All new Rust code follows Rule 16 (dedicated thread) and Rule 16a (independent ORT sessions, intra-op thread cap).
6. No hardcoded color / radius / shadow literals in new frontend code (Rule 12).
7. `isTransitioning` prevents double-click race; sliders disabled on `streamUnavailable`.
