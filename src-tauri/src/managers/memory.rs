use anyhow::{anyhow, Result};
use log::{error, info};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::AppHandle;
use uuid::Uuid;

use crate::managers::chat_manager::{ChatManager, ChatMessage, ChatOptions};

/// Shared handle type to the workspace.db connection that holds the
/// `memories` table. Was previously aliased through `NotesManager` — the
/// underlying DB has always been workspace.db since the notes→workspace
/// merge, so Commit 3 moved the alias here locally.
type WorkspaceDbConnection = Arc<Mutex<Connection>>;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Memory {
    pub id: String,
    pub content: String,
    pub category: String,
    pub source: String,
    pub importance: i64,
    pub created_at: i64,
    pub last_accessed: i64,
}

pub struct MemoryManager {
    db_path: PathBuf,
    conn: WorkspaceDbConnection,
    is_extracting: Arc<AtomicBool>,
}

impl MemoryManager {
    /// Opens its own connection to `workspace.db` — the `memories` table
    /// lives there (moved from legacy notes.db in an earlier migration).
    /// Post Commit 3, MemoryManager is decoupled from NotesManager entirely.
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        let app_data_dir = crate::portable::app_data_dir(app_handle)?;
        let db_path = app_data_dir.join("workspace.db");
        let raw_conn = Connection::open(&db_path)
            .map_err(|e| anyhow!("open workspace.db for MemoryManager: {e}"))?;
        crate::managers::workspace::workspace_manager::apply_workspace_conn_pragmas(&raw_conn)?;
        let conn = Arc::new(Mutex::new(raw_conn));
        Ok(Self {
            db_path,
            conn,
            is_extracting: Arc::new(AtomicBool::new(false)),
        })
    }

    fn lock_conn(&self) -> Result<MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|_| anyhow!("workspace database mutex poisoned"))
    }

    pub fn is_extracting(&self) -> bool {
        self.is_extracting.load(Ordering::Relaxed)
    }

    pub async fn extract_and_save(
        &self,
        session: Vec<ChatMessage>,
        chat_manager: Arc<ChatManager>,
    ) -> Result<()> {
        if chat_manager.is_streaming() {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            if chat_manager.is_streaming() {
                return Ok(()); // Skip if still streaming
            }
        }

        if self.is_extracting.swap(true, Ordering::Relaxed) {
            return Ok(()); // Already extracting
        }

        let history_text = session
            .iter()
            .map(|m| format!("{}: {}", m.role, m.content))
            .collect::<Vec<_>>()
            .join("\n");

        let prompt = format!(
            "From this conversation, extract 1-5 concise facts about the user. Categorize each as one of: fact, project, preference, open_loop. Format each line as: [category] content. Only include non-obvious facts not already known. Be specific.\n\n{}",
            history_text
        );

        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: prompt,
            attachments: None,
            document_context: None,
        }];

        let extracted = Arc::new(Mutex::new(String::new()));
        let extracted_clone = Arc::clone(&extracted);
        let result = chat_manager
            .stream_chat(messages, ChatOptions::default(), move |token, _| {
                if let Ok(mut s) = extracted_clone.lock() {
                    s.push_str(&token);
                }
            })
            .await;

        self.is_extracting.store(false, Ordering::Relaxed);

        match result {
            Ok(()) => {
                let extracted_text = extracted.lock().map(|s| s.clone()).unwrap_or_default();
                self.save_extracted_memories(&extracted_text)?;
                info!("Memory extraction complete");
            }
            Err(e) => {
                error!("Memory extraction failed: {}", e);
            }
        }

        Ok(())
    }

    fn save_extracted_memories(&self, raw: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = chrono::Utc::now().timestamp_millis();
        let valid_categories = ["fact", "project", "preference", "open_loop"];

        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            // Parse [category] content
            let (category, content) = if line.starts_with('[') {
                if let Some(end) = line.find(']') {
                    let cat = &line[1..end];
                    let content = line[end + 1..].trim();
                    (cat.to_string(), content.to_string())
                } else {
                    ("fact".to_string(), line.to_string())
                }
            } else {
                ("fact".to_string(), line.to_string())
            };

            let category = if valid_categories.contains(&category.as_str()) {
                category
            } else {
                "fact".to_string()
            };

            if content.is_empty() {
                continue;
            }

            let id = Uuid::new_v4().to_string();
            if let Err(e) = conn.execute(
                "INSERT INTO memories (id, content, category, source, importance, created_at, last_accessed)
                 VALUES (?1, ?2, ?3, 'conversation', 3, ?4, ?4)",
                params![id, content, category, now],
            ) {
                error!("Failed to save memory: {}", e);
            }
        }
        Ok(())
    }

    pub fn retrieve_relevant(&self, limit: usize) -> Result<Vec<Memory>> {
        let conn = self.lock_conn()?;
        let now = chrono::Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "SELECT id, content, category, source, importance, created_at, last_accessed
             FROM memories
             ORDER BY CASE category WHEN 'project' THEN 0 WHEN 'open_loop' THEN 1 WHEN 'fact' THEN 2 ELSE 3 END, importance DESC
             LIMIT ?1"
        )?;
        let memories: Vec<Memory> = stmt
            .query_map([limit as i64], |row| {
                Ok(Memory {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    category: row.get(2)?,
                    source: row.get(3)?,
                    importance: row.get(4)?,
                    created_at: row.get(5)?,
                    last_accessed: row.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;

        // Update last_accessed for retrieved memories
        let ids: Vec<String> = memories.iter().map(|m| m.id.clone()).collect();
        for id in &ids {
            let _ = conn.execute(
                "UPDATE memories SET last_accessed = ?1 WHERE id = ?2",
                params![now, id],
            );
        }

        Ok(memories)
    }

    pub fn prune_stale(&self) -> Result<usize> {
        let conn = self.lock_conn()?;
        let thirty_days_ms = 30i64 * 24 * 60 * 60 * 1000;
        let cutoff = chrono::Utc::now().timestamp_millis() - thirty_days_ms;

        // Decrement importance for memories not accessed in 30 days
        conn.execute(
            "UPDATE memories SET importance = importance - 1 WHERE last_accessed < ?1 AND importance > 0",
            params![cutoff],
        )?;

        // Delete zero-importance memories
        let deleted = conn.execute("DELETE FROM memories WHERE importance = 0", [])?;
        info!("Pruned {} stale memories", deleted);
        Ok(deleted)
    }

    pub fn delete_memory(&self, id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM memories WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn clear_all(&self) -> Result<usize> {
        let conn = self.lock_conn()?;
        let count = conn.execute("DELETE FROM memories", [])?;
        Ok(count)
    }

    pub fn list_all(&self) -> Result<Vec<Memory>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, content, category, source, importance, created_at, last_accessed
             FROM memories ORDER BY created_at DESC",
        )?;
        let memories = stmt
            .query_map([], |row| {
                Ok(Memory {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    category: row.get(2)?,
                    source: row.get(3)?,
                    importance: row.get(4)?,
                    created_at: row.get(5)?,
                    last_accessed: row.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(memories)
    }
}
