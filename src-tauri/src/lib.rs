mod actions;
pub mod app_identity;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod apple_intelligence;
mod audio_feedback;
pub mod audio_toolkit;
pub mod cli;
mod clipboard;
mod commands;
mod debug_session_log;
mod embedding_sidecar_protocol;
mod helpers;
mod input;
mod llm_client;
mod managers;
mod overlay;
pub mod portable;
mod settings;
mod shortcut;
mod signal_handle;
mod transcription_coordinator;
mod transcription_workspace;
mod import;
mod plugin;
mod tray;
mod tray_i18n;
mod utils;

pub use cli::CliArgs;
#[cfg(debug_assertions)]
use specta_typescript::{BigIntExportBehavior, Typescript};
use tauri_specta::{collect_commands, collect_events, Builder};

use env_filter::Builder as EnvFilterBuilder;
use managers::audio::AudioRecordingManager;
use managers::chat_manager::ChatManager;
use managers::database::manager::DatabaseManager;
use managers::embedding_ort::InferenceHandle;
use managers::embedding_worker::EmbeddingWorker;
use managers::history::HistoryManager;
use managers::llm::LlmManager;
use managers::memory::MemoryManager;
use managers::model::ModelManager;
use managers::search::SearchManager;
use managers::system_audio::SystemAudioManager;
use managers::transcription::TranscriptionManager;
use managers::voice_session::VoiceSessionManager;
use managers::workspace::{AppState, WorkspaceManager};
#[cfg(unix)]
use signal_hook::consts::{SIGUSR1, SIGUSR2};
#[cfg(unix)]
use signal_hook::iterator::Signals;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use tauri::image::Image;
pub use transcription_coordinator::TranscriptionCoordinator;

use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_log::{Builder as LogBuilder, RotationStrategy, Target, TargetKind};

use crate::settings::get_settings;

// Global atomic to store the file log level filter
// We use u8 to store the log::LevelFilter as a number
pub static FILE_LOG_LEVEL: AtomicU8 = AtomicU8::new(log::LevelFilter::Debug as u8);

fn level_filter_from_u8(value: u8) -> log::LevelFilter {
    match value {
        0 => log::LevelFilter::Off,
        1 => log::LevelFilter::Error,
        2 => log::LevelFilter::Warn,
        3 => log::LevelFilter::Info,
        4 => log::LevelFilter::Debug,
        5 => log::LevelFilter::Trace,
        _ => log::LevelFilter::Trace,
    }
}

fn build_console_filter() -> env_filter::Filter {
    let mut builder = EnvFilterBuilder::new();

    match std::env::var("RUST_LOG") {
        Ok(spec) if !spec.trim().is_empty() => {
            if let Err(err) = builder.try_parse(&spec) {
                log::warn!(
                    "Ignoring invalid RUST_LOG value '{}': {}. Falling back to info-level console logging",
                    spec,
                    err
                );
                builder.filter_level(log::LevelFilter::Info);
            }
        }
        _ => {
            builder.filter_level(log::LevelFilter::Info);
        }
    }

    builder.build()
}

fn show_main_window(app: &AppHandle, _source: &'static str) {
    if let Some(main_window) = app.get_webview_window("main") {
        if let Err(e) = main_window.unminimize() {
            log::error!("Failed to unminimize webview window: {}", e);
        }
        if let Err(e) = main_window.show() {
            log::error!("Failed to show webview window: {}", e);
        }
        if let Err(e) = main_window.set_focus() {
            log::error!("Failed to focus webview window: {}", e);
        }
        #[cfg(target_os = "macos")]
        {
            if let Err(e) = app.set_activation_policy(tauri::ActivationPolicy::Regular) {
                log::error!("Failed to set activation policy to Regular: {}", e);
            }
        }
        return;
    }

    let webview_labels = app.webview_windows().keys().cloned().collect::<Vec<_>>();
    log::error!(
        "Main window not found. Webview labels: {:?}",
        webview_labels
    );
}

#[allow(unused_variables)]
fn should_force_show_permissions_window(app: &AppHandle) -> bool {
    #[cfg(target_os = "windows")]
    {
        let model_manager = app.state::<Arc<ModelManager>>();
        let has_downloaded_models = model_manager
            .get_available_models()
            .iter()
            .any(|model| model.is_downloaded);

        if !has_downloaded_models {
            return false;
        }

        let status = commands::audio::get_windows_microphone_permission_status();
        if status.supported && status.overall_access == commands::audio::PermissionAccess::Denied {
            log::info!(
                "Windows microphone permissions are denied; forcing main window visible for onboarding"
            );
            return true;
        }
    }

    false
}

fn initialize_core_logic(app_handle: &AppHandle) {
    // Note: Enigo (keyboard/mouse simulation) is NOT initialized here.
    // The frontend is responsible for calling the `initialize_enigo` command
    // after onboarding completes. This avoids triggering permission dialogs
    // on macOS before the user is ready.

    // Initialize the managers
    let recording_manager = Arc::new(
        AudioRecordingManager::new(app_handle).expect("Failed to initialize recording manager"),
    );
    let model_manager =
        Arc::new(ModelManager::new(app_handle).expect("Failed to initialize model manager"));

    // Paths used across the embedding stack + DB init.
    let app_data_dir = crate::portable::app_data_dir(app_handle).unwrap_or_else(|_| {
        app_handle
            .path()
            .app_data_dir()
            .expect("Failed to get app data dir")
    });
    let workspace_db_path = app_data_dir.join("workspace.db");
    let embedding_model_dir = app_data_dir
        .join("models")
        .join(managers::embedding_ort::MODEL_ID);

    // Phase A legacy rename — if a usearch index file from the pre-flip
    // build is still sitting in app_data, move it aside so it doesn't get
    // accidentally re-read. Not deleted: a later cleanup commit removes
    // the backup once vec_embeddings has ≥1 row (simplified heuristic per
    // REBUILD_RATIONALE §15; "2 successful boots" was cargo-culted).
    let old_usearch = app_data_dir.join("embeddings.usearch");
    if old_usearch.is_file() {
        let backup = app_data_dir.join("embeddings.usearch.backup");
        match std::fs::rename(&old_usearch, &backup) {
            Ok(()) => log::info!(
                "renamed legacy embeddings.usearch → embeddings.usearch.backup"
            ),
            Err(e) => log::warn!(
                "failed to rename legacy embeddings.usearch: {} \
                 (safe to ignore — old file will be cleaned up by a later commit)",
                e
            ),
        }
    }

    // Rule 15 / D11: acquire the vault process lock BEFORE any SQLite
    // `Connection::open` (workspace.db, the EmbeddingWorker's worker conn,
    // DatabaseManager). Without this, two instances can race the SQLite
    // opens and corrupt workspace_fts + vec0 state.
    //
    // Failure mode per D11: native dialog + `std::process::exit(0)`. No
    // IPC, no focus-steal. The dialog pops pre-Tauri-runtime because we
    // don't have an AppHandle-bound dialog plugin available this early;
    // we use `rfd` (already in-tree via tauri-plugin-dialog) for the
    // cross-platform blocking MessageDialog. Exit code is 0 because this
    // is a user-facing "already running" path, not a crash.
    //
    // The lock is stored in Tauri managed state below so its backing File
    // lives for the full app lifetime; Drop releases the OS lock on
    // normal exit, panic unwind, or OS reclaim.
    let vault_dir = crate::app_identity::resolve_vault_root(app_handle);
    let vault_lock = match crate::app_identity::VaultLock::acquire(&vault_dir) {
        Ok(lock) => lock,
        Err(msg) => {
            log::error!("vault lock acquisition failed: {}", msg);
            rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Warning)
                .set_title("Infield is already running")
                .set_description(&format!(
                    "Another copy of Infield is using this vault:\n\n  {}\n\n\
                     Close the other window before opening a second one.",
                    vault_dir.display()
                ))
                .set_buttons(rfd::MessageButtons::Ok)
                .show();
            std::process::exit(0);
        }
    };
    app_handle.manage(vault_lock);

    // Spawn the ORT embedding worker. Blocks up to LOAD_TIMEOUT (10s) on
    // session load; on failure or timeout, returns a handle in the
    // `vector_search_available = false` state — search degrades to FTS-only,
    // Settings banner surfaces the reason via the tauri event.
    let inference_handle = Arc::new(InferenceHandle::spawn(
        app_handle.clone(),
        embedding_model_dir.clone(),
    ));
    log::info!(
        "InferenceHandle spawn: available={}",
        inference_handle.is_available()
    );

    let chunk_pipeline = Arc::new(managers::chunking::ChunkPipeline::new(2_000, 400));
    let transcription_manager = Arc::new(
        TranscriptionManager::new(app_handle, model_manager.clone())
            .expect("Failed to initialize transcription manager"),
    );
    let history_manager =
        Arc::new(HistoryManager::new(app_handle).expect("Failed to initialize history manager"));
    // Phase A Commit 3 retired NotesManager + TaggingManager (both
    // notes-scoped). Legacy-file cleanup is deferred until AFTER
    // workspace.db successfully opens and migrates (line ~295 below),
    // gated on the `.merged-into-workspace` marker — see comment there.
    let llm_manager =
        Arc::new(LlmManager::new(app_handle).expect("Failed to initialize local LLM manager"));
    let voice_session_manager = Arc::new(VoiceSessionManager::new());
    let interview_session_manager = Arc::new(
        crate::managers::interview_session::InterviewSessionManager::new(),
    );
    let interview_worker = Arc::new(
        crate::managers::interview_worker::InterviewTranscriptionWorker::new(app_handle),
    );

    // Open workspace.db + apply the canonical PRAGMA block. The worker
    // connection (opened inside EmbeddingWorker::new) calls the same helper
    // — mismatches across connections corrupt WAL under concurrent writes.
    let mut ws_conn =
        rusqlite::Connection::open(&workspace_db_path).expect("Failed to open workspace database");
    managers::workspace::workspace_manager::apply_workspace_conn_pragmas(&ws_conn)
        .expect("Failed to apply workspace PRAGMAs");

    // Run migrations against the bare conn BEFORE wrapping it in
    // WorkspaceManager — Rule 19's reindex check reads/writes
    // `embedding_model_info` + `vec_embeddings`, so those tables must
    // already exist. WorkspaceManager::migrate() is idempotent (user_version
    // marker) and we call it again below for any future dev-time migrations,
    // but the real work happens here.
    managers::workspace::WorkspaceManager::migrations()
        .to_latest(&mut ws_conn)
        .expect("Failed to run workspace migrations");

    // Rule 19: compare the current model.onnx hash (cached in a side-file
    // keyed by mtime) against the row in `embedding_model_info`. Mismatch
    // wipes `vec_embeddings` + requeues every embeddable node via
    // `embed_backfill_queue`. Only runs when the session loaded OK —
    // otherwise we have nothing authoritative to compare against.
    if inference_handle.is_available() {
        match managers::embedding_ort::rule_19_reindex_check(
            &mut ws_conn,
            &embedding_model_dir,
        ) {
            Ok(outcome) => log::info!("Rule 19 outcome: {:?}", outcome),
            Err(e) => log::warn!("Rule 19 check failed (non-fatal): {}", e),
        }
    } else {
        log::info!(
            "Rule 19 check skipped — inference unavailable; \
             comparison will run on the next boot where the model loads"
        );
    }

    // Construct EmbeddingWorker now that migrations + Rule 19 are done.
    // The worker opens its own connection to workspace.db inside ::new.
    let embedding_worker = EmbeddingWorker::new(
        app_handle,
        chunk_pipeline,
        inference_handle.clone(),
        workspace_db_path.clone(),
    );

    let workspace_manager = Arc::new(WorkspaceManager::new(ws_conn, embedding_worker.clone()));
    // Idempotent (user_version) — covered above, keep for any mid-dev migrations added.
    workspace_manager
        .migrate()
        .expect("Failed to run workspace migrations (idempotent)");
    workspace_manager
        .ensure_workspace_fts_populated()
        .expect("Failed to seed workspace FTS index");
    if let Err(e) = workspace_manager.probe_and_repair() {
        log::error!("workspace probe_and_repair failed: {}", e);
    }

    // Phase A Commit 3 legacy-notes cleanup. Guardrails:
    //   (a) runs only AFTER workspace.db opened + migrated + probe/repair —
    //       if any of those panic earlier, we never reach this block and
    //       the user's notes.db stays on disk, recoverable.
    //   (b) gated on the `.merged-into-workspace` marker — which is the
    //       file rename NotesManager::open_shared_database used to perform
    //       after a successful notes→workspace merge. Marker present ⇒
    //       merge ran to completion ⇒ notes.db data is already in
    //       workspace_nodes ⇒ safe to remove the leftovers. Marker absent
    //       ⇒ either a pre-merge install or a mid-merge crash; in either
    //       case, leave notes.db alone and let a future recovery path
    //       handle it.
    //   (c) per-file failure logs at warn! + continues — no panic on
    //       permission-denied / file-locked edge cases.
    let merged_marker = app_data_dir.join("notes.db.merged-into-workspace");
    if merged_marker.is_file() {
        // Marker stays: it's a permanent record that the migration ran.
        // Delete only the stale SQLite artefacts (notes.db + journals).
        let stale_files = ["notes.db", "notes.db-wal", "notes.db-shm"];
        for name in stale_files {
            let path = app_data_dir.join(name);
            if path.exists() {
                match std::fs::remove_file(&path) {
                    Ok(()) => log::info!(
                        "Removed legacy notes artefact: {}",
                        path.display()
                    ),
                    Err(e) => log::warn!(
                        "Failed to remove legacy notes artefact {}: {} \
                         (safe to ignore — manual cleanup possible)",
                        path.display(),
                        e
                    ),
                }
            }
        }
    } else if app_data_dir.join("notes.db").is_file() {
        log::warn!(
            "Found notes.db without .merged-into-workspace marker — \
             leaving untouched. This is a pre-Phase-A install or a \
             mid-merge crash; data is still recoverable. If you've \
             verified workspace_nodes has your content, remove notes.db \
             manually."
        );
    }

    let search_manager = Arc::new(SearchManager::new(
        inference_handle.clone(),
        workspace_manager.clone(),
        embedding_worker.clone(),
    ));
    let system_audio_manager = Arc::new(
        SystemAudioManager::new(app_handle).expect("Failed to initialize system audio manager"),
    );

    // Apply accelerator preferences before any model loads
    managers::transcription::apply_accelerator_settings(app_handle);

    // Add managers to Tauri's managed state
    app_handle.manage(recording_manager.clone());
    app_handle.manage(model_manager.clone());
    app_handle.manage(inference_handle.clone());
    app_handle.manage(embedding_worker.clone());
    app_handle.manage(transcription_manager.clone());
    commands::models::ensure_selected_transcription_model(app_handle);
    app_handle.manage(history_manager.clone());
    app_handle.manage(llm_manager.clone());
    app_handle.manage(voice_session_manager.clone());
    app_handle.manage(interview_session_manager.clone());
    app_handle.manage(interview_worker.clone());
    app_handle.manage(search_manager.clone());
    app_handle.manage(system_audio_manager.clone());
    let import_queue_service = import::ImportQueueService::spawn(
        app_handle.clone(),
        workspace_manager.clone(),
        transcription_manager.clone(),
    );
    app_handle.manage(import_queue_service);
    let chat_manager = Arc::new(ChatManager::new());
    let chat_manager_for_init = chat_manager.clone();
    app_handle.manage(chat_manager);
    let app_chat_init = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let settings = settings::get_settings(&app_chat_init);
        let pid = settings.chat_active_provider_id.trim();
        let pid = if pid.is_empty() {
            "ollama"
        } else {
            pid
        };
        match commands::chat::build_chat_config_from_settings(&settings, pid) {
            Ok(cfg) => {
                if let Err(e) = chat_manager_for_init.reload(cfg).await {
                    log::warn!("Failed to apply saved chat provider on startup: {}", e);
                }
            }
            Err(e) => log::warn!("Invalid saved chat provider on startup: {}", e),
        }
    });
    let memory_manager = Arc::new(
        MemoryManager::new(app_handle).expect("Failed to initialize memory manager"),
    );
    app_handle.manage(memory_manager);
    let chat_memory_manager = Arc::new(
        managers::chat_memory::ChatMemoryManager::new(
            app_handle,
            managers::embedding_ort::EMBEDDING_DIM,
        )
        .expect("Failed to init ChatMemoryManager"),
    );
    app_handle.manage(chat_memory_manager);
    // DatabaseManager reuses the vault_dir computed at VaultLock acquisition
    // (earlier in this fn, before any SQLite opens). Must not re-resolve
    // here — `resolve_vault_root` canonicalises via `std::fs::canonicalize`
    // which can return a different PathBuf on a second call if symlinks or
    // drive letters change shape mid-init. Single source of truth avoids
    // that drift.
    let database_manager = Arc::new(
        DatabaseManager::new_with_vault(app_handle, vault_dir.clone())
            .expect("Failed to init DatabaseManager"),
    );

    // AppState holds workspace_manager for cross-manager operations
    let app_state = AppState {
        database_manager: database_manager.clone(),
        workspace_manager: workspace_manager.clone(),
    };
    app_handle.manage(database_manager);
    app_handle.manage(Arc::new(app_state));

    // Note: Shortcuts are NOT initialized here.
    // The frontend is responsible for calling the `initialize_shortcuts` command
    // after permissions are confirmed (on macOS) or after onboarding completes.
    // This matches the pattern used for Enigo initialization.

    #[cfg(unix)]
    let signals = Signals::new(&[SIGUSR1, SIGUSR2]).unwrap();
    // Set up signal handlers for toggling transcription
    #[cfg(unix)]
    signal_handle::setup_signal_handler(app_handle.clone(), signals);

    // Apply macOS Accessory policy if starting hidden and tray is available.
    // If the tray icon is disabled, keep the dock icon so the user can reopen.
    #[cfg(target_os = "macos")]
    {
        let settings = settings::get_settings(app_handle);
        if settings.start_hidden && settings.show_tray_icon {
            let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
        }
    }
    // Get the current theme to set the appropriate initial icon
    let initial_theme = tray::get_current_theme(app_handle);

    // Choose the appropriate initial icon based on theme
    let initial_icon_path = tray::get_icon_path(initial_theme, tray::TrayIconState::Idle);

    let tray = TrayIconBuilder::new()
        .icon(
            Image::from_path(
                app_handle
                    .path()
                    .resolve(initial_icon_path, tauri::path::BaseDirectory::Resource)
                    .unwrap(),
            )
            .unwrap(),
        )
        .tooltip(tray::tray_tooltip())
        .show_menu_on_left_click(true)
        .icon_as_template(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => {
                show_main_window(app, "tray_menu_settings");
            }
            "check_updates" => {
                let settings = settings::get_settings(app);
                if settings.update_checks_enabled {
                    show_main_window(app, "tray_menu_check_updates");
                    let _ = app.emit("check-for-updates", ());
                }
            }
            "copy_last_transcript" => {
                tray::copy_last_transcript(app);
            }
            "unload_model" => {
                let transcription_manager = app.state::<Arc<TranscriptionManager>>();
                if !transcription_manager.is_model_loaded() {
                    log::warn!("No model is currently loaded.");
                    return;
                }
                match transcription_manager.unload_model() {
                    Ok(()) => log::info!("Model unloaded via tray."),
                    Err(e) => log::error!("Failed to unload model via tray: {}", e),
                }
            }
            "cancel" => {
                use crate::utils::cancel_current_operation;

                // Use centralized cancellation that handles all operations
                cancel_current_operation(app);
            }
            "quit" => {
                app.exit(0);
            }
            id if id.starts_with("model_select:") => {
                let model_id = id.strip_prefix("model_select:").unwrap().to_string();
                let current_model = settings::get_settings(app).selected_model;
                if model_id == current_model {
                    return;
                }
                let app_clone = app.clone();
                std::thread::spawn(move || {
                    match commands::models::switch_active_model(&app_clone, &model_id) {
                        Ok(()) => {
                            log::info!("Model switched to {} via tray.", model_id);
                        }
                        Err(e) => {
                            log::error!("Failed to switch model via tray: {}", e);
                        }
                    }
                    tray::update_tray_menu(&app_clone, &tray::TrayIconState::Idle, None);
                });
            }
            _ => {}
        })
        .build(app_handle)
        .unwrap();
    app_handle.manage(tray);

    // Initialize tray menu with idle state
    utils::update_tray_menu(app_handle, &utils::TrayIconState::Idle, None);

    // Apply show_tray_icon setting
    let settings = settings::get_settings(app_handle);
    if !settings.show_tray_icon {
        tray::set_tray_visibility(app_handle, false);
    }

    // Refresh tray menu when model state changes
    let app_handle_for_listener = app_handle.clone();
    app_handle.listen("model-state-changed", move |_| {
        tray::update_tray_menu(&app_handle_for_listener, &tray::TrayIconState::Idle, None);
    });

    // Get the autostart manager and configure based on user setting
    let autostart_manager = app_handle.autolaunch();
    let settings = settings::get_settings(&app_handle);

    if settings.autostart_enabled {
        // Enable autostart if user has opted in
        let _ = autostart_manager.enable();
    } else {
        // Disable autostart if user has opted out
        let _ = autostart_manager.disable();
    }

    // Create the recording overlay window (hidden by default)
    utils::create_recording_overlay(app_handle);
}

#[tauri::command]
#[specta::specta]
fn trigger_update_check(app: AppHandle) -> Result<(), String> {
    let settings = settings::get_settings(&app);
    if !settings.update_checks_enabled {
        return Ok(());
    }
    app.emit("check-for-updates", ())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn show_main_window_command(app: AppHandle) -> Result<(), String> {
    show_main_window(&app, "invoke_show_main_window_command");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(cli_args: CliArgs) {
    // Register the `sqlite-vec` extension with SQLite's global auto-extension
    // list BEFORE opening any `rusqlite::Connection`. Every connection opened
    // after this call (workspace.db, notes.db, future per-vault DBs) picks up
    // `vec0` + `vec_version()` automatically — no per-connection load call.
    // Phase A deliverable 3 (D10 locked: static-link via the `sqlite-vec`
    // crate; Rule 17 carve-out since no dlopen / codesign work required).
    //
    // Assert on return code: silent failure here ships a binary where every
    // subsequent `Connection::open` thinks vec0 is available but isn't, and
    // search fails opaquely at first query. There is no graceful-degradation
    // story at the auto-extension layer — crash-at-boot is the right loud
    // failure mode.
    //
    // SAFETY: `sqlite3_vec_init` has the exact `xEntryPoint` signature
    // expected by `sqlite3_auto_extension` (documented in sqlite-vec's
    // Rust example); the `*const ()` cast is the crate's documented
    // registration pattern. Called exactly once — `run()` is invoked once
    // from `main.rs`.
    let rc = unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )))
    };
    assert_eq!(
        rc,
        rusqlite::ffi::SQLITE_OK,
        "sqlite-vec auto-extension register failed (rc={rc})"
    );

    // Detect portable mode before anything else
    portable::init();

    // Parse console logging directives from RUST_LOG, falling back to info-level logging
    // when the variable is unset
    let console_filter = build_console_filter();

    let specta_builder = Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            shortcut::change_binding,
            shortcut::reset_binding,
            shortcut::change_ptt_setting,
            shortcut::change_audio_feedback_setting,
            shortcut::change_audio_feedback_volume_setting,
            shortcut::change_sound_theme_setting,
            shortcut::change_start_hidden_setting,
            shortcut::change_autostart_setting,
            shortcut::change_translate_to_english_setting,
            shortcut::change_selected_language_setting,
            shortcut::change_overlay_position_setting,
            shortcut::change_debug_mode_setting,
            shortcut::change_show_onboarding_setting,
            shortcut::change_word_correction_threshold_setting,
            shortcut::change_extra_recording_buffer_setting,
            shortcut::change_paste_delay_ms_setting,
            shortcut::change_system_audio_max_chunk_secs_setting,
            shortcut::change_system_audio_paragraph_silence_secs_setting,
            shortcut::change_system_audio_vad_hangover_secs_setting,
            shortcut::change_paste_method_setting,
            shortcut::get_available_typing_tools,
            shortcut::change_typing_tool_setting,
            shortcut::change_external_script_path_setting,
            shortcut::change_clipboard_handling_setting,
            shortcut::change_auto_submit_setting,
            shortcut::change_auto_submit_key_setting,
            shortcut::change_auto_create_note_setting,
            shortcut::change_auto_tag_enabled_setting,
            shortcut::change_post_process_enabled_setting,
            shortcut::change_experimental_enabled_setting,
            shortcut::change_llm_model_path_setting,
            shortcut::change_llm_gpu_enabled_setting,
            shortcut::change_post_process_base_url_setting,
            shortcut::change_post_process_api_key_setting,
            shortcut::change_post_process_model_setting,
            shortcut::set_post_process_provider,
            shortcut::fetch_post_process_models,
            shortcut::add_post_process_prompt,
            shortcut::update_post_process_prompt,
            shortcut::delete_post_process_prompt,
            shortcut::set_post_process_selected_prompt,
            shortcut::update_custom_words,
            shortcut::suspend_binding,
            shortcut::resume_binding,
            shortcut::change_mute_while_recording_setting,
            shortcut::change_append_trailing_space_setting,
            shortcut::change_lazy_stream_close_setting,
            shortcut::change_app_language_setting,
            shortcut::change_update_checks_setting,
            shortcut::change_keyboard_implementation_setting,
            shortcut::get_keyboard_implementation,
            shortcut::change_show_tray_icon_setting,
            shortcut::change_whisper_accelerator_setting,
            shortcut::change_ort_accelerator_setting,
            shortcut::change_whisper_gpu_device,
            shortcut::get_available_accelerators,
            shortcut::handy_keys::start_handy_keys_recording,
            shortcut::handy_keys::stop_handy_keys_recording,
            trigger_update_check,
            show_main_window_command,
            commands::append_cursor_debug_log,
            commands::cancel_operation,
            commands::is_portable,
            commands::get_app_dir_path,
            commands::get_app_settings,
            commands::get_default_settings,
            commands::get_log_dir_path,
            commands::set_log_level,
            commands::open_recordings_folder,
            commands::open_log_dir,
            commands::open_app_data_dir,
            commands::check_apple_intelligence_available,
            commands::initialize_enigo,
            commands::initialize_shortcuts,
            commands::models::get_available_models,
            commands::models::get_model_info,
            commands::models::download_model,
            commands::models::delete_model,
            commands::models::cancel_download,
            commands::models::set_active_model,
            commands::models::get_current_model,
            commands::models::set_active_llm_model,
            commands::models::get_current_llm_model,
            commands::models::get_transcription_model_status,
            commands::search::get_embedding_model_info,
            commands::models::is_model_loading,
            commands::models::has_any_models_available,
            commands::models::has_any_models_or_downloads,
            commands::audio::update_microphone_mode,
            commands::audio::get_microphone_mode,
            commands::audio::get_windows_microphone_permission_status,
            commands::audio::open_microphone_privacy_settings,
            commands::audio::get_available_microphones,
            commands::audio::set_selected_microphone,
            commands::audio::get_selected_microphone,
            commands::audio::get_available_output_devices,
            commands::audio::set_selected_output_device,
            commands::audio::get_selected_output_device,
            commands::audio::play_test_sound,
            commands::audio::check_custom_sounds,
            commands::audio::set_clamshell_microphone,
            commands::audio::get_clamshell_microphone,
            commands::audio::is_recording,
            commands::audio::start_ui_recording,
            commands::audio::stop_ui_recording,
            commands::transcription::set_model_unload_timeout,
            commands::transcription::get_model_load_status,
            commands::transcription::unload_model_manually,
            commands::history::get_history_entries,
            commands::history::toggle_history_entry_saved,
            commands::history::get_audio_file_path,
            commands::history::delete_history_entry,
            commands::history::retry_history_entry_transcription,
            commands::import_queue::enqueue_import_paths,
            commands::import_queue::get_import_queue,
            commands::import_queue::cancel_import_job,
            commands::history::update_history_limit,
            commands::history::update_recording_retention_period,
            helpers::clamshell::is_laptop,
            commands::database::ensure_database,
            commands::database::get_db_views,
            commands::database::create_db_view,
            commands::database::delete_db_view,
            commands::database::reorder_db_views,
            commands::database::ensure_default_view,
            commands::llm::get_note_prompts,
            commands::llm::get_default_note_prompts,
            commands::llm::get_llm_status,
            commands::llm::add_note_prompt,
            commands::llm::update_note_prompt,
            commands::llm::delete_note_prompt,
            commands::search::get_vector_index_status,
            commands::search::get_footer_system_status,
            commands::search::search_workspace_hybrid,
            commands::search::search_workspace_title,
            commands::search::reindex_all_embeddings,
            commands::system_audio::start_system_audio_capture,
            commands::system_audio::stop_system_audio_capture,
            commands::system_audio::is_system_audio_capturing,
            commands::system_audio::get_system_audio_capture_elapsed_secs,
            commands::system_audio::test_loopback_device,
            commands::system_audio::get_render_devices,
            commands::interview::start_interview_session,
            commands::interview::stop_interview_session,
            commands::interview::is_interview_session_active,
            commands::chat::send_chat_message,
            commands::chat::set_chat_provider,
            commands::chat::save_chat_provider_options,
            commands::chat::save_provider_api_key,
            commands::chat::test_chat_provider,
            commands::chat::get_chat_providers,
            commands::chat::new_chat_session,
            commands::chat::list_chat_sessions,
            commands::chat::delete_chat_session,
            commands::chat::add_chat_message,
            commands::chat::extract_chat_document,
            commands::chat::get_chat_messages,
            commands::chat::preview_chat_prompt_context,
            commands::chat::save_chat_custom_instructions,
            commands::chat::save_chat_system_prompt_template,
            commands::chat::save_chat_output_token_settings,
            commands::chat::list_ollama_vision_models,
            commands::chat::build_chat_context,
            commands::memory::list_memories,
            commands::memory::delete_memory,
            commands::memory::clear_memories,
            commands::database::create_database,
            commands::database::get_fields,
            commands::database::get_rows,
            commands::database::create_row,
            commands::database::update_cell,
            commands::database::get_all_cells_for_row,
            commands::database::get_rows_filtered_sorted,
            commands::database::create_select_option,
            commands::database::rename_select_option,
            commands::database::update_select_option_color,
            commands::database::delete_select_option,
            commands::database::create_row_in_group,
            commands::database::create_date_field,
            commands::database::update_row_date,
            commands::database::export_database_template,
            commands::database::save_database_template,
            commands::database::delete_database_template,
            commands::database::list_database_templates,
            commands::database::run_workspace_migration,
            commands::onboarding::get_onboarding_state,
            commands::onboarding::update_onboarding_state,
            commands::onboarding::reset_onboarding,
            commands::workspace_nodes::create_node,
            commands::workspace_nodes::get_node,
            commands::workspace_nodes::get_node_children,
            commands::workspace_nodes::get_root_nodes,
            commands::workspace_nodes::update_node,
            commands::workspace_nodes::delete_node,
            commands::workspace_nodes::move_node,
            commands::workspace_nodes::create_node_view,
            commands::workspace_nodes::get_node_views,
            commands::workspace_nodes::update_node_view,
            commands::workspace_nodes::delete_node_view,
            commands::workspace_nodes::get_node_comments,
            commands::workspace_nodes::add_comment,
            commands::workspace_nodes::delete_comment,
            commands::workspace_nodes::get_templates,
            commands::workspace_nodes::create_template,
            commands::workspace_nodes::ws_create_select_option,
            commands::workspace_nodes::ws_rename_select_option,
            commands::workspace_nodes::ws_update_select_option_color,
            commands::workspace_nodes::ws_delete_select_option,
            commands::workspace_nodes::ws_reorder_select_options,
            commands::workspace_nodes::ws_get_cell,
            commands::workspace_nodes::ws_update_cell,
            commands::workspace_nodes::ws_create_row_in_group,
            commands::workspace_nodes::ws_add_single_select_field,
            commands::workspace_nodes::ws_add_field,
            commands::workspace_nodes::ws_rename_field,
            commands::workspace_nodes::ws_set_field_type,
            commands::workspace_nodes::ws_set_field_group,
            commands::workspace_nodes::ws_rename_field_group,
            commands::workspace_nodes::ws_delete_field,
            commands::workspace_nodes::get_user_preference,
            commands::workspace_nodes::set_user_preference,
            commands::workspace_nodes::get_backlinks,
            commands::workspace_nodes::propagate_rename,
            commands::workspace_nodes::get_or_create_daily_note,
            commands::workspace_nodes::restore_node,
            commands::workspace_nodes::permanent_delete_node,
            commands::workspace_nodes::get_deleted_nodes,
            commands::workspace_nodes::empty_trash,
            commands::workspace_nodes::import_markdown_folder,
            commands::workspace_nodes::import_csv,
            commands::workspace_nodes::export_markdown,
            commands::workspace_nodes::export_csv,
            commands::workspace_nodes::sync_vault,
            commands::workspace_nodes::get_vault_sync_status,
            commands::vault_sync::export_database_to_vault,
            commands::vault_sync::export_all_databases_to_vault,
            commands::vault_sync::import_database_from_vault,
            commands::ui::set_app_zoom,
            commands::yt_dlp_plugin::yt_dlp_plugin_status,
            commands::yt_dlp_plugin::install_yt_dlp_plugin,
            commands::yt_dlp_plugin::check_yt_dlp_update,
            commands::yt_dlp_plugin::uninstall_yt_dlp_plugin,
        ])
        .events(collect_events![
            managers::history::HistoryUpdatePayload,
        ]);

    #[cfg(debug_assertions)] // <- Only export on non-release builds
    specta_builder
        .export(
            Typescript::default().bigint(BigIntExportBehavior::Number),
            "../src/bindings.ts",
        )
        .expect("Failed to export typescript bindings");

    let invoke_handler = specta_builder.invoke_handler();

    /// Tao on Windows can emit bogus `NewEvents` / `RedrawEventsCleared` sequence warnings
    /// when the WebView receives focus (e.g. clicking in-app controls). Harmless upstream noise;
    /// see https://github.com/tauri-apps/tauri/issues/8494
    fn suppress_tao_windows_runner_warn_spam(metadata: &log::Metadata<'_>) -> bool {
        cfg!(target_os = "windows")
            && metadata.target() == "tao::platform_impl::platform::event_loop::runner"
            && metadata.level() == log::Level::Warn
    }

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .device_event_filter(tauri::DeviceEventFilter::Always)
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            LogBuilder::new()
                .level(log::LevelFilter::Trace) // Set to most verbose level globally
                .max_file_size(500_000)
                .rotation_strategy(RotationStrategy::KeepOne)
                .clear_targets()
                .targets([
                    // Console output respects RUST_LOG environment variable
                    Target::new(TargetKind::Stdout).filter({
                        let console_filter = console_filter.clone();
                        move |metadata| {
                            if suppress_tao_windows_runner_warn_spam(metadata) {
                                return false;
                            }
                            console_filter.enabled(metadata)
                        }
                    }),
                    // File logs respect the user's settings (stored in FILE_LOG_LEVEL atomic)
                    Target::new(if let Some(data_dir) = portable::data_dir() {
                        TargetKind::Folder {
                            path: data_dir.join("logs"),
                            file_name: Some("handy".into()),
                        }
                    } else {
                        TargetKind::LogDir {
                            file_name: Some("handy".into()),
                        }
                    })
                    .filter(|metadata| {
                        if suppress_tao_windows_runner_warn_spam(metadata) {
                            return false;
                        }
                        let file_level = FILE_LOG_LEVEL.load(Ordering::Relaxed);
                        metadata.level() <= level_filter_from_u8(file_level)
                    }),
                ])
                .build(),
        );

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|a| a == "--toggle-transcription") {
                signal_handle::send_transcription_input(app, "transcribe", "CLI");
            } else if args.iter().any(|a| a == "--toggle-post-process") {
                signal_handle::send_transcription_input(app, "transcribe_with_post_process", "CLI");
            } else if args.iter().any(|a| a == "--cancel") {
                crate::utils::cancel_current_operation(app);
            } else {
                show_main_window(app, "single_instance");
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["recording_overlay"])
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(cli_args.clone())
        .setup(move |app| {
            specta_builder.mount_events(app);

            // Create main window programmatically so we can set data_directory
            // for portable mode (redirects WebView2 cache to portable Data dir)
            //
            // Taskbar / title-bar icon: with `app.windows` empty in tauri.conf.json,
            // `default_window_icon()` is often None, so we must set `.icon()` explicitly
            // or Windows shows a blank WebView2 placeholder.
            let window_icon = app
                .default_window_icon()
                .map(|i| i.to_owned())
                .unwrap_or_else(|| {
                    Image::from_bytes(include_bytes!("../icons/128x128.png"))
                        .expect("icons/128x128.png must be a valid PNG")
                });

            // Custom chrome on every platform: the frontend renders a full
            // titlebar, drag region, and window controls via `data-tauri-
            // drag-region`. On macOS this also lets `#root`'s rounded
            // corners + rim light show through the desktop instead of
            // being framed by the native titlebar.
            //
            // `transparent(true)` + `shadow(false)` together give the
            // frontend complete control over the window silhouette.
            // `macOSPrivateApi: true` in tauri.conf.json is required for
            // transparency on macOS; it's already set.
            let mut win_builder =
                tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("/".into()))
                    .title("Infield")
                    // 20% larger than the previous 1680x1000 default per
                    // user request after wholesale-swap. Min stays at
                    // 1200x720 so users with small monitors aren't locked out.
                    .inner_size(2016.0, 1200.0)
                    .min_inner_size(1200.0, 720.0)
                    .resizable(true)
                    .maximizable(true)
                    .visible(false)
                    .decorations(false)
                    .transparent(true)
                    .shadow(false)
                    .icon(window_icon)?;

            if let Some(data_dir) = portable::data_dir() {
                win_builder = win_builder.data_directory(data_dir.join("webview"));
            }

            let main_window = win_builder.build()?;

            // Apply native translucency / rounded-corner compositing so the
            // transparent window + `#root`'s 24px border-radius actually render
            // as a rounded floating app on the desktop (not a rectangular slab
            // clipped to the window bounds). Platform-specific:
            //   - macOS: NSVisualEffectView with HudWindow material
            //   - Windows 11: Mica (preferred) → Acrylic fallback
            //   - Windows 10 / Linux: silently no-op; CSS gracefully degrades
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                let _ = apply_vibrancy(
                    &main_window,
                    NSVisualEffectMaterial::HudWindow,
                    None,
                    None,
                );
            }
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::{apply_acrylic, apply_mica};
                // Mica is Windows 11-only. If it fails (Win 10 or earlier
                // build) we fall back to Acrylic. Both failing is a no-op;
                // transparent(true) alone still renders a borderless window.
                if apply_mica(&main_window, Some(true)).is_err() {
                    let _ = apply_acrylic(&main_window, None);
                }

                // Use the frontend-defined rounded shell rather than
                // Windows 11's fixed native corner radius. DWM's built-in
                // radius is smaller than Infield's glass panels, so it
                // creates a mismatched double-corner. The top bar and root
                // are clipped in CSS with `--window-corner-radius`.
                //
                // No-op on Windows 10 / older (the attribute is ignored).
                if let Ok(hwnd) = main_window.hwnd() {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::Graphics::Dwm::{
                        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE,
                        DWMWCP_DONOTROUND,
                    };
                    let hwnd = HWND(hwnd.0 as *mut _);
                    let preference = DWMWCP_DONOTROUND;
                    unsafe {
                        let _ = DwmSetWindowAttribute(
                            hwnd,
                            DWMWA_WINDOW_CORNER_PREFERENCE,
                            &preference as *const _ as *const _,
                            std::mem::size_of_val(&preference) as u32,
                        );
                    }
                }
            }

            let mut settings = get_settings(&app.handle());

            // CLI --debug flag overrides debug_mode and log level (runtime-only, not persisted)
            if cli_args.debug {
                settings.debug_mode = true;
                settings.log_level = settings::LogLevel::Trace;
            }

            let tauri_log_level: tauri_plugin_log::LogLevel = settings.log_level.into();
            let file_log_level: log::Level = tauri_log_level.into();
            // Store the file log level in the atomic for the filter to use
            FILE_LOG_LEVEL.store(file_log_level.to_level_filter() as u8, Ordering::Relaxed);
            let app_handle = app.handle().clone();
            app.manage(TranscriptionCoordinator::new(app_handle.clone()));

            initialize_core_logic(&app_handle);

            // Hide tray icon if --no-tray was passed
            if cli_args.no_tray {
                tray::set_tray_visibility(&app_handle, false);
            }

            // Show main window only if not starting hidden.
            // CLI --start-hidden flag overrides the setting.
            // But if permission onboarding is required, always show the window.
            let should_hide = settings.start_hidden || cli_args.start_hidden;
            let should_force_show = should_force_show_permissions_window(&app_handle);

            // If start_hidden but tray is disabled, we must show the window
            // anyway. Without a tray icon, the dock is the only way back in.
            let tray_available = settings.show_tray_icon && !cli_args.no_tray;
            if should_force_show || !should_hide || !tray_available {
                show_main_window(&app_handle, "setup_startup");
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _res = window.hide();

                #[cfg(target_os = "macos")]
                {
                    let settings = get_settings(&window.app_handle());
                    let tray_visible =
                        settings.show_tray_icon && !window.app_handle().state::<CliArgs>().no_tray;
                    if tray_visible {
                        // Tray is available: hide the dock icon, app lives in the tray
                        let res = window
                            .app_handle()
                            .set_activation_policy(tauri::ActivationPolicy::Accessory);
                        if let Err(e) = res {
                            log::error!("Failed to set activation policy: {}", e);
                        }
                    }
                    // No tray: keep the dock icon visible so the user can reopen
                }
            }
            tauri::WindowEvent::ThemeChanged(theme) => {
                log::info!("Theme changed to: {:?}", theme);
                // Update tray icon to match new theme, maintaining idle state
                utils::change_tray_icon(&window.app_handle(), utils::TrayIconState::Idle);
            }
            _ => {}
        })
        .invoke_handler(invoke_handler)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = &event {
                show_main_window(app, "macos_reopen");
            }
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(m) = app.try_state::<std::sync::Arc<SystemAudioManager>>() {
                    if m.is_running() {
                        let mgr = m.inner().clone();
                        tauri::async_runtime::block_on(async move {
                            if let Err(e) = mgr.stop_loopback().await {
                                log::error!("System audio flush on app exit: {e}");
                            }
                        });
                    }
                }
            }
            let _ = (app, event); // suppress unused warnings on non-macOS
        });
}
