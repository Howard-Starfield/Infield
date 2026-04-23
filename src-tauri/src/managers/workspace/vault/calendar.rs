use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use serde_json::Value;

use super::format::{
    option_id_to_name, parse_fields,
    serialize_common_frontmatter, serialize_cell_for_csv, slugify, VaultField, VaultType,
};
use crate::managers::workspace::node_types::{NodeView, WorkspaceNode};

// Re-export date helpers that are pub(crate) in format.rs via pub use
// (we declared them pub there, so just use them directly)

/// Export a database as a calendar vault file.
/// `date_field_id`: the field used for grouping by date.
pub fn export_calendar(
    db: &WorkspaceNode,
    rows: &[WorkspaceNode],
    view: Option<&NodeView>,
    date_field_id: &str,
    vault_root: &Path,
) -> Result<PathBuf, String> {
    let db_props: Value = serde_json::from_str(&db.properties).map_err(|e| e.to_string())?;
    let field_visibility = super::table::view_field_visibility(view);
    let all_fields = parse_fields(&db_props, &field_visibility);
    let (export_fields, protected_fields): (Vec<VaultField>, Vec<VaultField>) =
        all_fields.into_iter().partition(|f| f.field_type != "protected");

    let excluded: Vec<(&str, &str)> = protected_fields
        .iter()
        .map(|f| (f.id.as_str(), f.name.as_str()))
        .collect();

    let cover_str: Option<String> = db_props
        .get("cover")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let date_field = export_fields
        .iter()
        .find(|f| f.id == date_field_id)
        .ok_or_else(|| format!("date field '{}' not found in database schema", date_field_id))?;
    let use_time = date_field.include_time;

    // Frontmatter
    let mut frontmatter = serialize_common_frontmatter(
        VaultType::Calendar,
        &db.id,
        &db.name,
        &db.icon,
        cover_str.as_deref(),
        db.created_at,
        db.updated_at,
        &export_fields,
        &excluded,
    );
    frontmatter.push_str(&format!(
        "date_field_id: {}\n",
        super::format::yaml_str(date_field_id)
    ));

    if let Some(v) = view {
        frontmatter.push_str(&format!("view_id: {}\n", super::format::yaml_str(&v.id)));
    }

    // Body — group rows by date
    let mut by_date: BTreeMap<String, Vec<&WorkspaceNode>> = BTreeMap::new();
    let mut unscheduled: Vec<&WorkspaceNode> = Vec::new();

    for row in rows {
        let row_props: Value = serde_json::from_str(&row.properties)
            .unwrap_or(Value::Object(serde_json::Map::new()));
        let date_str = extract_date_string(&row_props, date_field_id, use_time);
        match date_str {
            Some(d) => by_date.entry(d).or_default().push(row),
            None => unscheduled.push(row),
        }
    }

    let extra_fields: Vec<&VaultField> = export_fields
        .iter()
        .filter(|f| f.id != date_field_id && !f.is_primary && !f.hidden)
        .take(3)
        .collect();

    let mut body = format!("# {}\n", db.name);

    for (date, day_rows) in &by_date {
        body.push_str(&format!("\n## {}\n", date));
        for row in day_rows {
            body.push_str(&format_calendar_row(row, &extra_fields));
        }
    }

    if !unscheduled.is_empty() {
        body.push_str("\n## Unscheduled\n");
        for row in &unscheduled {
            body.push_str(&format_calendar_row(row, &extra_fields));
        }
    }

    let content = format!("---\n{}---\n\n{}", frontmatter, body);

    let slug = slugify(&db.name);
    let rel_path = PathBuf::from(format!("databases/{}/calendar.md", slug));
    let abs_path = vault_root.join(&rel_path);
    if let Some(parent) = abs_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&abs_path, &content).map_err(|e| e.to_string())?;

    Ok(rel_path)
}

fn extract_date_string(row_props: &Value, date_field_id: &str, use_time: bool) -> Option<String> {
    let cell = row_props.get("cells")?.get(date_field_id)?;
    let value = cell.get("value")?;
    if value.is_null() {
        return None;
    }
    let ms = value.as_i64()?;
    if ms == 0 {
        return None;
    }
    let secs = ms / 1000;
    use chrono::{DateTime, Utc};
    let dt = DateTime::<Utc>::from_timestamp(secs, 0)?;
    if use_time {
        Some(dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
    } else {
        Some(dt.format("%Y-%m-%d").to_string())
    }
}

fn format_calendar_row(
    row: &WorkspaceNode,
    extra_fields: &[&VaultField],
) -> String {
    let row_props: Value =
        serde_json::from_str(&row.properties).unwrap_or(Value::Object(serde_json::Map::new()));
    let cells = row_props
        .get("cells")
        .cloned()
        .unwrap_or(Value::Object(serde_json::Map::new()));

    let mut extras: Vec<String> = Vec::new();
    for field in extra_fields {
        let cell = cells.get(&field.id).cloned().unwrap_or(Value::Null);
        let opt_names = option_id_to_name(field);
        let val = serialize_cell_for_csv(field, &cell, &opt_names);
        if !val.is_empty() {
            extras.push(format!("{}: {}", field.name, val));
        }
    }

    let extra_str = if extras.is_empty() {
        String::new()
    } else {
        format!(" — {}", extras.join(", "))
    };

    let mut line = format!("- [ ] **{}**{}\n", row.name, extra_str);
    line.push_str(&format!("  <!-- infield_row_id: {} -->\n", row.id));
    line
}

