use std::path::{Path, PathBuf};
use std::fs::File;

use fs2::FileExt;
use tauri::{AppHandle, Manager};

pub const APP_NAME: &str = "Infield";
pub const LEGACY_APP_NAME: &str = "Handy";
pub const VAULT_DIR_NAME: &str = "infield-vault";
pub const LEGACY_VAULT_DIR_NAME: &str = "handy-vault";
pub const PORTABLE_MAGIC: &str = "Infield Portable Mode";
pub const LEGACY_PORTABLE_MAGIC: &str = "Handy Portable Mode";

pub fn resolve_vault_root(app: &AppHandle) -> PathBuf {
    let app_data = crate::portable::app_data_dir(app)
        .unwrap_or_else(|_| app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let preferred = app_data.join(VAULT_DIR_NAME);
    let legacy = app_data.join(LEGACY_VAULT_DIR_NAME);

    let resolved = if preferred.exists() {
        preferred
    } else if legacy.exists() {
        if let Some(parent) = preferred.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::rename(&legacy, &preferred) {
            Ok(()) => preferred,
            Err(error) => {
                log::warn!(
                    "Failed to migrate legacy vault directory from '{}' to '{}': {}",
                    legacy.display(),
                    preferred.display(),
                    error
                );
                legacy
            }
        }
    } else {
        preferred
    };

    // Canonicalize once so symlinks / `..` segments / drive-relative paths
    // resolve to a single stable absolute path.  Every subsequent join +
    // comparison (vault_rel_path lookup, collision detection, old-file
    // cleanup) now operates on the same canonical form — otherwise a user
    // whose vault root is a symlink could see the same file under two
    // different path strings and trip every path-equality check.
    //
    // `canonicalize` can only run on an existing path; if the directory
    // hasn't been created yet we return the non-canonical form and let the
    // first write create it.  VaultLock::acquire creates the directory at
    // startup, so production callers always see the canonical form.
    canonicalize_with_fallback(&resolved)
}

/// Best-effort `fs::canonicalize` that gracefully falls back to the input
/// when the path doesn't exist yet or the FS refuses.  On Windows, strips
/// the `\\?\` verbatim prefix that `canonicalize` adds, because several
/// downstream tools (git, `fs::rename`, Tauri's path serializer) choke on it.
fn canonicalize_with_fallback(path: &Path) -> PathBuf {
    let Ok(canonical) = std::fs::canonicalize(path) else {
        return path.to_path_buf();
    };
    #[cfg(windows)]
    {
        // `\\?\C:\foo\bar` → `C:\foo\bar`.  Keep UNC paths (`\\?\UNC\server\…`)
        // as-is: stripping would corrupt them.
        if let Some(s) = canonical.to_str() {
            if let Some(stripped) = s.strip_prefix(r"\\?\") {
                if !stripped.starts_with("UNC\\") {
                    return PathBuf::from(stripped);
                }
            }
        }
    }
    canonical
}

/// Holds an exclusive OS-level lock on `<vault_root>/.infield.lock`.
///
/// The lock is released automatically when this value is dropped (including on
/// process crash), so stale lock files never block restart. Two Infield processes
/// pointing at the same vault directory will both open the same file, but only
/// one will obtain the exclusive lock; the other receives a clear startup error.
///
/// Wrapped in `Mutex` so the struct is `Send + Sync` and can be registered as
/// Tauri managed state, which keeps it alive for the full app lifetime.
pub struct VaultLock {
    _file: std::sync::Mutex<File>,
}

impl VaultLock {
    /// Try to acquire the vault process lock.  Returns `Err` with a
    /// human-readable message if another process already holds the lock.
    pub fn acquire(vault_root: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(vault_root)
            .map_err(|e| format!("Cannot create vault directory: {e}"))?;

        // Fall back to reading any pre-existing `.handy.lock` from an earlier
        // build — acquire whichever already exists, else create `.infield.lock`.
        let new_path = vault_root.join(".infield.lock");
        let legacy_path = vault_root.join(".handy.lock");
        let lock_path = if legacy_path.exists() && !new_path.exists() {
            legacy_path
        } else {
            new_path
        };
        let file = File::create(&lock_path)
            .map_err(|e| format!("Cannot open vault lock file: {e}"))?;

        // Write PID so the file is readable for debugging (best-effort).
        use std::io::Write;
        let _ = (&file).write_all(format!("{}\n", std::process::id()).as_bytes());

        file.try_lock_exclusive().map_err(|_| {
            format!(
                "Another Infield process is already using this vault ({}).\n\
                 Close the other instance before opening a second one.",
                vault_root.display()
            )
        })?;

        Ok(VaultLock { _file: std::sync::Mutex::new(file) })
    }
}

pub fn read_markdown_body_from_vault_file(vault_root: &Path, rel_path: &str) -> Option<String> {
    let file_path = vault_root.join(rel_path);
    let content = std::fs::read_to_string(&file_path).ok()?;
    let content = content.trim_start();
    if !content.starts_with("---") {
        return Some(content.to_string());
    }
    let end = content[3..].find("\n---")?;
    let body_start = 3 + end + 4;
    let body = content[body_start..].trim();
    Some(body.to_string())
}
