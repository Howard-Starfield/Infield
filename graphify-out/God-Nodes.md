# God Nodes — Most Connected Abstractions in Handy

> Extracted from graph analysis of `src/components/` + `src-tauri/src/`
> 2,192 nodes · 4,498 edges · 45 communities
> Method: betweenness centrality + degree centrality

---

## What makes a "god node"?

Nodes with the highest **betweenness centrality** — they sit on the shortest path between many other nodes, making them architectural chokepoints. Change these and ripple effects propagate everywhere.

---

## Top 5 God Nodes

### 1. `get_settings()` — 137 edges | Settings hub

**Source:** `src-tauri/src/settings.rs`

**What it is:** The primary settings read path. Every part of the app — audio, transcription, UI, hotkeys, paste, chat — calls this to get config.

**Communities it bridges:** Database Write Pipeline, Audio Recording & Transcription, Chat Manager, Paste & Import Processing, App Initialization, Default Configuration, Hotkey Infrastructure, History Management, Recording Control, Sound & Audio Feedback

**Key callers:**
- `maybe_create_note_from_transcription()` — transcription pipeline reads settings
- `process_transcription_output()` — audio processing reads settings
- `play_feedback_sound()` / `play_feedback_sound_blocking()` — sound system reads settings
- `paste()` — paste pipeline reads paste settings
- `initialize_core_logic()` — app init reads settings to boot everything

**Risk:** With 130 INFERRED edges, there may be phantom connections that aren't actually exercised at runtime. Verify critical paths.

---

### 2. `WorkspaceManager` — 96 edges | Vault/workspace coordinator

**Source:** `src-tauri/src/managers/workspace/workspace_manager.rs`

**What it is:** The central orchestrator for the vault + SQLite workspace. All tree operations (create, move, delete, rename) and database operations (field, row, view management) flow through here.

**Methods (EXTRACTED structural connections):**
- Field operations: `.get_field_select_options()`, `.set_field_select_options()`, `.create_select_option()`, `.rename_select_option()`, `.update_select_option_color()`, `.delete_select_option()`, `.reorder_select_options()`
- Cell operations: `.cell_value_to_search_fragment()`, `.row_cells_flat_text()`
- Node operations: `get_node()`, `create_node()`, `update_node()`, `delete_node()`, `move_node()`, `get_node_children()`, `get_root_nodes()`

**Risk:** Single coordinator for both vault (`.md` files) and SQLite — any bug here corrupts both.

---

### 3. `write_settings()` — 72 edges | Settings write path

**Source:** `src-tauri/src/settings.rs`

**What it is:** The primary settings write path. Writes go to disk (JSON in app data dir).

**Key write targets:**
- `store_path()` — where settings are persisted
- `update_microphone_mode()` / `set_selected_microphone()` — mic config
- `set_selected_output_device()` — audio output config
- `set_chat_provider()` / `save_chat_provider_options()` / `save_chat_custom_instructions()` — chat config
- `set_clamshell_microphone()` — clamshell-specific mic

**Risk:** 71 INFERRED edges — many of these write-side connections may be model-inferred rather than actual call paths.

---

### 4. `get_default_settings()` — 43 edges | Defaults provider

**Source:** `src-tauri/src/settings.rs`

**What it is:** Returns the default settings struct. Used at first boot and when resetting settings.

**Contained values (all EXTRACTED):**
- `default_chat_custom_instructions()`
- `default_chat_system_prompt_mode()`
- `default_show_onboarding()`
- `default_chat_active_provider_id()`
- `default_chat_max_output_tokens()`
- `default_start_hidden()`
- `default_autostart_enabled()`
- `default_update_checks_enabled()`

**Bridges:** Default Configuration → Settings & Hotkeys, Paste & Import Processing

---

### 5. `t()` — 42 edges | i18n / translation bridge

**Source:** `src/components/chat/ChatWindow.tsx`

**What it is:** The translation/i18n function used across the UI. Every UI string that needs localization goes through `t()`.

**Key callers:**
- `getLanguageDisplayText()` — language selector
- `handleSystemAudioToggle()` — system audio toggle
- `copyToClipboard()` — clipboard operations
- `handleSend()` / `handleQuickCreate()` / `handleCreateQuickCapture()` — chat actions
- `formatRelativeTime()` — time formatting

**Observation:** `t()` appears in **10 communities** — it's the localization escape hatch that ties the entire UI together. If i18n ever needs refactoring, all these call sites need review.

---

## Secondary God Nodes

### `settings.rs` — 77 edges | Settings type definitions

**Source:** `src-tauri/src/settings.rs`

Contains the type definitions for the entire settings surface:
- `LogLevel`, `ShortcutBinding`, `LLMPrompt`, `ChatProviderOverride`, `ChatSystemPromptMode`, `PostProcessProvider`, `OverlayPosition`, `ModelUnloadTimeout`
- Default value functions: `default_chat_custom_instructions()`, `default_chat_system_prompt_mode()`, etc.

### `workspace_nodes.rs` — 48 edges | Vault node commands

**Source:** `src-tauri/src/commands/workspace_nodes.rs`

All Tauri commands for workspace tree operations:
- `create_node()`, `get_node()`, `get_node_children()`, `get_root_nodes()`
- `update_node()`, `delete_node()`, `move_node()`
- `create_node_view()`, `cascade_descendant_vault_paths()`
- `VaultSyncStatus`

### `mod.rs` (shortcut) — 70 edges | Hotkey registration

**Source:** `src-tauri/src/shortcut/mod.rs`

All hotkey infrastructure:
- `init_shortcuts()`, `register_shortcut()`, `unregister_shortcut()`
- `register_cancel_shortcut()`, `unregister_cancel_shortcut()`
- `change_binding()`, `reset_binding()`, `suspend_binding()`, `resume_binding()`
- `BindingResponse`

### `t()` from ChatWindow.tsx — bridges i18n across UI

See above — every UI surface that displays text locally uses `t()`.

---

## Architectural Observations

### The Settings Singularity

`get_settings()`, `write_settings()`, and `get_default_settings()` together account for **252 edges** — 5.6% of the entire graph. The settings module is the most consequential piece of shared state in the app.

Every major system reads from it at runtime:
- Audio recording → reads mic settings
- Transcription → reads VAD + model settings
- Chat → reads provider + prompt settings
- Paste → reads paste method + auto-submit settings
- UI → reads theme + language + display settings

**Implication:** If settings ever need a schema migration, every reader is potentially affected.

### The Vault Coordinator

`WorkspaceManager` is the single arbiter of both:
1. **Vault tree** — parent/child relationships, slug paths, `.md` file lifecycle
2. **Workspace database** — `workspace_nodes`, `workspace_fts`, `vec_embeddings`

The two are supposed to be kept in sync (Rule 1 from CLAUDE.md: "vault is source of truth, SQLite is derived index"). `WorkspaceManager` is where that synchronization happens.

### The i18n Escape Hatch

`t()` is the only i18n mechanism. If the app ever needs to support dynamic language switching without reload, `ChatWindow.tsx` + every caller needs review.

---

## Knowledge Gaps

158 nodes are **isolated** (≤1 connection). Notable examples:
- `RecordingErrorEvent` — event type with no connections
- `ShortcutAction` — enum with no connections
- `ProcessedTranscription` — result type with no connections
- `AppleLLMResponse` — Apple Intelligence response type

These may be genuinely under-connected or represent genuinely isolated types. Run `/graphify query "What connects RecordingErrorEvent to the rest of the system?"` for details.

---

## How to use this note

- **Before changing settings.rs** → trace all callers of `get_settings()` / `write_settings()`
- **Before changing WorkspaceManager** → trace all tree+database operations
- **Before changing i18n** → trace all `t()` callers across communities
- **Before hotkey changes** → trace `shortcut/mod.rs` and `handy_keys.rs`
