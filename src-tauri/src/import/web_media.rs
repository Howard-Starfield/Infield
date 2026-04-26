//! yt-dlp wrapper. URL-specific concerns isolated here.
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WebMediaMetadata {
    pub url: String,
    pub source_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    pub platform: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    pub available_video_heights: Vec<u32>,
    pub is_live: bool,
}

#[derive(Debug, Clone, Error, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WebMediaError {
    #[error("Unsupported source: {0}")]
    Unsupported(String),
    #[error("Content not available in this region")]
    RegionUnavailable { country: Option<String> },
    #[error("Authentication required (private / members-only / restricted)")]
    AuthRequired,
    #[error("Content deleted or not found")]
    DeletedOrNotFound,
    #[error("Live streams aren't supported")]
    LiveStream,
    #[error("Duration {duration_seconds}s exceeds limit {limit_seconds}s")]
    DurationExceedsLimit { duration_seconds: f64, limit_seconds: f64 },
    #[error("Network error: {0}")]
    NetworkError(String),
    #[error("yt-dlp plugin not installed")]
    YtDlpNotFound,
    #[error("yt-dlp crashed (exit {exit_code})")]
    YtDlpCrashed { exit_code: i32, stderr_tail: String },
    #[error("ffmpeg failed: {0}")]
    FfmpegFailed(String),
    #[error("Disk full")]
    DiskFull,
    #[error("Downloaded file failed integrity check")]
    IntegrityCheckFailed,
}

pub struct YtDlpHandle {
    pub binary: PathBuf,
}

impl YtDlpHandle {
    pub fn new(binary: PathBuf) -> Self { Self { binary } }
    pub fn is_available(&self) -> bool { self.binary.exists() }
}

pub fn parse_metadata(json: &str, url: &str) -> Result<WebMediaMetadata, WebMediaError> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| WebMediaError::YtDlpCrashed { exit_code: 0, stderr_tail: format!("JSON parse: {}", e) })?;

    let source_id = v["id"].as_str().ok_or_else(||
        WebMediaError::Unsupported("yt-dlp returned no id".into()))?.to_string();
    let title = v["title"].as_str().unwrap_or("Untitled").to_string();
    let thumbnail_url = v["thumbnail"].as_str().map(|s| s.to_string());
    let duration_seconds = v["duration"].as_f64();
    let channel = v["channel"].as_str().or_else(|| v["uploader"].as_str()).map(|s| s.to_string());
    let platform = v["extractor_key"].as_str().or_else(|| v["extractor"].as_str())
        .unwrap_or("unknown").to_string().to_lowercase();
    let published_at = v["upload_date"].as_str().and_then(|d| {
        if d.len() == 8 { Some(format!("{}-{}-{}", &d[0..4], &d[4..6], &d[6..8])) } else { None }
    });
    let is_live = v["is_live"].as_bool().unwrap_or(false);
    let mut heights: Vec<u32> = v["formats"].as_array().map(|fs| {
        fs.iter().filter_map(|f| f["height"].as_u64().map(|h| h as u32)).filter(|h| *h > 0).collect()
    }).unwrap_or_default();
    heights.sort_unstable();
    heights.dedup();

    Ok(WebMediaMetadata {
        url: url.to_string(), source_id, title, thumbnail_url, duration_seconds, channel,
        platform, published_at, available_video_heights: heights, is_live,
    })
}

pub fn classify_stderr(stderr: &str, exit_code: i32) -> WebMediaError {
    let s = stderr.to_ascii_lowercase();
    if s.contains("unsupported url") {
        WebMediaError::Unsupported(stderr.lines().last().unwrap_or("").trim().to_string())
    } else if s.contains("private video") || s.contains("login required")
              || s.contains("members-only") || s.contains("sign in")
              || s.contains("confirm your age") {
        WebMediaError::AuthRequired
    } else if s.contains("not available in your country")
              || (s.contains("video unavailable") && s.contains("country")) {
        WebMediaError::RegionUnavailable { country: None }
    } else if s.contains("video unavailable") || s.contains("video not found") || s.contains("does not exist") {
        WebMediaError::DeletedOrNotFound
    } else if s.contains("network") || s.contains("timed out") || s.contains("connection") {
        WebMediaError::NetworkError(stderr.lines().last().unwrap_or("").trim().to_string())
    } else {
        let tail: String = stderr.chars().rev().take(500).collect::<String>().chars().rev().collect();
        WebMediaError::YtDlpCrashed { exit_code, stderr_tail: tail }
    }
}

impl YtDlpHandle {
    pub async fn fetch_metadata(&self, url: &str) -> Result<WebMediaMetadata, WebMediaError> {
        if !self.is_available() { return Err(WebMediaError::YtDlpNotFound); }
        let out = tokio::process::Command::new(&self.binary)
            .args(["--dump-json", "--no-playlist", "--no-warnings", url])
            .output().await
            .map_err(|e| WebMediaError::NetworkError(e.to_string()))?;
        if !out.status.success() {
            return Err(classify_stderr(&String::from_utf8_lossy(&out.stderr), out.status.code().unwrap_or(-1)));
        }
        parse_metadata(&String::from_utf8_lossy(&out.stdout), url)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PlaylistEntry {
    pub url: String,
    pub source_id: String,
    pub title: String,
    pub duration_seconds: Option<f64>,
    pub thumbnail_url: Option<String>,
    pub channel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PlaylistEnvelope {
    pub playlist_url: String,
    pub playlist_title: String,
    pub channel: Option<String>,
    pub entries: Vec<PlaylistEntry>,
}

pub fn parse_playlist(json: &str, url: &str) -> Result<PlaylistEnvelope, WebMediaError> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| WebMediaError::YtDlpCrashed { exit_code: 0, stderr_tail: e.to_string() })?;
    let playlist_title = v["title"].as_str().unwrap_or("Untitled playlist").to_string();
    let channel = v["uploader"].as_str().or_else(|| v["channel"].as_str()).map(|s| s.to_string());
    let entries = v["entries"].as_array().map(|arr| {
        arr.iter().filter_map(|e| {
            let id = e["id"].as_str()?.to_string();
            let title = e["title"].as_str().unwrap_or("Untitled").to_string();
            let entry_url = e["url"].as_str().or_else(|| e["webpage_url"].as_str())
                .unwrap_or(&id).to_string();
            Some(PlaylistEntry {
                url: entry_url, source_id: id, title,
                duration_seconds: e["duration"].as_f64(),
                thumbnail_url: e["thumbnail"].as_str().map(|s| s.to_string()),
                channel: e["channel"].as_str().or_else(|| e["uploader"].as_str()).map(|s| s.to_string()),
            })
        }).collect()
    }).unwrap_or_default();
    Ok(PlaylistEnvelope { playlist_url: url.to_string(), playlist_title, channel, entries })
}

impl YtDlpHandle {
    pub async fn fetch_playlist_entries(&self, url: &str) -> Result<PlaylistEnvelope, WebMediaError> {
        if !self.is_available() { return Err(WebMediaError::YtDlpNotFound); }
        let out = tokio::process::Command::new(&self.binary)
            .args(["--flat-playlist", "--dump-single-json", "--no-warnings", url])
            .output().await
            .map_err(|e| WebMediaError::NetworkError(e.to_string()))?;
        if !out.status.success() {
            return Err(classify_stderr(&String::from_utf8_lossy(&out.stderr), out.status.code().unwrap_or(-1)));
        }
        parse_playlist(&String::from_utf8_lossy(&out.stdout), url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handle_reports_availability_from_path() {
        let h = YtDlpHandle::new(PathBuf::from("/nonexistent/yt-dlp"));
        assert!(!h.is_available());
    }

    #[test]
    fn web_media_format_serializes_with_snake_case_kind() {
        // Guards against bindings drift — serde's rename_all = "snake_case"
        // produces "mp3_audio" and "mp4_video" (no underscore around the digit).
        // The TS bindings MUST match these wire strings exactly or
        // enqueue_import_urls deserialization fails silently.
        let f = WebMediaFormat::Mp3Audio;
        assert_eq!(serde_json::to_string(&f).unwrap(), r#"{"kind":"mp3_audio"}"#);
        let f2 = WebMediaFormat::Mp4Video { max_height: 720 };
        assert_eq!(
            serde_json::to_string(&f2).unwrap(),
            r#"{"kind":"mp4_video","max_height":720}"#
        );
    }

    #[test]
    fn video_format_arg_uses_max_height() {
        assert_eq!(build_video_format_arg(720), "bv*[height<=720]+ba/b[height<=720]");
        assert_eq!(build_video_format_arg(1080), "bv*[height<=1080]+ba/b[height<=1080]");
    }

    #[test]
    fn error_serializes_with_kind_tag() {
        let e = WebMediaError::AuthRequired;
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"kind\":\"auth_required\""));
    }
}

#[cfg(test)]
mod parse_tests {
    use super::*;

    const YT_FIXTURE: &str = include_str!("web_media_fixtures/youtube_video.json");

    #[test]
    fn parses_youtube_fixture() {
        let m = parse_metadata(YT_FIXTURE, "https://www.youtube.com/watch?v=test").unwrap();
        assert!(!m.title.is_empty());
        assert!(!m.source_id.is_empty());
        assert!(m.platform.contains("youtube"));
    }

    #[test]
    fn classifies_auth_required() {
        let e = classify_stderr("ERROR: Private video. Sign in to watch.", 1);
        assert!(matches!(e, WebMediaError::AuthRequired));
    }

    #[test]
    fn classifies_unsupported() {
        let e = classify_stderr("ERROR: Unsupported URL: file://localhost/x", 1);
        assert!(matches!(e, WebMediaError::Unsupported(_)));
    }

    #[test]
    fn classifies_deleted() {
        let e = classify_stderr("ERROR: Video unavailable. This video is not available.", 1);
        assert!(matches!(e, WebMediaError::DeletedOrNotFound));
    }

    #[test]
    fn parses_youtube_playlist_fixture() {
        let json = include_str!("web_media_fixtures/youtube_playlist.json");
        let p = parse_playlist(json, "https://www.youtube.com/playlist?list=PLxyz").unwrap();
        assert!(!p.playlist_title.is_empty());
        assert!(!p.entries.is_empty());
    }
}

// ── Task 13: Download with progress + cancellation ──────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WebMediaFormat {
    Mp3Audio,
    Mp4Video { max_height: u32 },
}

impl Default for WebMediaFormat {
    fn default() -> Self { WebMediaFormat::Mp3Audio }
}

pub fn build_video_format_arg(max_height: u32) -> String {
    format!("bv*[height<={h}]+ba/b[height<={h}]", h = max_height)
}

// ── Task 15: Import opts types ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AlreadyImportedHit {
    pub node_id: String,
    pub imported_at: String,
    pub vault_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PlaylistSource {
    pub title: String,
    pub url: String,
    pub index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WebMediaImportOpts {
    pub keep_media: bool,
    pub format: WebMediaFormat,
    pub transcribe: bool,
    pub parent_folder_node_id: Option<String>,
    pub playlist_source: Option<PlaylistSource>,
}

impl Default for WebMediaImportOpts {
    fn default() -> Self {
        Self {
            keep_media: true,
            format: WebMediaFormat::default(),
            transcribe: true,
            parent_folder_node_id: None,
            playlist_source: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct MediaArtefacts {
    pub audio_path: Option<PathBuf>,
    pub video_path: Option<PathBuf>,
    pub thumbnail_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct DownloadProgress {
    pub bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed_human: Option<String>,
    pub eta_human: Option<String>,
}

/// Parse yt-dlp progress lines, e.g.
/// `[download]   12.3% of   40.00MiB at  2.10MiB/s ETA 00:14`
pub fn parse_progress_line(line: &str) -> Option<DownloadProgress> {
    if !line.contains("[download]") { return None; }
    let mut total_bytes: Option<u64> = None;
    let mut speed_human: Option<String> = None;
    let mut eta_human: Option<String> = None;
    let mut percent: Option<f64> = None;

    if let Some(idx) = line.find('%') {
        let pre: String = line[..idx].chars().rev()
            .take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        let pre: String = pre.chars().rev().collect();
        percent = pre.parse::<f64>().ok();
    }
    if let Some(of_idx) = line.find(" of ") {
        let after = line[of_idx + 4..].trim_start();
        let token: String = after.chars().take_while(|c| !c.is_whitespace()).collect();
        total_bytes = parse_size_token(&token);
    }
    if let Some(at_idx) = line.find(" at ") {
        let after = &line[at_idx + 4..];
        let speed: String = after.split_whitespace().next().unwrap_or("").to_string();
        if !speed.is_empty() { speed_human = Some(speed); }
    }
    if let Some(eta_idx) = line.find(" ETA ") {
        let token: String = line[eta_idx + 5..].chars().take_while(|c| !c.is_whitespace()).collect();
        if !token.is_empty() { eta_human = Some(token); }
    }
    let bytes = match (percent, total_bytes) {
        (Some(p), Some(t)) => ((p / 100.0) * t as f64) as u64,
        _ => 0,
    };
    Some(DownloadProgress { bytes, total_bytes, speed_human, eta_human })
}

fn parse_size_token(s: &str) -> Option<u64> {
    let s = s.trim();
    let (num_part, suffix): (String, String) = s.chars().partition(|c| c.is_ascii_digit() || *c == '.');
    let n: f64 = num_part.parse().ok()?;
    let mult: f64 = match suffix.to_ascii_uppercase().trim() {
        "B" => 1.0,
        "KIB" | "K" => 1024.0,
        "MIB" | "M" => 1024.0 * 1024.0,
        "GIB" | "G" => 1024.0 * 1024.0 * 1024.0,
        "TIB" | "T" => 1024.0_f64.powi(4),
        _ => return None,
    };
    Some((n * mult) as u64)
}

#[cfg(test)]
mod progress_tests {
    use super::*;

    #[test]
    fn parses_typical_line() {
        let p = parse_progress_line("[download]   12.3% of   40.00MiB at  2.10MiB/s ETA 00:14").unwrap();
        assert_eq!(p.total_bytes, Some(40 * 1024 * 1024));
        assert_eq!(p.eta_human.as_deref(), Some("00:14"));
    }

    #[test]
    fn ignores_non_progress_lines() {
        assert!(parse_progress_line("[info] something").is_none());
    }
}

impl YtDlpHandle {
    pub async fn download_audio(
        &self, url: &str, target_dir: &Path,
        on_progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
        cancel: Arc<AtomicBool>,
    ) -> Result<MediaArtefacts, WebMediaError> {
        if !self.is_available() { return Err(WebMediaError::YtDlpNotFound); }
        std::fs::create_dir_all(target_dir).map_err(|e| WebMediaError::FfmpegFailed(e.to_string()))?;

        let out_template = target_dir.join("audio.%(ext)s");
        let thumb_template = target_dir.join("thumbnail.%(ext)s");

        let mut cmd = tokio::process::Command::new(&self.binary);
        cmd.args([
            "-x", "--audio-format", "mp3", "--audio-quality", "2",
            "--write-thumbnail", "--convert-thumbnails", "jpg",
            "--no-playlist", "--newline",
            "--sleep-interval", "1", "--max-sleep-interval", "3",
            "-o", out_template.to_str().unwrap(),
            "-o", &format!("thumbnail:{}", thumb_template.display()),
            url,
        ]);
        cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());

        configure_process_group(&mut cmd);

        let mut child = cmd.spawn().map_err(|e| WebMediaError::YtDlpCrashed {
            exit_code: -1, stderr_tail: e.to_string()
        })?;
        let pid = child.id();

        let stdout = child.stdout.take().unwrap();
        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_buf = String::new();

        let cancel_clone = cancel.clone();
        let progress_task = tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                if cancel_clone.load(Ordering::Relaxed) { break; }
                if let Some(p) = parse_progress_line(&line) { on_progress(p); }
            }
        });

        let cancel_watch = cancel.clone();
        let cancel_kill = tokio::spawn(async move {
            while !cancel_watch.load(Ordering::Relaxed) {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
            kill_process_group(pid);
        });

        let status = child.wait().await.map_err(|e| WebMediaError::YtDlpCrashed {
            exit_code: -1, stderr_tail: e.to_string()
        })?;
        let _ = progress_task.await;
        cancel_kill.abort();

        if let Some(mut e) = child.stderr.take() {
            use tokio::io::AsyncReadExt;
            let _ = e.read_to_string(&mut stderr_buf).await;
        }

        if cancel.load(Ordering::Relaxed) {
            return Err(WebMediaError::IntegrityCheckFailed);
        }
        if !status.success() {
            return Err(classify_stderr(&stderr_buf, status.code().unwrap_or(-1)));
        }

        let audio_path = find_one_with_prefix(target_dir, "audio.")?;
        let thumbnail_path = find_one_with_prefix(target_dir, "thumbnail.").ok();
        Ok(MediaArtefacts { audio_path: Some(audio_path), video_path: None, thumbnail_path })
    }
}

impl YtDlpHandle {
    pub async fn download_video(
        &self, url: &str, target_dir: &Path, max_height: u32,
        on_progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
        cancel: Arc<AtomicBool>,
    ) -> Result<MediaArtefacts, WebMediaError> {
        if !self.is_available() { return Err(WebMediaError::YtDlpNotFound); }
        std::fs::create_dir_all(target_dir).map_err(|e| WebMediaError::FfmpegFailed(e.to_string()))?;

        let out_template = target_dir.join("video.%(ext)s");
        let thumb_template = target_dir.join("thumbnail.%(ext)s");
        let format_arg = build_video_format_arg(max_height);

        let mut cmd = tokio::process::Command::new(&self.binary);
        cmd.args([
            "-f", &format_arg,
            "--merge-output-format", "mp4",
            "--write-thumbnail", "--convert-thumbnails", "jpg",
            "--no-playlist", "--newline",
            "--sleep-interval", "1", "--max-sleep-interval", "3",
            "-o", out_template.to_str().unwrap(),
            "-o", &format!("thumbnail:{}", thumb_template.display()),
            url,
        ]);
        cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());

        configure_process_group(&mut cmd);

        let mut child = cmd.spawn().map_err(|e| WebMediaError::YtDlpCrashed {
            exit_code: -1, stderr_tail: e.to_string()
        })?;
        let pid = child.id();

        let stdout = child.stdout.take().unwrap();
        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_buf = String::new();

        let cancel_clone = cancel.clone();
        let progress_task = tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                if cancel_clone.load(Ordering::Relaxed) { break; }
                if let Some(p) = parse_progress_line(&line) { on_progress(p); }
            }
        });

        let cancel_watch = cancel.clone();
        let cancel_kill = tokio::spawn(async move {
            while !cancel_watch.load(Ordering::Relaxed) {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
            kill_process_group(pid);
        });

        let status = child.wait().await.map_err(|e| WebMediaError::YtDlpCrashed {
            exit_code: -1, stderr_tail: e.to_string()
        })?;
        let _ = progress_task.await;
        cancel_kill.abort();

        if let Some(mut e) = child.stderr.take() {
            use tokio::io::AsyncReadExt;
            let _ = e.read_to_string(&mut stderr_buf).await;
        }

        if cancel.load(Ordering::Relaxed) {
            return Err(WebMediaError::IntegrityCheckFailed);
        }
        if !status.success() {
            return Err(classify_stderr(&stderr_buf, status.code().unwrap_or(-1)));
        }

        let video_path = target_dir.join("video.mp4");
        let final_video = if video_path.exists() {
            video_path
        } else {
            find_one_with_prefix(target_dir, "video.")?
        };
        let thumbnail_path = find_one_with_prefix(target_dir, "thumbnail.").ok();
        Ok(MediaArtefacts { audio_path: None, video_path: Some(final_video), thumbnail_path })
    }
}

fn find_one_with_prefix(dir: &Path, prefix: &str) -> Result<PathBuf, WebMediaError> {
    for entry in std::fs::read_dir(dir).map_err(|e| WebMediaError::FfmpegFailed(e.to_string()))? {
        let entry = entry.map_err(|e| WebMediaError::FfmpegFailed(e.to_string()))?;
        if entry.file_name().to_string_lossy().starts_with(prefix) { return Ok(entry.path()); }
    }
    Err(WebMediaError::IntegrityCheckFailed)
}

#[cfg(unix)]
fn configure_process_group(cmd: &mut tokio::process::Command) {
    use std::os::unix::process::CommandExt as UnixCommandExt;
    unsafe {
        cmd.pre_exec(|| { libc::setsid(); Ok(()) });
    }
}

#[cfg(windows)]
fn configure_process_group(cmd: &mut tokio::process::Command) {
    use std::os::windows::process::CommandExt as WinCommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
    cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);
}

#[cfg(unix)]
fn kill_process_group(pid: Option<u32>) {
    unsafe { if let Some(p) = pid { libc::killpg(p as i32, libc::SIGTERM); } }
}

#[cfg(windows)]
fn kill_process_group(_pid: Option<u32>) {
    // On Windows, killing via process-group requires a Job Object or sending CTRL_BREAK_EVENT.
    // For v1 we rely on tokio's Child::start_kill via the worker layer if needed.
}

// ── Task 14: Integrity verification ─────────────────────────────────────────

pub fn verify_artefacts(artefacts: &MediaArtefacts) -> Result<(), WebMediaError> {
    let Some(audio) = &artefacts.audio_path else { return Err(WebMediaError::IntegrityCheckFailed); };
    if !audio.exists() { return Err(WebMediaError::IntegrityCheckFailed); }
    let meta = std::fs::metadata(audio).map_err(|_| WebMediaError::IntegrityCheckFailed)?;
    if meta.len() < 1024 { return Err(WebMediaError::IntegrityCheckFailed); }

    use std::io::Read;
    let mut buf = [0u8; 4];
    let mut f = std::fs::File::open(audio).map_err(|_| WebMediaError::IntegrityCheckFailed)?;
    f.read_exact(&mut buf).map_err(|_| WebMediaError::IntegrityCheckFailed)?;
    let is_id3 = &buf[..3] == b"ID3";
    let is_mpeg_sync = buf[0] == 0xFF && (buf[1] & 0xE0) == 0xE0;
    if !is_id3 && !is_mpeg_sync { return Err(WebMediaError::IntegrityCheckFailed); }
    Ok(())
}

#[cfg(test)]
mod verify_tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn rejects_too_small() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("audio.mp3");
        std::fs::write(&p, b"tiny").unwrap();
        let r = verify_artefacts(&MediaArtefacts {
            audio_path: Some(p), video_path: None, thumbnail_path: None,
        });
        assert!(matches!(r, Err(WebMediaError::IntegrityCheckFailed)));
    }

    #[test]
    fn accepts_id3_header() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("audio.mp3");
        let mut data = b"ID3".to_vec();
        data.resize(2048, 0);
        std::fs::write(&p, &data).unwrap();
        let r = verify_artefacts(&MediaArtefacts {
            audio_path: Some(p), video_path: None, thumbnail_path: None,
        });
        assert!(r.is_ok());
    }
}
