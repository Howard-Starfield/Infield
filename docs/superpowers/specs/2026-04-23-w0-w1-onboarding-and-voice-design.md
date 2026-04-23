# W0 + W1 — Spotlight Onboarding + Voice Transcribe Wiring

> Design spec for the first two phases of the Backend Wiring Phase.
> Two commits: W0 lands cleanly first; W1 lands separately with the
> backend-touch justified inline. Authority: PLAN.md "Backend Wiring
> Phase (W)", CLAUDE.md Rules 9, 12, 13, 14, 18, 20, 21.

**Date:** 2026-04-23
**Branch:** `claude/sad-jang-a58c1a`
**Author:** Claude (Opus 4.7)

---

## 1. Goals

**W0** — Build a first-run onboarding overlay that walks the user through
mic permission → accessibility (macOS only) → required model downloads →
vault path. Source of truth lives in Rust's `onboarding_state` table; the
overlay is a pure read/write client.

**W1** — Wire the existing `AudioView` mic UI to Handy's transcription
pipeline. The mic button starts recording, a stop button finalises it,
the result is appended to a per-day workspace doc under "Mic Transcribe"
per CLAUDE.md Rule 9.

Non-goals (deferred):
- Welcome screen, theme picker (deleted from the plan)
- AI insight panel / waveform visualisation (cosmetic; covered in later W phases)
- System-audio capture wiring in AudioView (toggle deferred — backend works, UI later)
- Vault-path enforcement in `resolve_vault_root` (D19 — picker stores the value; backend wiring is its own follow-up)

---

## 2. W0 — Spotlight onboarding

### 2.1 Step set (4 steps)

| # | Step              | Purpose                                                    | Skip rule                                          |
|---|-------------------|------------------------------------------------------------|----------------------------------------------------|
| 1 | `mic`             | Request microphone permission                              | Skip → records `Skipped`, downstream record fails noisily |
| 2 | `accessibility`   | Request macOS accessibility (for global shortcuts)         | Auto-skip on Win/Linux → records `NotApplicable`   |
| 3 | `models`          | Download Whisper (user-picked size) + bge-small (required) | 3-attempt soft-skip per D14                        |
| 4 | `vault`           | Confirm `~/Documents/Infield` or pick a custom folder      | None — Continue is always available                |

`done` is the terminal state. Backend enum loses `welcome` and `theme`
(see §2.5).

### 2.2 UI shape

A single **`OnboardingOverlay`** component mounted at the App level when
`onboardingStep !== 'done'`. Visual treatment:

- **No backdrop blur.** A fully transparent dimmer sits over the existing
  HerOS atmospheric blob layer so the kinetic background remains visible
  through the overlay. (User callout: differs from `SpotlightOverlay`'s
  `rgba(0,0,0,0.7) + blur(20px)` chrome.)
- A centred `HerOSPanel` ~640px wide. Inside: header (icon badge + step
  title + step counter `2 of 4`), content area swapped via
  `AnimatePresence mode="wait"` cross-fade, footer with progress dots +
  Skip / Continue actions.
- Spotlight pattern matches `src/components/SpotlightOverlay.tsx`'s glass
  card geometry (24px radius, glass-card class, premium shadow), minus
  the blurred backdrop.

```
┌─────────────────────────────────────────┐
│  ●  Microphone access     2 of 4        │  header
├─────────────────────────────────────────┤
│                                         │
│  Infield needs your mic to capture      │
│  voice notes…                           │  step body
│                                         │
│  [ Allow microphone ]   [ Skip ]        │
│                                         │
├─────────────────────────────────────────┤
│  ○ ● ○ ○            ◀ Back   Continue ▶ │  footer
└─────────────────────────────────────────┘
```

### 2.3 Boot gate

`App.tsx`'s `AnimatePresence` becomes a four-way switch:

```
isBooting        → <LoadingScreen />
isLocked         → <LockOverlay /> (existing)
onboarding != 'done' → <OnboardingOverlay />          [NEW]
otherwise        → <AppShell />
```

Mount precedence: `isBooting > isLocked > onboarding > shell`. On a fresh
install the user lands on the mic step ~2.5s after launch; `isLocked`
stays `false` (D-H1) so the overlay takes over immediately after boot.

### 2.4 VaultContext extensions (additive only)

Per user confirmation #4. Existing fields untouched; the four new
additions piggyback on the existing `useVault()` consumer surface:

```typescript
type VaultContextType = {
  // ...existing fields unchanged...
  onboardingStep: OnboardingStep | null      // null while loading initial state
  onboardingState: OnboardingState | null    // full state for steps that need historical fields
  completeStep: (patch: OnboardingStatePatch) => Promise<void>
  refreshOnboarding: () => Promise<void>
}
```

Source of truth: `commands.getOnboardingState()` called on provider
mount. `completeStep` calls `updateOnboardingState(patch)` and updates
local state from the response. `refreshOnboarding` is exposed for
edge cases (e.g. macOS permission re-poll after window refocus).

`OnboardingStep` and `OnboardingState` types come from
`src/bindings.ts` (specta-generated).

### 2.5 Backend changes (`src-tauri/`)

Justified by user authorisation #3.

**`src-tauri/src/managers/onboarding.rs`:**
- `OnboardingStep` loses `Welcome` and `Theme` variants. Final shape:
  `Mic | Accessibility | Models | Vault | Done`.
- `OnboardingStep::from_str` returns an error for `"welcome"` or
  `"theme"` — but to avoid breaking existing rows from any prior dev
  run, `get()` translates legacy strings to `Mic` on read and
  immediately patches the row to `mic` (one-line forward-migrate).
- Auto-seed insert in `get()` changes from `'welcome'` to `'mic'`
  (line 180-184).
- Tests update: `get_on_fresh_install_seeds_welcome_row` →
  `get_on_fresh_install_seeds_mic_row`; assertion of
  `OnboardingStep::Welcome` → `Mic`. Other tests that reference
  `Welcome` get the same swap.

**`src-tauri/src/managers/workspace/workspace_manager.rs`:**
- The Phase B migration's `CHECK (current_step IN (...))` is left as-is.
  SQLite can't `ALTER TABLE` a CHECK constraint without a table rebuild,
  and the existing constraint is a *superset* of the new allowed values
  — `mic | accessibility | models | vault | done` are all in the list.
  Removing welcome/theme from CHECK adds zero safety (typed enum
  prevents emitting them anyway) and costs a migration. Skip.

**Bindings regen:** `bun run tauri dev` once at the end of W0 to regen
`src/bindings.ts`. Specta picks up the smaller enum.

### 2.6 Component layout (new files, flat)

```
src/components/
  OnboardingOverlay.tsx          — container + step router + boot gate
  OnboardingStepMic.tsx          — Allow/Skip; Win mic-permission registry path; macOS plugin
  OnboardingStepAccessibility.tsx — macOS only; auto-patches NotApplicable on other OSes
  OnboardingStepModels.tsx       — Whisper picker + bge-small required; combined progress
  OnboardingStepVault.tsx        — default/custom path with D19-honest copy
src/styles/
  onboarding.css                 — concern file (Rule 18 §3): backdrop, panel motion, dots
```

All step components share a `<OnboardingStepFrame title icon onContinue onSkip canContinue />`
helper to keep header/footer consistent and DRY.

### 2.7 Per-step behaviour

**Mic.**
- macOS: dynamic import `tauri-plugin-macos-permissions-api`'s
  `checkMicrophonePermission` → if not granted, `requestMicrophonePermission`
  → re-check.
- Windows: read `getWindowsMicrophonePermissionStatus()`. If
  `overall_access !== 'allowed'`, "Open settings" button calls
  `openMicrophonePrivacySettings()`. Permission status re-polls on
  window focus (single `addEventListener('focus', refresh)`).
- Linux: assume granted (no dialog API).
- Outcomes: `Granted` → patch + advance. `Denied/Skipped` → patch + show
  warning copy ("Voice memos won't work; you can fix this in
  Settings → Audio") and advance.

**Accessibility.**
- Non-macOS: `useEffect` on mount immediately calls
  `completeStep({ accessibility_permission: NotApplicable, current_step: 'models' })`.
  No render flash — the overlay renders the next step on the same tick.
- macOS: dynamic import `checkAccessibilityPermission` /
  `requestAccessibilityPermission`. Open System Settings deep link;
  poll on focus.

**Models.**
- Calls `getAvailableModels()` once.
- Whisper picker: filter `engine_type === 'Whisper'` + `category ===
  'Transcription'`, default to `is_recommended` (per D20). Radio-style
  list with size + disk size labels.
- bge-small: filter `id === 'bge-small-en-v1.5'`. Marked required;
  cannot be deselected.
- Combined progress: weighted by total bytes
  (`(whisperBytesDone + bgeBytesDone) / (whisperTotal + bgeTotal)`).
  Per-file breakdown shown beneath. Source: `model-download-progress`
  Tauri event payload (verify exact shape during impl — fall back to
  polling `get_available_models` if event unavailable).
- Failure handling per D14: 3 attempts, exponential backoff (2s/8s/32s).
  Then a "Skip — configure later in Settings → Models" button.
- Soft-skip patches `models_downloaded` with whatever did download (may
  be empty, or just bge if Whisper failed).
- On success: `setActiveModel(whisperId)` for the picked Whisper before
  advancing.

**Vault.**
- Default path display: hardcoded `"~/Documents/Infield"` (per D15;
  computed at boot-time later if needed; just a label here).
- "Choose folder…" → `@tauri-apps/plugin-dialog`'s
  `open({ directory: true, multiple: false, title: 'Pick vault folder' })`.
- Pre-Continue copy (D19 honesty): "Custom locations land in a future
  release — your choice is saved now so it applies automatically once
  the integration ships."
- Continue: patches `vault_root` (the chosen path or the literal default
  string) + `current_step: 'done'` + `completed_at: <unix>`.

### 2.8 Verification (W0)

- [ ] `bun run build` — green
- [ ] `bunx vitest run` — green (no new tests required; existing 9 pass)
- [ ] `cargo test --lib` — green (onboarding tests updated for new enum)
- [ ] `bun run tauri dev` boots:
  - Fresh app data → Onboarding overlay appears at the mic step
  - Walk all 4 steps → AppShell takes over
  - Reset via `commands.resetOnboarding()` → next launch re-enters at mic
- [ ] Cmd/Ctrl+L still triggers lock overlay (regression check)
- [ ] UI scale slider still works (Rule 20/21 regression check)
- [ ] No console errors / no broken imports in other views

---

## 3. W1 — Voice transcribe wiring

### 3.1 Backend changes (`src-tauri/`)

Per user authorisation #1: add the missing UI-callable wrappers.
**Reuses** the existing `TranscribeAction` start/stop pipeline — does
NOT introduce new transcription behaviour, only exposes it to JS.

**`src-tauri/src/actions.rs`:**
- Add two free functions (sibling to `TranscribeAction`):
  ```rust
  /// Synthetic binding id used by UI-initiated recordings so the
  /// existing pipeline (history, voice-session, cancel-shortcut
  /// register/unregister) treats them as a normal session.
  pub const UI_RECORDING_BINDING_ID: &str = "ui-mic";

  pub fn trigger_ui_recording_start(app: &AppHandle) {
      let action = TranscribeAction { post_process: false };
      action.start(app, UI_RECORDING_BINDING_ID, "");
  }

  pub fn trigger_ui_recording_stop(app: &AppHandle) {
      let action = TranscribeAction { post_process: false };
      action.stop(app, UI_RECORDING_BINDING_ID, "");
  }
  ```
  This keeps the entire pipeline (model load, recording, transcription,
  voice-memo doc append per Rule 9, history entry, audio feedback,
  tray icon, overlay) identical to the keybinding path.

**`src-tauri/src/commands/audio.rs`:**
- Add two thin Tauri commands:
  ```rust
  #[tauri::command]
  #[specta::specta]
  pub fn start_ui_recording(app: AppHandle) -> Result<(), String> {
      crate::actions::trigger_ui_recording_start(&app);
      Ok(())
  }

  #[tauri::command]
  #[specta::specta]
  pub fn stop_ui_recording(app: AppHandle) -> Result<(), String> {
      crate::actions::trigger_ui_recording_stop(&app);
      Ok(())
  }
  ```

**`src-tauri/src/lib.rs`:**
- Register both commands in the `collect_commands!` list alongside the
  existing `commands::audio::*` entries.

**Bindings regen:** specta picks them up on next `bun run tauri dev`.

### 3.2 AudioView wiring

Replace the entire mock body of `src/components/AudioView.tsx`. The
glass-card chrome, header, scroll shadow, info column, footer wave bar
geometry stay identical; the data sources and event handlers swap to
real backend calls.

**State:**
```typescript
type Line = { ts: string; speaker: string; text: string; isPartial?: boolean }
const [isRecording, setIsRecording] = useState(false)
const [transcript, setTranscript] = useState<Line[]>([])
const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
const [recordingStart, setRecordingStart] = useState<number | null>(null)
const [error, setError] = useState<string | null>(null)
```

**Handlers:**
- Mic button click (idle): `await commands.startUiRecording()` →
  `setIsRecording(true)`, `setRecordingStart(Date.now())`.
- Stop button click (recording): `await commands.stopUiRecording()` →
  `setIsRecording(false)`. The transcription stream finalises async;
  `workspace-transcription-synced` confirms write completion.

**Tauri event subscriptions** (mounted via `useEffect`):
- `workspace-node-body-updated` → if `payload.node_id === activeNodeId`,
  parse the body's voice-memo block (text after the most recent
  `::voice_memo_recording{...}` directive) and append a `Line` at the
  bottom (replace if `isPartial`). Throttled server-side at ~1s.
- `workspace-transcription-synced` (source `voice_memo`) → set
  `activeNodeId = payload.node_id`. Use this to pick up the doc id from
  the very first chunk if user hadn't started recording in this session.
- `recording-error` → `setError(payload.detail)`, surface via Sonner
  toast (already mounted in App.tsx). Specifically handle
  `error_type === 'microphone_permission_denied'` with a CTA to open
  Settings.

**Rule 9 compliance** — the existing Rust pipeline (already in
`actions.rs` `process_transcription_output` + `transcription_workspace`)
writes the voice-memo doc per Rule 9 verbatim:
- ISO title `Voice Memos — YYYY-MM-DD`
- Under "Mic Transcribe" folder
- `::voice_memo_recording{...}` directive + transcript
- `voice_session_manager.set_workspace_doc_id(...)` tracks active doc
- `migrate_legacy_voice_memo_title` handles legacy non-ISO titles
This is **untouched**. Reusing `TranscribeAction::start/stop` means we
inherit Rule 9 for free.

### 3.3 Cosmetic decisions for AudioView

- Drop the mock "AI Insight" panel content; render it as an empty
  panel with copy "AI insights land in W6" — keeps the layout grid
  intact without lying about features.
- Drop the mock device-diagnostics fixed strings; leave the panel with
  real values where backend exposes them
  (`getSelectedMicrophone()` for the mic name) and "—" for unknown.
- Waveform animation stays cosmetic — no real audio level meter (would
  require a new event from the recording manager; deferred).
- Header status text: "Recording…" / "Idle"; drop the mock "Neural
  Intelligence" copy.

### 3.4 Verification (W1)

- [ ] `cargo test --lib` — green (no new Rust tests required; the new
  commands are 3-line wrappers)
- [ ] `bun run build` — green
- [ ] `bunx vitest run` — green
- [ ] `bun run tauri dev`:
  - Click mic in AudioView → tray icon flips to recording
  - Speak → live partial lines appear in transcript area within ~1s
  - Click stop → final line appears, `workspace-transcription-synced` toast/log
  - Open Notes (when wired in W2) → "Mic Transcribe" folder exists,
    today's doc has the directive + transcript appended
  - Repeat: second recording in the same minute appends to the same
    daily doc
- [ ] Mic-denied path: revoke permission → click record → toast appears,
  no crash

---

## 4. Risks

1. **Synthetic binding_id collisions.** `TranscribeAction` uses
   `binding_id` for the `register_cancel_shortcut` keymap and history
   entry tagging. Using a fixed string `"ui-mic"` should be safe (it's
   just a string identifier the manager round-trips), but verify during
   impl that no part of the pipeline rejects an unknown binding id.
   Mitigation: add the binding id to the bindings registry as a
   "virtual" entry if rejection occurs.

2. **Concurrent recording.** A user could press their global shortcut
   while UI recording is active (or vice versa). Existing
   `try_start_recording` already returns an error if already recording;
   AudioView surfaces it via `recording-error` event.

3. **Model download progress event shape.** Verified `model-download-failed`
   exists but `model-download-progress` is not yet confirmed. If the
   event doesn't exist, fall back to polling `get_available_models()`
   every 500ms during active downloads. Both paths produce the same UI.

4. **Vault step copy lying.** D19 explicitly notes the backend doesn't
   wire the user-picked vault yet. Copy must be honest; the design
   reuses D19's exact phrasing to avoid silent UX deception.

5. **macOS permission plugin import failure.** `tauri-plugin-macos-permissions`
   is registered in `lib.rs` (line 960). Frontend dynamic import of
   `tauri-plugin-macos-permissions-api` must handle the case where the
   plugin module fails to load (Linux/Windows) — gracefully skip.

6. **CHECK constraint allows old values.** The migration's CHECK still
   permits `'welcome'` and `'theme'` at the SQL level. A future hand-
   crafted INSERT could write them. Acceptable risk: the typed enum
   gates all writes through Rust, and the legacy-row handler in `get()`
   self-heals on read.

---

## 5. Out of scope (explicit)

- Welcome / theme onboarding steps (deleted from spec)
- AI insight panel real wiring (W6)
- Real audio-level visualisation in AudioView waveform
- System-audio capture toggle in AudioView (backend works; UI lands later)
- Vault-path enforcement in `resolve_vault_root` (separate D19 follow-up)
- Reset-onboarding UI surface in Settings (D16 — separate phase)
- Onboarding tests beyond what already exists (happy path + negative
  cases land with W5 settings work that exercises the same surfaces)

---

## 6. Commit shape

**Commit 1 (W0):**
> `feat(onboarding): spotlight overlay for first-run mic/a11y/models/vault`
- New: `src/components/OnboardingOverlay.tsx`,
  `src/components/OnboardingStep{Mic,Accessibility,Models,Vault}.tsx`,
  `src/styles/onboarding.css`
- Modified: `src/App.tsx` (boot gate), `src/contexts/VaultContext.tsx`
  (additive fields), `src/main.tsx` (CSS import)
- Modified: `src-tauri/src/managers/onboarding.rs` (enum prune,
  legacy-row self-heal, tests updated)
- Generated: `src/bindings.ts`
- Docs: this file + PLAN.md status update

**Commit 2 (W1):**
> `feat(audio): wire AudioView mic to Handy transcription pipeline`
- Modified: `src-tauri/src/actions.rs` (UI-recording trigger helpers)
- Modified: `src-tauri/src/commands/audio.rs` (start/stop_ui_recording
  Tauri commands)
- Modified: `src-tauri/src/lib.rs` (register commands)
- Modified: `src/components/AudioView.tsx` (mock → real wiring)
- Generated: `src/bindings.ts`
- Docs: PLAN.md status update
