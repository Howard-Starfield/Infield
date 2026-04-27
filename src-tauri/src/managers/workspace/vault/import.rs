use std::collections::HashMap;
use std::path::{Path, PathBuf};
use serde::Deserialize;
use serde_json::{json, Value};

// ─── Public output types ──────────────────────────────────────────────────────

/// Everything needed to upsert one database and all its rows into SQLite.
pub struct DatabaseImport {
    pub db_id: String,
    pub db_name: String,
    pub db_icon: String,
    /// Reconstructed `{ "fields": [...] }` JSON for workspace_nodes.properties.
    pub db_properties_json: String,
    pub db_created_at_secs: i64,
    pub db_updated_at_secs: i64,
    pub vault_rel_path: Option<String>,
    pub rows: Vec<RowImport>,
}

pub struct RowImport {
    pub id: String,
    pub name: String,
    pub position: f64,
    /// `{ "cells": { field_id: { "type": ..., "value": ... } } }` JSON.
    pub properties_json: String,
    pub created_at_secs: i64,
    pub updated_at_secs: i64,
}

// ─── YAML frontmatter structs ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct CommonFrontmatter {
    id: String,
    name: String,
    #[serde(default)]
    icon: String,
    #[serde(default)]
    cover: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    fields: Vec<FieldFm>,
    // Type-specific extras (ignored by the shared struct)
    infield_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct FieldFm {
    id: String,
    name: String,
    field_type: String,
    #[serde(default)]
    is_primary: bool,
    #[serde(default)]
    position: i64,
    #[serde(default)]
    hidden: bool,
    #[serde(default)]
    has_formula: bool,
    #[serde(default)]
    include_time: bool,
    #[serde(default)]
    options: Vec<OptionFm>,
}

#[derive(Debug, Clone, Deserialize)]
struct OptionFm {
    id: String,
    name: String,
    #[serde(default = "default_purple")]
    color: String,
}
fn default_purple() -> String { "purple".to_string() }

// ─── Entry point: dispatch by infield_type ────────────────────────────────────

/// Parse a `databases/<slug>/database.md` file and its sibling `rows/<id>.md`
/// files into a `DatabaseImport` struct ready for upsert into SQLite.
///
/// Pre-W4-cleanup layouts (inline-CSV `databases/<slug>.md`, `cards/<id>.md`,
/// `calendar.md` aggregate) are not parsed here — they're quarantined by the
/// boot migration into `<vault>/.handy/legacy-db-files/`. Encountering one
/// here means migration didn't run or the file is a fresh legacy import.
///
/// Fails gracefully — any parse error returns `Err` without touching SQLite.
pub fn parse_vault_database(file_path: &Path) -> Result<DatabaseImport, String> {
    let content = std::fs::read_to_string(file_path)
        .map_err(|e| format!("Cannot read {}: {e}", file_path.display()))?;

    let (fm_text, _body) = split_frontmatter(&content)?;

    let fm: CommonFrontmatter = serde_yaml::from_str(&fm_text)
        .map_err(|e| format!("YAML parse error in {}: {e}", file_path.display()))?;

    let db_rel = file_path.to_string_lossy().replace('\\', "/");

    let rows_dir = file_path.parent().map(|p| p.join("rows"));
    let has_rows_dir = rows_dir.as_deref().map(Path::is_dir).unwrap_or(false);

    // Accept the new format when the marker says "database" OR when a sibling
    // rows/ directory exists (covers freshly-migrated databases that haven't
    // had their schema file rewritten yet).
    if fm.infield_type.as_deref() == Some("database") || has_rows_dir {
        return parse_database_with_rows(fm, rows_dir.as_deref(), &db_rel);
    }

    Err(format!(
        "Legacy pre-W4 vault layout at '{}'. Expected the boot migration to \
         quarantine it under .handy/legacy-db-files/. Run the app once to \
         trigger migration, or call parse_vault_database with a path under \
         databases/<slug>/database.md.",
        file_path.display()
    ))
}

// ─── New W4 format: database.md + rows/<id>.md ───────────────────────────────

fn parse_database_with_rows(
    fm: CommonFrontmatter,
    rows_dir: Option<&Path>,
    vault_rel: &str,
) -> Result<DatabaseImport, String> {
    let created_at_secs = parse_dt_secs(fm.created_at.as_deref());
    let updated_at_secs = parse_dt_secs(fm.updated_at.as_deref());
    let db_properties_json = reconstruct_db_props(&fm.id, &fm.fields);

    let mut rows: Vec<RowImport> = Vec::new();

    if let Some(dir) = rows_dir {
        if dir.is_dir() {
            let mut row_paths: Vec<PathBuf> = std::fs::read_dir(dir)
                .map_err(|e| format!("Cannot read rows dir {}: {e}", dir.display()))?
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| {
                    p.extension().map(|x| x == "md").unwrap_or(false)
                        && !p.file_name()
                            .and_then(|n| n.to_str())
                            .map(|n| n.ends_with(".md.tmp") || n.starts_with('.'))
                            .unwrap_or(false)
                })
                .collect();
            row_paths.sort();

            for row_path in &row_paths {
                match parse_row_file(row_path, &fm.fields) {
                    Ok(row) => rows.push(row),
                    Err(e) => log::warn!(
                        "[vault-import] skipping row {}: {e}", row_path.display()
                    ),
                }
            }
        }
    }

    // Stable position by created_at, then by filename. Reassign 1.0..N so the
    // SQLite mirror gets dense fractional indices.
    rows.sort_by(|a, b| a.created_at_secs.cmp(&b.created_at_secs).then_with(|| a.id.cmp(&b.id)));
    for (i, r) in rows.iter_mut().enumerate() {
        r.position = (i + 1) as f64;
    }

    Ok(DatabaseImport {
        db_id: fm.id,
        db_name: fm.name,
        db_icon: fm.icon,
        db_properties_json,
        db_created_at_secs: created_at_secs,
        db_updated_at_secs: updated_at_secs,
        vault_rel_path: Some(vault_rel.to_string()),
        rows,
    })
}

#[derive(Debug, Deserialize)]
struct RowFrontmatter {
    id: String,
    #[serde(default)]
    database_id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    icon: String,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    /// Catch-all for `<field_id>: <value>` entries plus `vault_version`.
    #[serde(flatten)]
    extra: HashMap<String, serde_yaml::Value>,
}

fn parse_row_file(path: &Path, db_fields: &[FieldFm]) -> Result<RowImport, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("read error: {e}"))?;
    let (fm_text, _body) = split_frontmatter(&content)?;
    let row: RowFrontmatter = serde_yaml::from_str(&fm_text)
        .map_err(|e| format!("YAML error: {e}"))?;

    let mut cells: serde_json::Map<String, Value> = serde_json::Map::new();
    for field in db_fields {
        let Some(yaml_val) = row.extra.get(&field.id) else { continue };
        let cell_value = deserialize_cell_yaml(field, yaml_val);
        if !cell_value.is_null() {
            cells.insert(field.id.clone(), json!({
                "type": field.field_type,
                "value": cell_value,
            }));
        }
    }

    // Primary cell mirrors the title — overwrite from row.title so a renamed
    // title in the file wins over a stale primary cell value.
    if let Some(pf) = db_fields.iter().find(|f| f.is_primary) {
        if !row.title.is_empty() {
            cells.insert(pf.id.clone(), json!({
                "type": pf.field_type,
                "value": row.title,
            }));
        }
    }

    Ok(RowImport {
        id: row.id,
        name: row.title,
        position: 0.0, // reassigned by parse_database_with_rows
        properties_json: json!({ "cells": cells }).to_string(),
        created_at_secs: parse_dt_secs(row.created_at.as_deref()),
        updated_at_secs: parse_dt_secs(row.updated_at.as_deref()),
    })
}

/// Reverse of `serialize_cell_yaml` in `mod.rs`. Reads a YAML scalar/sequence
/// and returns the JSON representation expected by `properties.cells`.
fn deserialize_cell_yaml(field: &FieldFm, val: &serde_yaml::Value) -> Value {
    use serde_yaml::Value as Y;
    if matches!(val, Y::Null) {
        return Value::Null;
    }

    match field.field_type.as_str() {
        "rich_text" | "url" | "protected" | "single_select" | "board" => {
            val.as_str().map(|s| Value::String(s.to_string())).unwrap_or(Value::Null)
        }
        "number" => match val {
            Y::Number(n) => n.as_f64().map(Value::from).unwrap_or(Value::Null),
            Y::String(s) => s.parse::<f64>().map(Value::from).unwrap_or(Value::Null),
            _ => Value::Null,
        },
        "checkbox" => match val {
            Y::Bool(b) => Value::Bool(*b),
            Y::String(s) => Value::Bool(s.eq_ignore_ascii_case("true")),
            _ => Value::Bool(false),
        },
        "date" | "date_time" | "last_edited_time" | "created_time" => {
            let s = val.as_str().unwrap_or("");
            parse_date_to_ms(s, field.include_time || field.field_type != "date")
                .map(Value::from)
                .unwrap_or(Value::Null)
        }
        "time" => match val {
            Y::Number(n) => n.as_i64().map(Value::from).unwrap_or(Value::Null),
            Y::String(s) => s.parse::<i64>().map(Value::from).unwrap_or(Value::Null),
            _ => Value::Null,
        },
        "multi_select" | "checklist" | "media" => match val {
            Y::Sequence(seq) => {
                let items: Vec<Value> = seq.iter()
                    .filter_map(|v| v.as_str().map(|s| Value::String(s.to_string())))
                    .collect();
                Value::Array(items)
            }
            _ => Value::Array(vec![]),
        },
        _ => val.as_str().map(|s| Value::String(s.to_string())).unwrap_or(Value::Null),
    }
}

// ─── DB properties reconstruction ────────────────────────────────────────────

/// Reconstruct the `{ "fields": [...] }` JSON that workspace_nodes.properties
/// stores for a database node, from the vault's parsed field list.
fn reconstruct_db_props(db_id: &str, fields: &[FieldFm]) -> String {
    let fields_json: Vec<Value> = fields.iter().map(|f| {
        let type_option = if f.options.is_empty() {
            if f.include_time {
                json!({ "include_time": true })
            } else {
                json!({})
            }
        } else {
            let opts: Vec<Value> = f.options.iter()
                .map(|o| json!({ "id": o.id, "name": o.name, "color": o.color }))
                .collect();
            json!({ "options": opts })
        };

        json!({
            "id": f.id,
            "database_id": db_id,
            "name": f.name,
            "field_type": f.field_type,
            "is_primary": f.is_primary,
            "type_option": type_option,
            "position": f.position,
        })
    }).collect();

    json!({ "fields": fields_json }).to_string()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Split `---\n<frontmatter>\n---\n<body>` into (frontmatter, body).
pub fn split_frontmatter(content: &str) -> Result<(String, String), String> {
    let content = content.trim_start();
    if !content.starts_with("---") {
        return Err("File does not start with YAML frontmatter (expected `---`)".to_string());
    }
    // Find second `---` (on its own line)
    let rest = &content[3..];
    let end_pos = rest.find("\n---")
        .ok_or("Frontmatter closing `---` not found")?;
    let fm_text = rest[..end_pos].trim().to_string();
    let body_start = end_pos + 4; // skip "\n---"
    let body = rest.get(body_start..).unwrap_or("").trim_start_matches('\n');
    Ok((fm_text, body.to_string()))
}

fn parse_dt_secs(s: Option<&str>) -> i64 {
    let s = match s { Some(s) if !s.is_empty() => s, _ => return 0 };
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.timestamp())
        .unwrap_or(0)
}

fn parse_date_to_ms(s: &str, include_time: bool) -> Option<i64> {
    if include_time {
        chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|dt| dt.timestamp_millis())
            .or_else(|| {
                // Try without timezone: "YYYY-MM-DDTHH:MM:SSZ"
                chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%SZ")
                    .ok()
                    .map(|dt| dt.and_utc().timestamp_millis())
            })
    } else {
        chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
            .ok()
            .map(|d| {
                use chrono::Timelike;
                d.and_hms_opt(0, 0, 0)
                    .unwrap()
                    .and_utc()
                    .timestamp_millis()
            })
    }
}
