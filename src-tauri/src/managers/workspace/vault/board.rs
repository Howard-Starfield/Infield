use std::collections::HashMap;
use std::path::{Path, PathBuf};
use serde_json::Value;

use super::format::{
    option_id_to_name, parse_fields, serialize_common_frontmatter, slugify,
    timestamp_to_utc_str, yaml_str, VaultField, VaultOption, VaultType,
};
use super::table::view_field_visibility;
use crate::managers::workspace::node_types::{NodeView, WorkspaceNode};

pub struct BoardExport {
    /// Relative path of the main board file (relative to vault_root).
    pub board_file_path: PathBuf,
    /// Relative paths of all written card sub-documents.
    pub card_paths: Vec<PathBuf>,
}

/// Export a database as a board vault file + card sub-documents.
/// `group_field_id`: the `board` or `single_select` field used for column grouping.
/// Returns paths of all written files (board file first, then cards).
pub fn export_board(
    db: &WorkspaceNode,
    rows: &[WorkspaceNode],
    view: Option<&NodeView>,
    group_field_id: &str,
    vault_root: &Path,
) -> Result<BoardExport, String> {
    let db_props: Value = serde_json::from_str(&db.properties).map_err(|e| e.to_string())?;
    let field_visibility = view_field_visibility(view);
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

    let group_field = export_fields
        .iter()
        .find(|f| f.id == group_field_id)
        .ok_or_else(|| format!("group field '{}' not found in database schema", group_field_id))?;

    // Build option_id → VaultOption for the grouping field
    let opt_by_id: HashMap<String, &VaultOption> =
        group_field.options.iter().map(|o| (o.id.clone(), o)).collect();

    // Group rows by their board column option value (stable option ID)
    // Preserve column order from field options definition
    let column_order: Vec<String> = group_field.options.iter().map(|o| o.id.clone()).collect();

    let mut columns: HashMap<String, Vec<&WorkspaceNode>> = HashMap::new();
    let mut uncategorized: Vec<&WorkspaceNode> = Vec::new();

    for row in rows {
        let row_props: Value = serde_json::from_str(&row.properties)
            .unwrap_or(Value::Object(serde_json::Map::new()));
        let opt_id = row_props
            .get("cells")
            .and_then(|c| c.get(group_field_id))
            .and_then(|cell| cell.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if opt_id.is_empty() || !opt_by_id.contains_key(&opt_id) {
            uncategorized.push(row);
        } else {
            columns.entry(opt_id).or_default().push(row);
        }
    }

    // Sort rows within each column by position ascending
    for col_rows in columns.values_mut() {
        col_rows.sort_by(|a, b| a.position.partial_cmp(&b.position).unwrap_or(std::cmp::Ordering::Equal));
    }
    uncategorized.sort_by(|a, b| a.position.partial_cmp(&b.position).unwrap_or(std::cmp::Ordering::Equal));

    // Frontmatter
    let mut frontmatter = serialize_common_frontmatter(
        VaultType::Board,
        &db.id,
        &db.name,
        &db.icon,
        cover_str.as_deref(),
        db.created_at,
        db.updated_at,
        &export_fields,
        &excluded,
    );
    frontmatter.push_str(&format!("group_field_id: {}\n", yaml_str(group_field_id)));

    if let Some(v) = view {
        frontmatter.push_str(&format!("view_id: {}\n", yaml_str(&v.id)));
    }

    // Board body
    let mut body = format!("# {}\n", db.name);

    let slug = slugify(&db.name);
    let cards_rel_base = PathBuf::from(format!("databases/{}/cards", slug));
    let cards_abs_base = vault_root.join(&cards_rel_base);
    std::fs::create_dir_all(&cards_abs_base).map_err(|e| e.to_string())?;

    let mut card_paths: Vec<PathBuf> = Vec::new();

    // Emit columns in option definition order
    for opt_id in &column_order {
        let opt = match opt_by_id.get(opt_id) {
            Some(o) => o,
            None => continue,
        };
        body.push_str(&format!("\n## {}\n", opt.name));
        body.push_str(&format!("<!-- column_option_id: {} -->\n", opt.id));

        let col_rows = columns.get(opt_id).map(|v| v.as_slice()).unwrap_or(&[]);
        for row in col_rows {
            body.push_str(&format!(
                "- **{}** (`{}`) — position: {:.1}\n",
                row.name, row.id, row.position
            ));

            // Write card sub-document
            let card_rel = cards_rel_base.join(format!("{}.md", row.id));
            let card_content = build_card_file(row, db, opt_id, &opt.name, &export_fields);
            std::fs::write(vault_root.join(&card_rel), &card_content)
                .map_err(|e| e.to_string())?;
            card_paths.push(card_rel);
        }
    }

    // Uncategorized column
    body.push_str("\n## Uncategorized\n");
    body.push_str("<!-- column_option_id: null -->\n");
    for row in &uncategorized {
        body.push_str(&format!(
            "- **{}** (`{}`) — position: {:.1}\n",
            row.name, row.id, row.position
        ));
        let card_rel = cards_rel_base.join(format!("{}.md", row.id));
        let card_content = build_card_file(row, db, "", "Uncategorized", &export_fields);
        std::fs::write(vault_root.join(&card_rel), &card_content)
            .map_err(|e| e.to_string())?;
        card_paths.push(card_rel);
    }

    let content = format!("---\n{}---\n\n{}", frontmatter, body);
    let board_rel = PathBuf::from(format!("databases/{}/board.md", slug));
    let board_abs = vault_root.join(&board_rel);
    if let Some(parent) = board_abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&board_abs, &content).map_err(|e| e.to_string())?;

    Ok(BoardExport {
        board_file_path: board_rel,
        card_paths,
    })
}

pub fn build_card_file(
    row: &WorkspaceNode,
    db: &WorkspaceNode,
    column_option_id: &str,
    column_option_name: &str,
    fields: &[VaultField],
) -> String {
    let mut fm = String::new();
    fm.push_str(&format!("infield_version: {}\n", super::format::INFIELD_VERSION));
    fm.push_str("infield_type: \"board-card\"\n");
    fm.push_str(&format!("id: {}\n", yaml_str(&row.id)));
    fm.push_str(&format!("database_id: {}\n", yaml_str(&db.id)));
    fm.push_str(&format!("title: {}\n", yaml_str(&row.name)));
    fm.push_str(&format!("icon: {}\n", yaml_str(&row.icon)));
    if column_option_id.is_empty() {
        fm.push_str("column_option_id: null\n");
    } else {
        fm.push_str(&format!("column_option_id: {}\n", yaml_str(column_option_id)));
    }
    fm.push_str(&format!("column_option_name: {}\n", yaml_str(column_option_name)));
    fm.push_str(&format!("position: {:.6}\n", row.position));
    fm.push_str(&format!("created_at: {}\n", yaml_str(&timestamp_to_utc_str(row.created_at))));
    fm.push_str(&format!("updated_at: {}\n", yaml_str(&timestamp_to_utc_str(row.updated_at))));

    // Inline a few key field values for human readability (max 5 non-hidden, non-board fields)
    let row_props: Value =
        serde_json::from_str(&row.properties).unwrap_or(Value::Object(serde_json::Map::new()));
    let cells = row_props
        .get("cells")
        .cloned()
        .unwrap_or(Value::Object(serde_json::Map::new()));

    let summary_fields: Vec<&VaultField> = fields
        .iter()
        .filter(|f| {
            !f.is_primary
                && !f.hidden
                && !matches!(f.field_type.as_str(), "protected" | "board" | "single_select")
        })
        .take(5)
        .collect();

    if !summary_fields.is_empty() {
        fm.push_str("fields:\n");
        for field in summary_fields {
            let cell = cells.get(&field.id).cloned().unwrap_or(Value::Null);
            let opt_names = option_id_to_name(field);
            let val = super::format::serialize_cell_for_csv(field, &cell, &opt_names);
            if !val.is_empty() {
                fm.push_str(&format!("  {}: {}\n", yaml_str(&field.name), yaml_str(&val)));
            }
        }
    }

    let body = row.body.trim();
    format!("---\n{}---\n\n{}\n", fm, body)
}
