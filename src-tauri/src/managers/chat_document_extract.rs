//! Local text extraction for chat document attachments (Path A — no raw binaries to the model).

use base64::Engine;
use calamine::{open_workbook_auto_from_rs, Data, Reader};
use encoding_rs::UTF_8;
use pdf_extract::extract_text_from_mem;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::borrow::Cow;
use std::io::Cursor;

/// Hard cap on characters returned to the UI / stitched into chat (per file).
pub const CHAT_DOCUMENT_MAX_CHARS: usize = 120_000;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ExtractChatDocumentInput {
    pub data_base64: String,
    pub filename: String,
    pub mime: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ExtractChatDocumentResult {
    pub filename: String,
    pub mime: String,
    pub text: String,
    pub truncated: bool,
    pub error: Option<String>,
}

fn extension_hint(name: &str) -> Option<String> {
    let lower = name.to_ascii_lowercase();
    lower.rsplit_once('.').map(|(_, ext)| ext.to_string())
}

fn looks_like_spreadsheet(ext: Option<&str>, mime: &str) -> bool {
    matches!(
        ext,
        Some("xlsx" | "xlsm" | "xls" | "ods")
    ) || mime.contains("spreadsheet")
        || mime == "application/vnd.ms-excel"
}

fn looks_like_pdf(ext: Option<&str>, mime: &str) -> bool {
    ext == Some("pdf") || mime == "application/pdf"
}

fn looks_like_docx(ext: Option<&str>, mime: &str) -> bool {
    ext == Some("docx")
        || mime
            == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}

fn decode_utf8_with_fallback(bytes: &[u8]) -> Cow<'_, str> {
    let (cow, _, had_errors) = UTF_8.decode(bytes);
    if had_errors {
        encoding_rs::WINDOWS_1252.decode(bytes).0
    } else {
        cow
    }
}

fn strip_xml_to_plain(xml: &str) -> String {
    // Remove XML tags; keep rough paragraph breaks from closing </w:p>
    let mut s = xml.replace("</w:p>", "\n");
    let re = regex::Regex::new(r"<[^>]+>").unwrap();
    s = re.replace_all(&s, "").to_string();
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn extract_docx(bytes: &[u8]) -> Result<String, String> {
    let cursor = Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("docx (zip): {e}"))?;
    let mut xml = String::new();
    let mut f = archive
        .by_name("word/document.xml")
        .map_err(|e| format!("docx: missing word/document.xml: {e}"))?;
    std::io::Read::read_to_string(&mut f, &mut xml)
        .map_err(|e| format!("docx: read document.xml: {e}"))?;
    Ok(strip_xml_to_plain(&xml))
}

fn extract_spreadsheet(bytes: &[u8]) -> Result<String, String> {
    let cursor = Cursor::new(bytes.to_vec());
    let mut wb =
        open_workbook_auto_from_rs(cursor).map_err(|e| format!("spreadsheet: {e}"))?;
    let names: Vec<String> = wb.sheet_names().iter().map(|s| s.to_string()).collect();
    let mut out = String::new();
    for name in names {
        let range = match wb.worksheet_range(name.as_str()) {
            Ok(r) => r,
            Err(_) => continue,
        };
        out.push_str("## ");
        out.push_str(&name);
        out.push('\n');
        for row in range.rows() {
            let line: Vec<String> = row
                .iter()
                .map(|c| match c {
                    Data::Empty => String::new(),
                    Data::String(s) => s.clone(),
                    Data::Float(f) => f.to_string(),
                    Data::Int(i) => i.to_string(),
                    Data::Bool(b) => b.to_string(),
                    Data::Error(e) => format!("#ERR:{e}"),
                    Data::DateTime(dt) => dt.to_string(),
                    Data::DateTimeIso(s) => s.clone(),
                    Data::DurationIso(s) => s.clone(),
                })
                .collect();
            out.push_str(&line.join("\t"));
            out.push('\n');
        }
        out.push('\n');
    }
    if out.trim().is_empty() {
        return Err("spreadsheet: no readable cells".to_string());
    }
    Ok(out)
}

fn extract_pdf(bytes: &[u8]) -> Result<String, String> {
    extract_text_from_mem(bytes).map_err(|e| format!("pdf: {e}"))
}

fn extract_csv(bytes: &[u8]) -> String {
    let text = decode_utf8_with_fallback(bytes);
    let mut out = String::new();
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .from_reader(text.as_bytes());
    for rec in rdr.records().flatten() {
        out.push_str(&rec.iter().collect::<Vec<_>>().join("\t"));
        out.push('\n');
    }
    out
}

/// Decode base64 payload and extract plain text according to filename / MIME.
pub fn extract_chat_document_bytes(input: &ExtractChatDocumentInput) -> ExtractChatDocumentResult {
    let filename = input.filename.trim();
    let mime = input.mime.trim().to_ascii_lowercase();
    let ext_owned = extension_hint(filename);
    let ext = ext_owned.as_deref();

    let bytes = match base64::engine::general_purpose::STANDARD.decode(input.data_base64.trim()) {
        Ok(b) => b,
        Err(e) => {
            return ExtractChatDocumentResult {
                filename: filename.to_string(),
                mime: mime.clone(),
                text: String::new(),
                truncated: false,
                error: Some(format!("invalid base64: {e}")),
            };
        }
    };

    if bytes.is_empty() {
        return ExtractChatDocumentResult {
            filename: filename.to_string(),
            mime: mime.clone(),
            text: String::new(),
            truncated: false,
            error: Some("empty file".to_string()),
        };
    }

    let extracted = if looks_like_pdf(ext, &mime) {
        extract_pdf(&bytes)
    } else if looks_like_docx(ext, &mime) {
        extract_docx(&bytes)
    } else if looks_like_spreadsheet(ext, &mime) {
        extract_spreadsheet(&bytes)
    } else if ext == Some("csv") || mime == "text/csv" || mime == "application/csv" {
        Ok(extract_csv(&bytes))
    } else if ext == Some("md")
        || ext == Some("txt")
        || mime.starts_with("text/")
        || mime == "application/json"
    {
        Ok(decode_utf8_with_fallback(&bytes).into_owned())
    } else {
        Err(format!(
            "unsupported type (mime={mime}, ext={})",
            ext.unwrap_or("?")
        ))
    };

    match extracted {
        Ok(mut text) => {
            let mut truncated = false;
            if text.len() > CHAT_DOCUMENT_MAX_CHARS {
                text.truncate(CHAT_DOCUMENT_MAX_CHARS);
                truncated = true;
            }
            ExtractChatDocumentResult {
                filename: filename.to_string(),
                mime: mime.clone(),
                text,
                truncated,
                error: None,
            }
        }
        Err(err) => ExtractChatDocumentResult {
            filename: filename.to_string(),
            mime: mime.clone(),
            text: String::new(),
            truncated: false,
            error: Some(err),
        },
    }
}
