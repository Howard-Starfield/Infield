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

// ─── Field parsing ────────────────────────────────────────────────────────────

/// Parse the `type_option` JSON value from a field definition.
/// Handles double-encoded strings (stored as JSON-in-JSON-string) and plain objects.
pub fn parse_type_option(field: &Value) -> Value {
    match field.get("type_option") {
        None | Some(Value::Null) => Value::Object(serde_json::Map::new()),
        Some(Value::Object(obj)) if obj.is_empty() => Value::Object(serde_json::Map::new()),
        Some(Value::Object(_)) => field["type_option"].clone(),
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() {
                Value::Object(serde_json::Map::new())
            } else {
                serde_json::from_str(t).unwrap_or(Value::Object(serde_json::Map::new()))
            }
        }
        Some(_) => Value::Object(serde_json::Map::new()),
    }
}

fn parse_options_from_type_option(type_option: &Value) -> Vec<VaultOption> {
    let Some(arr) = type_option.get("options").and_then(|v| v.as_array()) else {
        return vec![];
    };
    arr.iter()
        .filter_map(|opt| {
            let id = opt.get("id")?.as_str()?.to_string();
            let name = opt
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let color = opt
                .get("color")
                .and_then(|v| v.as_str())
                .unwrap_or("purple")
                .to_string();
            Some(VaultOption { id, name, color })
        })
        .collect()
}

/// Parse all fields from a database node's properties JSON.
/// `field_visibility`: from view_options.fieldVisibility (field_id → visible bool).
pub fn parse_fields(
    db_props: &Value,
    field_visibility: &HashMap<String, bool>,
) -> Vec<VaultField> {
    let Some(arr) = db_props.get("fields").and_then(|v| v.as_array()) else {
        return vec![];
    };
    let mut fields: Vec<VaultField> = arr
        .iter()
        .filter_map(|f| {
            let id = f.get("id")?.as_str()?.to_string();
            let name = f
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let field_type = f
                .get("field_type")
                .and_then(|v| v.as_str())
                .unwrap_or("rich_text")
                .to_string();
            let is_primary = f
                .get("is_primary")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let position = f
                .get("position")
                .and_then(|v| v.as_i64())
                .or_else(|| f.get("position").and_then(|v| v.as_f64()).map(|x| x as i64))
                .unwrap_or(0);
            // hidden: visibility map says visible=true means NOT hidden
            let hidden = field_visibility
                .get(&id)
                .copied()
                .map(|visible| !visible)
                .unwrap_or(false);

            let type_option = parse_type_option(f);
            let include_time = type_option
                .get("include_time")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let options = parse_options_from_type_option(&type_option);

            Some(VaultField {
                id,
                name,
                field_type,
                is_primary,
                position,
                hidden,
                include_time,
                options,
                has_formula: false, // resolved per-cell at export time
            })
        })
        .collect();
    fields.sort_by_key(|f| f.position);
    fields
}

/// Build option_id → option_name lookup for one field's options.
pub fn option_id_to_name(field: &VaultField) -> HashMap<String, String> {
    field
        .options
        .iter()
        .map(|o| (o.id.clone(), o.name.clone()))
        .collect()
}

// ─── Cell serialization ───────────────────────────────────────────────────────

/// Convert a raw cell JSON value to a human-readable string for CSV.
/// `opt_names`: option_id → name for this field (empty for non-select fields).
pub fn serialize_cell_for_csv(field: &VaultField, cell: &Value, opt_names: &HashMap<String, String>) -> String {
    let Some(value) = cell.get("value") else {
        return String::new();
    };

    match field.field_type.as_str() {
        "rich_text" | "url" => value.as_str().unwrap_or("").to_string(),

        "number" => {
            if value.is_null() {
                String::new()
            } else if let Some(n) = value.as_f64() {
                if n.fract() == 0.0 && n.abs() < 1e15 {
                    format!("{}", n as i64)
                } else {
                    format!("{}", n)
                }
            } else {
                String::new()
            }
        }

        "checkbox" => {
            if value.as_bool().unwrap_or(false) {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }

        "single_select" | "board" => {
            let id = value.as_str().unwrap_or("");
            if id.is_empty() {
                return String::new();
            }
            opt_names.get(id).cloned().unwrap_or_else(|| id.to_string())
        }

        "multi_select" => {
            let Some(arr) = value.as_array() else {
                return String::new();
            };
            let names: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str())
                .filter(|id| !id.is_empty())
                .map(|id| opt_names.get(id).cloned().unwrap_or_else(|| id.to_string()))
                .collect();
            if names.is_empty() {
                String::new()
            } else {
                // JSON array of names for unambiguous parsing
                serde_json::to_string(&names).unwrap_or_default()
            }
        }

        "date" => {
            if value.is_null() {
                return String::new();
            }
            if let Some(ms) = value.as_i64() {
                ms_to_utc_date(ms)
            } else {
                String::new()
            }
        }

        "date_time" => {
            if value.is_null() {
                return String::new();
            }
            if let Some(ms) = value.as_i64() {
                if field.include_time {
                    ms_to_utc_datetime(ms)
                } else {
                    ms_to_utc_date(ms)
                }
            } else {
                String::new()
            }
        }

        "time" => {
            if let Some(secs) = value.as_i64() {
                let h = secs / 3600;
                let m = (secs % 3600) / 60;
                let s = secs % 60;
                format!("{:02}:{:02}:{:02}", h, m, s)
            } else {
                String::new()
            }
        }

        "checklist" => {
            let Some(arr) = value.as_array() else {
                return String::new();
            };
            let items: Vec<String> = arr
                .iter()
                .filter_map(|item| {
                    let text = item.get("text")?.as_str()?.trim().to_string();
                    if text.is_empty() {
                        return None;
                    }
                    let checked = item
                        .get("is_checked")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    Some(if checked {
                        format!("[x] {}", text)
                    } else {
                        format!("[ ] {}", text)
                    })
                })
                .collect();
            items.join("; ")
        }

        "media" => {
            if let Some(arr) = value.as_array() {
                let paths: Vec<&str> = arr
                    .iter()
                    .filter_map(|v| {
                        v.as_str()
                            .or_else(|| v.get("url").and_then(|u| u.as_str()))
                            .or_else(|| v.get("path").and_then(|p| p.as_str()))
                    })
                    .collect();
                paths.join("|")
            } else {
                String::new()
            }
        }

        "last_edited_time" | "created_time" => {
            if let Some(ms) = value.as_i64() {
                ms_to_utc_datetime(ms)
            } else {
                String::new()
            }
        }

        _ => value.as_str().unwrap_or("").to_string(),
    }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

fn ms_to_utc_date(ms: i64) -> String {
    let secs = ms / 1000;
    DateTime::<Utc>::from_timestamp(secs, 0)
        .unwrap_or_default()
        .format("%Y-%m-%d")
        .to_string()
}

fn ms_to_utc_datetime(ms: i64) -> String {
    let secs = ms / 1000;
    DateTime::<Utc>::from_timestamp(secs, 0)
        .unwrap_or_default()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

pub fn now_utc_str() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

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
