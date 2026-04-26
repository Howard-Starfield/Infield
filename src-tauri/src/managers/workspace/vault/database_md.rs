// src-tauri/src/managers/workspace/vault/database_md.rs
//
// Pure helper: writes `<vault>/databases/<db-slug>/database.md`. The frontmatter
// is the schema (database id/name/icon + field schema); the body is a one-line
// placeholder description. Atomic temp-file + rename. Caller is responsible for
// the Rule 13 mtime guard (not enforced here because we only call this on
// initial create + boot migration, where the file does not yet exist).

use std::path::{Path, PathBuf};

use super::format::{
    serialize_common_frontmatter, slugify, VaultField, VaultType,
};
use crate::managers::database::field::Field;
use crate::managers::workspace::node_types::WorkspaceNode;

/// Write `databases/<db-slug>/database.md` for a database node + its field
/// schema. Returns the absolute file path on success.
pub fn export_database_md(
    vault_root: &Path,
    db: &WorkspaceNode,
    fields: &[Field],
) -> Result<PathBuf, String> {
    if db.node_type != "database" {
        return Err(format!(
            "export_database_md: node '{}' has node_type '{}', expected 'database'",
            db.id, db.node_type
        ));
    }

    let db_slug = slugify(&db.name);
    let db_dir = vault_root.join("databases").join(&db_slug);
    std::fs::create_dir_all(&db_dir)
        .map_err(|e| format!("create_dir_all({db_dir:?}) failed: {e}"))?;

    let target = db_dir.join("database.md");
    let tmp = db_dir.join("database.md.tmp");

    let vault_fields: Vec<VaultField> = fields
        .iter()
        .map(field_to_vault_field)
        .collect();

    // serialize_common_frontmatter returns YAML *without* the leading/trailing
    // `---` fences — we wrap it ourselves to produce a valid markdown file.
    let yaml = serialize_common_frontmatter(
        VaultType::Database,
        &db.id,
        &db.name,
        &db.icon,
        None,                     // cover deferred (Rule 12 — preset gradients only, not file uploads)
        db.created_at,
        db.updated_at,
        &vault_fields,
        &[],                      // no protected fields excluded in W4
    );

    let mut content = String::with_capacity(yaml.len() + 256);
    content.push_str("---\n");
    content.push_str(&yaml);
    content.push_str("---\n\n");
    content.push_str(&format!(
        "Database: {}. Edit rows in the table view; this file is regenerated on schema change.\n",
        db.name
    ));

    std::fs::write(&tmp, &content).map_err(|e| format!("write tmp failed: {e}"))?;
    std::fs::rename(&tmp, &target).map_err(|e| format!("rename failed: {e}"))?;
    Ok(target)
}

fn field_to_vault_field(f: &Field) -> VaultField {
    VaultField {
        id: f.id.clone(),
        name: f.name.clone(),
        field_type: format!("{:?}", f.field_type).to_lowercase(),
        is_primary: f.is_primary,
        position: f.position as i64,
        hidden: false,
        include_time: false,
        options: Vec::new(),
        has_formula: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::managers::database::field::{FieldType, TypeOption};

    fn make_db_node(id: &str, name: &str) -> WorkspaceNode {
        WorkspaceNode {
            id: id.to_string(),
            parent_id: None,
            node_type: "database".to_string(),
            name: name.to_string(),
            icon: "📊".to_string(),
            position: 1.0,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
            deleted_at: None,
            properties: "{}".to_string(),
            body: String::new(),
            vault_rel_path: Some(format!("databases/{}/database.md", slugify(name))),
        }
    }

    fn make_field(id: &str, name: &str, ft: FieldType, is_primary: bool, position: i64) -> Field {
        let type_option = match ft {
            FieldType::SingleSelect => TypeOption::SingleSelect { options: Vec::new() },
            _ => TypeOption::RichText,
        };
        Field {
            id: id.to_string(),
            database_id: "db-1".to_string(),
            name: name.to_string(),
            field_type: ft,
            is_primary,
            type_option,
            position,
        }
    }

    #[test]
    fn export_database_md_writes_expected_path_and_frontmatter() {
        let temp = tempfile::tempdir().expect("tempdir");
        let vault_root = temp.path();
        let db = make_db_node("db-test-1", "My Projects");
        let fields = vec![
            make_field("f-name", "Name", FieldType::RichText, true, 0),
            make_field("f-status", "Status", FieldType::SingleSelect, false, 1),
        ];

        let path = export_database_md(vault_root, &db, &fields).expect("export");

        let expected_path = vault_root.join("databases").join("my-projects").join("database.md");
        assert_eq!(path, expected_path, "path is databases/<slug>/database.md");
        assert!(path.exists(), "file written to disk");

        let body = std::fs::read_to_string(&path).expect("read file");
        // Frontmatter delimiters present
        assert!(body.starts_with("---\n"), "starts with opening fence");
        assert!(body.contains("\n---\n\n"), "has closing fence + body separator");
        // Database identity in frontmatter
        assert!(body.contains("id: \"db-test-1\""), "id present");
        assert!(body.contains("name: \"My Projects\""), "name present");
        assert!(body.contains("icon: \"📊\""), "icon present");
        // Field schema present
        assert!(body.contains("Name"), "primary field name present");
        assert!(body.contains("is_primary: true"), "primary flag set");
        assert!(body.contains("Status"), "non-primary field present");
        // Body description present
        assert!(body.contains("Database: My Projects."), "body description");
    }

    #[test]
    fn export_database_md_atomic_temp_file_cleaned() {
        let temp = tempfile::tempdir().expect("tempdir");
        let db = make_db_node("db-2", "Second");
        let fields = vec![make_field("f-1", "Name", FieldType::RichText, true, 0)];

        export_database_md(temp.path(), &db, &fields).expect("export");

        let dir = temp.path().join("databases").join("second");
        let entries: Vec<_> = std::fs::read_dir(&dir)
            .expect("readdir")
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(entries.contains(&"database.md".to_string()), "final file present");
        assert!(!entries.iter().any(|n| n == "database.md.tmp"), "no leftover tmp file");
    }

    #[test]
    fn export_database_md_rejects_non_database_node() {
        let temp = tempfile::tempdir().expect("tempdir");
        let mut row = make_db_node("row-1", "Whatever");
        row.node_type = "row".to_string();

        let result = export_database_md(temp.path(), &row, &[]);
        assert!(result.is_err(), "must reject non-database node_type");
        let err = result.unwrap_err();
        assert!(err.contains("expected 'database'"), "error mentions expected type, got: {err}");
    }
}
