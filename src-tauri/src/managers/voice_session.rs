use std::sync::Mutex;

/// Tracks the active voice-memo workspace document for the current session.
///
/// Post-refactor (voice memo = workspace.db only): only the workspace doc id is
/// tracked here. The legacy `active_note_id` (SQLite `notes` row) was removed when
/// the transcription pipeline stopped writing to notes.db. See CLAUDE.md Rule 9.
pub struct VoiceSessionManager {
    active_workspace_doc_id: Mutex<Option<String>>,
}

impl VoiceSessionManager {
    pub fn new() -> Self {
        Self {
            active_workspace_doc_id: Mutex::new(None),
        }
    }

    pub fn get_workspace_doc_id(&self) -> Option<String> {
        self.active_workspace_doc_id
            .lock()
            .ok()
            .and_then(|g| g.clone())
    }

    pub fn set_workspace_doc_id(&self, id: Option<String>) {
        if let Ok(mut guard) = self.active_workspace_doc_id.lock() {
            *guard = id;
        }
    }

    /// Remove and return the workspace doc id (for finalize_index on session end).
    pub fn take_workspace_doc_id(&self) -> Option<String> {
        self.active_workspace_doc_id
            .lock()
            .ok()
            .and_then(|mut g| g.take())
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.active_workspace_doc_id.lock() {
            *guard = None;
        }
    }
}
