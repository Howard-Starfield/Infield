//! yt-dlp plugin install/uninstall/update.
#[allow(unused_imports)]
use std::path::{Path, PathBuf};
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
