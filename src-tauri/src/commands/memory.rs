use crate::managers::memory::{Memory, MemoryManager};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn list_memories(
    memory_manager: State<'_, Arc<MemoryManager>>,
) -> Result<Vec<Memory>, String> {
    memory_manager.list_all().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_memory(
    memory_manager: State<'_, Arc<MemoryManager>>,
    id: String,
) -> Result<(), String> {
    memory_manager.delete_memory(&id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn clear_memories(
    memory_manager: State<'_, Arc<MemoryManager>>,
) -> Result<usize, String> {
    memory_manager.clear_all().map_err(|e| e.to_string())
}
