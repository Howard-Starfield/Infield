//! Tauri command surface for Phase B onboarding state.
//!
//! Thin wrappers around `OnboardingManager`. The manager is constructed per
//! call because the only dependency is the workspace connection held by
//! `AppState` — no long-lived state to cache.

use std::sync::Arc;
use tauri::State;

use crate::managers::onboarding::{
    OnboardingManager, OnboardingState, OnboardingStatePatch,
};
use crate::managers::workspace::AppState;

fn manager(state: &State<'_, Arc<AppState>>) -> OnboardingManager {
    OnboardingManager::new(state.workspace_manager.conn().clone())
}

#[tauri::command]
#[specta::specta]
pub async fn get_onboarding_state(
    state: State<'_, Arc<AppState>>,
) -> Result<OnboardingState, String> {
    manager(&state).get().await
}

#[tauri::command]
#[specta::specta]
pub async fn update_onboarding_state(
    state: State<'_, Arc<AppState>>,
    patch: OnboardingStatePatch,
) -> Result<OnboardingState, String> {
    manager(&state).patch(patch).await
}

#[tauri::command]
#[specta::specta]
pub async fn reset_onboarding(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    manager(&state).reset().await
}
