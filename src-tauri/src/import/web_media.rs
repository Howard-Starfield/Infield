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
