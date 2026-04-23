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
pub struct FieldFm {
    pub id: String,
    pub name: String,
    pub field_type: String,
    #[serde(default)]
    pub is_primary: bool,
    #[serde(default)]
    pub position: i64,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub has_formula: bool,
    #[serde(default)]
    pub include_time: bool,
    #[serde(default)]
    pub options: Vec<OptionFm>,
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

/// Parse a vault database file and its associated card/sub-files into a
/// `DatabaseImport` struct ready for upsert into SQLite.
///
/// `file_path` is the absolute path of the primary vault file (table .md,
/// board/board.md, or calendar/calendar.md).
/// Fails gracefully — any parse error returns `Err` without touching SQLite.
pub fn parse_vault_database(file_path: &Path) -> Result<DatabaseImport, String> {
    let content = std::fs::read_to_string(file_path)
        .map_err(|e| format!("Cannot read {}: {e}", file_path.display()))?;

    let (fm_text, body) = split_frontmatter(&content)?;

    let fm: CommonFrontmatter = serde_yaml::from_str(&fm_text)
        .map_err(|e| format!("YAML parse error in {}: {e}", file_path.display()))?;

    let db_rel = file_path
        .to_string_lossy()
        .replace('\\', "/");

    match fm.infield_type.as_deref().unwrap_or("table") {
        "board" => parse_board(fm, file_path, &db_rel),
        "calendar" => parse_calendar(fm, &body, &db_rel),
        _ => parse_table(fm, &body, &db_rel), // "table" + unknown
    }
}

// ─── Table import ─────────────────────────────────────────────────────────────

fn parse_table(fm: CommonFrontmatter, csv_text: &str, vault_rel: &str) -> Result<DatabaseImport, String> {
    let created_at_secs = parse_dt_secs(fm.created_at.as_deref());
    let updated_at_secs = parse_dt_secs(fm.updated_at.as_deref());

    let db_properties_json = reconstruct_db_props(&fm.id, &fm.fields);

    // Build field_name → field lookup (for CSV header matching)
    let field_by_name: HashMap<&str, &FieldFm> = fm.fields.iter()
        .map(|f| (f.name.as_str(), f))
        .collect();

    let rows = parse_csv_into_rows(csv_text, &fm.fields, &field_by_name)?;

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

fn parse_csv_into_rows(
    csv_text: &str,
    fields: &[FieldFm],
    field_by_name: &HashMap<&str, &FieldFm>,
) -> Result<Vec<RowImport>, String> {
    let trimmed = csv_text.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(trimmed.as_bytes());

    let headers: Vec<String> = rdr
        .headers()
        .map_err(|e| format!("CSV header error: {e}"))?
        .iter()
        .map(|s| s.to_string())
        .collect();

    // Map header index → field (skip _row_id at index 0)
    let col_fields: Vec<Option<&FieldFm>> = headers
        .iter()
        .map(|h| if h == "_row_id" { None } else { field_by_name.get(h.as_str()).copied() })
        .collect();

    let row_id_col = headers.iter().position(|h| h == "_row_id")
        .ok_or("CSV missing _row_id column")?;

    // Find primary field for name
    let primary_field = fields.iter().find(|f| f.is_primary);

    let mut rows: Vec<RowImport> = Vec::new();
    let mut position = 1.0_f64;

    for result in rdr.records() {
        let record = result.map_err(|e| format!("CSV row error: {e}"))?;
        let row_id = record.get(row_id_col).unwrap_or("").to_string();
        if row_id.is_empty() {
            continue;
        }

        let mut cells: serde_json::Map<String, Value> = serde_json::Map::new();
        let mut row_name = String::new();

        for (col_idx, field_opt) in col_fields.iter().enumerate() {
            let Some(field) = field_opt else { continue };
            let raw = record.get(col_idx).unwrap_or("");

            if field.is_primary && row_name.is_empty() {
                row_name = raw.to_string();
            }

            let cell_value = deserialize_cell(field, raw);
            cells.insert(field.id.clone(), json!({
                "type": field.field_type,
                "value": cell_value,
            }));
        }

        // Fall back to row_id short prefix if no primary field
        if row_name.is_empty() {
            if let Some(pf) = primary_field {
                if let Some(cell) = cells.get(&pf.id) {
                    row_name = cell["value"].as_str().unwrap_or("").to_string();
                }
            }
        }
        if row_name.is_empty() {
            row_name = format!("Row {}", rows.len() + 1);
        }

        rows.push(RowImport {
            id: row_id,
            name: row_name,
            position,
            properties_json: json!({ "cells": cells }).to_string(),
            created_at_secs: 0, // CSV does not store row timestamps
            updated_at_secs: 0,
        });
        position += 1.0;
    }

    Ok(rows)
}

// ─── Board import ─────────────────────────────────────────────────────────────

fn parse_board(fm: CommonFrontmatter, board_file: &Path, vault_rel: &str) -> Result<DatabaseImport, String> {
    let created_at_secs = parse_dt_secs(fm.created_at.as_deref());
    let updated_at_secs = parse_dt_secs(fm.updated_at.as_deref());
    let db_properties_json = reconstruct_db_props(&fm.id, &fm.fields);

    // cards/ directory is sibling to board.md
    let cards_dir = board_file
        .parent()
        .map(|p| p.join("cards"))
        .ok_or("Cannot resolve cards/ directory")?;

    let mut rows: Vec<RowImport> = Vec::new();

    if cards_dir.exists() {
        let mut card_paths: Vec<PathBuf> = std::fs::read_dir(&cards_dir)
            .map_err(|e| format!("Cannot read cards dir: {e}"))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().map(|x| x == "md").unwrap_or(false))
            .collect();
        card_paths.sort();

        for card_path in &card_paths {
            match parse_card_file(card_path, &fm.fields) {
                Ok(row) => rows.push(row),
                Err(e) => log::warn!("[vault-import] skipping card {}: {e}", card_path.display()),
            }
        }
    }

    // Sort by position
    rows.sort_by(|a, b| a.position.partial_cmp(&b.position).unwrap_or(std::cmp::Ordering::Equal));

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
struct CardFrontmatter {
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    icon: String,
    #[serde(default)]
    column_option_id: Option<String>,
    #[serde(default)]
    position: f64,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    // `fields:` inline summaries (field_name: value) are informational only;
    // the authoritative cell data comes from rebuilding from board schema.
    #[serde(default)]
    fields: serde_yaml::Value,
}

fn parse_card_file(path: &Path, db_fields: &[FieldFm]) -> Result<RowImport, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("read error: {e}"))?;
    let (fm_text, body) = split_frontmatter(&content)?;
    let card: CardFrontmatter = serde_yaml::from_str(&fm_text)
        .map_err(|e| format!("YAML error: {e}"))?;

    // Find the board/single_select group field
    let group_field = db_fields.iter()
        .find(|f| f.field_type == "board" || f.field_type == "single_select");

    let mut cells: serde_json::Map<String, Value> = serde_json::Map::new();

    // Set the board column cell from column_option_id
    if let (Some(gf), Some(opt_id)) = (group_field, &card.column_option_id) {
        cells.insert(gf.id.clone(), json!({
            "type": gf.field_type,
            "value": opt_id,
        }));
    }

    // Rebuild inline summary fields from the card's `fields:` YAML map
    // These are field_name → string_value pairs used for informational display.
    // We reverse them back into cell JSON using the db schema.
    if let serde_yaml::Value::Mapping(map) = &card.fields {
        let field_by_name: HashMap<&str, &FieldFm> = db_fields.iter()
            .map(|f| (f.name.as_str(), f))
            .collect();
        for (k, v) in map {
            let k_str = match k.as_str() { Some(s) => s, None => continue };
            let v_str = match v.as_str() { Some(s) => s, None => continue };
            if let Some(field) = field_by_name.get(k_str) {
                // Skip primary field — set from card title below
                if field.is_primary { continue }
                let cell_value = deserialize_cell(field, v_str);
                cells.insert(field.id.clone(), json!({
                    "type": field.field_type,
                    "value": cell_value,
                }));
            }
        }
    }

    // Primary field = card title (Q4: title from card YAML, not CSV)
    if let Some(pf) = db_fields.iter().find(|f| f.is_primary) {
        cells.insert(pf.id.clone(), json!({
            "type": pf.field_type,
            "value": card.title,
        }));
    }

    Ok(RowImport {
        id: card.id,
        name: card.title.clone(),
        position: card.position,
        properties_json: json!({ "cells": cells }).to_string(),
        created_at_secs: parse_dt_secs(card.created_at.as_deref()),
        updated_at_secs: parse_dt_secs(card.updated_at.as_deref()),
    })
}

// ─── Calendar import ──────────────────────────────────────────────────────────

fn parse_calendar(fm: CommonFrontmatter, body: &str, vault_rel: &str) -> Result<DatabaseImport, String> {
    let created_at_secs = parse_dt_secs(fm.created_at.as_deref());
    let updated_at_secs = parse_dt_secs(fm.updated_at.as_deref());
    let db_properties_json = reconstruct_db_props(&fm.id, &fm.fields);

    // Extract rows from body: look for <!-- infield_row_id: {id} --> comments
    // paired with the preceding `- [ ] **{name}**` line.
    let rows = parse_calendar_body(body);

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

fn parse_calendar_body(body: &str) -> Vec<RowImport> {
    let mut rows: Vec<RowImport> = Vec::new();
    let lines: Vec<&str> = body.lines().collect();
    let mut position = 1.0_f64;

    let mut pending_name: Option<String> = None;

    for line in &lines {
        let trimmed = line.trim();

        // `- [ ] **Name**` or `- [x] **Name**`
        if trimmed.starts_with("- [") {
            if let Some(name) = extract_task_name(trimmed) {
                pending_name = Some(name);
            }
            continue;
        }

        // `  <!-- infield_row_id: uuid -->`
        if let Some(row_id) = extract_row_id_comment(trimmed) {
            if let Some(name) = pending_name.take() {
                rows.push(RowImport {
                    id: row_id,
                    name,
                    position,
                    properties_json: r#"{"cells":{}}"#.to_string(),
                    created_at_secs: 0,
                    updated_at_secs: 0,
                });
                position += 1.0;
            }
        } else {
            // Non-comment, non-task line clears the pending buffer
            if !trimmed.is_empty() {
                pending_name = None;
            }
        }
    }

    rows
}

fn extract_task_name(line: &str) -> Option<String> {
    // `- [ ] **Name** — extras` or `- [x] **Name**`
    let after_checkbox = line.find("] ")?;
    let rest = line[after_checkbox + 2..].trim();
    // Bold: **Name**
    if let (Some(s), Some(e)) = (rest.find("**"), rest.rfind("**")) {
        if s + 2 < e {
            return Some(rest[s + 2..e].to_string());
        }
    }
    // Plain text fallback
    let name = rest.split(" — ").next()?.trim().to_string();
    if name.is_empty() { None } else { Some(name) }
}

fn extract_row_id_comment(line: &str) -> Option<String> {
    // `<!-- infield_row_id: uuid -->`
    let inner = line.strip_prefix("<!--")?.strip_suffix("-->")?.trim();
    let id = inner.strip_prefix("infield_row_id:")?.trim().to_string();
    if id.is_empty() { None } else { Some(id) }
}

// ─── Cell deserialisation (reverse of serialize_cell_for_csv) ────────────────

fn deserialize_cell(field: &FieldFm, raw: &str) -> Value {
    if raw.is_empty() {
        return Value::Null;
    }

    // Build option_name → option_id reverse map
    let name_to_id: HashMap<String, String> = field.options.iter()
        .map(|o| (o.name.to_lowercase(), o.id.clone()))
        .collect();

    match field.field_type.as_str() {
        "rich_text" | "url" => Value::String(raw.to_string()),

        "number" => raw.parse::<f64>()
            .map(Value::from)
            .unwrap_or(Value::Null),

        "checkbox" => Value::Bool(raw.eq_ignore_ascii_case("true")),

        "single_select" | "board" => {
            // CSV stores option name; we need option id
            let id = name_to_id.get(&raw.to_lowercase())
                .cloned()
                .unwrap_or_else(|| raw.to_string());
            Value::String(id)
        }

        "multi_select" => {
            // CSV stores JSON array of names e.g. `["Tag1","Tag2"]`
            if let Ok(names) = serde_json::from_str::<Vec<String>>(raw) {
                let ids: Vec<Value> = names.iter()
                    .map(|n| {
                        let id = name_to_id.get(&n.to_lowercase())
                            .cloned()
                            .unwrap_or_else(|| n.clone());
                        Value::String(id)
                    })
                    .collect();
                Value::Array(ids)
            } else {
                // Fallback: comma-separated
                let ids: Vec<Value> = raw.split(',')
                    .map(|n| n.trim())
                    .filter(|n| !n.is_empty())
                    .map(|n| {
                        let id = name_to_id.get(&n.to_lowercase())
                            .cloned()
                            .unwrap_or_else(|| n.to_string());
                        Value::String(id)
                    })
                    .collect();
                Value::Array(ids)
            }
        }

        "date" => parse_date_to_ms(raw, false)
            .map(Value::from)
            .unwrap_or(Value::Null),

        "date_time" => {
            parse_date_to_ms(raw, field.include_time)
                .map(Value::from)
                .unwrap_or(Value::Null)
        }

        "time" => {
            // "HH:MM:SS" → seconds
            let parts: Vec<&str> = raw.split(':').collect();
            if parts.len() == 3 {
                let h = parts[0].parse::<i64>().unwrap_or(0);
                let m = parts[1].parse::<i64>().unwrap_or(0);
                let s = parts[2].parse::<i64>().unwrap_or(0);
                Value::from(h * 3600 + m * 60 + s)
            } else {
                Value::Null
            }
        }

        "checklist" => {
            // Items separated by "; " with `[x]`/`[ ]` prefix
            let items: Vec<Value> = raw.split("; ")
                .filter(|s| !s.trim().is_empty())
                .map(|item| {
                    let (checked, text) = if item.trim_start().starts_with("[x]") {
                        (true, item.trim_start()[3..].trim().to_string())
                    } else if item.trim_start().starts_with("[ ]") {
                        (false, item.trim_start()[3..].trim().to_string())
                    } else {
                        (false, item.trim().to_string())
                    };
                    json!({ "text": text, "is_checked": checked })
                })
                .collect();
            Value::Array(items)
        }

        "media" => {
            let paths: Vec<Value> = raw.split('|')
                .filter(|s| !s.is_empty())
                .map(|p| Value::String(p.to_string()))
                .collect();
            Value::Array(paths)
        }

        _ => Value::String(raw.to_string()),
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
