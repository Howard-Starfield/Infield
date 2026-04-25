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

    let finalized_node = match inner
        .workspace
        .update_node_body_persist_only(&note_id, &final_body)
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

/// Worker entry-point for WebMedia jobs. Transitions Queued → FetchingMeta then runs the handler.
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
    handle_fetching_meta(inner, job_id).await
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

impl ImportQueueService {
    pub fn spawn(
        app: AppHandle,
        workspace: Arc<WorkspaceManager>,
        tm: Arc<TranscriptionManager>,
    ) -> Self {
        let wake = Arc::new(tokio::sync::Notify::new());
        let inner = Arc::new(ImportQueueInner {
            app: app.clone(),
            jobs: TokioMutex::new(Vec::new()),
            wake: wake.clone(),
            workspace,
            tm,
        });

        let worker = inner.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                loop {
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
