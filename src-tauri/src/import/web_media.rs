//! yt-dlp wrapper. URL-specific concerns isolated here.
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use thiserror::Error;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handle_reports_availability_from_path() {
        let h = YtDlpHandle::new(PathBuf::from("/nonexistent/yt-dlp"));
        assert!(!h.is_available());
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
}
