//! yt-dlp plugin install/uninstall/update.
use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};

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
