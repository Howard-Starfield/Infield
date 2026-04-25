//! yt-dlp plugin install/uninstall/update.
use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};
use tauri::Emitter;
use sha2::{Digest, Sha256};
use std::io::Write;
use chrono::Utc;

pub fn binary_name() -> &'static str {
    if cfg!(target_os = "windows") { "yt-dlp.exe" }
    else if cfg!(target_os = "macos") { "yt-dlp_macos" }
    else { "yt-dlp_linux" }
}

pub fn extension_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("extensions").join("yt-dlp"))
}

pub fn binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(extension_dir(app)?.join(binary_name()))
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PluginStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub installed_at: Option<String>,
    pub last_checked_at: Option<String>,
    pub latest_available: Option<String>,
    pub size_bytes: Option<u64>,
}

pub fn read_status_at(dir: &Path) -> PluginStatus {
    let bin = dir.join(binary_name());
    let installed = bin.exists();
    if !installed {
        return PluginStatus {
            installed: false, version: None, installed_at: None,
            last_checked_at: None, latest_available: None, size_bytes: None,
        };
    }
    let read_trim = |name: &str| fs::read_to_string(dir.join(name)).ok().map(|s| s.trim().to_string());
    PluginStatus {
        installed,
        version: read_trim("version.txt"),
        installed_at: read_trim("installed_at.txt"),
        last_checked_at: read_trim("last_checked_at.txt"),
        latest_available: read_trim("latest_available.txt"),
        size_bytes: fs::metadata(&bin).ok().map(|m| m.len()),
    }
}

pub fn read_status(app: &AppHandle) -> Result<PluginStatus, String> {
    Ok(read_status_at(&extension_dir(app)?))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseMetadata {
    pub tag_name: String,
    pub asset_url: String,
    pub checksums_url: String,
}

const GITHUB_RELEASES_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

pub async fn fetch_latest_release_metadata() -> Result<ReleaseMetadata, String> {
    let client = reqwest::Client::builder()
        .user_agent("Handy/1.0 (yt-dlp plugin updater)")
        .build()
        .map_err(|e| e.to_string())?;
    let resp: serde_json::Value = client
        .get(GITHUB_RELEASES_API)
        .send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    let tag_name = resp["tag_name"].as_str().ok_or("missing tag_name")?.to_string();
    let assets = resp["assets"].as_array().ok_or("missing assets")?;
    let target_name = binary_name();
    let asset_url = assets.iter()
        .find(|a| a["name"].as_str() == Some(target_name))
        .and_then(|a| a["browser_download_url"].as_str())
        .ok_or_else(|| format!("no asset named {}", target_name))?
        .to_string();
    let checksums_url = assets.iter()
        .find(|a| a["name"].as_str() == Some("SHA2-256SUMS"))
        .and_then(|a| a["browser_download_url"].as_str())
        .ok_or("no SHA2-256SUMS asset")?
        .to_string();
    Ok(ReleaseMetadata { tag_name, asset_url, checksums_url })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_name_per_platform() {
        let name = binary_name();
        if cfg!(target_os = "windows") { assert_eq!(name, "yt-dlp.exe"); }
        else if cfg!(target_os = "macos") { assert_eq!(name, "yt-dlp_macos"); }
        else { assert_eq!(name, "yt-dlp_linux"); }
    }
}

#[cfg(test)]
mod status_tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn returns_not_installed_for_empty_dir() {
        let tmp = TempDir::new().unwrap();
        let s = read_status_at(tmp.path());
        assert!(!s.installed);
        assert!(s.version.is_none());
    }

    #[test]
    fn returns_installed_when_binary_present() {
        let tmp = TempDir::new().unwrap();
        let bin = tmp.path().join(binary_name());
        fs::write(&bin, b"fake binary").unwrap();
        fs::write(tmp.path().join("version.txt"), "2026.04.15\n").unwrap();
        fs::write(tmp.path().join("installed_at.txt"), "2026-04-24T10:00:00Z").unwrap();
        let s = read_status_at(tmp.path());
        assert!(s.installed);
        assert_eq!(s.version.as_deref(), Some("2026.04.15"));
        assert_eq!(s.installed_at.as_deref(), Some("2026-04-24T10:00:00Z"));
        assert_eq!(s.size_bytes, Some(11));
    }
}

#[cfg(test)]
mod release_tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn fetches_real_release_metadata() {
        let r = fetch_latest_release_metadata().await.unwrap();
        assert!(!r.tag_name.is_empty());
        assert!(r.asset_url.starts_with("https://github.com/"));
        assert!(r.checksums_url.contains("SHA2-256SUMS"));
    }
}

pub fn compute_sha256(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn parse_checksums_for(checksums_text: &str, asset_name: &str) -> Option<String> {
    for line in checksums_text.lines() {
        let mut parts = line.splitn(2, "  ");
        let hex = parts.next()?.trim();
        let name = parts.next()?.trim();
        if name == asset_name { return Some(hex.to_string()); }
    }
    None
}

pub async fn fetch_text(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder().user_agent("Handy/1.0").build().map_err(|e| e.to_string())?;
    client.get(url).send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())
}

pub async fn download_with_progress(
    url: &str, target: &Path,
    on_progress: impl Fn(u64, Option<u64>),
) -> Result<(), String> {
    use futures_util::StreamExt;
    let client = reqwest::Client::builder().user_agent("Handy/1.0").build().map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?;
    let total = resp.content_length();
    let mut file = fs::File::create(target).map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut so_far: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        so_far += chunk.len() as u64;
        on_progress(so_far, total);
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod checksum_tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn computes_known_sha256() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("x.bin");
        fs::write(&f, b"hello").unwrap();
        let h = compute_sha256(&f).unwrap();
        assert_eq!(h, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    }

    #[test]
    fn parses_sha256sums_format() {
        let text = "abc123  yt-dlp_linux\ndef456  yt-dlp_macos\n789xyz  yt-dlp.exe\n";
        assert_eq!(parse_checksums_for(text, "yt-dlp_macos").as_deref(), Some("def456"));
        assert!(parse_checksums_for(text, "nonexistent").is_none());
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum InstallProgress {
    FetchingMetadata,
    Downloading { bytes: u64, total: Option<u64> },
    Verifying,
    Finalizing,
    Done,
}

pub async fn install(app: &AppHandle) -> Result<(), String> {
    let dir = extension_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let _ = app.emit("plugin-install-progress", InstallProgress::FetchingMetadata);
    let release = fetch_latest_release_metadata().await?;

    let target = dir.join(binary_name());
    let tmp = dir.join(format!("{}.downloading", binary_name()));

    let app_clone = app.clone();
    download_with_progress(&release.asset_url, &tmp, move |bytes, total| {
        let _ = app_clone.emit("plugin-install-progress",
            InstallProgress::Downloading { bytes, total });
    }).await?;

    let _ = app.emit("plugin-install-progress", InstallProgress::Verifying);
    let checksums_text = fetch_text(&release.checksums_url).await?;
    let expected = parse_checksums_for(&checksums_text, binary_name())
        .ok_or("checksum line for our asset not found")?;
    let actual = compute_sha256(&tmp)?;
    if !actual.eq_ignore_ascii_case(&expected) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Download integrity check failed (expected {}, got {})", expected, actual));
    }

    let _ = app.emit("plugin-install-progress", InstallProgress::Finalizing);
    if target.exists() { fs::remove_file(&target).map_err(|e| e.to_string())?; }
    fs::rename(&tmp, &target).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&target).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&target, perms).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("codesign")
            .args(["--force", "--sign", "-"]).arg(&target).output();
        if let Ok(o) = out {
            if !o.status.success() {
                log::warn!("codesign failed: {}", String::from_utf8_lossy(&o.stderr));
            }
        }
    }

    fs::write(dir.join("version.txt"), &release.tag_name).map_err(|e| e.to_string())?;
    fs::write(dir.join("installed_at.txt"), Utc::now().to_rfc3339()).map_err(|e| e.to_string())?;
    fs::write(dir.join("checksum.sha256"), &actual).map_err(|e| e.to_string())?;

    let _ = app.emit("plugin-install-progress", InstallProgress::Done);
    let _ = app.emit("plugin-state-changed", ());
    Ok(())
}

#[cfg(test)]
mod install_helper_tests {
    #[test]
    fn case_insensitive_hex_match() {
        assert!("deadbeef".eq_ignore_ascii_case("DEADBEEF"));
        assert!(!"deadbeef".eq_ignore_ascii_case("deadbeed"));
    }
}
