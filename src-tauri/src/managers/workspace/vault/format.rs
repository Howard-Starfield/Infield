use chrono::{DateTime, Utc};
use serde_json::Value;
use std::collections::HashMap;

pub const INFIELD_VERSION: u32 = 1;

// ─── Core types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct VaultOption {
    pub id: String,
    pub name: String,
    /// Named color string: "purple", "pink", "light_pink", "orange", "yellow",
    /// "lime", "green", "aqua", "blue". Stored as-is from SelectColor enum.
    pub color: String,
}

#[derive(Debug, Clone)]
pub struct VaultField {
    pub id: String,
    pub name: String,
    /// Snake_case field type string from workspace_manager allowed list.
    pub field_type: String,
    pub is_primary: bool,
    pub position: i64,
    /// From view_options.fieldVisibility — field is in schema but hidden in this view.
    pub hidden: bool,
    /// For date/date_time fields: persisted flag from TypeOption.
    pub include_time: bool,
    /// For board/single_select/multi_select fields only.
    pub options: Vec<VaultOption>,
    /// True when the cell has a HyperFormula expression; value is exported but is computed.
    pub has_formula: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum VaultType {
    Table,
    Board,
    Calendar,
    Database,
}

impl VaultType {
    pub fn as_str(&self) -> &'static str {
        match self {
            VaultType::Table => "table",
            VaultType::Board => "board",
            VaultType::Calendar => "calendar",
            VaultType::Database => "database",
        }
    }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

pub fn timestamp_to_utc_str(ts_secs: i64) -> String {
    DateTime::<Utc>::from_timestamp(ts_secs, 0)
        .unwrap_or_default()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

// ─── YAML hand-rolling ────────────────────────────────────────────────────────

/// Safely quote a string for YAML double-quoted scalar.
pub fn yaml_str(s: &str) -> String {
    let escaped = s
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t");
    format!("\"{}\"", escaped)
}

pub fn yaml_str_or_null(s: Option<&str>) -> String {
    match s {
        Some(v) if !v.is_empty() => yaml_str(v),
        _ => "null".to_string(),
    }
}

/// Serialize the shared database frontmatter block (used by table, board, calendar).
/// Returns the YAML content WITHOUT the `---` fences.
pub fn serialize_common_frontmatter(
    vault_type: VaultType,
    db_id: &str,
    db_name: &str,
    db_icon: &str,
    db_cover: Option<&str>,
    created_at: i64,
    updated_at: i64,
    fields: &[VaultField],
    excluded_protected: &[(&str, &str)], // (id, name) of skipped protected fields
) -> String {
    let mut out = String::new();

    out.push_str(&format!("infield_version: {}\n", INFIELD_VERSION));
    out.push_str(&format!("infield_type: {}\n", vault_type.as_str()));
    out.push_str(&format!("id: {}\n", yaml_str(db_id)));
    out.push_str(&format!("name: {}\n", yaml_str(db_name)));
    out.push_str(&format!("icon: {}\n", yaml_str(db_icon)));
    out.push_str(&format!("cover: {}\n", yaml_str_or_null(db_cover)));
    out.push_str(&format!("created_at: {}\n", yaml_str(&timestamp_to_utc_str(created_at))));
    out.push_str(&format!("updated_at: {}\n", yaml_str(&timestamp_to_utc_str(updated_at))));

    // Fields
    if fields.is_empty() {
        out.push_str("fields: []\n");
    } else {
        out.push_str("fields:\n");
        for field in fields {
            out.push_str(&format!("  - id: {}\n", yaml_str(&field.id)));
            out.push_str(&format!("    name: {}\n", yaml_str(&field.name)));
            out.push_str(&format!("    field_type: {}\n", yaml_str(&field.field_type)));
            out.push_str(&format!("    is_primary: {}\n", field.is_primary));
            out.push_str(&format!("    position: {}\n", field.position));
            out.push_str(&format!("    hidden: {}\n", field.hidden));
            out.push_str(&format!("    has_formula: {}\n", field.has_formula));
            if field.include_time {
                out.push_str("    include_time: true\n");
            }
            if !field.options.is_empty() {
                out.push_str("    options:\n");
                for opt in &field.options {
                    out.push_str(&format!("      - id: {}\n", yaml_str(&opt.id)));
                    out.push_str(&format!("        name: {}\n", yaml_str(&opt.name)));
                    out.push_str(&format!("        color: {}\n", yaml_str(&opt.color)));
                }
            }
        }
    }

    // Excluded protected fields
    if !excluded_protected.is_empty() {
        out.push_str("excluded_fields:\n");
        for (id, name) in excluded_protected {
            out.push_str(&format!("  - id: {}\n", yaml_str(id)));
            out.push_str(&format!("    name: {}\n", yaml_str(name)));
            out.push_str("    field_type: \"protected\"\n");
            out.push_str("    reason: \"protected\"\n");
        }
    }

    out
}

// ─── Slug helper ──────────────────────────────────────────────────────────────

/// ASCII-safe slug for database vault filenames.  Stronger guarantees than the
/// document slugger because database exports live at a fixed `databases/<slug>/`
/// root — we can't afford a Windows-reserved name or a runaway-length slug
/// breaking the whole export directory.
pub fn slugify(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let mut slug = String::new();
    let mut prev_dash = true; // trim leading dashes
    for c in s.chars() {
        if c == '-' {
            if !prev_dash {
                slug.push('-');
            }
            prev_dash = true;
        } else {
            slug.push(c);
            prev_dash = false;
        }
    }
    // trim trailing dash / dot / space (Windows strips trailing `.` and ` ` at the FS layer)
    let mut slug = slug.trim_end_matches(['-', '.', ' ']).to_string();

    // Cap length (64 bytes — tighter than document slugger since path prefix
    // `databases/<slug>/cards/<uuid>.md` already eats a large budget).
    const MAX_SLUG_BYTES: usize = 64;
    if slug.len() > MAX_SLUG_BYTES {
        slug.truncate(MAX_SLUG_BYTES);
        slug = slug.trim_end_matches(['-', '.', ' ']).to_string();
    }

    if slug.is_empty() {
        return "untitled".to_string();
    }

    // Windows reserved device names — append `-` to force non-reserved form.
    const RESERVED: &[&str] = &[
        "con", "prn", "aux", "nul",
        "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
        "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    if RESERVED.contains(&slug.as_str()) {
        slug.push('-');
    }

    slug
}
