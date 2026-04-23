use std::path::{Path, PathBuf};
use serde_json::Value;

use super::format::{
    option_id_to_name, parse_fields, serialize_common_frontmatter, serialize_cell_for_csv,
    slugify, VaultField, VaultType,
};
use crate::managers::workspace::node_types::{NodeView, WorkspaceNode};

/// Export a database and all its row children as a YAML-frontmatter + CSV vault file.
/// Returns the path of the written file relative to `vault_root`.
pub fn export_table(
    db: &WorkspaceNode,
    rows: &[WorkspaceNode],
    view: Option<&NodeView>,
    vault_root: &Path,
) -> Result<PathBuf, String> {
    let db_props: Value = serde_json::from_str(&db.properties).map_err(|e| e.to_string())?;

    // Parse view options for field visibility
    let field_visibility = view_field_visibility(view);
    let _view_options: Value = view
        .map(|v| serde_json::from_str(&v.view_options).unwrap_or(Value::Object(serde_json::Map::new())))
        .unwrap_or(Value::Object(serde_json::Map::new()));

    // Parse fields and split out protected ones
    let all_fields = parse_fields(&db_props, &field_visibility);
    let (export_fields, protected_fields): (Vec<VaultField>, Vec<VaultField>) =
        all_fields.into_iter().partition(|f| f.field_type != "protected");

    let excluded: Vec<(&str, &str)> = protected_fields
        .iter()
        .map(|f| (f.id.as_str(), f.name.as_str()))
        .collect();

    // Cover from properties
    let cover_str: Option<String> = db_props
        .get("cover")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Build YAML frontmatter
    let mut frontmatter = serialize_common_frontmatter(
        VaultType::Table,
        &db.id,
        &db.name,
        &db.icon,
        cover_str.as_deref(),
        db.created_at,
        db.updated_at,
        &export_fields,
        &excluded,
    );

    // Primary view details (filters/sorts stored in view, not in frontmatter for v1)
    if let Some(v) = view {
        frontmatter.push_str(&format!("view_id: {}\n", super::format::yaml_str(&v.id)));
        frontmatter.push_str(&format!("view_name: {}\n", super::format::yaml_str(&v.name)));
    }

    // Build CSV
    let csv_bytes = build_csv(&export_fields, rows)?;
    let csv_str = String::from_utf8(csv_bytes).map_err(|e| e.to_string())?;

    let content = format!("---\n{}---\n\n{}", frontmatter, csv_str);

    // Write to databases/{slug}.md
    let slug = slugify(&db.name);
    let rel_path = PathBuf::from(format!("databases/{}.md", slug));
    let abs_path = vault_root.join(&rel_path);
    if let Some(parent) = abs_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&abs_path, &content).map_err(|e| e.to_string())?;

    Ok(rel_path)
}

fn build_csv(fields: &[VaultField], rows: &[WorkspaceNode]) -> Result<Vec<u8>, String> {
    let mut wtr = csv::WriterBuilder::new()
        .has_headers(true)
        .from_writer(vec![]);

    // Header: _row_id first, then field names in position order
    let mut header: Vec<String> = vec!["_row_id".to_string()];
    for f in fields {
        header.push(f.name.clone());
    }
    wtr.write_record(&header).map_err(|e| e.to_string())?;

    for row in rows {
        let row_props: Value =
            serde_json::from_str(&row.properties).unwrap_or(Value::Object(serde_json::Map::new()));
        let cells = row_props.get("cells").cloned().unwrap_or(Value::Object(serde_json::Map::new()));

        let mut record: Vec<String> = vec![row.id.clone()];
        for field in fields {
            let cell = cells.get(&field.id).cloned().unwrap_or(Value::Null);
            let opt_names = option_id_to_name(field);
            // Check if any cell for this field has a formula — mark field
            let has_formula = cell.get("formula").and_then(|v| v.as_str()).is_some_and(|s| !s.is_empty());
            let mut field_clone = field.clone();
            field_clone.has_formula = has_formula;
            let val = serialize_cell_for_csv(&field_clone, &cell, &opt_names);
            record.push(val);
        }
        wtr.write_record(&record).map_err(|e| e.to_string())?;
    }

    wtr.flush().map_err(|e| e.to_string())?;
    wtr.into_inner().map_err(|e| e.to_string())
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

pub fn view_field_visibility(view: Option<&NodeView>) -> std::collections::HashMap<String, bool> {
    let Some(view) = view else {
        return std::collections::HashMap::new();
    };
    let Ok(opts) = serde_json::from_str::<Value>(&view.view_options) else {
        return std::collections::HashMap::new();
    };
    opts.get("fieldVisibility")
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(k, v)| v.as_bool().map(|b| (k.clone(), b)))
                .collect()
        })
        .unwrap_or_default()
}
