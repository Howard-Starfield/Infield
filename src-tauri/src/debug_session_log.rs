//! NDJSON agent debug log (session `4c23bc`). Remove after investigation.

use std::io::Write;
use std::path::PathBuf;

const SESSION_ID: &str = "4c23bc";
const LOG_FILE: &str = "debug-4c23bc.log";

fn log_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join(LOG_FILE))
        .unwrap_or_else(|| PathBuf::from(LOG_FILE))
}

/// Append one NDJSON line to workspace `debug-4c23bc.log`.
pub fn write_line(
    hypothesis_id: &str,
    location: &str,
    message: &str,
    data: serde_json::Value,
) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let line = serde_json::json!({
        "sessionId": SESSION_ID,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": ts,
    });
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())
    {
        let _ = writeln!(f, "{}", line);
    }
}
