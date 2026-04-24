use crate::audio_toolkit::audio::loopback::{ChunkTrigger, LoopbackCapture};
// NotesManager import retired in Phase A Commit 3. System audio sessions
// now write exclusively to workspace_nodes (see `workspace_session_doc_id`
// below). The legacy `current_note_id` field is preserved as a session
// identifier but populated with a UUID rather than a Note row id.
use crate::managers::transcription::TranscriptionManager;
use crate::managers::workspace::AppState;
use crate::transcription_workspace::{
    emit_workspace_node_body_updated_immediate, emit_workspace_node_body_updated_throttled,
    WorkspaceTranscriptionSyncedPayload, SYSTEM_AUDIO_FOLDER,
};
use anyhow::Result;
use chrono::Local;
use log::error;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicU32, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// Default wall-clock gap between delivered chunks to start a new timestamped
/// paragraph (tunable via settings at runtime).
pub const PARAGRAPH_SILENCE_THRESHOLD_SECS: f32 = 1.5;

/// Short Whisper fragments (below this many words) merge into the previous paragraph.
const SHORT_CHUNK_MAX_WORDS: usize = 4;

const WORKSPACE_PERSIST_INTERVAL_MS: u64 = 1000;

fn secs_to_bits(secs: f32) -> u32 {
    secs.clamp(0.5, 10.0).to_bits()
}

fn secs_from_bits(bits: u32) -> f32 {
    f32::from_bits(bits).clamp(0.5, 10.0)
}

#[derive(Serialize, Clone, Debug)]
pub struct SystemAudioParagraph {
    pub timestamp_secs: u64,
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct SystemAudioChunkPayload {
    pub paragraphs: Vec<SystemAudioParagraph>,
    /// Full markdown with `[MM:SS]` lines; same as legacy flat field for consumers.
    pub rendered_text: String,
    pub accumulated_text: String,
    pub note_id: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn word_count(s: &str) -> usize {
    s.split_whitespace().count()
}

fn render_paragraphs_markdown(paragraphs: &[SystemAudioParagraph]) -> String {
    paragraphs
        .iter()
        .map(|p| {
            let mm = p.timestamp_secs / 60;
            let ss = p.timestamp_secs % 60;
            format!("[{:02}:{:02}] {}", mm, ss, p.text.trim())
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Heuristic text joiner for speech chunks within the same paragraph (Option A).
///
/// - Existing ends with punctuation (.!?…) → space (sentence already closed)
/// - VAD-triggered chunk + new starts uppercase → ". " (implied sentence break)
/// - Otherwise → space (mid-sentence or timer-flush continuation)
fn join_chunks(existing: &str, new_chunk: &str, is_natural_pause: bool) -> String {
    let existing = existing.trim_end();
    let new = new_chunk.trim();

    if existing.is_empty() {
        return new.to_string();
    }
    if new.is_empty() {
        return existing.to_string();
    }

    let already_closed = matches!(existing.chars().last(), Some('.' | '!' | '?' | '…'));

    if already_closed {
        format!("{existing} {new}")
    } else if is_natural_pause && new.chars().next().map_or(false, |c| c.is_uppercase()) {
        format!("{existing}. {new}")
    } else {
        format!("{existing} {new}")
    }
}

pub struct SystemAudioManager {
    app_handle: AppHandle,
    capture: Arc<Mutex<Option<LoopbackCapture>>>,
    /// ID of the note created at session start. None between sessions.
    current_note_id: Arc<Mutex<Option<String>>>,
    /// Title of the current session note, stored in memory to avoid a DB
    /// round-trip on every chunk and on stop.
    current_note_title: Arc<Mutex<String>>,
    /// Timestamped paragraphs for the active session (markdown via `render_paragraphs_markdown`).
    paragraphs: Arc<Mutex<Vec<SystemAudioParagraph>>>,
    session_started_at: Arc<Mutex<Option<Instant>>>,
    last_chunk_ended_at: Arc<Mutex<Option<Instant>>>,
    /// Workspace child document under "System Audio" for this session.
    workspace_session_doc_id: Arc<Mutex<Option<String>>>,
    last_workspace_persist_ms: Arc<Mutex<u64>>,
    paragraph_silence_secs: Arc<AtomicU32>,
    /// BP-2: count of spawned transcribe tasks that haven't finished yet.
    /// stop_loopback polls this to avoid clearing session state while a
    /// late task is still writing to the workspace doc.
    in_flight_chunks: Arc<AtomicUsize>,
}

impl SystemAudioManager {
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

    /// Start loopback capture.
    ///
    /// `max_chunk_secs`: force-flush the speech buffer when it reaches this
    /// duration even if VAD has not yet detected silence.
    /// `vad_hangover_secs`: trailing silence after speech before a VAD chunk is emitted.
    /// `paragraph_silence_secs`: wall-clock gap between chunk completions to start a new paragraph.
    pub async fn start_loopback(
        &self,
        max_chunk_secs: f32,
        vad_hangover_secs: f32,
        paragraph_silence_secs: f32,
    ) -> Result<()> {
        {
            let mut paras = self.paragraphs.lock().unwrap();
            paras.clear();
        }
        *self.session_started_at.lock().unwrap() = Some(Instant::now());
        *self.last_chunk_ended_at.lock().unwrap() = None;
        self.set_paragraph_silence_secs(paragraph_silence_secs);

        let app = self.app_handle.clone();
        let current_note_id = Arc::clone(&self.current_note_id);
        let current_note_title = Arc::clone(&self.current_note_title);
        let paragraphs = Arc::clone(&self.paragraphs);
        let session_started_at = Arc::clone(&self.session_started_at);
        let last_chunk_ended_at = Arc::clone(&self.last_chunk_ended_at);
        let workspace_session_doc_id = Arc::clone(&self.workspace_session_doc_id);
        let last_workspace_persist_ms = Arc::clone(&self.last_workspace_persist_ms);
        let paragraph_silence_secs = Arc::clone(&self.paragraph_silence_secs);
        let in_flight_chunks = Arc::clone(&self.in_flight_chunks);

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
            let in_flight_chunks = Arc::clone(&in_flight_chunks);

            // BP-1: snapshot VAD-cut wall-clock offset BEFORE spawning, so paragraph
            // ordering tracks the audio cut time — not whenever Whisper happens to
            // return. `transcribe()` can take 200-500ms and two short chunks can race.
            let chunk_start_offset_ms: u64 = {
                let session = session_started_at.lock().unwrap();
                match *session {
                    Some(start) => start.elapsed().as_millis() as u64,
                    None => return,
                }
            };

            // BP-2: increment before spawn so the task is guaranteed-counted even if
            // spawn scheduling is delayed.
            in_flight_chunks.fetch_add(1, Ordering::SeqCst);

            tauri::async_runtime::spawn(async move {
                // BP-2: RAII — decrement on task exit (return, early return, or panic).
                struct DoneGuard(Arc<AtomicUsize>);
                impl Drop for DoneGuard {
                    fn drop(&mut self) {
                        self.0.fetch_sub(1, Ordering::SeqCst);
                    }
                }
                let _done = DoneGuard(in_flight_chunks);

                // ── Transcribe ────────────────────────────────────────────────
                let transcription_manager = app.state::<Arc<TranscriptionManager>>();
                let transcribed = match transcription_manager.transcribe(audio) {
                    Ok(text) => text,
                    Err(e) => {
                        error!("Failed to transcribe system audio chunk: {e}");
                        return;
                    }
                };

                let trimmed = transcribed.trim().to_string();
                if trimmed.is_empty() {
                    return;
                }

                // ── Create note on first chunk ────────────────────────────────
                let note_id = {
                    let guard = current_note_id.lock().unwrap();
                    guard.clone()
                };

                let note_id = match note_id {
                    Some(id) => id,
                    None => {
                        // Synthetic session id — preserves the event shape
                        // but no longer creates a Note row. The workspace
                        // doc (created below) is the real storage.
                        let title = format!(
                            "Media Recording — {}",
                            Local::now().format("%I:%M %p %a %d")
                        );
                        let id = uuid::Uuid::new_v4().to_string();
                        *current_note_id.lock().unwrap() = Some(id.clone());
                        *current_note_title.lock().unwrap() = title;
                        id
                    }
                };

                let is_natural_pause = matches!(trigger, ChunkTrigger::Vad);
                let now = Instant::now();
                let gap = {
                    let last = last_chunk_ended_at.lock().unwrap();
                    last.map(|t| now.duration_since(t))
                };
                let paragraph_silence_secs =
                    secs_from_bits(paragraph_silence_secs.load(Ordering::Relaxed));
                let new_paragraph = gap.is_some_and(|g| g.as_secs_f32() >= paragraph_silence_secs);

                let wc = word_count(&trimmed);

                // ── Merge into paragraph list ─────────────────────────────────
                let rendered = {
                    // BP-1: use captured VAD-cut offset, not post-transcribe elapsed.
                    let elapsed_secs = chunk_start_offset_ms / 1000;

                    let mut paras = paragraphs.lock().unwrap();

                    if paras.is_empty() {
                        paras.push(SystemAudioParagraph {
                            timestamp_secs: 0,
                            text: trimmed.clone(),
                        });
                    } else if new_paragraph && wc >= SHORT_CHUNK_MAX_WORDS {
                        paras.push(SystemAudioParagraph {
                            timestamp_secs: elapsed_secs,
                            text: trimmed.clone(),
                        });
                    } else if new_paragraph && wc < SHORT_CHUNK_MAX_WORDS {
                        if let Some(last) = paras.last_mut() {
                            last.text = join_chunks(&last.text, &trimmed, is_natural_pause);
                        }
                    } else if let Some(last) = paras.last_mut() {
                        last.text = join_chunks(&last.text, &trimmed, is_natural_pause);
                    }

                    let out = render_paragraphs_markdown(&paras);
                    *last_chunk_ended_at.lock().unwrap() = Some(Instant::now());
                    out
                };

                let payload_paras = paragraphs.lock().unwrap().clone();

                // ── Workspace mirror (folder + child doc, throttled persist) ─
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    let ws_mgr = &state.workspace_manager;
                    let needs_child = workspace_session_doc_id.lock().unwrap().is_none();
                    if needs_child {
                        if let Ok(folder_id) = ws_mgr
                            .ensure_transcription_folder(&app, SYSTEM_AUDIO_FOLDER)
                            .await
                        {
                            let title = current_note_title.lock().unwrap().clone();
                            match ws_mgr
                                .create_document_child(&folder_id, &title, "🎧", "")
                                .await
                            {
                                Ok(doc) => {
                                    *workspace_session_doc_id.lock().unwrap() =
                                        Some(doc.id.clone());
                                    *last_workspace_persist_ms.lock().unwrap() = now_ms();

                                    // Initial vault write for the new session document
                                    if let Err(e) =
                                        ws_mgr.write_node_to_vault(&app, &doc, None).await
                                    {
                                        error!("Failed to write initial system audio doc {} to vault: {}", doc.id, e);
                                    }

                                    let _ = app.emit(
                                        "workspace-transcription-synced",
                                        WorkspaceTranscriptionSyncedPayload {
                                            node_id: doc.id.clone(),
                                            // Distinct from voice_memo: frontend skips auto-jump to Workspace
                                            // while the user stays on System Audio (note + mirror still update).
                                            source: "system_audio".to_string(),
                                        },
                                    );
                                }
                                Err(e) => error!("System audio workspace child: {e}"),
                            }
                        }
                    }

                    let ws_id = workspace_session_doc_id.lock().unwrap().clone();
                    if let Some(ws_id) = ws_id {
                        let t = now_ms();
                        let should_persist = {
                            let mut last = last_workspace_persist_ms.lock().unwrap();
                            if t.saturating_sub(*last) >= WORKSPACE_PERSIST_INTERVAL_MS {
                                *last = t;
                                true
                            } else {
                                false
                            }
                        };
                        if should_persist {
                            match ws_mgr
                                .update_node_body_persist_only(&ws_id, &rendered)
                                .await
                            {
                                Ok(node) => {
                                    emit_workspace_node_body_updated_throttled(&app, &node);

                                    // Mirror to vault
                                    match ws_mgr.write_node_to_vault(&app, &node, None).await {
                                        Ok(rel_path) => {
                                            if let Err(e) = ws_mgr
                                                .update_vault_rel_path(&node.id, &rel_path)
                                                .await
                                            {
                                                error!("Failed to update vault_rel_path for system audio doc {}: {}", node.id, e);
                                            }
                                        }
                                        Err(e) => {
                                            error!(
                                                "Failed to write system audio doc {} to vault: {}",
                                                node.id, e
                                            );
                                        }
                                    }
                                }
                                Err(e) => error!("System audio workspace persist: {e}"),
                            }
                        }
                    }
                }

                // ── Emit live view event ──────────────────────────────────────
                if let Err(e) = app.emit(
                    "system-audio-chunk",
                    SystemAudioChunkPayload {
                        paragraphs: payload_paras,
                        rendered_text: rendered.clone(),
                        accumulated_text: rendered.clone(),
                        note_id,
                    },
                ) {
                    error!("Failed to emit system-audio-chunk event: {e}");
                }
            });
        };

        let mut loopback = LoopbackCapture::new()?;
        loopback.start(
            self.app_handle.clone(),
            on_chunk,
            max_chunk_secs,
            vad_hangover_secs,
        )?;

        let mut capture_guard = self.capture.lock().unwrap();
        *capture_guard = Some(loopback);

        Ok(())
    }

    /// Stop loopback capture and flush the accumulated transcript to the DB.
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
        let note_id = self.current_note_id.lock().unwrap().clone();
        let note_title = self.current_note_title.lock().unwrap().clone();
        let final_text = render_paragraphs_markdown(&self.paragraphs.lock().unwrap());
        let ws_doc_id = self.workspace_session_doc_id.lock().unwrap().clone();

        // Phase A Commit 3: legacy notes final-write block deleted. The
        // workspace doc (finalised below) is the sole persistent storage
        // for system-audio transcripts. `note_id` / `note_title` remain
        // as in-memory session handles only.
        let _ = (&note_id, &note_title);

        if let Some(ref wid) = ws_doc_id {
            if let Some(state) = self.app_handle.try_state::<Arc<AppState>>() {
                if !final_text.is_empty() {
                    match state
                        .workspace_manager
                        .update_node_body_persist_only(wid, &final_text)
                        .await
                    {
                        Ok(node) => {
                            emit_workspace_node_body_updated_immediate(&self.app_handle, &node);

                            // Final mirror to vault
                            match state
                                .workspace_manager
                                .write_node_to_vault(&self.app_handle, &node, None)
                                .await
                            {
                                Ok(rel_path) => {
                                    if let Err(e) = state
                                        .workspace_manager
                                        .update_vault_rel_path(&node.id, &rel_path)
                                        .await
                                    {
                                        error!("Failed to update final vault_rel_path for system audio doc {}: {}", node.id, e);
                                    }
                                }
                                Err(e) => {
                                    error!(
                                        "Failed to write final system audio doc {} to vault: {}",
                                        node.id, e
                                    );
                                }
                            }
                        }
                        Err(e) => error!("System audio final workspace body: {e}"),
                    }
                }
                if let Err(e) = state
                    .workspace_manager
                    .finalize_node_search_index(wid)
                    .await
                {
                    error!("System audio finalize index: {e}");
                }
            }
        }

        // ── Clear session state ───────────────────────────────────────────────
        *self.current_note_id.lock().unwrap() = None;
        self.current_note_title.lock().unwrap().clear();
        self.paragraphs.lock().unwrap().clear();
        *self.session_started_at.lock().unwrap() = None;
        *self.last_chunk_ended_at.lock().unwrap() = None;
        *self.workspace_session_doc_id.lock().unwrap() = None;
        *self.last_workspace_persist_ms.lock().unwrap() = 0;

        Ok(())
    }

    pub fn is_running(&self) -> bool {
        let capture_guard = self.capture.lock().unwrap();
        capture_guard
            .as_ref()
            .map(|c| c.is_running())
            .unwrap_or(false)
    }

    pub fn set_paragraph_silence_secs(&self, secs: f32) {
        self.paragraph_silence_secs
            .store(secs_to_bits(secs), Ordering::Relaxed);
    }

    /// Wall-clock elapsed since loopback session started (`start_loopback`), if active.
    pub fn capture_elapsed_secs(&self) -> Option<f32> {
        self.session_started_at
            .lock()
            .unwrap()
            .as_ref()
            .map(|t| t.elapsed().as_secs_f32())
    }
}
