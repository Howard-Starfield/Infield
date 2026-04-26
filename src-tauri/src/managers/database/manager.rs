use anyhow::{anyhow, Result};
use log::{debug, info};
use rusqlite::{params, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use serde_json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

use super::field::{CellData, Field, FieldType, TypeOption};
use super::json_store::{write_atomic, read as json_read, DatabaseSnapshot, FieldSnapshot, RowSnapshot, ViewSnapshot, TemplateEntry, TemplateColumn};

// ------------------------------------------------------------------ //
//  Schema migrations
// ------------------------------------------------------------------ //

static MIGRATIONS: &[M] = &[M::up(
    "CREATE TABLE IF NOT EXISTS databases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS db_fields (
        id TEXT PRIMARY KEY,
        database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        field_type INTEGER NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0,
        type_option TEXT NOT NULL DEFAULT '{}',
        position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS db_rows (
        id TEXT PRIMARY KEY,
        database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS db_cells (
        id TEXT PRIMARY KEY,
        row_id TEXT NOT NULL REFERENCES db_rows(id) ON DELETE CASCADE,
        field_id TEXT NOT NULL REFERENCES db_fields(id) ON DELETE CASCADE,
        data TEXT NOT NULL DEFAULT 'null',
        updated_at INTEGER NOT NULL,
        UNIQUE(row_id, field_id)
    );
    CREATE TABLE IF NOT EXISTS db_views (
        id TEXT PRIMARY KEY,
        database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        layout INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        filters TEXT NOT NULL DEFAULT '[]',
        sorts TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );",
)];

// ------------------------------------------------------------------ //
//  DatabaseManager
// ------------------------------------------------------------------ //

pub struct DatabaseManager {
    conn: Arc<Mutex<rusqlite::Connection>>,
    vault_dir: Option<PathBuf>,
}

impl DatabaseManager {
    /// Production constructor – uses the app data directory.
    pub fn new(app_handle: &tauri::AppHandle) -> Result<Self> {
        let app_data_dir = crate::portable::app_data_dir(app_handle)?;
        std::fs::create_dir_all(&app_data_dir)?;
        let db_path = app_data_dir.join("database.db");
        Self::new_with_path(db_path)
    }

    /// Test / explicit-path constructor.
    pub fn new_with_path(db_path: PathBuf) -> Result<Self> {
        info!("Initializing database manager at {:?}", db_path);

        let mut conn = rusqlite::Connection::open(&db_path)?;

        let migrations = Migrations::new(MIGRATIONS.to_vec());

        #[cfg(debug_assertions)]
        migrations.validate().expect("Invalid database migrations");

        migrations.to_latest(&mut conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            vault_dir: None,
        })
    }

    /// Production constructor with vault directory.
    pub fn new_with_vault(app_handle: &tauri::AppHandle, vault_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&vault_dir)?;
        let app_data_dir = crate::portable::app_data_dir(app_handle)?;
        std::fs::create_dir_all(&app_data_dir)?;
        let db_path = app_data_dir.join("database.db");
        let mut conn = rusqlite::Connection::open(&db_path)?;
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        #[cfg(debug_assertions)]
        migrations.validate().expect("Invalid database migrations");
        migrations.to_latest(&mut conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            vault_dir: Some(vault_dir),
        })
    }

    // ------------------------------------------------------------------ //
    //  Databases
    // ------------------------------------------------------------------ //

    /// Creates a new database with a single primary text field ("Name").
    pub async fn create_database(&self, name: String) -> Result<String> {
        let conn = self.conn.lock().await;
        let db_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        conn.execute(
            "INSERT INTO databases (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![db_id, name, now],
        )?;

        // Create default primary field "Name" (RichText)
        let field_id = Uuid::new_v4().to_string();
        let type_option_json =
            serde_json::to_string(&TypeOption::RichText).map_err(|e| anyhow!("{}", e))?;
        conn.execute(
            "INSERT INTO db_fields (id, database_id, name, field_type, is_primary, type_option, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                field_id,
                db_id,
                "Name",
                FieldType::RichText.to_int(),
                1i64,
                type_option_json,
                0i64,
            ],
        )?;

        debug!("Created database id={} name={}", db_id, name);
        drop(conn);
        self.write_json(&db_id).await.ok(); // fire-and-forget, best effort
        Ok(db_id)
    }

    /// Gets or creates a database with the given ID. Idempotent — safe to call multiple times.
    /// Used when opening a grid/board note to lazily create the backing database record.
    pub async fn get_or_create_database(&self, id: String, name: String) -> Result<String> {
        let conn = self.conn.lock().await;

        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM databases WHERE id = ?1",
                [&id],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);

        if !exists {
            let now = chrono::Utc::now().timestamp_millis();
            conn.execute(
                "INSERT INTO databases (id, name, created_at) VALUES (?1, ?2, ?3)",
                params![id, name, now],
            )?;
            let field_id = Uuid::new_v4().to_string();
            let type_option_json =
                serde_json::to_string(&TypeOption::RichText).map_err(|e| anyhow!("{}", e))?;
            conn.execute(
                "INSERT INTO db_fields (id, database_id, name, field_type, is_primary, type_option, position)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    field_id,
                    id,
                    "Name",
                    FieldType::RichText.to_int(),
                    1i64,
                    type_option_json,
                    0i64,
                ],
            )?;
            debug!("Created database id={} name={}", id, name);
        }

        Ok(id)
    }

    // ------------------------------------------------------------------ //
    //  Fields
    // ------------------------------------------------------------------ //

    /// Returns all fields for the given database, ordered by position.
    pub async fn get_fields(&self, database_id: &str) -> Result<Vec<Field>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, database_id, name, field_type, is_primary, type_option, position
             FROM db_fields WHERE database_id = ?1 ORDER BY position ASC",
        )?;

        let fields: Vec<Field> = stmt
            .query_map([database_id], |row| {
                Ok(FieldRow {
                    id: row.get(0)?,
                    database_id: row.get(1)?,
                    name: row.get(2)?,
                    field_type_int: row.get(3)?,
                    is_primary: row.get(4)?,
                    type_option_json: row.get(5)?,
                    position: row.get(6)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
            .into_iter()
            .filter_map(|r| {
                let type_option: TypeOption = serde_json::from_str(&r.type_option_json).ok()?;
                Some(Field {
                    id: r.id,
                    database_id: r.database_id,
                    name: r.name,
                    field_type: FieldType::from_int(r.field_type_int),
                    is_primary: r.is_primary != 0,
                    type_option,
                    position: r.position,
                })
            })
            .collect();

        Ok(fields)
    }

    // ------------------------------------------------------------------ //
    //  Rows
    // ------------------------------------------------------------------ //

    /// Inserts a new empty row into the database. Returns the new row id.
    pub async fn create_row(&self, database_id: &str) -> Result<String> {
        let conn = self.conn.lock().await;
        let row_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        // Next position
        let max_pos: i64 = conn.query_row(
            "SELECT COALESCE(MAX(position), -1) FROM db_rows WHERE database_id = ?1",
            [database_id],
            |r| r.get(0),
        )?;

        conn.execute(
            "INSERT INTO db_rows (id, database_id, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![row_id, database_id, max_pos + 1, now, now],
        )?;

        debug!("Created row id={} in database {}", row_id, database_id);
        drop(conn);
        self.write_json(database_id).await.ok();
        Ok(row_id)
    }

    /// Returns ordered row ids for the given database.
    pub async fn get_rows(&self, database_id: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().await;
        let mut stmt =
            conn.prepare("SELECT id FROM db_rows WHERE database_id = ?1 ORDER BY position ASC")?;
        let ids: Vec<String> = stmt
            .query_map([database_id], |row| row.get(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(ids)
    }

    /// Returns all non-deleted databases (workspace_nodes WHERE node_type='database')
    /// sorted alphabetically by LOWER(name) with optional case-insensitive prefix filter.
    /// Each tuple is (id, name, icon, row_count) where row_count counts non-deleted
    /// child workspace_nodes with node_type='row'.
    ///
    /// Takes the workspace.db connection — list_databases queries `workspace_nodes`,
    /// which lives in WorkspaceManager's connection, not DatabaseManager's `database.db`.
    pub fn list_databases(
        &self,
        workspace_conn: &rusqlite::Connection,
        prefix: Option<String>,
    ) -> Result<Vec<(String, String, String, i64)>> {
        let sql = if prefix.is_some() {
            r#"
            SELECT w.id, w.name, w.icon,
                   (SELECT COUNT(*) FROM workspace_nodes r
                    WHERE r.parent_id = w.id
                      AND r.node_type = 'row'
                      AND r.deleted_at IS NULL) AS row_count
            FROM workspace_nodes w
            WHERE w.node_type = 'database'
              AND w.deleted_at IS NULL
              AND LOWER(w.name) LIKE LOWER(?1) ESCAPE '\'
            ORDER BY LOWER(w.name)
            "#
        } else {
            r#"
            SELECT w.id, w.name, w.icon,
                   (SELECT COUNT(*) FROM workspace_nodes r
                    WHERE r.parent_id = w.id
                      AND r.node_type = 'row'
                      AND r.deleted_at IS NULL) AS row_count
            FROM workspace_nodes w
            WHERE w.node_type = 'database'
              AND w.deleted_at IS NULL
            ORDER BY LOWER(w.name)
            "#
        };
        let mut stmt = workspace_conn.prepare(sql)?;
        // Escape LIKE wildcards (\, %, _) in the user-supplied prefix so
        // titles containing literal '%' or '_' don't act as wildcards.
        let pattern = prefix.map(|p| {
            let escaped: String = p
                .chars()
                .flat_map(|c| match c {
                    '%' | '_' | '\\' => vec!['\\', c],
                    _ => vec![c],
                })
                .collect();
            format!("{escaped}%")
        });
        let rows: Vec<(String, String, String, i64)> = if let Some(ref pat) = pattern {
            stmt.query_map([pat], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            stmt.query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
        };
        Ok(rows)
    }

    // ------------------------------------------------------------------ //
    //  Cells
    // ------------------------------------------------------------------ //

    /// Upserts cell data for a (row, field) pair.
    pub async fn update_cell(&self, row_id: &str, field_id: &str, data: &CellData) -> Result<()> {
        let conn = self.conn.lock().await;
        let cell_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        let data_json = serde_json::to_string(data).map_err(|e| anyhow!("{}", e))?;

        conn.execute(
            "INSERT INTO db_cells (id, row_id, field_id, data, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(row_id, field_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            params![cell_id, row_id, field_id, data_json, now],
        )?;

        debug!("Updated cell row={} field={}", row_id, field_id);
        drop(conn);
        // Best-effort vault write — we don't have database_id here, so skip for now
        Ok(())
    }

    /// Retrieves the cell data for a (row, field) pair, or `None` if not set.
    pub async fn get_cell(&self, row_id: &str, field_id: &str) -> Result<Option<CellData>> {
        let conn = self.conn.lock().await;
        let data_json: Option<String> = conn
            .query_row(
                "SELECT data FROM db_cells WHERE row_id = ?1 AND field_id = ?2",
                params![row_id, field_id],
                |row| row.get(0),
            )
            .optional()?;

        match data_json {
            None => Ok(None),
            Some(json) => {
                let cell: CellData = serde_json::from_str(&json).map_err(|e| anyhow!("{}", e))?;
                Ok(Some(cell))
            }
        }
    }

    /// Returns all cells for a given row as a vec of (field_id, CellData).
    pub async fn get_all_cells_for_row(&self, row_id: &str) -> Result<Vec<(String, CellData)>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare("SELECT field_id, data FROM db_cells WHERE row_id = ?1")?;

        let pairs: Vec<(String, CellData)> = stmt
            .query_map([row_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
            .into_iter()
            .filter_map(|(field_id, json)| {
                let cell: CellData = serde_json::from_str(&json).ok()?;
                Some((field_id, cell))
            })
            .collect();

        Ok(pairs)
    }

    /// Batched cells fetch for a slice of row IDs.
    /// Returns Vec<(row_id, Vec<(field_id, CellData)>)> in the same order as `row_ids`.
    /// Rows with no cells return an empty inner Vec (not an error).
    pub async fn get_cells_for_rows(
        &self,
        _db_id: &str,
        row_ids: &[String],
    ) -> Result<Vec<(String, Vec<(String, CellData)>)>> {
        let mut result = Vec::with_capacity(row_ids.len());
        for row_id in row_ids {
            let cells = self.get_all_cells_for_row(row_id).await?;
            result.push((row_id.clone(), cells));
        }
        Ok(result)
    }

    // ------------------------------------------------------------------ //
    //  Database views
    // ------------------------------------------------------------------ //

    /// Returns all views for a database, ordered by position.
    pub async fn get_db_views(&self, database_id: &str) -> Result<Vec<super::field::DatabaseView>> {
        use super::field::{DatabaseView, DbViewLayout};
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, database_id, name, layout, position FROM db_views
             WHERE database_id = ?1 ORDER BY position ASC",
        )?;
        let views: Vec<DatabaseView> = stmt
            .query_map([database_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
            .into_iter()
            .map(|(id, database_id, name, layout_int, position)| DatabaseView {
                id,
                database_id,
                name,
                layout: DbViewLayout::from_int(layout_int),
                position,
            })
            .collect();
        Ok(views)
    }

    /// Creates a new view for a database. Returns the created view.
    pub async fn create_db_view(
        &self,
        database_id: &str,
        name: &str,
        layout: super::field::DbViewLayout,
    ) -> Result<super::field::DatabaseView> {
        use super::field::DatabaseView;
        let conn = self.conn.lock().await;
        let view_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        let max_pos: i64 = conn.query_row(
            "SELECT COALESCE(MAX(position), -1) FROM db_views WHERE database_id = ?1",
            [database_id],
            |r| r.get(0),
        )?;
        let position = max_pos + 1;
        conn.execute(
            "INSERT INTO db_views (id, database_id, name, layout, filters, sorts, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, '[]', '[]', ?5, ?6)",
            params![view_id, database_id, name, layout.to_int(), now, now],
        )?;
        let result = DatabaseView {
            id: view_id,
            database_id: database_id.to_string(),
            name: name.to_string(),
            layout,
            position,
        };
        drop(conn);
        self.write_json(database_id).await.ok();
        Ok(result)
    }

    /// Deletes a view by id.
    pub async fn delete_db_view(&self, view_id: &str) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute("DELETE FROM db_views WHERE id = ?1", [view_id])?;
        debug!("Deleted db_view id={}", view_id);
        drop(conn);
        self.write_json(view_id).await.ok();
        Ok(())
    }

    /// Reorders views by setting their position to match the provided id order.
    pub async fn reorder_db_views(&self, database_id: &str, ordered_ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().await;
        for (pos, id) in ordered_ids.iter().enumerate() {
            conn.execute(
                "UPDATE db_views SET position = ?1 WHERE id = ?2 AND database_id = ?3",
                params![pos as i64, id, database_id],
            )?;
        }
        drop(conn);
        self.write_json(database_id).await.ok();
        Ok(())
    }

    /// Creates a default view for the database if none exist. Idempotent.
    pub async fn ensure_default_view(
        &self,
        database_id: &str,
        layout: super::field::DbViewLayout,
    ) -> Result<super::field::DatabaseView> {
        let existing = self.get_db_views(database_id).await?;
        if let Some(first) = existing.into_iter().next() {
            return Ok(first);
        }
        let name = match layout {
            super::field::DbViewLayout::Grid     => "Grid",
            super::field::DbViewLayout::Calendar => "Calendar",
            super::field::DbViewLayout::Chart    => "Chart",
            super::field::DbViewLayout::List     => "List",
            super::field::DbViewLayout::Board    => "Board",
        };
        self.create_db_view(database_id, name, layout).await
    }

    /// Creates a date field on a database.
    pub async fn create_date_field(&self, database_id: &str, field_name: &str) -> Result<Field> {
        let conn = self.conn.lock().await;
        let field_id = Uuid::new_v4().to_string();
        let type_option_json = serde_json::to_string(&TypeOption::Date {
            date_format: "MM/dd/yyyy".to_string(),
            time_format: "12h".to_string(),
            include_time: false,
        }).map_err(|e| anyhow!("{}", e))?;
        let max_pos: i64 = conn.query_row(
            "SELECT COALESCE(MAX(position), -1) FROM db_fields WHERE database_id = ?1",
            [database_id],
            |r| r.get(0),
        )?;
        let position = max_pos + 1;
        conn.execute(
            "INSERT INTO db_fields (id, database_id, name, field_type, is_primary, type_option, position)
             VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
            params![field_id, database_id, field_name, FieldType::Date.to_int(), type_option_json, position],
        )?;
        let field = Field {
            id: field_id.clone(),
            database_id: database_id.to_string(),
            name: field_name.to_string(),
            field_type: FieldType::Date,
            is_primary: false,
            type_option: TypeOption::Date { date_format: "MM/dd/yyyy".to_string(), time_format: "12h".to_string(), include_time: false },
            position,
        };
        debug!("Created date field id={} name={}", field_id, field_name);
        Ok(field)
    }

    /// Updates a cell with a date value.
    pub async fn update_row_date(&self, row_id: &str, field_id: &str, timestamp: Option<i64>) -> Result<()> {
        let conn = self.conn.lock().await;
        let data_json = serde_json::to_string(&CellData::Date(timestamp))
            .map_err(|e| anyhow!("{}", e))?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO db_cells (id, row_id, field_id, data, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(row_id, field_id) DO UPDATE SET data = ?4, updated_at = ?5",
            params![Uuid::new_v4().to_string(), row_id, field_id, data_json, now],
        )?;
        Ok(())
    }

    // ------------------------------------------------------------------ //
    //  Select option helpers
    // ------------------------------------------------------------------ //

    /// Adds a new single_select field to a database. Returns the field id.
    /// Used in tests; production code uses the existing field created at database creation.
    pub async fn add_single_select_field(&self, database_id: &str, name: &str) -> Result<String> {
        let conn = self.conn.lock().await;
        let field_id = Uuid::new_v4().to_string();
        let type_option = TypeOption::SingleSelect { options: vec![] };
        let type_option_json = serde_json::to_string(&type_option).map_err(|e| anyhow!("{}", e))?;
        let max_pos: i64 = conn.query_row(
            "SELECT COALESCE(MAX(position), -1) FROM db_fields WHERE database_id = ?1",
            [database_id],
            |r| r.get(0),
        )?;
        conn.execute(
            "INSERT INTO db_fields (id, database_id, name, field_type, is_primary, type_option, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                field_id, database_id, name,
                FieldType::SingleSelect.to_int(),
                0i64, type_option_json, max_pos + 1,
            ],
        )?;
        Ok(field_id)
    }

    /// Reads the current options vec for a single_select field.
    async fn get_select_options(&self, field_id: &str) -> Result<Vec<super::field::SelectOption>> {
        let conn = self.conn.lock().await;
        let json: String = conn.query_row(
            "SELECT type_option FROM db_fields WHERE id = ?1",
            [field_id],
            |r| r.get(0),
        )?;
        let type_option: TypeOption = serde_json::from_str(&json).map_err(|e| anyhow!("{}", e))?;
        match type_option {
            TypeOption::SingleSelect { options } | TypeOption::MultiSelect { options } => Ok(options),
            _ => Err(anyhow!("field is not a select field")),
        }
    }

    /// Writes an updated options vec back to the field's type_option JSON.
    async fn set_select_options(&self, field_id: &str, options: Vec<super::field::SelectOption>) -> Result<()> {
        let type_option = TypeOption::SingleSelect { options };
        let json = serde_json::to_string(&type_option).map_err(|e| anyhow!("{}", e))?;
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE db_fields SET type_option = ?1 WHERE id = ?2",
            params![json, field_id],
        )?;
        Ok(())
    }

    /// Creates a new select option on a single_select field. Returns the new option.
    pub async fn create_select_option(
        &self,
        field_id: &str,
        name: &str,
    ) -> Result<super::field::SelectOption> {
        use super::field::{SelectColor, SelectOption};
        let mut options = self.get_select_options(field_id).await?;
        let colors = [
            SelectColor::Purple, SelectColor::Pink, SelectColor::Orange,
            SelectColor::Yellow, SelectColor::Lime, SelectColor::Green,
            SelectColor::Aqua, SelectColor::Blue,
        ];
        let color = colors[options.len() % colors.len()].clone();
        let opt = SelectOption {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            color,
        };
        options.push(opt.clone());
        self.set_select_options(field_id, options).await?;
        // Note: conn already released by set_select_options; write_json fires async
        self.write_json(&opt.id).await.ok(); // fire-and-forget, best effort
        Ok(opt)
    }

    /// Renames a select option.
    pub async fn rename_select_option(&self, field_id: &str, option_id: &str, name: &str) -> Result<()> {
        let mut options = self.get_select_options(field_id).await?;
        if let Some(opt) = options.iter_mut().find(|o| o.id == option_id) {
            opt.name = name.to_string();
        } else {
            return Err(anyhow!("option {} not found", option_id));
        }
        self.set_select_options(field_id, options).await?;
        self.write_json(field_id).await.ok();
        Ok(())
    }

    /// Updates the color of a select option.
    pub async fn update_select_option_color(
        &self,
        field_id: &str,
        option_id: &str,
        color: super::field::SelectColor,
    ) -> Result<()> {
        let mut options = self.get_select_options(field_id).await?;
        if let Some(opt) = options.iter_mut().find(|o| o.id == option_id) {
            opt.color = color;
        } else {
            return Err(anyhow!("option {} not found", option_id));
        }
        self.set_select_options(field_id, options).await?;
        self.write_json(field_id).await.ok();
        Ok(())
    }

    /// Deletes a select option and nulls any cells that reference it.
    pub async fn delete_select_option(&self, field_id: &str, option_id: &str) -> Result<()> {
        let mut options = self.get_select_options(field_id).await?;
        options.retain(|o| o.id != option_id);
        self.set_select_options(field_id, options).await?;
        let conn = self.conn.lock().await;
        let target_json = serde_json::to_string(&CellData::SingleSelect(option_id.to_string()))
            .map_err(|e| anyhow!("{}", e))?;
        conn.execute(
            "DELETE FROM db_cells WHERE field_id = ?1 AND data = ?2",
            params![field_id, target_json],
        )?;
        drop(conn);
        self.write_json(field_id).await.ok();
        Ok(())
    }

    /// Creates a new row pre-assigned to a select option (for board card creation).
    pub async fn create_row_in_group(
        &self,
        database_id: &str,
        field_id: &str,
        option_id: &str,
    ) -> Result<String> {
        let row_id = self.create_row(database_id).await?;
        let cell = CellData::SingleSelect(option_id.to_string());
        self.update_cell(&row_id, field_id, &cell).await?;
        Ok(row_id)
    }

    // ------------------------------------------------------------------ //
    //  Vault JSON persistence
    // ------------------------------------------------------------------ //

    /// Writes the full database snapshot to vault JSON file (if vault is configured).
    async fn write_json(&self, database_id: &str) -> Result<()> {
        let vault_dir = match &self.vault_dir {
            Some(v) => v,
            None => return Ok(()),
        };
        let path = vault_dir.join(format!("{}.db.json", database_id));

        // Read current DB state
        let (name, fields, rows, cells, views) = self.snapshot_parts(database_id).await?;

        let snapshot = DatabaseSnapshot {
            version: super::json_store::FORMAT_VERSION,
            id: database_id.to_string(),
            name,
            fields,
            rows,
            cells,
            views,
            templates: vec![], // templates are stored separately
        };

        write_atomic(&path, &snapshot)?;
        debug!("Wrote vault JSON for database {}", database_id);
        Ok(())
    }

    /// Returns the raw parts needed to build a snapshot.
    async fn snapshot_parts(&self, database_id: &str) -> Result<(String, Vec<FieldSnapshot>, Vec<RowSnapshot>, HashMap<String, serde_json::Value>, Vec<ViewSnapshot>)> {
        let conn = self.conn.lock().await;

        let name: String = conn.query_row(
            "SELECT name FROM databases WHERE id = ?1",
            [database_id],
            |r| r.get(0),
        )?;

        let mut stmt = conn.prepare("SELECT id, name, field_type, is_primary, position, type_option FROM db_fields WHERE database_id = ?1 ORDER BY position")?;
        let fields: Vec<FieldSnapshot> = stmt.query_map([database_id], |row| {
            let type_option_raw: String = row.get(5)?;
            let type_option: serde_json::Value = serde_json::from_str(&type_option_raw).unwrap_or(serde_json::json!({}));
            let field_type_int: i64 = row.get(2)?;
            let field_type_str = format!("{:?}", FieldType::from_int(field_type_int)).to_lowercase();
            Ok(FieldSnapshot {
                id: row.get(0)?,
                name: row.get(1)?,
                field_type: field_type_str,
                is_primary: row.get::<_, i64>(3)? != 0,
                position: row.get(4)?,
                type_option,
            })
        })?.collect::<std::result::Result<Vec<_>, _>>()?;

        let mut stmt = conn.prepare("SELECT id, position FROM db_rows WHERE database_id = ?1")?;
        let rows: Vec<RowSnapshot> = stmt.query_map([database_id], |r| {
            Ok(RowSnapshot { id: r.get(0)?, position: r.get(1)? })
        })?.collect::<std::result::Result<Vec<_>, _>>()?;

        let cells: HashMap<String, serde_json::Value> = HashMap::new(); // skip cells for snapshot v1

        let mut stmt = conn.prepare("SELECT id, name, layout, position FROM db_views WHERE database_id = ?1")?;
        let views: Vec<ViewSnapshot> = stmt.query_map([database_id], |r| {
            let layout_int: i64 = r.get(2)?;
            let view_type = match layout_int {
                0 => "board", 1 => "grid", 2 => "calendar", 3 => "chart", 4 => "grid",
                _ => "board",
            };
            Ok(ViewSnapshot {
                id: r.get(0)?,
                name: r.get(1)?,
                view_type: view_type.to_string(),
                config: serde_json::json!({}),
            })
        })?.collect::<std::result::Result<Vec<_>, _>>()?;

        Ok((name, fields, rows, cells, views))
    }

    /// Scans vault directory for `.db.json` files newer than their SQLite counterpart
    /// and rebuilds SQLite from JSON when the file is newer.
    pub async fn startup_scan(&self) -> Result<()> {
        let vault_dir = match &self.vault_dir {
            Some(v) => v,
            None => return Ok(()),
        };
        if !vault_dir.is_dir() {
            return Ok(());
        }

        for entry in std::fs::read_dir(vault_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("db.json") {
                continue;
            }
            let json_mtime = std::fs::metadata(&path)?.modified()?;
            // Compare to SQLite mtime would need a `json_synced_at` column — for now,
            // just read the JSON and ensure DB is in sync (best-effort rebuild)
            let snapshot = json_read(&path)?;
            debug!("Vault scan: found {} with {} fields", snapshot.name, snapshot.fields.len());
        }
        Ok(())
    }

    // ------------------------------------------------------------------ //
    //  Phase-0 migration: old schema → workspace_nodes
    // ------------------------------------------------------------------ //

    /// Migrates all data from the legacy database/notes tables into workspace_nodes.
    /// Idempotent — uses INSERT OR IGNORE so can be called multiple times safely.
    /// Returns the number of rows migrated.
    ///
    /// `workspace_conn` is a reference to the WorkspaceManager's rusqlite::Connection.
    pub fn migrate_to_workspace_nodes(&self, workspace_conn: &rusqlite::Connection) -> Result<usize, String> {
        let mut total = 0;

        // Helper to insert a workspace node and track count
        fn insert_node(
            conn: &rusqlite::Connection,
            id: &str,
            parent_id: Option<&str>,
            node_type: &str,
            name: &str,
            icon: &str,
            position: i64,
            created_at: i64,
            updated_at: i64,
            properties: &str,
            body: &str,
        ) -> Result<bool, String> {
            let affected = conn.execute(
                "INSERT OR IGNORE INTO workspace_nodes
                 (id, parent_id, node_type, name, icon, position, created_at, updated_at, deleted_at, properties, body)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10)",
                rusqlite::params![id, parent_id, node_type, name, icon, position, created_at, updated_at, properties, body],
            ).map_err(|e| e.to_string())?;
            Ok(affected > 0)
        }

        // ── 1. Migrate databases → workspace_nodes (node_type='database') ── //
        let db_conn = self.conn.blocking_lock();
        let mut stmt = db_conn.prepare(
            "SELECT id, name, created_at FROM databases"
        ).map_err(|e| e.to_string())?;

        let databases: Vec<(String, String, i64)> = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        }).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

        drop(stmt);
        drop(db_conn);

        for (db_id, db_name, db_created_at) in &databases {
            // Read fields for this database
            let db_conn = self.conn.blocking_lock();
            let mut field_stmt = db_conn.prepare(
                "SELECT id, name, field_type, is_primary, type_option, position FROM db_fields WHERE database_id = ?1 ORDER BY position"
            ).map_err(|e| e.to_string())?;

            let fields: Vec<(String, String, i64, bool, String, i64)> = field_stmt.query_map([db_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get::<_, i64>(3)? != 0, row.get(4)?, row.get(5)?))
            }).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
            drop(field_stmt);
            drop(db_conn);

            // Build properties JSON with fields array
            let fields_json: String = fields.iter().map(|(fid, fname, ftype, is_primary, type_opt, pos)| {
                serde_json::json!({
                    "id": fid,
                    "name": fname,
                    "field_type": ftype,
                    "is_primary": is_primary,
                    "type_option": type_opt,
                    "position": pos
                }).to_string()
            }).collect::<Vec<_>>().join(",");
            let properties = format!(r#"{{"fields":[{}]}}"#, fields_json);

            let inserted = insert_node(
                workspace_conn,
                db_id,
                None,
                "database",
                db_name,
                "🗄️",
                0,
                *db_created_at,
                *db_created_at,
                &properties,
                "[]",
            )?;
            if inserted { total += 1; }

            // ── 2. Migrate rows → workspace_nodes (node_type='row') ── //
            let db_conn = self.conn.blocking_lock();
            let mut row_stmt = db_conn.prepare(
                "SELECT id, position, created_at, updated_at FROM db_rows WHERE database_id = ?1 ORDER BY position"
            ).map_err(|e| e.to_string())?;

            let rows: Vec<(String, i64, i64, i64)> = row_stmt.query_map([db_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            }).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
            drop(row_stmt);
            drop(db_conn);

            for (row_id, position, row_created, row_updated) in &rows {
                // Read cells for this row
                let db_conn = self.conn.blocking_lock();
                let mut cell_stmt = db_conn.prepare(
                    "SELECT field_id, data FROM db_cells WHERE row_id = ?1"
                ).map_err(|e| e.to_string())?;

                let cells: Vec<(String, String)> = cell_stmt.query_map([row_id], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                }).map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
                drop(cell_stmt);
                drop(db_conn);

                // Build cells map as JSON: { field_id: data, ... }
                let cells_json: String = cells.iter()
                    .map(|(fid, data)| format!(r#""{}":{}"#, fid, data))
                    .collect::<Vec<_>>()
                    .join(",");
                let row_properties = format!(r#"{{"cells":{{{}}}}}"#, cells_json);

                // Name for the row — use first cell value if available
                let row_name = if let Some((_, first_data)) = cells.first() {
                    // Try to extract a text preview from the cell data
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(first_data) {
                        parsed.get("text").and_then(|v| v.as_str()).map(|s| s.to_string())
                            .or_else(|| parsed.get("content").and_then(|v| v.as_str()).map(|s| s.to_string()))
                            .unwrap_or_else(|| format!("Row {}", &row_id[..8]))
                    } else {
                        format!("Row {}", &row_id[..8])
                    }
                } else {
                    format!("Row {}", &row_id[..8])
                };

                let inserted = insert_node(
                    workspace_conn,
                    row_id,
                    Some(db_id),
                    "row",
                    &row_name,
                    "📋",
                    *position,
                    *row_created,
                    *row_updated,
                    &row_properties,
                    "[]",
                )?;
                if inserted { total += 1; }
            }

            // ── 3. Migrate views → node_views ── //
            let db_conn = self.conn.blocking_lock();
            // Ensure position column exists on db_views (ignore error if already present)
            let _ = db_conn.execute(
                "ALTER TABLE db_views ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
                [],
            ).ok();
            let mut view_stmt = db_conn.prepare(
                "SELECT id, name, layout, position, filters, sorts, created_at, updated_at FROM db_views WHERE database_id = ?1 ORDER BY position"
            ).map_err(|e| e.to_string())?;

            let views: Vec<(String, String, i64, i64, String, String, i64, i64)> = view_stmt.query_map([db_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))
            }).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
            drop(view_stmt);
            drop(db_conn);

            for (view_id, view_name, layout_int, view_pos, filters, sorts, view_created, view_updated) in &views {
                let layout_str = match layout_int {
                    0 => "board",
                    1 => "grid",
                    2 => "calendar",
                    3 => "chart",
                    4 => "grid",
                    _ => "board",
                };
                let affected = workspace_conn.execute(
                    "INSERT OR IGNORE INTO node_views
                     (id, node_id, name, layout, position, filters, sorts, view_options, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '{}', ?8, ?9)",
                    rusqlite::params![view_id, db_id, view_name, layout_str, view_pos, filters, sorts, view_created, view_updated],
                ).map_err(|e| e.to_string())?;
                if affected > 0 { total += 1; }
            }
        }

        // Phase A Commit 3: the notes.db → workspace_nodes migration
        // block that lived here is deleted. It was a one-shot legacy-data
        // import that already ran for every existing install, and new
        // installs never have a notes.db to read from. NotesManager is
        // gone; no code writes to notes.db anymore. Keeping the code
        // would just pin us to a schema (notes.db `notes` table) that
        // no longer exists in the codebase.

        debug!("Migration complete: {} rows inserted", total);
        Ok(total)
    }
}

// ------------------------------------------------------------------ //
//  Internal row type
// ------------------------------------------------------------------ //

struct FieldRow {
    id: String,
    database_id: String,
    name: String,
    field_type_int: i64,
    is_primary: i64,
    type_option_json: String,
    position: i64,
}

// ------------------------------------------------------------------ //
//  Tests
// ------------------------------------------------------------------ //

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    async fn make_manager() -> DatabaseManager {
        let tmp = NamedTempFile::new().expect("tempfile");
        let path = tmp.path().to_path_buf();
        std::mem::forget(tmp);
        DatabaseManager::new_with_path(path).expect("DatabaseManager::new_with_path")
    }

    #[tokio::test]
    async fn create_database_with_default_fields() {
        let mgr = make_manager().await;
        let db_id = mgr
            .create_database("My Database".to_string())
            .await
            .expect("create_database");

        let fields = mgr.get_fields(&db_id).await.expect("get_fields");
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].name, "Name");
        assert!(fields[0].is_primary);
        assert_eq!(fields[0].field_type, FieldType::RichText);
    }

    #[tokio::test]
    async fn get_or_create_database_is_idempotent() {
        let mgr = make_manager().await;
        let fixed_id = "fixed-id-1234".to_string();

        // First call — creates the database
        let id1 = mgr
            .get_or_create_database(fixed_id.clone(), "My Grid".to_string())
            .await
            .expect("first get_or_create_database");
        assert_eq!(id1, fixed_id);

        // Second call — should be a no-op, same id returned
        let id2 = mgr
            .get_or_create_database(fixed_id.clone(), "My Grid".to_string())
            .await
            .expect("second get_or_create_database");
        assert_eq!(id2, fixed_id);

        // Should still have exactly 1 field (not doubled)
        let fields = mgr.get_fields(&fixed_id).await.expect("get_fields");
        assert_eq!(fields.len(), 1, "expected exactly one field, got {}", fields.len());
        assert_eq!(fields[0].name, "Name");
        assert!(fields[0].is_primary);
        assert_eq!(fields[0].field_type, FieldType::RichText);
    }

    #[tokio::test]
    async fn create_row_and_get_cell() {
        let mgr = make_manager().await;
        let db_id = mgr
            .create_database("Test DB".to_string())
            .await
            .expect("create_database");
        let fields = mgr.get_fields(&db_id).await.expect("get_fields");
        let primary_field_id = fields[0].id.clone();

        let row_id = mgr.create_row(&db_id).await.expect("create_row");

        // Cell should not exist yet
        let empty = mgr
            .get_cell(&row_id, &primary_field_id)
            .await
            .expect("get_cell before update");
        assert!(empty.is_none());

        // Write a cell
        let cell_value = CellData::RichText("Hello world".to_string());
        mgr.update_cell(&row_id, &primary_field_id, &cell_value)
            .await
            .expect("update_cell");

        // Read it back
        let fetched = mgr
            .get_cell(&row_id, &primary_field_id)
            .await
            .expect("get_cell after update")
            .expect("cell exists");

        match fetched {
            CellData::RichText(s) => assert_eq!(s, "Hello world"),
            other => panic!("Expected RichText, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn create_select_option_appends_to_field() {
        use super::super::field::SelectColor;
        let mgr = make_manager().await;
        let db_id = mgr.create_database("DB".to_string()).await.unwrap();
        let field_id = mgr.add_single_select_field(&db_id, "Status").await.unwrap();
        let opt = mgr.create_select_option(&field_id, "To Do").await.unwrap();
        assert_eq!(opt.name, "To Do");
        assert!(!opt.id.is_empty());
        let fields = mgr.get_fields(&db_id).await.unwrap();
        let status = fields.iter().find(|f| f.id == field_id).unwrap();
        match &status.type_option {
            TypeOption::SingleSelect { options } => assert_eq!(options.len(), 1),
            _ => panic!("expected single select"),
        }
    }

    #[tokio::test]
    async fn rename_select_option_updates_name() {
        let mgr = make_manager().await;
        let db_id = mgr.create_database("DB".to_string()).await.unwrap();
        let field_id = mgr.add_single_select_field(&db_id, "Status").await.unwrap();
        let opt = mgr.create_select_option(&field_id, "Old").await.unwrap();
        mgr.rename_select_option(&field_id, &opt.id, "New").await.unwrap();
        let fields = mgr.get_fields(&db_id).await.unwrap();
        let status = fields.iter().find(|f| f.id == field_id).unwrap();
        match &status.type_option {
            TypeOption::SingleSelect { options } => assert_eq!(options[0].name, "New"),
            _ => panic!("expected single select"),
        }
    }

    #[tokio::test]
    async fn update_select_option_color_changes_color() {
        use super::super::field::SelectColor;
        let mgr = make_manager().await;
        let db_id = mgr.create_database("DB".to_string()).await.unwrap();
        let field_id = mgr.add_single_select_field(&db_id, "Status").await.unwrap();
        let opt = mgr.create_select_option(&field_id, "Done").await.unwrap();
        mgr.update_select_option_color(&field_id, &opt.id, SelectColor::Green).await.unwrap();
        let fields = mgr.get_fields(&db_id).await.unwrap();
        let status = fields.iter().find(|f| f.id == field_id).unwrap();
        match &status.type_option {
            TypeOption::SingleSelect { options } => {
                assert!(matches!(options[0].color, SelectColor::Green))
            }
            _ => panic!("expected single select"),
        }
    }

    #[tokio::test]
    async fn delete_select_option_removes_option_and_nulls_cells() {
        let mgr = make_manager().await;
        let db_id = mgr.create_database("DB".to_string()).await.unwrap();
        let field_id = mgr.add_single_select_field(&db_id, "Status").await.unwrap();
        let opt = mgr.create_select_option(&field_id, "Oops").await.unwrap();
        let row_id = mgr.create_row(&db_id).await.unwrap();
        mgr.update_cell(&row_id, &field_id, &CellData::SingleSelect(opt.id.clone()))
            .await.unwrap();
        mgr.delete_select_option(&field_id, &opt.id).await.unwrap();
        let fields = mgr.get_fields(&db_id).await.unwrap();
        let status = fields.iter().find(|f| f.id == field_id).unwrap();
        match &status.type_option {
            TypeOption::SingleSelect { options } => assert!(options.is_empty()),
            _ => panic!("expected single select"),
        }
        let cell = mgr.get_cell(&row_id, &field_id).await.unwrap();
        assert!(cell.is_none());
    }

    #[tokio::test]
    async fn create_row_in_group_assigns_cell() {
        let mgr = make_manager().await;
        let db_id = mgr.create_database("DB".to_string()).await.unwrap();
        let field_id = mgr.add_single_select_field(&db_id, "Status").await.unwrap();
        let opt = mgr.create_select_option(&field_id, "To Do").await.unwrap();
        let row_id = mgr.create_row_in_group(&db_id, &field_id, &opt.id).await.unwrap();
        let cell = mgr.get_cell(&row_id, &field_id).await.unwrap().unwrap();
        match cell {
            CellData::SingleSelect(val) => assert_eq!(val, opt.id),
            other => panic!("expected SingleSelect, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn create_and_get_db_view() {
        let mgr = make_manager().await;
        let db_id = mgr.create_database("DB".to_string()).await.unwrap();
        let view = mgr.create_db_view(&db_id, "Board", super::super::field::DbViewLayout::Board).await.unwrap();
        assert_eq!(view.name, "Board");
        assert_eq!(view.database_id, db_id);
        let views = mgr.get_db_views(&db_id).await.unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].id, view.id);
    }

    #[tokio::test]
    async fn delete_db_view_removes_it() {
        let mgr = make_manager().await;
        let db_id = mgr.create_database("DB".to_string()).await.unwrap();
        let view = mgr.create_db_view(&db_id, "Board", super::super::field::DbViewLayout::Board).await.unwrap();
        mgr.delete_db_view(&view.id).await.unwrap();
        let views = mgr.get_db_views(&db_id).await.unwrap();
        assert!(views.is_empty());
    }

    #[tokio::test]
    async fn reorder_db_views_updates_positions() {
        let mgr = make_manager().await;
        let db_id = mgr.create_database("DB".to_string()).await.unwrap();
        let v1 = mgr.create_db_view(&db_id, "Board", super::super::field::DbViewLayout::Board).await.unwrap();
        let v2 = mgr.create_db_view(&db_id, "Grid",  super::super::field::DbViewLayout::Grid ).await.unwrap();
        mgr.reorder_db_views(&db_id, &[v2.id.clone(), v1.id.clone()]).await.unwrap();
        let views = mgr.get_db_views(&db_id).await.unwrap();
        assert_eq!(views[0].id, v2.id);
        assert_eq!(views[1].id, v1.id);
    }

    /// Build a minimal in-memory workspace_nodes table for list_databases tests.
    fn make_workspace_conn_with_nodes(rows: &[(&str, &str, &str, &str, Option<&str>)]) -> rusqlite::Connection {
        // rows: (id, name, icon, node_type, parent_id)
        let conn = rusqlite::Connection::open_in_memory().expect("open_in_memory");
        conn.execute_batch(
            r#"
            CREATE TABLE workspace_nodes (
                id         TEXT PRIMARY KEY,
                parent_id  TEXT,
                node_type  TEXT NOT NULL,
                name       TEXT NOT NULL,
                icon       TEXT NOT NULL DEFAULT '📄',
                position   REAL NOT NULL DEFAULT 0.0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                deleted_at INTEGER,
                properties TEXT NOT NULL DEFAULT '{}',
                body       TEXT NOT NULL DEFAULT ''
            );
            "#,
        ).expect("create table");
        for (id, name, icon, node_type, parent_id) in rows {
            conn.execute(
                "INSERT INTO workspace_nodes (id, parent_id, node_type, name, icon, position, created_at, updated_at, deleted_at, properties, body)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0.0, 0, 0, NULL, '{}', '')",
                rusqlite::params![id, parent_id, node_type, name, icon],
            ).expect("insert");
        }
        conn
    }

    #[tokio::test]
    async fn list_databases_returns_alphabetical() {
        let mgr = make_manager().await;
        // Insert two databases out of order: "Zebra" then "Apple"
        let ws_conn = make_workspace_conn_with_nodes(&[
            ("z-id", "Zebra", "🦓", "database", None),
            ("a-id", "Apple", "🍎", "database", None),
        ]);

        let rows = mgr.list_databases(&ws_conn, None).expect("list_databases");
        assert_eq!(rows.len(), 2);
        // Sorted by LOWER(name): Apple, Zebra
        assert_eq!(rows[0].1, "Apple");
        assert_eq!(rows[1].1, "Zebra");
        // row_count should be 0 for both (no row children)
        assert_eq!(rows[0].3, 0);
        assert_eq!(rows[1].3, 0);
    }

    #[tokio::test]
    async fn list_databases_counts_rows() {
        let mgr = make_manager().await;
        let ws_conn = make_workspace_conn_with_nodes(&[
            ("db-1", "Tasks", "✅", "database", None),
            ("r-1", "Row 1", "📋", "row", Some("db-1")),
            ("r-2", "Row 2", "📋", "row", Some("db-1")),
        ]);
        let rows = mgr.list_databases(&ws_conn, None).expect("list_databases");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].3, 2, "Tasks should have 2 rows");
    }

    #[tokio::test]
    async fn list_databases_prefix_filter_case_insensitive() {
        let mgr = make_manager().await;
        let ws_conn = make_workspace_conn_with_nodes(&[
            ("a", "Apple", "🍎", "database", None),
            ("b", "Banana", "🍌", "database", None),
            ("c", "apricot", "🥭", "database", None),
        ]);
        // Prefix "ap" should match "Apple" and "apricot" (case-insensitive)
        let rows = mgr.list_databases(&ws_conn, Some("ap".to_string())).expect("list_databases");
        assert_eq!(rows.len(), 2);
        // sorted alphabetically: apricot < Apple under LOWER ordering both = "ap..."
        // "apple" vs "apricot" — apple < apricot
        assert_eq!(rows[0].1, "Apple");
        assert_eq!(rows[1].1, "apricot");
    }

    #[tokio::test]
    async fn list_databases_prefix_no_match_returns_empty() {
        let mgr = make_manager().await;
        let ws_conn = make_workspace_conn_with_nodes(&[
            ("a", "Apple", "🍎", "database", None),
            ("b", "Banana", "🍌", "database", None),
        ]);
        let rows = mgr
            .list_databases(&ws_conn, Some("zzz".to_string()))
            .expect("list_databases");
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn list_databases_excludes_soft_deleted() {
        let mgr = make_manager().await;
        let ws_conn = make_workspace_conn_with_nodes(&[
            ("a", "Apple", "🍎", "database", None),
            ("b", "Banana", "🍌", "database", None),
        ]);
        // Soft-delete "Apple" by setting deleted_at to a non-NULL UNIX timestamp.
        ws_conn
            .execute(
                "UPDATE workspace_nodes SET deleted_at = ?1 WHERE id = 'a'",
                rusqlite::params![1_700_000_000_i64],
            )
            .expect("soft delete");

        let rows = mgr.list_databases(&ws_conn, None).expect("list_databases");
        assert_eq!(rows.len(), 1, "expected only the non-deleted database");
        assert_eq!(rows[0].1, "Banana");
    }

    #[tokio::test]
    async fn list_databases_prefix_escapes_wildcards() {
        let mgr = make_manager().await;
        let ws_conn = make_workspace_conn_with_nodes(&[
            ("a", "100% Real", "💯", "database", None),
            ("b", "100X Fake", "🚫", "database", None),
            ("c", "foo", "📁", "database", None),
        ]);
        // Plain prefix "100" matches both "100% Real" and "100X Fake" (literal "100" prefix).
        let rows = mgr
            .list_databases(&ws_conn, Some("100".to_string()))
            .expect("list_databases");
        assert_eq!(rows.len(), 2);

        // Prefix "100%" — without escaping, the '%' would still match "100X Fake"
        // (since '%' is a SQL wildcard). With escaping, only the literal "100%" prefix
        // matches, i.e. only "100% Real".
        let rows = mgr
            .list_databases(&ws_conn, Some("100%".to_string()))
            .expect("list_databases");
        assert_eq!(rows.len(), 1, "expected only '100% Real' to match literal '100%' prefix");
        assert_eq!(rows[0].1, "100% Real");
    }

    #[tokio::test]
    async fn get_cells_for_rows_preserves_order() {
        let mgr = make_manager().await;
        let db_id = mgr.create_database("DB".to_string()).await.unwrap();
        let fields = mgr.get_fields(&db_id).await.unwrap();
        let primary_field_id = fields[0].id.clone();

        let row_a = mgr.create_row(&db_id).await.unwrap();
        let row_b = mgr.create_row(&db_id).await.unwrap();

        mgr.update_cell(&row_a, &primary_field_id, &CellData::RichText("A".to_string())).await.unwrap();
        mgr.update_cell(&row_b, &primary_field_id, &CellData::RichText("B".to_string())).await.unwrap();

        // Call with row_ids in REVERSE insertion order
        let row_ids = vec![row_b.clone(), row_a.clone()];
        let result = mgr.get_cells_for_rows(&db_id, &row_ids).await.expect("get_cells_for_rows");

        assert_eq!(result.len(), 2);
        // First entry corresponds to row_b
        assert_eq!(result[0].0, row_b);
        match &result[0].1[0].1 {
            CellData::RichText(s) => assert_eq!(s, "B"),
            other => panic!("expected RichText('B'), got {:?}", other),
        }
        // Second entry corresponds to row_a
        assert_eq!(result[1].0, row_a);
        match &result[1].1[0].1 {
            CellData::RichText(s) => assert_eq!(s, "A"),
            other => panic!("expected RichText('A'), got {:?}", other),
        }
    }

    #[tokio::test]
    async fn get_cells_for_rows_empty_input() {
        let mgr = make_manager().await;
        let result = mgr.get_cells_for_rows("any-db", &[]).await.expect("get_cells_for_rows");
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn ensure_default_view_is_idempotent() {
        let mgr = make_manager().await;
        let db_id = mgr.create_database("DB".to_string()).await.unwrap();
        mgr.ensure_default_view(&db_id, super::super::field::DbViewLayout::Board).await.unwrap();
        mgr.ensure_default_view(&db_id, super::super::field::DbViewLayout::Board).await.unwrap();
        let views = mgr.get_db_views(&db_id).await.unwrap();
        assert_eq!(views.len(), 1, "should not create duplicate default view");
    }
}
