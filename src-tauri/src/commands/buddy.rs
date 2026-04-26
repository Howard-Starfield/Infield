//! Tauri commands for the buddy system. Thin wrappers around `BuddyManager`.

use std::sync::Arc;
use tauri::State;

use crate::managers::buddy::{
    ActivityEvent, BuddyManager, BuddyState, ClaimResult, MilestoneTickResult,
};

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
#[specta::specta]
pub async fn get_buddy_state(mgr: State<'_, Arc<BuddyManager>>) -> Result<BuddyState, String> {
    mgr.get_state(now_ms()).await
}

#[tauri::command]
#[specta::specta]
pub async fn claim_chest(mgr: State<'_, Arc<BuddyManager>>) -> Result<ClaimResult, String> {
    mgr.claim_chest(now_ms(), None).await
}

#[tauri::command]
#[specta::specta]
pub async fn switch_active_buddy(
    mgr: State<'_, Arc<BuddyManager>>,
    buddy_id: String,
) -> Result<(), String> {
    mgr.switch_active_buddy(&buddy_id, now_ms()).await
}

#[tauri::command]
#[specta::specta]
pub async fn equip_gear(
    mgr: State<'_, Arc<BuddyManager>>,
    gear_id: String,
    slot: String,
    buddy_id: String,
) -> Result<(), String> {
    mgr.equip_gear(&gear_id, &slot, &buddy_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn unequip_gear(
    mgr: State<'_, Arc<BuddyManager>>,
    slot: String,
    buddy_id: String,
) -> Result<(), String> {
    mgr.unequip_gear(&slot, &buddy_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn set_overlay_position(
    mgr: State<'_, Arc<BuddyManager>>,
    x: f64,
    y: f64,
    anchor: String,
) -> Result<(), String> {
    mgr.set_overlay_position(x, y, &anchor, now_ms()).await
}

#[tauri::command]
#[specta::specta]
pub async fn set_overlay_hidden(
    mgr: State<'_, Arc<BuddyManager>>,
    hidden: bool,
) -> Result<(), String> {
    mgr.set_overlay_hidden(hidden, now_ms()).await
}

#[tauri::command]
#[specta::specta]
pub async fn set_cap_total(
    mgr: State<'_, Arc<BuddyManager>>,
    cap: f64,
) -> Result<(), String> {
    mgr.set_cap_total(cap, now_ms()).await
}

#[tauri::command]
#[specta::specta]
pub async fn record_activity_batch(
    mgr: State<'_, Arc<BuddyManager>>,
    events: Vec<ActivityEvent>,
) -> Result<(), String> {
    mgr.record_activity(&events, now_ms()).await
}

#[tauri::command]
#[specta::specta]
pub async fn tick_milestone(
    mgr: State<'_, Arc<BuddyManager>>,
    milestone_id: String,
    delta: i64,
) -> Result<MilestoneTickResult, String> {
    mgr.tick_milestone(&milestone_id, delta, now_ms()).await
}
