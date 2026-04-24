//! Interview-mode transcription worker (Rule 16).
//!
//! Drives two independent ORT Whisper sessions — one for the mic stream
//! ("You"), one for the system-audio loopback ("Other") — and merges their
//! paragraph output by wall-clock offset on stop. See
//! `docs/superpowers/specs/2026-04-23-interview-mode-design.md`.

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
use serde::Serialize;
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

// ─────────────────────────────────────────────────────────────────────────────
// Live-persist + workspace body rendering
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Worker
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct InterviewChunkParagraph {
    pub speaker: String, // "You" or "Other"
    pub participant: Option<String>,
    pub text: String,
    pub wall_clock_ms: u64,
}

#[derive(Clone, Serialize)]
pub struct InterviewChunkPayload {
    pub paragraphs: Vec<InterviewChunkParagraph>,
    pub workspace_doc_id: String,
}

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
    session_start_unix_ms: Arc<Mutex<u64>>,
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
            session_start_unix_ms: Arc::new(Mutex::new(0)),
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

        let started_at_ms = chrono::Utc::now().timestamp_millis();
        *self.session_start_unix_ms.lock().unwrap() = started_at_ms as u64;
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

        let initial_body = String::new();
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

        // Register with the session manager BEFORE starting captures, so any
        // immediate chunk event finds the session active.
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

        // Wire the mic sub-capture.
        let mut mic_capture = MicChunkedCapture::new()?;
        self.wire_mic_chunk(&mut mic_capture, max_chunk_secs, vad_hangover_secs)?;
        *self.mic_capture.lock().unwrap() = Some(mic_capture);

        // Wire the system sub-capture.
        let mut system_capture = LoopbackCapture::new()?;
        self.wire_system_chunk(&mut system_capture, max_chunk_secs, vad_hangover_secs)?;
        *self.system_capture.lock().unwrap() = Some(system_capture);

        Ok((doc.id, started_at_ms))
    }

    fn wire_mic_chunk(
        &self,
        mic_capture: &mut MicChunkedCapture,
        max_chunk_secs: f32,
        vad_hangover_secs: f32,
    ) -> Result<()> {
        let app = self.app_handle.clone();
        let state = Arc::clone(&self.state);
        let session_started_at = Arc::clone(&self.session_started_at);
        let session_start_unix_ms = Arc::clone(&self.session_start_unix_ms);
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
                let session_start_unix_ms = Arc::clone(&session_start_unix_ms);
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
                        &session_start_unix_ms,
                        &participant,
                    )
                    .await;
                });
            },
            max_chunk_secs,
            vad_hangover_secs,
        )
    }

    fn wire_system_chunk(
        &self,
        system_capture: &mut LoopbackCapture,
        max_chunk_secs: f32,
        vad_hangover_secs: f32,
    ) -> Result<()> {
        let app = self.app_handle.clone();
        let state = Arc::clone(&self.state);
        let session_started_at = Arc::clone(&self.session_started_at);
        let session_start_unix_ms = Arc::clone(&self.session_start_unix_ms);
        let last_persist = Arc::clone(&self.last_workspace_persist_ms);
        let in_flight = Arc::clone(&self.in_flight);
        let ws_doc_id = Arc::clone(&self.workspace_doc_id);
        let participant = Arc::clone(&self.participant_name);

        system_capture.start(
            self.app_handle.clone(),
            move |audio, _trigger: ChunkTrigger| {
                let app = app.clone();
                let state = Arc::clone(&state);
                let session_started_at = Arc::clone(&session_started_at);
                let session_start_unix_ms = Arc::clone(&session_start_unix_ms);
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
                        &session_start_unix_ms,
                        &participant,
                    )
                    .await;
                });
            },
            max_chunk_secs,
            vad_hangover_secs,
        )
    }

    pub async fn stop(&self) -> Result<Option<String>> {
        // Stop capture threads (they flush trailing buffers).
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
        if tokio::time::timeout(Duration::from_secs(5), drain)
            .await
            .is_err()
        {
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
        *self.session_start_unix_ms.lock().unwrap() = 0;
        *self.workspace_doc_id.lock().unwrap() = None;
        *self.participant_name.lock().unwrap() = String::new();
        *self.last_workspace_persist_ms.lock().unwrap() = 0;
        let _ = now_ms();

        Ok(Some(ws_doc_id))
    }
}

async fn persist_live_body(
    app: &AppHandle,
    state: &Arc<Mutex<ParagraphState>>,
    ws_doc_id: &Arc<Mutex<Option<String>>>,
    last_persist: &Arc<Mutex<u64>>,
    session_start_unix_ms: &Arc<Mutex<u64>>,
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

    let session_start_ms = *session_start_unix_ms.lock().unwrap();
    let name = participant.lock().unwrap().clone();
    let merged = {
        let st = state.lock().unwrap();
        merge_paragraphs(&st.mic, &st.system, session_start_ms, &name)
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

            // Emit per-paragraph live event for the frontend feed.
            let chunks: Vec<InterviewChunkParagraph> = merged
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
                .collect();
            let _ = app.emit(
                "interview-chunk",
                InterviewChunkPayload {
                    paragraphs: chunks,
                    workspace_doc_id: ws_id.clone(),
                },
            );
        }
        Err(e) => error!("Interview live persist: {e}"),
    }
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
}
