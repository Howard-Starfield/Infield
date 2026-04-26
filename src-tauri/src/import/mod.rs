//! Serial file-import queue: documents → workspace nodes; audio/video →
//! transcription → workspace node. Phase A Commit 3 dropped the notes
//! path (NotesManager deleted); imports now land exclusively in
//! `workspace_nodes`.

mod post_processing;
mod segmenting;
pub mod web_media;
pub use web_media::{
    WebMediaMetadata, WebMediaError, YtDlpHandle,
    WebMediaImportOpts, WebMediaFormat, PlaylistSource, AlreadyImportedHit,
    PlaylistEnvelope, PlaylistEntry, DownloadProgress, MediaArtefacts,
};

use crate::actions::maybe_convert_chinese_variant;
use crate::audio_toolkit::constants;
use crate::audio_toolkit::read_wav_samples_range;
use crate::managers::transcription::TranscriptionManager;
use crate::managers::workspace::{WorkspaceManager, WorkspaceNode};
use crate::portable;
use crate::settings::get_settings;
use crate::transcription_workspace::emit_workspace_node_body_updated_immediate;
use encoding_rs::UTF_8;
use hound::WavReader;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as TokioMutex;

pub const FILE_IMPORT_SOURCE: &str = "file_import";
const FILE_IMPORT_FOLDER: &str = "Imported Files";

const IMPORT_BODY_MAX_CHARS: usize = 1_200_000;
const SR: u64 = constants::WHISPER_SAMPLE_RATE as u64;
const GAP_PARAGRAPH_MS: u64 = 1500;
const MIN_MEANINGFUL_TRANSCRIPT_CHARS: usize = 20;
const IMPORT_DB_FLUSH_INTERVAL: Duration = Duration::from_secs(2);
const IMPORT_DB_FLUSH_MAX_CHARS: usize = 4_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ImportJobKind {
    Markdown,
    PlainText,
    Pdf,
    Audio,
    Video,
    WebMedia,   // NEW — W7
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ImportJobState {
    Queued,
    FetchingMeta,    // NEW — W7
    Downloading,     // NEW — W7
    Preparing,
    Segmenting,
    DraftCreated,
    Transcribing,
    PostProcessing,
    Finalizing,
    ExtractingText,
    CreatingNote,
    Done,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ImportJobDto {
    pub id: String,
    pub file_name: String,
    pub source_path: String,
    pub kind: ImportJobKind,
    pub state: ImportJobState,
    pub message: Option<String>,
    pub note_id: Option<String>,
    pub progress: f32,
    pub segment_index: u32,
    pub segment_count: u32,
    pub current_step: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub web_meta: Option<WebMediaMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_speed_human: Option<String>,
}

struct ImportJob {
    id: String,
    file_name: String,
    source_path: PathBuf,
    kind: ImportJobKind,
    state: ImportJobState,
    message: Option<String>,
    note_id: Option<String>,
    cancel_requested: Arc<AtomicBool>,
    progress: f32,
    segment_index: u32,
    segment_count: u32,
    current_step: Option<String>,
    // W7 WebMedia fields — in-memory only; not persisted. Boot recovery (Task 21)
    // marks any in-flight WebMedia jobs as Error on restart.
    web_meta: Option<web_media::WebMediaMetadata>,
    web_opts: Option<web_media::WebMediaImportOpts>,
    download_bytes: Option<u64>,
    download_total_bytes: Option<u64>,
    download_speed_human: Option<String>,
    // draft_node_id / local_audio_path / media_dir used by Task 18 Downloading state
    draft_node_id: Option<String>,
    local_audio_path: Option<PathBuf>,
    media_dir: Option<PathBuf>,
}

impl ImportJob {
    fn to_dto(&self) -> ImportJobDto {
        ImportJobDto {
            id: self.id.clone(),
            file_name: self.file_name.clone(),
            source_path: self.source_path.to_string_lossy().to_string(),
            kind: self.kind,
            state: self.state,
            message: self.message.clone(),
            note_id: self.note_id.clone(),
            progress: self.progress,
            segment_index: self.segment_index,
            segment_count: self.segment_count,
            current_step: self.current_step.clone(),
            web_meta: self.web_meta.clone(),
            download_bytes: self.download_bytes,
            download_total_bytes: self.download_total_bytes,
            download_speed_human: self.download_speed_human.clone(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Type)]
pub struct ImportQueueSnapshot {
    pub jobs: Vec<ImportJobDto>,
}

struct ImportQueueInner {
    app: AppHandle,
    jobs: TokioMutex<Vec<ImportJob>>,
    wake: Arc<tokio::sync::Notify>,
    workspace: Arc<WorkspaceManager>,
    tm: Arc<TranscriptionManager>,
    /// When `true` the worker loop idles (100 ms sleep) instead of picking
    /// the next Queued job. Resume stores `false` and notifies the wake handle.
    paused: Arc<AtomicBool>,
}

#[derive(Clone)]
pub struct ImportQueueService {
    inner: Arc<ImportQueueInner>,
}

#[derive(Serialize)]
struct ImportJobMetaFile {
    source_path: String,
    title: String,
}

#[derive(Clone, Serialize)]
struct WorkspaceImportSyncedPayload {
    node_id: String,
    source: String,
}

fn classify_path(path: &Path) -> ImportJobKind {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "md" | "markdown" | "mdx" => ImportJobKind::Markdown,
        "txt" | "text" | "log" | "csv" => ImportJobKind::PlainText,
        "pdf" => ImportJobKind::Pdf,
        "wav" | "mp3" | "m4a" | "aac" | "flac" | "ogg" | "opus" => ImportJobKind::Audio,
        "mp4" | "mov" | "mkv" | "avi" | "webm" | "mpeg" | "mpg" | "wmv" => ImportJobKind::Video,
        _ => ImportJobKind::Unknown,
    }
}

fn decode_utf8_with_fallback(bytes: &[u8]) -> Cow<'_, str> {
    let (cow, _, had_errors) = UTF_8.decode(bytes);
    if had_errors {
        encoding_rs::WINDOWS_1252.decode(bytes).0
    } else {
        cow
    }
}

fn truncate_body(s: &str) -> (String, bool) {
    if s.len() <= IMPORT_BODY_MAX_CHARS {
        return (s.to_string(), false);
    }
    let mut out = s.chars().take(IMPORT_BODY_MAX_CHARS).collect::<String>();
    out.push_str("\n\n…(truncated)");
    (out, true)
}

async fn emit_snapshot(inner: &ImportQueueInner) {
    let jobs: Vec<ImportJobDto> = inner
        .jobs
        .lock()
        .await
        .iter()
        .map(ImportJob::to_dto)
        .collect();
    let payload = ImportQueueSnapshot { jobs };
    if let Err(e) = inner.app.emit("import-queue-updated", payload) {
        warn!("import-queue-updated emit failed: {e}");
    }
}

fn run_ffmpeg_to_wav(input: &Path, output_wav: &Path) -> Result<(), String> {
    let out = std::process::Command::new("ffmpeg")
        .arg("-y")
        .arg("-i")
        .arg(input)
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-f")
        .arg("wav")
        .arg(output_wav)
        .output()
        .map_err(|e| {
            format!("Could not run ffmpeg (install ffmpeg and ensure it is on PATH): {e}")
        })?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("ffmpeg failed: {stderr}"));
    }
    Ok(())
}

fn prepare_wav_for_transcription(
    source: &Path,
    kind: ImportJobKind,
    tmp_wav: &Path,
) -> Result<(), String> {
    use crate::audio_toolkit::read_wav_samples;
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if kind == ImportJobKind::Audio && ext == "wav" {
        read_wav_samples(source).map_err(|e| format!("Invalid WAV: {e}"))?;
        std::fs::copy(source, tmp_wav).map_err(|e| format!("Copy WAV: {e}"))?;
        return Ok(());
    }
    run_ffmpeg_to_wav(source, tmp_wav)
}

fn pdf_text(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Read PDF: {e}"))?;
    pdf_extract::extract_text_from_mem(&bytes).map_err(|e| format!("PDF extract: {e}"))
}

async fn update_job_state(
    inner: &ImportQueueInner,
    id: &str,
    state: ImportJobState,
    message: Option<String>,
) {
    let mut jobs = inner.jobs.lock().await;
    if let Some(j) = jobs.iter_mut().find(|j| j.id == id) {
        j.state = state;
        j.message = message;
    }
    drop(jobs);
    emit_snapshot(inner).await;
}

async fn patch_job(inner: &ImportQueueInner, id: &str, patch: impl FnOnce(&mut ImportJob)) {
    let mut jobs = inner.jobs.lock().await;
    if let Some(j) = jobs.iter_mut().find(|j| j.id == id) {
        patch(j);
    }
    drop(jobs);
    emit_snapshot(inner).await;
}

fn should_flush_import_buffer(buffered_fragment: &str, last_flush_at: Instant) -> bool {
    !buffered_fragment.is_empty()
        && (buffered_fragment.chars().count() >= IMPORT_DB_FLUSH_MAX_CHARS
            || last_flush_at.elapsed() >= IMPORT_DB_FLUSH_INTERVAL)
}

async fn flush_import_buffer(
    inner: &ImportQueueInner,
    note_id: &str,
    buffered_fragment: &mut String,
    last_flush_at: &mut Instant,
) -> Result<(), String> {
    if buffered_fragment.is_empty() {
        return Ok(());
    }

    let fragment = std::mem::take(buffered_fragment);
    let existing = inner
        .workspace
        .get_node(note_id)
        .await?
        .ok_or_else(|| "Import draft document not found".to_string())?;
    let mut next_body = existing.body;
    next_body.push_str(&fragment);

    if let Err(e) = inner
        .workspace
        .update_node_body_persist_only(note_id, &next_body)
        .await
    {
        error!("update_node_body_persist_only: {e}");
        return Err(format!("{e}"));
    }

    *last_flush_at = Instant::now();
    Ok(())
}

async fn ensure_file_import_folder(inner: &ImportQueueInner) -> Result<String, String> {
    let roots = inner.workspace.get_root_nodes().await?;
    if let Some(folder) = roots.into_iter().find(|node| {
        node.node_type == "document" && node.name == FILE_IMPORT_FOLDER && node.deleted_at.is_none()
    }) {
        return Ok(folder.id);
    }

    let folder = inner
        .workspace
        .create_node(None, "document", FILE_IMPORT_FOLDER, "📁")
        .await?;
    sync_workspace_document_to_vault(inner, &folder).await;
    Ok(folder.id)
}

async fn sync_workspace_document_to_vault(inner: &ImportQueueInner, node: &WorkspaceNode) {
    if node.node_type != "document" || node.deleted_at.is_some() {
        return;
    }
    if let Ok(rel_path) = inner.workspace.write_node_to_vault(&inner.app, node, None).await {
        if let Err(e) = inner.workspace.update_vault_rel_path(&node.id, &rel_path).await {
            error!("Failed to update vault_rel_path during import for node {}: {}", node.id, e);
        }
    }
}

async fn emit_workspace_import_synced(inner: &ImportQueueInner, node_id: &str) {
    let payload = WorkspaceImportSyncedPayload {
        node_id: node_id.to_string(),
        source: FILE_IMPORT_SOURCE.to_string(),
    };
    if let Err(e) = inner.app.emit("workspace-import-synced", payload) {
        warn!("workspace-import-synced emit failed: {e}");
    }
}

async fn run_import_media(
    inner: &ImportQueueInner,
    job_id: &str,
    source_path: &Path,
    kind: ImportJobKind,
    title: &str,
    tmp_dir: &Path,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let _keepalive = inner.tm.acquire_keepalive("file_import");
    inner.tm.initiate_model_load();

    let tmp_wav = tmp_dir.join("work.wav");
    patch_job(inner, job_id, |j| {
        j.state = ImportJobState::Segmenting;
        j.current_step = Some("Detecting speech…".into());
        j.progress = 0.05;
    })
    .await;

    if cancel_flag.load(Ordering::Relaxed) {
        update_job_state(inner, job_id, ImportJobState::Cancelled, None).await;
        return Ok(());
    }

    prepare_wav_for_transcription(source_path, kind, &tmp_wav).map_err(|e| {
        format!("{e}")
    })?;

    let meta = ImportJobMetaFile {
        source_path: source_path.to_string_lossy().to_string(),
        title: title.to_string(),
    };
    let meta_json = serde_json::to_string(&meta).map_err(|e| e.to_string())?;
    fs::write(tmp_dir.join("import_job_meta.json"), meta_json).map_err(|e| e.to_string())?;

    let silero = inner.app.path().resolve(
        "resources/models/silero_vad_v4.onnx",
        tauri::path::BaseDirectory::Resource,
    );

    let mut segments = match silero {
        Ok(ref p) if p.exists() => segmenting::segment_wav(&tmp_wav, p).unwrap_or_default(),
        _ => Vec::new(),
    };

    if segments.is_empty() {
        let total_samples = WavReader::open(&tmp_wav)
            .map(|r| r.duration() as u64)
            .unwrap_or(0);
        let end_ms = total_samples.saturating_mul(1000) / SR;
        if end_ms >= 250 {
            segments.push(segmenting::SegmentSpan {
                start_ms: 0,
                end_ms,
            });
        }
    }

    if segments.is_empty() {
        update_job_state(
            inner,
            job_id,
            ImportJobState::Error,
            Some("No speech detected".into()),
        )
        .await;
        return Ok(());
    }

    let seg_json = serde_json::to_string_pretty(&segments).map_err(|e| e.to_string())?;
    fs::write(tmp_dir.join("segments.json"), seg_json).map_err(|e| e.to_string())?;

    let nseg = segments.len() as u32;
    patch_job(inner, job_id, |j| {
        j.segment_count = nseg;
        j.segment_index = 0;
        j.progress = 0.1;
    })
    .await;

    if cancel_flag.load(Ordering::Relaxed) {
        update_job_state(inner, job_id, ImportJobState::Cancelled, None).await;
        return Ok(());
    }

    patch_job(inner, job_id, |j| {
        j.state = ImportJobState::DraftCreated;
        j.current_step = Some("Creating draft note…".into());
    })
    .await;

    let folder_id = ensure_file_import_folder(inner).await?;
    let draft = inner
        .workspace
        .create_document_child(&folder_id, title, "🎙️", "")
        .await
        .map_err(|e| format!("create_workspace_document: {e}"))?;

    let note_id = draft.id.clone();
    patch_job(inner, job_id, |j| {
        j.note_id = Some(note_id.clone());
        j.state = ImportJobState::Transcribing;
        j.current_step = Some("Transcribing…".into());
    })
    .await;
    emit_workspace_import_synced(inner, &note_id).await;

    let mut assembled = String::new();
    let mut buffered_fragment = String::new();
    let mut last_db_flush_at = Instant::now();
    let mut prev_end_ms: Option<u64> = None;
    let mut consecutive_errors: u32 = 0;

    for (i, seg) in segments.iter().enumerate() {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = flush_import_buffer(
                inner,
                &note_id,
                &mut buffered_fragment,
                &mut last_db_flush_at,
            )
            .await;
            let _ = inner.workspace.soft_delete_node(&note_id).await;
            patch_job(inner, job_id, |j| {
                j.state = ImportJobState::Cancelled;
                j.message = None;
                j.progress = 1.0;
            })
            .await;
            return Ok(());
        }

        let gap_ms = prev_end_ms.map(|p| seg.start_ms.saturating_sub(p)).unwrap_or(0);
        let sep = if gap_ms > GAP_PARAGRAPH_MS { "\n\n" } else { " " };

        let start_sample = seg.start_ms.saturating_mul(SR) / 1000;
        let end_sample = seg.end_ms.saturating_mul(SR) / 1000;
        let samples = match read_wav_samples_range(&tmp_wav, start_sample, end_sample) {
            Ok(s) => s,
            Err(e) => {
                warn!("read_wav_samples_range segment {}: {}", i, e);
                Vec::new()
            }
        };

        let tm = inner.tm.clone();
        let transcribe_result: Result<String, String> = if samples.is_empty() {
            Ok(String::new())
        } else {
            tauri::async_runtime::spawn_blocking(move || {
                let r = tm.transcribe(samples);
                // Touch activity after each segment so the idle watcher timer never
                // looks stale while the keepalive lease is held (belt-and-suspenders).
                tm.touch_activity();
                r
            })
            .await
            .map_err(|e| format!("Transcribe join: {e}"))
            .and_then(|r| r.map_err(|e| format!("Transcribe: {e}")))
        };

        let (piece, ok_segment) = match &transcribe_result {
            Ok(t) if !t.trim().is_empty() => (t.trim().to_string(), true),
            Ok(_) => ("[inaudible]".to_string(), false),
            Err(e) => {
                warn!("segment {} transcribe: {}", i, e);
                ("[inaudible]".to_string(), false)
            }
        };
        if ok_segment {
            consecutive_errors = 0;
        } else {
            consecutive_errors += 1;
        }

        if consecutive_errors >= 3 {
            let _ = flush_import_buffer(
                inner,
                &note_id,
                &mut buffered_fragment,
                &mut last_db_flush_at,
            )
            .await;
            update_job_state(
                inner,
                job_id,
                ImportJobState::Error,
                Some("Transcription failed repeatedly".into()),
            )
            .await;
            emit_workspace_import_synced(inner, &note_id).await;
            return Ok(());
        }

        let marker = format!("<!-- seg:{i} -->");
        let frag = if i == 0 {
            format!("{marker}{sep}{piece}")
        } else {
            format!("{sep}{marker}{sep}{piece}")
        };
        buffered_fragment.push_str(&frag);
        if should_flush_import_buffer(&buffered_fragment, last_db_flush_at) {
            if flush_import_buffer(
                inner,
                &note_id,
                &mut buffered_fragment,
                &mut last_db_flush_at,
            )
            .await
            .is_err()
            {
                update_job_state(inner, job_id, ImportJobState::Error, Some("Failed to persist transcript fragment".into())).await;
                emit_workspace_import_synced(inner, &note_id).await;
                return Ok(());
            }
        }

        if !assembled.is_empty() {
            assembled.push_str(sep);
        }
        assembled.push_str(&piece);

        prev_end_ms = Some(seg.end_ms);
        let done = (i + 1) as f32 / nseg as f32;
        patch_job(inner, job_id, |j| {
            j.segment_index = (i + 1) as u32;
            j.progress = 0.1 + 0.75 * done;
        })
        .await;
    }

    if flush_import_buffer(
        inner,
        &note_id,
        &mut buffered_fragment,
        &mut last_db_flush_at,
    )
    .await
    .is_err()
    {
        update_job_state(inner, job_id, ImportJobState::Error, Some("Failed to persist final transcript fragment".into())).await;
        emit_workspace_import_synced(inner, &note_id).await;
        return Ok(());
    }

    let meaningful: String = assembled.chars().filter(|c| !c.is_whitespace()).collect();
    if meaningful.len() < MIN_MEANINGFUL_TRANSCRIPT_CHARS {
        update_job_state(
            inner,
            job_id,
            ImportJobState::Error,
            Some("No meaningful speech detected".into()),
        )
        .await;
        emit_workspace_import_synced(inner, &note_id).await;
        return Ok(());
    }

    if cancel_flag.load(Ordering::Relaxed) {
        let _ = inner.workspace.soft_delete_node(&note_id).await;
        patch_job(inner, job_id, |j| {
            j.state = ImportJobState::Cancelled;
        })
        .await;
        return Ok(());
    }

    patch_job(inner, job_id, |j| {
        j.state = ImportJobState::PostProcessing;
        j.current_step = Some("Cleaning up transcript…".into());
        j.progress = 0.88;
    })
    .await;

    let settings = get_settings(&inner.app);
    let mut body_for_llm = assembled.clone();
    if let Some(conv) = maybe_convert_chinese_variant(&settings, &body_for_llm).await {
        body_for_llm = conv;
    }

    let final_body = if settings.post_process_enabled {
        post_processing::post_process_import_transcript(&inner.app, &body_for_llm).await
    } else {
        body_for_llm
    };

    patch_job(inner, job_id, |j| {
        j.state = ImportJobState::Finalizing;
        j.current_step = Some("Finalizing…".into());
        j.progress = 0.95;
    })
    .await;

    // ── WebMedia Finalizing branch ───────────────────────────────────────────
    // For WebMedia jobs, override the plain transcript body with a
    // ::web_clip-directive-prefixed body and store web metadata in
    // workspace_nodes.properties (same pattern as voice_memo_mirror).
    let (body_to_write, web_properties_to_write) = {
        let jobs = inner.jobs.lock().await;
        if let Some(job) = jobs.iter().find(|j| j.id == job_id) {
            if job.kind == ImportJobKind::WebMedia {
                match (
                    job.web_meta.as_ref(),
                    job.draft_node_id.as_deref(),
                    job.web_opts.as_ref(),
                ) {
                    (Some(meta), Some(node_id), opts) => {
                        let opts_ref = opts.cloned().unwrap_or_default();
                        // Split final_body into paragraphs for the builder.
                        let paragraphs: Vec<String> = final_body
                            .split("\n\n")
                            .map(|s| s.to_string())
                            .collect();
                        match build_web_media_document(
                            job_id, meta, &opts_ref, node_id, &paragraphs,
                        ) {
                            Ok((props, body)) => {
                                let media_dir = job.media_dir.clone();
                                let keep = opts_ref.keep_media;
                                (body, Some((props, media_dir, keep)))
                            }
                            Err(e) => {
                                warn!("build_web_media_document failed (using plain body): {e}");
                                (final_body.clone(), None)
                            }
                        }
                    }
                    _ => (final_body.clone(), None),
                }
            } else {
                (final_body.clone(), None)
            }
        } else {
            (final_body.clone(), None)
        }
    };

    let finalized_node = match inner
        .workspace
        .update_node_body_persist_only(&note_id, &body_to_write)
        .await
    {
        Ok(node) => node,
        Err(e) => {
            error!("finalize_import_workspace_document: {e}");
            update_job_state(inner, job_id, ImportJobState::Error, Some(format!("{e}"))).await;
            emit_workspace_import_synced(inner, &note_id).await;
            return Ok(());
        }
    };

    // Store web metadata in properties and write segments sidecar.
    if let Some((props_json, media_dir_opt, keep_media)) = web_properties_to_write {
        if let Err(e) = inner.workspace.update_node_properties(&note_id, &props_json).await {
            warn!("update_node_properties for WebMedia job {job_id}: {e}");
        }
        if let Some(mdir) = media_dir_opt {
            // W7 v1: write empty segments.json — timestamps not yet plumbed through
            // the Audio pipeline. TODO(W2): populate with real (start_ms, end_ms, text).
            if let Err(e) = write_segments_json(&mdir, &[]) {
                warn!("write_segments_json for job {job_id}: {e}");
            }
            // Cleanup: remove audio.mp3 / video.mp4 when keep_media=false;
            // thumbnail + segments.json stay so the ::web_clip directive
            // still has its preview image.
            if !keep_media {
                let _ = std::fs::remove_file(mdir.join("audio.mp3"));
                let _ = std::fs::remove_file(mdir.join("video.mp4"));
            }
        }
    }

    emit_workspace_node_body_updated_immediate(&inner.app, &finalized_node);
    if let Err(e) = inner.workspace.finalize_node_search_index(&note_id).await {
        update_job_state(inner, job_id, ImportJobState::Error, Some(format!("{e}"))).await;
        emit_workspace_import_synced(inner, &note_id).await;
        return Ok(());
    }
    sync_workspace_document_to_vault(inner, &finalized_node).await;

    patch_job(inner, job_id, |j| {
        j.state = ImportJobState::Done;
        j.message = None;
        j.progress = 1.0;
        j.current_step = None;
    })
    .await;
    emit_workspace_import_synced(inner, &note_id).await;

    Ok(())
}

// ── W7: WebMedia vault-write helpers ────────────────────────────────────────

/// Build the YAML metadata map and the body string for a WebMedia import node.
///
/// Returns `(web_properties_json, body)` where `web_properties_json` is a
/// JSON object suitable for storage in `workspace_nodes.properties` (mirrors
/// the pattern used by `voice_memo_mirror`) and `body` is the raw markdown
/// body prefixed with a `::web_clip{...}` directive followed by the
/// transcript paragraphs.
fn build_web_media_document(
    job_id: &str,
    web_meta: &web_media::WebMediaMetadata,
    web_opts: &web_media::WebMediaImportOpts,
    draft_node_id: &str,
    transcript_paragraphs: &[String],
) -> Result<(String, String), String> {
    let mut map = serde_json::Map::new();
    map.insert("web_media".into(), serde_json::json!({
        "source_url":           web_meta.url,
        "source_id":            web_meta.source_id,
        "source_platform":      web_meta.platform,
        "source_channel":       web_meta.channel,
        "source_duration_seconds": web_meta.duration_seconds.map(|d| d as i64),
        "source_published_at":  web_meta.published_at,
        "media_dir":            format!(".handy-media/web/{}/", draft_node_id),
        "imported_at":          chrono::Utc::now().to_rfc3339(),
        "imported_via":         "web_media",
        "media_kept":           web_opts.keep_media,
        "playlist_source":      web_opts.playlist_source.as_ref().map(|ps| serde_json::json!({
            "title": ps.title,
            "url":   ps.url,
            "index": ps.index,
        })),
        "import_job_id":        job_id,
    }));
    let properties_json = serde_json::to_string(&serde_json::Value::Object(map))
        .map_err(|e| format!("serialize web_media properties: {e}"))?;

    let directive = format!(
        "::web_clip{{url=\"{}\" thumb=\".handy-media/web/{}/thumbnail.jpg\" platform=\"{}\"}}\n\n",
        web_meta.url, draft_node_id, web_meta.platform,
    );
    let body = format!("{}{}", directive, transcript_paragraphs.join("\n\n"));

    Ok((properties_json, body))
}

/// Write a `segments.json` sidecar to the media directory.
///
/// `segments` is a slice of `(start_ms, end_ms, text)` tuples.  In W7 v1 we
/// write an empty array because the per-segment timestamps are not yet plumbed
/// through `run_import_media` to the Finalizing site (the existing Audio
/// pipeline coalesces segments into a single assembled string).  The file is
/// always created so the sidecar directory is complete; W2 click-to-seek will
/// populate it when that feature lands.
///
/// TODO(W2): plumb `Vec<(u64, u64, String)>` from the transcription loop
/// through `run_import_media` so the real timestamps are written here.
fn write_segments_json(media_dir: &Path, segments: &[(u64, u64, String)]) -> Result<(), String> {
    let json: Vec<serde_json::Value> = segments
        .iter()
        .map(|(s, e, t)| serde_json::json!({ "start_ms": s, "end_ms": e, "text": t }))
        .collect();
    let path = media_dir.join("segments.json");
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&json).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

// ── W7: WebMedia worker helpers ──────────────────────────────────────────────

/// Transition a job's state and message, then emit a snapshot.
async fn transition_web_job(
    inner: &ImportQueueInner,
    job_id: &str,
    state: ImportJobState,
    message: Option<String>,
) {
    let mut jobs = inner.jobs.lock().await;
    if let Some(j) = jobs.iter_mut().find(|j| j.id == job_id) {
        j.state = state;
        j.message = message;
    }
    drop(jobs);
    emit_snapshot(inner).await;
}

/// Map a WebMediaError to a user-facing message and transition the job to Error.
async fn fail_web_job(inner: &ImportQueueInner, job_id: &str, e: web_media::WebMediaError) {
    transition_web_job(inner, job_id, ImportJobState::Error, Some(e.to_string())).await;
}

/// Worker entry-point for WebMedia jobs. Drives the full state machine:
/// Queued → FetchingMeta → Downloading → Preparing → [Audio pipeline].
async fn run_web_media_job(inner: &ImportQueueInner, job_id: &str) -> Result<(), String> {
    // Confirm the job is still Queued; bail if it was already processed or removed.
    {
        let mut jobs = inner.jobs.lock().await;
        let Some(job) = jobs.iter_mut().find(|j| j.id == job_id) else {
            return Ok(());
        };
        if job.state != ImportJobState::Queued {
            return Ok(());
        }
        job.state = ImportJobState::FetchingMeta;
        job.message = None;
    }
    emit_snapshot(inner).await;

    // FetchingMeta phase — on success the job transitions to Downloading.
    handle_fetching_meta(inner, job_id).await?;

    // Check whether FetchingMeta advanced us to Downloading (vs. Error/Done/Cancelled).
    let state_after_meta = {
        let jobs = inner.jobs.lock().await;
        jobs.iter().find(|j| j.id == job_id).map(|j| j.state)
    };
    if state_after_meta != Some(ImportJobState::Downloading) {
        return Ok(()); // terminal state reached (error, dedup-done, cancelled)
    }

    // Downloading phase — on success the job transitions to Preparing.
    handle_downloading(inner, job_id).await?;

    // Check whether Downloading advanced us to Preparing.
    let state_after_dl = {
        let jobs = inner.jobs.lock().await;
        jobs.iter().find(|j| j.id == job_id).map(|j| j.state)
    };
    if state_after_dl != Some(ImportJobState::Preparing) {
        return Ok(()); // cancelled or error during download
    }

    // Preparing phase — hand off to the Audio pipeline.
    handle_preparing_web_media(inner, job_id).await
}

/// Fetch yt-dlp metadata for a WebMedia job, enforce duration limit, then advance
/// to Downloading (Task 18) or transition to Error/Done.
///
/// Hardcoded 14 400 s (4 h) duration limit. Task 23 will route this through Settings.
const WEB_MEDIA_MAX_DURATION_SECONDS: f64 = 14_400.0;

async fn handle_fetching_meta(inner: &ImportQueueInner, job_id: &str) -> Result<(), String> {
    let url = {
        let jobs = inner.jobs.lock().await;
        jobs.iter()
            .find(|j| j.id == job_id)
            .map(|j| j.source_path.to_string_lossy().to_string())
    };
    let Some(url) = url else {
        return Ok(());
    };

    let bin = match crate::plugin::yt_dlp::binary_path(&inner.app) {
        Ok(p) => p,
        Err(e) => {
            let msg = format!("yt-dlp plugin path error: {e}");
            transition_web_job(inner, job_id, ImportJobState::Error, Some(msg)).await;
            return Ok(());
        }
    };
    let handle = web_media::YtDlpHandle::new(bin);
    if !handle.is_available() {
        fail_web_job(inner, job_id, web_media::WebMediaError::YtDlpNotFound).await;
        return Ok(());
    }

    match handle.fetch_metadata(&url).await {
        Ok(meta) => {
            // Store metadata on the job so the DTO can surface it to the frontend.
            {
                let mut jobs = inner.jobs.lock().await;
                if let Some(j) = jobs.iter_mut().find(|j| j.id == job_id) {
                    j.web_meta = Some(meta.clone());
                }
            }

            // Dedup: if a node with this source_id already exists in the workspace,
            // transition to Done and reuse the existing node rather than importing again.
            // (Preview flow will surface the hit via fetch_url_metadata in Task 19.)
            match inner.workspace.find_node_by_source_id(&meta.source_id).await {
                Ok(Some(hit)) => {
                    let msg = format!("Already imported as {}", hit.vault_path);
                    {
                        let mut jobs = inner.jobs.lock().await;
                        if let Some(j) = jobs.iter_mut().find(|j| j.id == job_id) {
                            j.note_id = Some(hit.node_id);
                        }
                    }
                    transition_web_job(inner, job_id, ImportJobState::Done, Some(msg)).await;
                    return Ok(());
                }
                Ok(None) => {
                    // Not previously imported — continue.
                }
                Err(e) => {
                    // Non-fatal: log and continue. Dedup is best-effort.
                    warn!("find_node_by_source_id error (continuing import): {e}");
                }
            }

            if meta.is_live {
                fail_web_job(inner, job_id, web_media::WebMediaError::LiveStream).await;
                return Ok(());
            }

            if let Some(d) = meta.duration_seconds {
                if d > WEB_MEDIA_MAX_DURATION_SECONDS {
                    fail_web_job(
                        inner,
                        job_id,
                        web_media::WebMediaError::DurationExceedsLimit {
                            duration_seconds: d,
                            limit_seconds: WEB_MEDIA_MAX_DURATION_SECONDS,
                        },
                    )
                    .await;
                    return Ok(());
                }
            }

            // Advance to Downloading (Task 18 implements the handler for that state).
            transition_web_job(inner, job_id, ImportJobState::Downloading, None).await;
            Ok(())
        }
        Err(e) => {
            fail_web_job(inner, job_id, e).await;
            Ok(())
        }
    }
}

/// Download audio for a WebMedia job using yt-dlp, emit progress events, and
/// on success transition to `Preparing`. On cancel or error, clean up the
/// sidecar directory and transition to `Cancelled` / `Error`.
async fn handle_downloading(inner: &ImportQueueInner, job_id: &str) -> Result<(), String> {
    // Snapshot the fields we need without holding the lock across await points.
    let (url, draft_node_id, cancel, format) = {
        let mut jobs = inner.jobs.lock().await;
        let job = match jobs.iter_mut().find(|j| j.id == job_id) {
            Some(j) => j,
            None => return Ok(()),
        };
        // Assign a stable node-id now so the sidecar dir is deterministic.
        let node_id = job
            .draft_node_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        job.draft_node_id = Some(node_id.clone());
        let format = job
            .web_opts
            .as_ref()
            .map(|o| o.format.clone())
            .unwrap_or(web_media::WebMediaFormat::Mp3Audio);
        (
            job.source_path.to_string_lossy().to_string(),
            node_id,
            job.cancel_requested.clone(),
            format,
        )
    };

    let bin = match crate::plugin::yt_dlp::binary_path(&inner.app) {
        Ok(p) => p,
        Err(e) => {
            let msg = format!("yt-dlp binary path error: {e}");
            transition_web_job(inner, job_id, ImportJobState::Error, Some(msg)).await;
            return Ok(());
        }
    };

    // Sidecar dir lives under <vault>/.handy-media/web/<draft_node_id>/.
    let vault_root = inner.workspace.vault_root(&inner.app);
    let media_dir = vault_root
        .join(".handy-media")
        .join("web")
        .join(&draft_node_id);

    let handle = web_media::YtDlpHandle::new(bin);

    let app_for_emit = inner.app.clone();
    let job_id_owned = job_id.to_string();
    let on_progress = move |p: web_media::DownloadProgress| {
        let _ = app_for_emit.emit(
            "import-queue-job-progress",
            serde_json::json!({
                "id": job_id_owned,
                "bytes": p.bytes,
                "total": p.total_bytes,
                "speed": p.speed_human,
                "eta": p.eta_human,
            }),
        );
    };

    let result = match &format {
        web_media::WebMediaFormat::Mp3Audio => {
            handle.download_audio(&url, &media_dir, on_progress, cancel.clone()).await
        }
        web_media::WebMediaFormat::Mp4Video { max_height } => {
            handle.download_video(&url, &media_dir, *max_height, on_progress, cancel.clone()).await
        }
    };

    // Cancellation: clean up dir and mark Cancelled.
    if cancel.load(Ordering::Relaxed) {
        let _ = fs::remove_dir_all(&media_dir);
        transition_web_job(inner, job_id, ImportJobState::Cancelled, Some("Cancelled by user".into())).await;
        return Ok(());
    }

    match result {
        Ok(artefacts) => {
            if let Err(e) = web_media::verify_artefacts(&artefacts) {
                let _ = fs::remove_dir_all(&media_dir);
                fail_web_job(inner, job_id, e).await;
                return Ok(());
            }
            // Stash paths on the job for the Preparing handler. For mp4 we
            // re-use `local_audio_path` as "the path to hand to ffmpeg" —
            // `prepare_wav_for_transcription` handles video extensions.
            {
                let mut jobs = inner.jobs.lock().await;
                if let Some(job) = jobs.iter_mut().find(|j| j.id == job_id) {
                    job.local_audio_path = artefacts
                        .audio_path
                        .clone()
                        .or_else(|| artefacts.video_path.clone());
                    job.media_dir = Some(media_dir.clone());
                }
            }
            transition_web_job(inner, job_id, ImportJobState::Preparing, None).await;
            Ok(())
        }
        Err(e) => {
            let _ = fs::remove_dir_all(&media_dir);
            fail_web_job(inner, job_id, e).await;
            Ok(())
        }
    }
}

/// Compose the imported note title with a local-time stamp so repeated
/// imports of the same source on the same day don't collide on slug.
fn web_media_title(meta: Option<&web_media::WebMediaMetadata>) -> String {
    let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
    let base = meta
        .map(|m| m.title.clone())
        .unwrap_or_else(|| "Imported Media".to_string());
    format!("{} — {}", base, stamp)
}

/// Finalize a WebMedia job whose options say `transcribe = false`. Creates
/// the draft note with the `::web_clip` directive only (no transcript body),
/// stores web metadata in properties, writes empty segments.json sidecar,
/// honours `keep_media = false` cleanup, and transitions to Done.
async fn finalize_web_media_no_transcript(
    inner: &ImportQueueInner,
    job_id: &str,
    title: &str,
) -> Result<(), String> {
    let (web_meta, web_opts, draft_node_id, media_dir) = {
        let jobs = inner.jobs.lock().await;
        let Some(job) = jobs.iter().find(|j| j.id == job_id) else { return Ok(()); };
        let Some(meta) = job.web_meta.clone() else {
            drop(jobs);
            transition_web_job(
                inner, job_id, ImportJobState::Error,
                Some("WebMedia job missing metadata".into()),
            ).await;
            return Ok(());
        };
        let opts = job.web_opts.clone().unwrap_or_default();
        let Some(node_id) = job.draft_node_id.clone() else {
            drop(jobs);
            transition_web_job(
                inner, job_id, ImportJobState::Error,
                Some("WebMedia job missing draft node id".into()),
            ).await;
            return Ok(());
        };
        let media_dir = job.media_dir.clone();
        (meta, opts, node_id, media_dir)
    };

    patch_job(inner, job_id, |j| {
        j.state = ImportJobState::Finalizing;
        j.current_step = Some("Saving note…".into());
        j.progress = 0.95;
    }).await;

    let folder_id = ensure_file_import_folder(inner).await?;
    let draft = inner
        .workspace
        .create_document_child(&folder_id, title, "🎙️", "")
        .await
        .map_err(|e| format!("create_workspace_document: {e}"))?;
    let note_id = draft.id.clone();

    {
        let note_id_for_patch = note_id.clone();
        patch_job(inner, job_id, |j| { j.note_id = Some(note_id_for_patch); }).await;
    }
    emit_workspace_import_synced(inner, &note_id).await;

    let (props_json, body) = build_web_media_document(
        job_id, &web_meta, &web_opts, &draft_node_id, &[],
    )?;

    let finalized_node = match inner
        .workspace
        .update_node_body_persist_only(&note_id, &body)
        .await
    {
        Ok(n) => n,
        Err(e) => {
            update_job_state(inner, job_id, ImportJobState::Error, Some(format!("{e}"))).await;
            emit_workspace_import_synced(inner, &note_id).await;
            return Ok(());
        }
    };

    if let Err(e) = inner.workspace.update_node_properties(&note_id, &props_json).await {
        warn!("update_node_properties for WebMedia job {job_id}: {e}");
    }

    if let Some(mdir) = media_dir.as_ref() {
        if let Err(e) = write_segments_json(mdir, &[]) {
            warn!("write_segments_json for job {job_id}: {e}");
        }
        if !web_opts.keep_media {
            let _ = std::fs::remove_file(mdir.join("audio.mp3"));
            let _ = std::fs::remove_file(mdir.join("video.mp4"));
        }
    }

    emit_workspace_node_body_updated_immediate(&inner.app, &finalized_node);
    if let Err(e) = inner.workspace.finalize_node_search_index(&note_id).await {
        update_job_state(inner, job_id, ImportJobState::Error, Some(e)).await;
        emit_workspace_import_synced(inner, &note_id).await;
        return Ok(());
    }
    sync_workspace_document_to_vault(inner, &finalized_node).await;

    patch_job(inner, job_id, |j| {
        j.state = ImportJobState::Done;
        j.message = None;
        j.progress = 1.0;
        j.current_step = None;
    }).await;
    emit_workspace_import_synced(inner, &note_id).await;
    Ok(())
}

/// Hand a downloaded WebMedia job off to the appropriate finalizer. When the
/// user opted in to transcription (`web_opts.transcribe = true`, the default
/// for mp3) it delegates to `run_import_media`; otherwise it calls
/// `finalize_web_media_no_transcript` to write the directive-only note.
async fn handle_preparing_web_media(inner: &ImportQueueInner, job_id: &str) -> Result<(), String> {
    let (media_path, title, cancel, transcribe, kind) = {
        let jobs = inner.jobs.lock().await;
        let job = match jobs.iter().find(|j| j.id == job_id) {
            Some(j) => j,
            None => return Ok(()),
        };
        let media_path = match &job.local_audio_path {
            Some(p) => p.clone(),
            None => {
                drop(jobs);
                transition_web_job(
                    inner,
                    job_id,
                    ImportJobState::Error,
                    Some("WebMedia job missing downloaded media path".into()),
                )
                .await;
                return Ok(());
            }
        };
        let opts = job.web_opts.clone().unwrap_or_default();
        let title = web_media_title(job.web_meta.as_ref());
        let kind = match opts.format {
            web_media::WebMediaFormat::Mp3Audio => ImportJobKind::Audio,
            web_media::WebMediaFormat::Mp4Video { .. } => ImportJobKind::Video,
        };
        (media_path, title, job.cancel_requested.clone(), opts.transcribe, kind)
    };

    if !transcribe {
        return finalize_web_media_no_transcript(inner, job_id, &title).await;
    }

    let app_data = match crate::portable::app_data_dir(&inner.app)
        .or_else(|_| inner.app.path().app_data_dir())
    {
        Ok(p) => p,
        Err(e) => {
            transition_web_job(
                inner,
                job_id,
                ImportJobState::Error,
                Some(format!("app data dir: {e}")),
            )
            .await;
            return Ok(());
        }
    };
    let tmp_dir = app_data.join("import_tmp").join(job_id);
    let _ = fs::remove_dir_all(&tmp_dir);
    if let Err(e) = fs::create_dir_all(&tmp_dir) {
        transition_web_job(
            inner,
            job_id,
            ImportJobState::Error,
            Some(format!("import tmp dir: {e}")),
        )
        .await;
        return Ok(());
    }

    let r = run_import_media(
        inner,
        job_id,
        &media_path,
        kind,
        &title,
        &tmp_dir,
        cancel,
    )
    .await;
    let _ = fs::remove_dir_all(&tmp_dir);
    if let Err(e) = r {
        update_job_state(inner, job_id, ImportJobState::Error, Some(e.clone())).await;
        return Err(e);
    }
    Ok(())
}

/// Mark any import jobs that were in a transient state at the time of the last
/// process exit as `Error` with a "Interrupted — retry" message.
///
/// **Current implementation is a no-op stub.**
///
/// The import queue is entirely in-memory (jobs are not persisted to SQLite —
/// see the comment on `ImportJob` and `enqueue_urls`).  Because there is no
/// persistent store, stale jobs from a previous process cannot be recovered;
/// they simply vanish when the process exits.  This function is called at
/// boot so the wiring point is in place: when Task 34 or a future task adds
/// SQLite persistence for the queue, the healing logic goes here.
///
/// States that would be healed when persistence lands:
///   fetching_meta, downloading, preparing, segmenting, transcribing, post_processing
fn heal_interrupted_jobs() {
    // No-op: queue is in-memory only. See function docstring.
    // TODO: when import_jobs table is added, execute:
    // UPDATE import_jobs
    //   SET state = 'error', message = 'Interrupted — retry'
    //   WHERE state IN ('fetching_meta','downloading','preparing',
    //                   'segmenting','transcribing','post_processing');
}

impl ImportQueueService {
    pub fn spawn(
        app: AppHandle,
        workspace: Arc<WorkspaceManager>,
        tm: Arc<TranscriptionManager>,
    ) -> Self {
        // Heal any stale jobs left over from a previous process exit.
        // Currently a no-op because the queue is in-memory; the hook is here
        // so it's easy to wire up when SQLite persistence lands (Task 34).
        heal_interrupted_jobs();

        let wake = Arc::new(tokio::sync::Notify::new());
        let paused = Arc::new(AtomicBool::new(false));
        let inner = Arc::new(ImportQueueInner {
            app: app.clone(),
            jobs: TokioMutex::new(Vec::new()),
            wake: wake.clone(),
            workspace,
            tm,
            paused: paused.clone(),
        });

        let worker = inner.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                loop {
                    // While paused, idle in place so the worker loop doesn't
                    // block the tokio executor. A resume() call will notify
                    // wake, causing the outer loop to re-enter the inner loop.
                    if worker.paused.load(Ordering::Relaxed) {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    }
                    let next_id = {
                        let jobs = worker.jobs.lock().await;
                        jobs
                            .iter()
                            .find(|j| j.state == ImportJobState::Queued)
                            .map(|j| j.id.clone())
                    };
                    let Some(job_id) = next_id else {
                        break;
                    };
                    if let Err(e) = Self::run_one_job(&worker, &job_id).await {
                        error!("Import job {job_id} failed: {e}");
                    }
                }
                worker.wake.notified().await;
            }
        });

        Self { inner }
    }

    pub async fn enqueue_paths(&self, paths: Vec<String>) -> Result<Vec<String>, String> {
        let mut ids = Vec::new();
        for p in paths {
            let path = PathBuf::from(p.trim());
            if !path.is_file() {
                return Err(format!("Not a file or missing: {}", path.display()));
            }
            let kind = classify_path(&path);
            if kind == ImportJobKind::Unknown {
                return Err(format!(
                    "Unsupported type: {}",
                    path.file_name().and_then(|n| n.to_str()).unwrap_or("?")
                ));
            }
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
            ids.push(id);
        }
        emit_snapshot(&self.inner).await;
        self.inner.wake.notify_one();
        Ok(ids)
    }

    /// Enqueue one WebMedia import job per URL. Each job is in-memory only;
    /// web_opts are NOT persisted to SQLite — boot recovery (Task 21) will mark
    /// any in-flight WebMedia jobs as Error on restart.
    pub async fn enqueue_urls(
        &self,
        urls: Vec<String>,
        opts: web_media::WebMediaImportOpts,
    ) -> Result<Vec<String>, String> {
        let mut ids = Vec::with_capacity(urls.len());
        for url in urls {
            let id = uuid::Uuid::new_v4().to_string();
            let job = ImportJob {
                id: id.clone(),
                file_name: url.clone(),
                source_path: PathBuf::from(&url),
                kind: ImportJobKind::WebMedia,
                state: ImportJobState::Queued,
                message: None,
                note_id: None,
                cancel_requested: Arc::new(AtomicBool::new(false)),
                progress: 0.0,
                segment_index: 0,
                segment_count: 0,
                current_step: None,
                web_meta: None,
                web_opts: Some(opts.clone()),
                download_bytes: None,
                download_total_bytes: None,
                download_speed_human: None,
                draft_node_id: None,
                local_audio_path: None,
                media_dir: None,
            };
            self.inner.jobs.lock().await.push(job);
            ids.push(id);
        }
        emit_snapshot(&self.inner).await;
        self.inner.wake.notify_one();
        Ok(ids)
    }

    pub async fn snapshot(&self) -> ImportQueueSnapshot {
        let jobs = self
            .inner
            .jobs
            .lock()
            .await
            .iter()
            .map(ImportJob::to_dto)
            .collect();
        ImportQueueSnapshot { jobs }
    }

    pub async fn cancel_job(&self, job_id: String) -> Result<(), String> {
        let mut jobs = self.inner.jobs.lock().await;
        let pos = jobs
            .iter()
            .position(|j| j.id == job_id)
            .ok_or_else(|| "Job not found".to_string())?;
        let st = jobs[pos].state;
        if st == ImportJobState::Queued {
            jobs.remove(pos);
            drop(jobs);
            emit_snapshot(&self.inner).await;
            return Ok(());
        }
        if matches!(
            st,
            ImportJobState::Done | ImportJobState::Error | ImportJobState::Cancelled
        ) {
            return Err("Job already finished".into());
        }
        jobs[pos].cancel_requested.store(true, Ordering::SeqCst);
        jobs[pos].message = Some("Cancelling…".into());
        drop(jobs);
        emit_snapshot(&self.inner).await;
        Ok(())
    }

    /// Cancel all in-flight WebMedia jobs. Called by `uninstall_yt_dlp_plugin`
    /// before removing the binary so any active yt-dlp processes are signalled
    /// first. Best-effort — ignores errors from already-terminal jobs.
    pub async fn cancel_all_web_media_jobs(&self) -> Result<(), String> {
        let ids: Vec<String> = {
            let jobs = self.inner.jobs.lock().await;
            jobs.iter()
                .filter(|j| {
                    j.kind == ImportJobKind::WebMedia
                        && matches!(
                            j.state,
                            ImportJobState::Queued
                                | ImportJobState::FetchingMeta
                                | ImportJobState::Downloading
                                | ImportJobState::Preparing
                        )
                })
                .map(|j| j.id.clone())
                .collect()
        };
        for id in ids {
            // Ignore "already finished" errors — race between check and cancel.
            let _ = self.cancel_job(id).await;
        }
        Ok(())
    }

    /// Remove all terminal-state jobs (Done / Error / Cancelled) from the
    /// in-memory queue. Active jobs (Queued, Downloading, etc.) are retained.
    pub async fn clear_completed_imports(&self) -> Result<(), String> {
        {
            let mut jobs = self.inner.jobs.lock().await;
            jobs.retain(|j| !matches!(
                j.state,
                ImportJobState::Done | ImportJobState::Error | ImportJobState::Cancelled,
            ));
        }
        emit_snapshot(&self.inner).await;
        Ok(())
    }

    /// Expose the underlying WorkspaceManager so Tauri commands (e.g.
    /// `fetch_url_metadata`) can call workspace queries without needing a
    /// separate `tauri::State<Arc<WorkspaceManager>>` parameter.
    pub fn workspace_manager(&self) -> Arc<WorkspaceManager> {
        self.inner.workspace.clone()
    }

    /// Pause the worker loop. In-flight jobs finish; new Queued jobs are not
    /// started until `resume` is called.
    pub fn pause(&self) {
        self.inner.paused.store(true, Ordering::Relaxed);
    }

    /// Resume the worker loop and notify the worker to re-check the queue.
    pub fn resume(&self) {
        self.inner.paused.store(false, Ordering::Relaxed);
        self.inner.wake.notify_one();
    }

    /// Return whether the queue is currently paused.
    pub fn is_paused(&self) -> bool {
        self.inner.paused.load(Ordering::Relaxed)
    }

    async fn run_one_job(inner: &ImportQueueInner, job_id: &str) -> Result<(), String> {
        // Route WebMedia jobs to their own handler before the file-import path
        // (which creates temp dirs and transitions to Preparing — neither applies
        // to URL-based imports that use yt-dlp).
        let kind = {
            let jobs = inner.jobs.lock().await;
            jobs.iter().find(|j| j.id == job_id).map(|j| j.kind)
        };
        if kind == Some(ImportJobKind::WebMedia) {
            return run_web_media_job(inner, job_id).await;
        }

        let (kind, source_path, title_base, cancel_flag) = {
            let mut jobs = inner.jobs.lock().await;
            let Some(job) = jobs.iter_mut().find(|j| j.id == job_id) else {
                return Ok(());
            };
            if job.state != ImportJobState::Queued {
                return Ok(());
            }
            job.state = ImportJobState::Preparing;
            job.message = None;
            (
                job.kind,
                job.source_path.clone(),
                job.file_name.clone(),
                job.cancel_requested.clone(),
            )
        };
        emit_snapshot(inner).await;

        let title = title_base
            .rsplit_once('.')
            .map(|(stem, _)| stem.to_string())
            .unwrap_or(title_base.clone());

        let app_data = match portable::app_data_dir(&inner.app).or_else(|_| inner.app.path().app_data_dir()) {
            Ok(p) => p,
            Err(e) => {
                update_job_state(
                    inner,
                    job_id,
                    ImportJobState::Error,
                    Some(format!("app data dir: {e}")),
                )
                .await;
                return Ok(());
            }
        };
        let tmp_dir = app_data.join("import_tmp").join(job_id);
        let _ = fs::remove_dir_all(&tmp_dir);
        if let Err(e) = fs::create_dir_all(&tmp_dir) {
            update_job_state(
                inner,
                job_id,
                ImportJobState::Error,
                Some(format!("import tmp dir: {e}")),
            )
            .await;
            return Ok(());
        }

        if matches!(kind, ImportJobKind::Audio | ImportJobKind::Video) {
            let r = run_import_media(
                inner,
                job_id,
                &source_path,
                kind,
                &title,
                &tmp_dir,
                cancel_flag,
            )
            .await;
            let _ = fs::remove_dir_all(&tmp_dir);
            if let Err(e) = r {
                update_job_state(inner, job_id, ImportJobState::Error, Some(e.clone()))
                    .await;
                return Err(e);
            }
            return Ok(());
        }

        let result: Result<String, String> = match kind {
            ImportJobKind::Markdown | ImportJobKind::PlainText => {
                update_job_state(inner, job_id, ImportJobState::ExtractingText, None).await;
                match fs::read(&source_path) {
                    Ok(bytes) => {
                        let text = decode_utf8_with_fallback(&bytes);
                        Ok(text.into_owned())
                    }
                    Err(e) => Err(format!("Read file: {e}")),
                }
            }
            ImportJobKind::Pdf => {
                update_job_state(inner, job_id, ImportJobState::ExtractingText, None).await;
                pdf_text(&source_path)
            }
            _ => Err("Unsupported file type".to_string()),
        };

        let _ = fs::remove_dir_all(&tmp_dir);

        let body = match result {
            Ok(t) => t,
            Err(e) => {
                update_job_state(
                    inner,
                    job_id,
                    ImportJobState::Error,
                    Some(e.clone()),
                )
                .await;
                return Err(e);
            }
        };

        update_job_state(inner, job_id, ImportJobState::CreatingNote, None).await;

        let (content, truncated) = truncate_body(&body);
        let folder_id = match ensure_file_import_folder(inner).await {
            Ok(id) => id,
            Err(e) => {
                update_job_state(inner, job_id, ImportJobState::Error, Some(e.clone())).await;
                return Ok(());
            }
        };
        let note = match inner
            .workspace
            .create_document_child(&folder_id, &title, "📄", &content)
            .await
        {
            Ok(n) => n,
            Err(e) => {
                let msg = format!("create_workspace_document: {e}");
                update_job_state(inner, job_id, ImportJobState::Error, Some(msg)).await;
                return Ok(());
            }
        };
        sync_workspace_document_to_vault(inner, &note).await;
        if let Err(e) = inner.workspace.finalize_node_search_index(&note.id).await {
            update_job_state(inner, job_id, ImportJobState::Error, Some(e)).await;
            emit_workspace_import_synced(inner, &note.id).await;
            return Ok(());
        }

        if truncated {
            info!("Import note {} body was truncated to cap", note.id);
        }

        {
            let mut jobs = inner.jobs.lock().await;
            if let Some(j) = jobs.iter_mut().find(|j| j.id == job_id) {
                j.state = ImportJobState::Done;
                j.note_id = Some(note.id.clone());
                j.message = None;
                j.progress = 1.0;
            }
        }
        emit_snapshot(inner).await;
        emit_workspace_import_synced(inner, &note.id).await;
        Ok(())
    }
}

#[cfg(test)]
mod boot_recovery_tests {
    use super::*;

    /// `heal_interrupted_jobs` must not panic (it is a no-op stub today).
    /// When SQLite persistence for the queue lands, this test will be extended
    /// to pre-populate a persisted state and assert jobs move to Error.
    #[test]
    fn heal_interrupted_jobs_is_safe_noop() {
        // Should complete without panic or error.
        heal_interrupted_jobs();
    }
}

#[cfg(test)]
mod enqueue_urls_unit_tests {
    use super::*;
    use crate::import::web_media::WebMediaImportOpts;

    /// Construct the ImportJob the same way enqueue_urls does, then assert fields.
    /// This is a pure-unit test — no AppHandle, no async runtime complexity.
    #[test]
    fn web_media_job_fields_are_set_correctly() {
        let url = "https://www.youtube.com/watch?v=abc".to_string();
        let opts = WebMediaImportOpts::default();
        let id = "test-id".to_string();
        let job = ImportJob {
            id: id.clone(),
            file_name: url.clone(),
            source_path: PathBuf::from(&url),
            kind: ImportJobKind::WebMedia,
            state: ImportJobState::Queued,
            message: None,
            note_id: None,
            cancel_requested: Arc::new(AtomicBool::new(false)),
            progress: 0.0,
            segment_index: 0,
            segment_count: 0,
            current_step: None,
            web_meta: None,
            web_opts: Some(opts),
            download_bytes: None,
            download_total_bytes: None,
            download_speed_human: None,
            draft_node_id: None,
            local_audio_path: None,
            media_dir: None,
        };
        assert_eq!(job.kind, ImportJobKind::WebMedia);
        assert_eq!(job.state, ImportJobState::Queued);
        assert!(job.web_opts.is_some());
        assert!(job.web_meta.is_none());
        let dto = job.to_dto();
        assert_eq!(dto.kind, ImportJobKind::WebMedia);
        assert!(dto.web_meta.is_none());
        assert!(dto.download_bytes.is_none());
    }

    #[test]
    fn enqueue_urls_opts_default_keep_media_true() {
        let opts = WebMediaImportOpts::default();
        assert!(opts.keep_media);
        assert!(opts.transcribe);
        assert!(opts.parent_folder_node_id.is_none());
        assert!(opts.playlist_source.is_none());
        // format is Mp3Audio by default
        assert!(matches!(opts.format, crate::import::web_media::WebMediaFormat::Mp3Audio));
    }
}

#[cfg(test)]
mod web_media_enum_tests {
    use super::*;

    #[test]
    fn web_media_kind_serializes_snake_case() {
        let kind = ImportJobKind::WebMedia;
        let json = serde_json::to_string(&kind).unwrap();
        assert_eq!(json, "\"web_media\"");
    }

    #[test]
    fn fetching_meta_state_serializes_snake_case() {
        let state = ImportJobState::FetchingMeta;
        let json = serde_json::to_string(&state).unwrap();
        assert_eq!(json, "\"fetching_meta\"");
    }

    #[test]
    fn downloading_state_serializes_snake_case() {
        let state = ImportJobState::Downloading;
        let json = serde_json::to_string(&state).unwrap();
        assert_eq!(json, "\"downloading\"");
    }

    #[test]
    fn import_job_dto_web_fields_default_none_for_non_web_jobs() {
        let dto = ImportJobDto {
            id: "test".into(),
            file_name: "x.pdf".into(),
            source_path: "/tmp/x.pdf".into(),
            kind: ImportJobKind::Pdf,
            state: ImportJobState::Queued,
            message: None,
            note_id: None,
            progress: 0.0,
            segment_index: 0,
            segment_count: 0,
            current_step: None,
            web_meta: None,
            download_bytes: None,
            download_total_bytes: None,
            download_speed_human: None,
        };
        assert!(dto.web_meta.is_none());
        assert!(dto.download_bytes.is_none());
    }
}

#[cfg(test)]
mod web_media_vault_write_tests {
    use super::*;
    use crate::import::web_media::{WebMediaImportOpts, WebMediaMetadata};

    fn make_meta() -> WebMediaMetadata {
        WebMediaMetadata {
            url: "https://www.youtube.com/watch?v=test".into(),
            source_id: "test".into(),
            title: "Test Video".into(),
            thumbnail_url: None,
            duration_seconds: Some(213.0),
            channel: Some("Channel".into()),
            platform: "youtube".into(),
            published_at: Some("2025-10-15".into()),
            available_video_heights: vec![720, 1080],
            is_live: false,
        }
    }

    #[test]
    fn build_document_includes_required_properties_keys() {
        let meta = make_meta();
        let opts = WebMediaImportOpts::default();
        let paragraphs = vec!["Hello.".into(), "World.".into()];
        let (props_json, body) =
            build_web_media_document("job-1", &meta, &opts, "node-uuid-here", &paragraphs)
                .unwrap();

        // Properties JSON must be a valid object containing a "web_media" key.
        let v: serde_json::Value = serde_json::from_str(&props_json).unwrap();
        let wm = v.get("web_media").expect("missing web_media key");
        for key in [
            "source_url", "source_id", "source_platform", "media_dir",
            "imported_at", "imported_via", "media_kept", "import_job_id",
        ] {
            assert!(
                wm.get(key).is_some(),
                "missing web_media.{key} in properties"
            );
        }

        // Body must start with the ::web_clip directive and contain transcript content.
        assert!(body.starts_with("::web_clip{"), "body does not start with ::web_clip directive");
        assert!(body.contains("Hello."), "body missing first paragraph");
        assert!(body.contains("World."), "body missing second paragraph");
    }

    #[test]
    fn build_document_directive_contains_url_and_platform() {
        let meta = make_meta();
        let opts = WebMediaImportOpts::default();
        let (_, body) =
            build_web_media_document("job-2", &meta, &opts, "nid", &[]).unwrap();
        assert!(body.contains("youtube.com/watch"), "directive missing URL");
        assert!(body.contains("youtube"), "directive missing platform");
    }

    #[test]
    fn build_document_media_dir_uses_draft_node_id() {
        let meta = make_meta();
        let opts = WebMediaImportOpts::default();
        let (props_json, _) =
            build_web_media_document("job-3", &meta, &opts, "abc-123", &[]).unwrap();
        let v: serde_json::Value = serde_json::from_str(&props_json).unwrap();
        let media_dir = v["web_media"]["media_dir"].as_str().unwrap();
        assert!(media_dir.contains("abc-123"), "media_dir does not embed draft_node_id");
    }

    #[test]
    fn write_segments_json_empty_is_valid_json_array() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_segments_json(tmp.path(), &[]).unwrap();
        let content = std::fs::read_to_string(tmp.path().join("segments.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(v.is_array());
        assert_eq!(v.as_array().unwrap().len(), 0);
    }

    #[test]
    fn write_segments_json_roundtrip() {
        let tmp = tempfile::TempDir::new().unwrap();
        let segs = vec![(0u64, 1500u64, "Hello world.".to_string())];
        write_segments_json(tmp.path(), &segs).unwrap();
        let content = std::fs::read_to_string(tmp.path().join("segments.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&content).unwrap();
        let arr = v.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["start_ms"], 0);
        assert_eq!(arr[0]["end_ms"], 1500);
        assert_eq!(arr[0]["text"], "Hello world.");
    }
}
