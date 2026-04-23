# Graph Report - .  (2026-04-23)

## Corpus Check
- Large corpus: 614 files · ~748,334 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 3520 nodes · 9031 edges · 61 communities detected
- Extraction: 63% EXTRACTED · 37% INFERRED · 0% AMBIGUOUS · INFERRED: 3308 edges (avg confidence: 0.67)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Workspace Shell & Layout|Workspace Shell & Layout]]
- [[_COMMUNITY_Settings & i18n|Settings & i18n]]
- [[_COMMUNITY_Workspace Manager & DB|Workspace Manager & DB]]
- [[_COMMUNITY_App Shell & Navigation|App Shell & Navigation]]
- [[_COMMUNITY_Database Manager|Database Manager]]
- [[_COMMUNITY_Clipboard & Input|Clipboard & Input]]
- [[_COMMUNITY_Chat Manager & LLM|Chat Manager & LLM]]
- [[_COMMUNITY_Settings Module|Settings Module]]
- [[_COMMUNITY_Actions & Transcription|Actions & Transcription]]
- [[_COMMUNITY_App Init & Tray|App Init & Tray]]
- [[_COMMUNITY_Audio Recording|Audio Recording]]
- [[_COMMUNITY_Model Management|Model Management]]
- [[_COMMUNITY_Settings Defaults|Settings Defaults]]
- [[_COMMUNITY_Crypto Vault & Listener|Crypto Vault & Listener]]
- [[_COMMUNITY_Embedding & Search|Embedding & Search]]
- [[_COMMUNITY_Tauri Bridge|Tauri Bridge]]
- [[_COMMUNITY_Theme & Onboarding|Theme & Onboarding]]
- [[_COMMUNITY_LLM Manager|LLM Manager]]
- [[_COMMUNITY_Text Processing & VAD|Text Processing & VAD]]
- [[_COMMUNITY_Keyboard Shortcuts|Keyboard Shortcuts]]
- [[_COMMUNITY_Chat UI|Chat UI]]
- [[_COMMUNITY_Calendar View|Calendar View]]
- [[_COMMUNITY_Vault Manager|Vault Manager]]
- [[_COMMUNITY_System Audio|System Audio]]
- [[_COMMUNITY_Entry & Auth|Entry & Auth]]
- [[_COMMUNITY_Onboarding Flow|Onboarding Flow]]
- [[_COMMUNITY_Audio Playback|Audio Playback]]
- [[_COMMUNITY_MDX Editor Toolbar|MDX Editor Toolbar]]
- [[_COMMUNITY_Text Chunking|Text Chunking]]
- [[_COMMUNITY_Lemniscate Animation|Lemniscate Animation]]
- [[_COMMUNITY_Status Bar & Footer|Status Bar & Footer]]
- [[_COMMUNITY_UI Primitives & Avatars|UI Primitives & Avatars]]
- [[_COMMUNITY_Vault Path Resolution|Vault Path Resolution]]
- [[_COMMUNITY_Notes Delete Preferences|Notes Delete Preferences]]
- [[_COMMUNITY_Page Header Eyebrow|Page Header Eyebrow]]
- [[_COMMUNITY_Calendar Utilities|Calendar Utilities]]
- [[_COMMUNITY_Toast Notifications|Toast Notifications]]
- [[_COMMUNITY_Sortable Layout|Sortable Layout]]
- [[_COMMUNITY_VAD Results|VAD Results]]
- [[_COMMUNITY_Avatar & Hashing|Avatar & Hashing]]
- [[_COMMUNITY_Event Templates|Event Templates]]
- [[_COMMUNITY_Scheduler|Scheduler]]
- [[_COMMUNITY_Gutter Splitter|Gutter Splitter]]
- [[_COMMUNITY_Resize Handle|Resize Handle]]
- [[_COMMUNITY_Resizable Hook|Resizable Hook]]
- [[_COMMUNITY_Cancel Icon|Cancel Icon]]
- [[_COMMUNITY_Handy Hand Icon|Handy Hand Icon]]
- [[_COMMUNITY_Handy Text Logo|Handy Text Logo]]
- [[_COMMUNITY_Microphone Icon|Microphone Icon]]
- [[_COMMUNITY_Transcription Icon|Transcription Icon]]
- [[_COMMUNITY_Textarea Component|Textarea Component]]
- [[_COMMUNITY_Mini Progress|Mini Progress]]
- [[_COMMUNITY_Notes Mode Matching|Notes Mode Matching]]
- [[_COMMUNITY_Segmented Control|Segmented Control]]
- [[_COMMUNITY_Virtual List|Virtual List]]
- [[_COMMUNITY_Date Parser|Date Parser]]
- [[_COMMUNITY_Diff Flash Hook|Diff Flash Hook]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 198|Community 198]]
- [[_COMMUNITY_Community 199|Community 199]]
- [[_COMMUNITY_Community 200|Community 200]]

## God Nodes (most connected - your core abstractions)
1. `get_settings()` - 138 edges
2. `WorkspaceManager` - 97 edges
3. `write_settings()` - 73 edges
4. `Filter` - 67 edges
5. `hasNativeVault()` - 58 edges
6. `Error` - 54 edges
7. `t()` - 45 edges
8. `get_default_settings()` - 44 edges
9. `ipcInvoke()` - 42 edges
10. `WorkspaceTree` - 42 edges

## Surprising Connections (you probably didn't know these)
- `orderedViewsForNewDatabase()` --calls--> `Filter`  [INFERRED]
  C:\AI_knowledge_workspace\Handy-main\src\components\workspace\WorkspaceTree.tsx → C:\AI_knowledge_workspace\Handy-main\src-tauri\src\managers\database\filter.rs
- `setupListener()` --calls--> `Error`  [INFERRED]
  C:\AI_knowledge_workspace\Handy-main\copy\src\App.tsx → C:\AI_knowledge_workspace\Handy-main\src-tauri\handy-keys\src\error.rs
- `normalizeVault()` --calls--> `Sort`  [INFERRED]
  C:\AI_knowledge_workspace\Handy-main\copy\src\crypto-vault.ts → C:\AI_knowledge_workspace\Handy-main\src-tauri\src\managers\database\sort.rs
- `handleSaveLlm()` --calls--> `saveLlmConfigNative()`  [INFERRED]
  C:\AI_knowledge_workspace\Handy-main\copy\src\components\SettingsView.tsx → C:\AI_knowledge_workspace\Handy-main\copy\src\tauri-bridge.ts
- `handleAiSummarize()` --calls--> `llmChatNative()`  [INFERRED]
  C:\AI_knowledge_workspace\Handy-main\copy\src\components\InspectorPanel.tsx → C:\AI_knowledge_workspace\Handy-main\copy\src\tauri-bridge.ts

## Communities

### Community 0 - "Workspace Shell & Layout"
Cohesion: 0.01
Nodes (244): flushActiveEditor(), registerActiveEditorFlush(), activeView resolution, cancel(), onDocMouseDown(), start(), AddViewPopover(), startCrossDatabaseBoardDropIfNeeded() (+236 more)

### Community 1 - "Settings & i18n"
Cohesion: 0.01
Nodes (186): fetchVersion(), handleDonateClick(), decodeWhisperValue(), encodeWhisperValue(), handleWhisperChange(), checkPermissions(), handleButtonClick(), initialSetup() (+178 more)

### Community 2 - "Workspace Manager & DB"
Cohesion: 0.02
Nodes (143): migrate_legacy_voice_memo_title(), canonicalize_with_fallback(), read_markdown_body_from_vault_file(), resolve_vault_root(), BoardExport, build_card_file(), export_board(), build_apple_intelligence_bridge() (+135 more)

### Community 3 - "App Shell & Navigation"
Cohesion: 0.02
Nodes (109): getActionIcon(), App(), AppBody(), async(), handleKeyDown(), setupListener(), showWin(), handleRailNavigate() (+101 more)

### Community 4 - "Database Manager"
Cohesion: 0.03
Nodes (109): create_database(), create_database_and_add_row(), create_database_inner(), create_date_field(), create_db_view(), create_row(), create_row_in_group(), create_row_inner() (+101 more)

### Community 5 - "Clipboard & Input"
Cohesion: 0.03
Nodes (118): AppCrashBoundary, decode_utf8_with_fallback(), extension_hint(), extract_chat_document_bytes(), extract_csv(), extract_docx(), extract_pdf(), extract_spreadsheet() (+110 more)

### Community 6 - "Chat Manager & LLM"
Cohesion: 0.03
Nodes (111): add_chat_message(), apply_chat_connection_fields(), build_chat_config_from_settings(), build_chat_context(), build_chat_system_prompt(), build_prompt_includes_guard_and_envelope(), chat_options_for_send(), ChatPromptPreview (+103 more)

### Community 7 - "Settings Module"
Cohesion: 0.04
Nodes (137): update_history_limit(), update_recording_retention_period(), LlamaBackendManager, add_post_process_prompt(), append_cursor_debug_log(), apply_and_reload_accelerator(), BindingResponse, change_app_language_setting() (+129 more)

### Community 8 - "Actions & Transcription"
Cohesion: 0.03
Nodes (99): append_markdown_note_content(), append_markdown_note_content_joins_with_blank_line(), append_transcription_to_voice_doc(), build_system_prompt(), CancelAction, create_markdown_note_content(), create_markdown_note_content_returns_trimmed_text(), directive_escape_path() (+91 more)

### Community 9 - "App Init & Tray"
Cohesion: 0.04
Nodes (65): VaultLock, handle_shortcut_event(), delete_history_entry(), get_audio_file_path(), get_history_entries(), get_latest_completed_entry_skips_empty_entries(), get_latest_entry_returns_newest_entry(), get_latest_entry_returns_none_when_empty() (+57 more)

### Community 10 - "Audio Recording"
Cohesion: 0.04
Nodes (70): AudioDevice, AudioRecordingManager, CaptureSource, check_custom_sounds(), create_audio_recorder(), custom_sound_exists(), CustomSounds, get_sound_base_dir() (+62 more)

### Community 11 - "Model Management"
Cohesion: 0.04
Nodes (55): EmbeddingEventPayload, EmbeddingWorker, emit_embedding_event(), open_worker_conn(), bge_small_corrupt_hash_is_rejected(), bge_small_pinned_hashes_match_staged_files(), DownloadCleanup, DownloadCleanup<'a> (+47 more)

### Community 12 - "Settings Defaults"
Cohesion: 0.04
Nodes (79): chunk_context(), llm_clean_chunk(), post_process_import_transcript(), resolve_import_prompt_template(), split_into_chunks(), strip_invisible_chars(), AppSettings, AutoSubmitKey (+71 more)

### Community 13 - "Crypto Vault & Listener"
Cohesion: 0.05
Nodes (66): addAudit(), addRecord(), auditTimestamp(), base32ToBytes(), bytesToBase32(), computeTotp(), createDefaultEbayRateLimit(), createEmptyVault() (+58 more)

### Community 14 - "Embedding & Search"
Cohesion: 0.06
Nodes (55): available_parallelism_or(), build_session(), cls_pool(), compute_or_cache_model_hash(), cos_sim(), dev_model_dir(), embed(), embed_is_deterministic_and_identity_is_one() (+47 more)

### Community 15 - "Tauri Bridge"
Cohesion: 0.11
Nodes (65): handleBeginAuth(), handleFinalize(), handleSaveConfig(), beginEbayOAuthNative(), cancelEbayOAuthNative(), canUseTauriInternalsInvoke(), changeVaultPasswordNative(), clearPendingEbayOAuthNative() (+57 more)

### Community 16 - "Theme & Onboarding"
Cohesion: 0.06
Nodes (32): getOnboardingState(), resetOnboarding(), updateOnboardingState(), nextStep(), OnboardingStepTheme(), OnboardingStepWelcome(), getPreset(), listPresets() (+24 more)

### Community 17 - "LLM Manager"
Cohesion: 0.08
Nodes (35): EmbeddingSidecarRequest, EmbeddingSidecarResponse, SidecarModeDto, ChatTemplate, detect_chat_template(), detect_chat_template_from_raw(), emit_response(), InferenceRuntime (+27 more)

### Community 18 - "Text Processing & VAD"
Cohesion: 0.09
Nodes (44): segment_wav(), segment_wav_empty_silence(), SegmentSpan, silero_path(), SileroVad, apply_custom_words(), build_ngram(), collapse_stutters() (+36 more)

### Community 19 - "Keyboard Shortcuts"
Cohesion: 0.07
Nodes (19): handleDragEnd(), log(), main(), FrontendKeyEvent, HandyKeysState, init_shortcuts(), ManagerCommand, modifiers_to_strings() (+11 more)

### Community 20 - "Chat UI"
Cohesion: 0.1
Nodes (27): buildDocumentXmlBlock(), composerMaxHeightPx(), escapeXmlAttr(), escapeXmlText(), fileExtension(), fileToBase64Payload(), isChatDocumentFile(), onResize() (+19 more)

### Community 21 - "Calendar View"
Cohesion: 0.09
Nodes (24): snapZonedToSlotMinutes(), eventStartToIso(), isZonedDateTime(), rowToCalendarEvent(), storedCalendarDateFieldId(), storedCalendarEndFieldId(), eventSortKey(), formatEventTime() (+16 more)

### Community 22 - "Vault Manager"
Cohesion: 0.1
Nodes (41): BoardExport struct, build_card_file, DatabaseImport struct, deserialize_cell, export_board, export_calendar, export_database_to_vault, export_table (+33 more)

### Community 23 - "System Audio"
Cohesion: 0.15
Nodes (27): clamp(), formatTimestamp(), handleCopyText(), handleOpenGeneralSettings(), handleOpenNote(), handleToggle(), nextCleanup(), onKey() (+19 more)

### Community 24 - "Entry & Auth"
Cohesion: 0.09
Nodes (13): GrainOverlay(), CanvasBoundary, easeInOut(), handlePointerDown(), handlePointerMove(), handlePointerUp(), LemniscateCurve, usePrefersReducedMotion() (+5 more)

### Community 25 - "Onboarding Flow"
Cohesion: 0.18
Nodes (19): check_constraint_rejects_unknown_step_on_direct_insert(), ensure_vec_extension(), fresh_conn(), get_on_fresh_install_seeds_welcome_row(), get_onboarding_state(), manager(), now_unix(), OnboardingManager (+11 more)

### Community 26 - "Audio Playback"
Cohesion: 0.17
Nodes (12): formatTime(), getProgressPercent(), handleEnded(), handleLoadedMetadata(), handlePause(), handlePlay(), handleSeek(), handleSliderMouseDown() (+4 more)

### Community 27 - "MDX Editor Toolbar"
Cohesion: 0.2
Nodes (8): measure(), onDoc(), onKey(), whenInAdmonition(), onDragEnd(), onKey(), computePinnedToolCount(), normalizeMdxToolOrder()

### Community 28 - "Text Chunking"
Cohesion: 0.37
Nodes (10): Chunk, chunk_pipeline_applies_overlap(), chunk_pipeline_extracts_json_paragraph_text(), chunk_pipeline_falls_back_to_raw_text_for_non_json_content(), chunk_pipeline_returns_single_chunk_for_short_text(), ChunkPipeline, collect_block_text(), extract_indexable_text() (+2 more)

### Community 29 - "Lemniscate Animation"
Cohesion: 0.29
Nodes (7): easeInOutQuad(), Lemniscate(), LemniscateCurve, onPointerDown(), onPointerMove(), onPointerUp(), readCssColor()

### Community 30 - "Status Bar & Footer"
Cohesion: 0.28
Nodes (3): useFooterSystemStatus(), transcriptionDotColorVar(), useTranscriptionStatus()

### Community 31 - "UI Primitives & Avatars"
Cohesion: 0.25
Nodes (8): FNV-1a hash function, GRADIENT_IDS constant, hashNameToGradient, inferStatusVariant heuristic, initialsOf, OwnerAvatar, StatusTag, StatusVariant type

### Community 32 - "Vault Path Resolution"
Cohesion: 0.38
Nodes (7): canonicalize_with_fallback, cascade_descendant_vault_paths, move_node, resolve_vault_root, update_node, ws_create_row_in_group, ws_update_cell

### Community 33 - "Notes Delete Preferences"
Cohesion: 0.73
Nodes (4): getDefaultNotesDeleteConfirmationPreferences(), loadNotesDeleteConfirmationPreferences(), persistNotesDeleteConfirmationPreferences(), resetNotesDeleteConfirmationPreferences()

### Community 34 - "Page Header Eyebrow"
Cohesion: 0.33
Nodes (2): Eyebrow(), PageHeader()

### Community 35 - "Calendar Utilities"
Cohesion: 0.6
Nodes (4): formatTime24(), getCurrentTimePosition(), getMonthDays(), isSameDay()

### Community 36 - "Toast Notifications"
Cohesion: 0.6
Nodes (3): ToastItem(), ToastProvider(), useToast()

### Community 37 - "Sortable Layout"
Cohesion: 0.6
Nodes (3): handleDragEnd(), handleDragStart(), SortablePanel()

### Community 38 - "VAD Results"
Cohesion: 0.5
Nodes (2): VadResult, VadStatus

### Community 39 - "Avatar & Hashing"
Cohesion: 0.7
Nodes (4): fnv1a(), hashNameToGradient(), initialsOf(), OwnerAvatar()

### Community 40 - "Event Templates"
Cohesion: 0.6
Nodes (3): loadTemplates(), saveTemplates(), useEventTemplates()

### Community 41 - "Scheduler"
Cohesion: 0.67
Nodes (2): clearIntervalId(), startInterval()

### Community 42 - "Gutter Splitter"
Cohesion: 0.67
Nodes (1): GutterSplitter()

### Community 43 - "Resize Handle"
Cohesion: 0.67
Nodes (1): ResizeHandle()

### Community 44 - "Resizable Hook"
Cohesion: 0.67
Nodes (1): useResizable()

### Community 45 - "Cancel Icon"
Cohesion: 0.67
Nodes (1): CancelIcon()

### Community 46 - "Handy Hand Icon"
Cohesion: 0.67
Nodes (1): HandyHand()

### Community 47 - "Handy Text Logo"
Cohesion: 0.67
Nodes (1): HandyTextLogo()

### Community 48 - "Microphone Icon"
Cohesion: 0.67
Nodes (1): MicrophoneIcon()

### Community 49 - "Transcription Icon"
Cohesion: 0.67
Nodes (1): TranscriptionIcon()

### Community 50 - "Textarea Component"
Cohesion: 0.67
Nodes (1): Textarea()

### Community 51 - "Mini Progress"
Cohesion: 1.0
Nodes (2): clampPct(), MiniProgress()

### Community 53 - "Notes Mode Matching"
Cohesion: 0.67
Nodes (1): matchesNotesMode()

### Community 54 - "Segmented Control"
Cohesion: 0.67
Nodes (1): SegmentedControl()

### Community 55 - "Virtual List"
Cohesion: 0.67
Nodes (1): VirtualList()

### Community 56 - "Date Parser"
Cohesion: 0.67
Nodes (1): parseNaturalDate()

### Community 57 - "Diff Flash Hook"
Cohesion: 0.67
Nodes (3): clampPct utility, MiniProgress, useDiffFlash

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (1): VadFrame<'a>

### Community 198 - "Community 198"
Cohesion: 1.0
Nodes (1): VaultLock

### Community 199 - "Community 199"
Cohesion: 1.0
Nodes (1): export_all_databases_to_vault

### Community 200 - "Community 200"
Cohesion: 1.0
Nodes (1): sync_vault

## Knowledge Gaps
- **92 isolated node(s):** `Expand opaque foreground so lines read thicker when downscaled (tray / taskbar).`, `tauri_plugin_log::LogLevel`, `VadFrame<'a>`, `VaultSyncStatus`, `std::result::Result<T, E>` (+87 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Page Header Eyebrow`** (6 nodes): `Eyebrow.tsx`, `Eyebrow()`, `PageHeader.tsx`, `PageHeader()`, `Eyebrow.tsx`, `PageHeader.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `VAD Results`** (5 nodes): `vad_result.rs`, `vad_result.rs`, `VadResult`, `.status()`, `VadStatus`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Scheduler`** (4 nodes): `scheduler.ts`, `scheduler.ts`, `clearIntervalId()`, `startInterval()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Gutter Splitter`** (3 nodes): `GutterSplitter.tsx`, `GutterSplitter.tsx`, `GutterSplitter()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Resize Handle`** (3 nodes): `ResizeHandle.tsx`, `ResizeHandle.tsx`, `ResizeHandle()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Resizable Hook`** (3 nodes): `useResizable.ts`, `useResizable.ts`, `useResizable()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cancel Icon`** (3 nodes): `CancelIcon.tsx`, `CancelIcon()`, `CancelIcon.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Handy Hand Icon`** (3 nodes): `HandyHand.tsx`, `HandyHand()`, `HandyHand.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Handy Text Logo`** (3 nodes): `HandyTextLogo.tsx`, `HandyTextLogo()`, `HandyTextLogo.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Microphone Icon`** (3 nodes): `MicrophoneIcon.tsx`, `MicrophoneIcon()`, `MicrophoneIcon.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Transcription Icon`** (3 nodes): `TranscriptionIcon.tsx`, `TranscriptionIcon.tsx`, `TranscriptionIcon()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Textarea Component`** (3 nodes): `Textarea.tsx`, `Textarea.tsx`, `Textarea()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Mini Progress`** (3 nodes): `clampPct()`, `MiniProgress()`, `MiniProgress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Notes Mode Matching`** (3 nodes): `noteView.ts`, `matchesNotesMode()`, `noteView.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Segmented Control`** (3 nodes): `SegmentedControl.tsx`, `SegmentedControl()`, `SegmentedControl.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Virtual List`** (3 nodes): `VirtualList.tsx`, `VirtualList.tsx`, `VirtualList()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Date Parser`** (3 nodes): `dateParser.ts`, `parseNaturalDate()`, `dateParser.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (2 nodes): `VadFrame<'a>`, `.is_speech()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 198`** (1 nodes): `VaultLock`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 199`** (1 nodes): `export_all_databases_to_vault`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 200`** (1 nodes): `sync_vault`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Filter` connect `Workspace Manager & DB` to `Workspace Shell & Layout`, `Settings & i18n`, `App Shell & Navigation`, `Database Manager`, `Clipboard & Input`, `Chat Manager & LLM`, `Avatar & Hashing`, `Settings Module`, `App Init & Tray`, `Model Management`, `Tauri Bridge`, `LLM Manager`, `Text Processing & VAD`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `get_settings()` connect `Settings Module` to `Workspace Manager & DB`, `Clipboard & Input`, `Chat Manager & LLM`, `Actions & Transcription`, `App Init & Tray`, `Audio Recording`, `Model Management`, `Settings Defaults`, `LLM Manager`, `Keyboard Shortcuts`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `Error` connect `Settings & i18n` to `Workspace Shell & Layout`, `App Shell & Navigation`, `Clipboard & Input`, `Actions & Transcription`, `Tauri Bridge`, `Chat UI`, `Audio Playback`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Are the 136 inferred relationships involving `get_settings()` (e.g. with `get_default_settings()` and `ensure_post_process_defaults()`) actually correct?**
  _`get_settings()` has 136 INFERRED edges - model-reasoned connections that need verification._
- **Are the 71 inferred relationships involving `write_settings()` (e.g. with `store_path()` and `update_microphone_mode()`) actually correct?**
  _`write_settings()` has 71 INFERRED edges - model-reasoned connections that need verification._
- **Are the 64 inferred relationships involving `Filter` (e.g. with `handleKeyDown()` and `handleSaveConfig()`) actually correct?**
  _`Filter` has 64 INFERRED edges - model-reasoned connections that need verification._
- **Are the 56 inferred relationships involving `hasNativeVault()` (e.g. with `canUseTauriInternalsInvoke()` and `getLegacyGlobalInvoke()`) actually correct?**
  _`hasNativeVault()` has 56 INFERRED edges - model-reasoned connections that need verification._