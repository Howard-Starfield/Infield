use chrono::Local;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::app_identity::resolve_vault_root;

const MAX_BASENAME_LEN: usize = 80;

/// Sanitize a user-supplied filename or generate a paste-mode fallback.
///
/// - `None` → generates `pasted-YYYYMMDD-HHMMSS` from local time.
/// - `Some(name)` → NFC-normalizes, strips the file extension if present,
///   strips control chars, replaces Windows-illegal chars and internal
///   whitespace with `-`, strips leading/trailing whitespace and dots,
///   truncates to 80 chars, and falls back to "image" if the result is empty.
pub fn sanitize_filename(preferred: Option<&str>) -> String {
    let name = match preferred {
        None => {
            return Local::now().format("pasted-%Y%m%d-%H%M%S").to_string();
        }
        Some(s) => s,
    };

    let normalized: String = name.nfc().collect();

    // Strip extension (we re-attach the canonical one for the validated MIME).
    let stem = match normalized.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => stem.to_string(),
        _ => normalized,
    };

    // Trim leading/trailing whitespace and dots before mapping internals.
    let pre_trimmed = stem.trim_matches(|c: char| c.is_whitespace() || c == '.');

    let cleaned: String = pre_trimmed
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_whitespace() => '-',
            c => c,
        })
        .filter(|c| !c.is_control())
        .collect();

    let trimmed: String = cleaned
        .trim_matches(|c: char| c.is_whitespace() || c == '.')
        .to_string();

    let truncated: String = trimmed.chars().take(MAX_BASENAME_LEN).collect();

    if truncated.is_empty() {
        "image".to_string()
    } else {
        truncated
    }
}

const ALLOWED_MIMES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/svg+xml",
];

/// Validate that the claimed MIME is whitelisted AND the bytes' magic-bytes
/// match. Returns the canonical extension on success.
pub fn validate_mime(claimed: &str, bytes: &[u8]) -> Result<&'static str, String> {
    if !ALLOWED_MIMES.contains(&claimed) {
        return Err(format!("unsupported mime: {}", claimed));
    }

    // SVG: infer doesn't detect SVG. Sniff manually — must start with
    // either an XML declaration or an <svg root tag, ignoring leading
    // whitespace and an optional UTF-8 BOM.
    if claimed == "image/svg+xml" {
        let head = strip_leading(bytes);
        if head.starts_with(b"<?xml") || head.starts_with(b"<svg") {
            return Ok("svg");
        }
        return Err(format!(
            "file contents do not match claimed mime: {}",
            claimed
        ));
    }

    let detected = infer::get(bytes).map(|t| t.mime_type()).unwrap_or("");
    if detected != claimed {
        return Err(format!(
            "file contents do not match claimed mime: {}",
            claimed
        ));
    }

    Ok(canonical_ext(claimed))
}

fn canonical_ext(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/avif" => "avif",
        "image/svg+xml" => "svg",
        _ => unreachable!("validate_mime gates this"),
    }
}

fn strip_leading(bytes: &[u8]) -> &[u8] {
    let mut b = if bytes.starts_with(b"\xEF\xBB\xBF") {
        &bytes[3..]
    } else {
        bytes
    };
    while let Some((first, rest)) = b.split_first() {
        if first.is_ascii_whitespace() {
            b = rest;
        } else {
            break;
        }
    }
    b
}

const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;

pub fn check_size_cap(bytes_len: usize) -> Result<(), String> {
    if bytes_len > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "image exceeds 25MB cap (got {} bytes)",
            bytes_len
        ));
    }
    Ok(())
}

/// Compute the absolute disk path and the vault-relative path string for a
/// new attachment. Uses local time for the YYYY/MM segment.
///
/// Returns (absolute_path, vault_rel_with_forward_slashes).
pub fn compute_attachment_path(
    vault_root: &Path,
    safe_basename: &str,
    canonical_ext: &str,
) -> (PathBuf, String) {
    let now = chrono::Local::now();
    let year = now.format("%Y").to_string();
    let month = now.format("%m").to_string();
    let uuid8 = &Uuid::new_v4().simple().to_string()[..8];

    let filename = format!("{}-{}.{}", safe_basename, uuid8, canonical_ext);
    let abs = vault_root
        .join("attachments")
        .join(&year)
        .join(&month)
        .join(&filename);
    let rel = format!("attachments/{}/{}/{}", year, month, filename);
    (abs, rel)
}

#[derive(Serialize, Deserialize, Type, Debug)]
pub struct SaveAttachmentInput {
    pub source_node_id: String,
    pub bytes: Vec<u8>,
    pub mime: String,
    pub preferred_name: Option<String>,
}

#[derive(Serialize, Deserialize, Type, Debug)]
pub struct SaveAttachmentOutput {
    /// Vault-relative path with forward slashes.
    /// e.g. "attachments/2026/04/foo-a3b9c2f1.png"
    pub vault_rel_path: String,
    /// Sanitized basename without UUID8 suffix or extension. e.g. "foo"
    pub display_name: String,
    pub bytes_written: u64,
}

#[tauri::command]
#[specta::specta]
pub async fn save_attachment(
    app: AppHandle,
    input: SaveAttachmentInput,
) -> Result<SaveAttachmentOutput, String> {
    let ext = validate_mime(&input.mime, &input.bytes)?;
    check_size_cap(input.bytes.len())?;
    let safe = sanitize_filename(input.preferred_name.as_deref());

    let vault_root = resolve_vault_root(&app);
    if !vault_root.exists() {
        // VaultLock::acquire creates this in production, but be defensive.
        fs::create_dir_all(&vault_root)
            .map_err(|e| format!("vault not initialized: {}", e))?;
    }
    let (abs_path, rel_path) = compute_attachment_path(&vault_root, &safe, ext);

    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to write attachment: {}", e))?;
    }

    // Atomic write: temp + rename. Target never exists (UUID disambiguator),
    // so Windows rename is fine.
    let tmp_path = abs_path.with_extension(format!("{}.tmp", ext));
    fs::write(&tmp_path, &input.bytes)
        .map_err(|e| format!("failed to write attachment: {}", e))?;
    fs::rename(&tmp_path, &abs_path)
        .map_err(|e| format!("failed to write attachment: {}", e))?;

    Ok(SaveAttachmentOutput {
        vault_rel_path: rel_path,
        display_name: safe,
        bytes_written: input.bytes.len() as u64,
    })
}

// Note: we don't unit-test `save_attachment` itself because it requires a
// full Tauri AppHandle. The pure helpers it composes are all covered above.
// End-to-end behaviour is covered by the manual verification in Task 22.

/// Returns the absolute path of the canonical vault root, e.g.
/// `<app_data>/infield-vault/` on a typical install. Used by the frontend
/// to populate the `vaultRootFacet` in MarkdownEditor so the live-preview
/// Image widget can resolve vault-relative paths into asset:// URLs.
#[tauri::command]
#[specta::specta]
pub fn get_vault_root(app: AppHandle) -> Result<String, String> {
    let path = resolve_vault_root(&app);
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paste_mode_returns_timestamp_prefix() {
        let out = sanitize_filename(None);
        assert!(out.starts_with("pasted-"));
        // Format: pasted-YYYYMMDD-HHMMSS = 7 + 8 + 1 + 6 = 22 chars
        assert_eq!(out.len(), 22);
    }

    #[test]
    fn strips_extension() {
        assert_eq!(sanitize_filename(Some("foo.png")), "foo");
        assert_eq!(sanitize_filename(Some("a.b.c.jpg")), "a.b.c");
    }

    #[test]
    fn replaces_windows_illegal_chars_with_dash() {
        assert_eq!(sanitize_filename(Some("a/b\\c:d*e?f.png")), "a-b-c-d-e-f");
    }

    #[test]
    fn replaces_internal_whitespace_with_dash() {
        assert_eq!(sanitize_filename(Some("my sketch.png")), "my-sketch");
        assert_eq!(sanitize_filename(Some("a\tb\nc.png")), "a-b-c");
    }

    #[test]
    fn strips_control_chars() {
        let input = "foo\x01bar\x1f.png";
        assert_eq!(sanitize_filename(Some(input)), "foobar");
    }

    #[test]
    fn strips_leading_and_trailing_dots_and_whitespace() {
        assert_eq!(sanitize_filename(Some("  ..foo..  .png")), "foo");
    }

    #[test]
    fn truncates_long_names_to_80_chars() {
        let long = "a".repeat(120) + ".png";
        let out = sanitize_filename(Some(&long));
        assert_eq!(out.chars().count(), 80);
    }

    #[test]
    fn empty_falls_back_to_image() {
        assert_eq!(sanitize_filename(Some("")), "image");
        assert_eq!(sanitize_filename(Some("...")), "image");
        assert_eq!(sanitize_filename(Some("   ")), "image");
    }

    #[test]
    fn nfc_normalizes_combining_marks() {
        // "é" composed (U+00E9) vs decomposed (U+0065 U+0301).
        let decomposed = "e\u{0301}.png";
        let out = sanitize_filename(Some(decomposed));
        assert_eq!(out, "\u{00E9}");
    }

    /// Minimal PNG signature: 8-byte magic + IHDR chunk header.
    fn fake_png_bytes() -> Vec<u8> {
        let mut v = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        v.extend_from_slice(&[0x00, 0x00, 0x00, 0x0D]);
        v.extend_from_slice(b"IHDR");
        v.extend_from_slice(&[0; 13]);
        v
    }

    /// Minimal JPEG signature: SOI marker + JFIF filler.
    fn fake_jpeg_bytes() -> Vec<u8> {
        vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, b'J', b'F', b'I', b'F', 0]
    }

    #[test]
    fn rejects_non_whitelisted_mime() {
        let bytes = fake_png_bytes();
        let err = validate_mime("application/pdf", &bytes).unwrap_err();
        assert!(err.contains("unsupported mime"));
    }

    #[test]
    fn accepts_png_with_matching_bytes() {
        let bytes = fake_png_bytes();
        assert_eq!(validate_mime("image/png", &bytes).unwrap(), "png");
    }

    #[test]
    fn accepts_jpeg_with_matching_bytes() {
        let bytes = fake_jpeg_bytes();
        assert_eq!(validate_mime("image/jpeg", &bytes).unwrap(), "jpg");
    }

    #[test]
    fn rejects_png_claim_with_jpeg_bytes() {
        let bytes = fake_jpeg_bytes();
        let err = validate_mime("image/png", &bytes).unwrap_err();
        assert!(err.contains("file contents do not match"));
    }

    #[test]
    fn accepts_svg_with_xml_declaration() {
        let bytes = b"<?xml version=\"1.0\"?><svg></svg>";
        assert_eq!(validate_mime("image/svg+xml", bytes).unwrap(), "svg");
    }

    #[test]
    fn accepts_svg_with_bare_root_tag() {
        let bytes = b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        assert_eq!(validate_mime("image/svg+xml", bytes).unwrap(), "svg");
    }

    #[test]
    fn accepts_svg_with_bom_and_whitespace() {
        let bytes = b"\xEF\xBB\xBF\n  <svg></svg>";
        assert_eq!(validate_mime("image/svg+xml", bytes).unwrap(), "svg");
    }

    #[test]
    fn rejects_svg_claim_with_html_payload() {
        let bytes = b"<html><body>nope</body></html>";
        let err = validate_mime("image/svg+xml", bytes).unwrap_err();
        assert!(err.contains("file contents do not match"));
    }

    #[test]
    fn size_cap_accepts_under_limit() {
        assert!(check_size_cap(1024).is_ok());
        assert!(check_size_cap(MAX_ATTACHMENT_BYTES).is_ok());
    }

    #[test]
    fn size_cap_rejects_over_limit() {
        let err = check_size_cap(MAX_ATTACHMENT_BYTES + 1).unwrap_err();
        assert!(err.contains("exceeds 25MB cap"));
    }

    #[test]
    fn computes_path_with_year_month_and_uuid_suffix() {
        let root = std::path::Path::new("/tmp/vault");
        let (abs, rel) = compute_attachment_path(root, "foo", "png");
        let abs_str = abs.to_string_lossy().to_string();
        assert!(abs_str.contains("attachments"));
        assert!(abs_str.ends_with(".png"));
        let filename = abs.file_name().unwrap().to_string_lossy().to_string();
        assert!(filename.starts_with("foo-"));
        assert_eq!(filename.len(), "foo-".len() + 8 + ".png".len());
        assert!(rel.starts_with("attachments/"));
        assert!(rel.ends_with(".png"));
        assert!(!rel.contains('\\'));
    }

    #[test]
    fn rel_path_year_and_month_match_abs_path() {
        let root = std::path::Path::new("/tmp/vault");
        let (abs, rel) = compute_attachment_path(root, "x", "png");
        let parts: Vec<&str> = rel.split('/').collect();
        let year = parts[1];
        let month = parts[2];
        let abs_str = abs.to_string_lossy().replace('\\', "/");
        assert!(abs_str.contains(&format!("attachments/{}/{}/", year, month)));
    }
}
