# Entry Experience — Onboarding + Launch

> **Last rewrite:** 2026-04-22 (Phase B kickoff). Supersedes the pre-rebuild draft that referenced Candle + the retired embedding sidecar.
>
> **Context:** Stable rule in [CLAUDE.md → Entry Experience](../../CLAUDE.md#entry-experience-post-phase-b). Phase status in [PLAN.md](../../PLAN.md).

---

## Summary

Infield's launch sequence is a **6-step Apple-style onboarding** plus a persistent launch hydration screen and an optional app-lock page. Google OAuth is **deferred to Phase G** — sign-in moves to Settings → Account; onboarding never asks for a Google account.

```
cold start
   ↓
LoadingScreen  (hydration: lock → SQLite → migrations → ORT load → store hydrate)
   ↓
Onboarding     (only on first launch OR explicit "Reset onboarding")
   ├─ 1. Welcome
   ├─ 2. Theme picker
   ├─ 3. Mic permission
   ├─ 4. Accessibility permission    (macOS only; skipped elsewhere)
   ├─ 5. Models download
   └─ 6. Vault location
   ↓
LoginPage      (only when user has set a passphrase in Settings → Security)
   ↓
AppShell
```

Subsequent launches: `LoadingScreen → LoginPage (if passphrase) → AppShell`. Onboarding is one-shot unless the user resets it.

---

## Stage machine

Owned by `src/entry/EntryContext.tsx`. Extended in Phase B from 3 stages to 4:

| Stage | Render | Exit condition |
|---|---|---|
| `loading` | `LoadingScreen` | Hydration milestones complete **and** `onboardingStep === 'done'` (or not set) |
| `onboarding` | `OnboardingShell` with active step component | User advances through all 6 steps; terminal step sets `onboarding_state.completed_at` |
| `login` | `LoginPage` | Passphrase validates (no-op if passphrase not set) |
| `app` | `AppShell` | — |

**Progress ramp** (LoadingScreen bar) maps to observable hydration signals, not wall-clock:

| % | Signal |
|---|---|
| 0 → 20 | `.handy.lock` acquired, Tauri window mounted |
| 20 → 50 | SQLite open, migrations applied, FTS probe done |
| 50 → 75 | ORT embedding session loaded (via Rule 16 worker thread); Rule 19 reindex check complete |
| 75 → 95 | `workspaceStore.hydrate()` returns |
| 95 → 100 | Stage transition resolves (onboarding vs. login vs. app) |

Minimum wall-clock floor stays at 3000ms (`DEFAULT_MIN_LOADING_MS`) — the lemniscate arc must complete a full cycle.

**Failure handling:** any stage error surfaces inline in the LoadingScreen with a "Retry" button. Never spin forever.

---

## Onboarding steps

Each step is a **full-screen glass panel** over `AtmosphericBackground`. Single primary CTA (`Continue`). Secondary action where applicable (`Skip`, `Grant later`). All copy hardcoded English in Phase B; i18n lift in Phase I (per D6).

### 1. Welcome

Hero panel — Infield wordmark + one-line tagline + `Continue` CTA. **No sign-in CTA.** Google OAuth moved to Phase G (D2a).

**Completion signal:** user clicks `Continue`. Writes `onboarding_state.step = 'theme'`.

### 2. Theme picker

Grid of preset cards (Sovereign Glass default + any others shipped by Phase B). Hover previews by setting `--preset-id` on `:root` transiently; click commits via existing `ThemeProvider.setPreset(id)`. Shows a tiny 3-widget preview panel that reacts live.

**Completion signal:** user clicks `Continue`. Theme selection already persisted via localStorage + Tauri-durable backup (existing `infield:theme:state`).

### 3. Mic permission

Single-sentence rationale + `Grant access` CTA + `Skip` link.

- macOS: invokes the existing `request_microphone_access` Tauri command → OS prompt.
- Windows: call returns granted if not explicitly denied.
- Linux: no-op (PulseAudio/PipeWire handled per-session).

**Skip semantics:** voice memo feature surfaces a "Grant microphone access" nudge in Settings on first use. Not blocking.

**Completion signal:** user clicks `Continue` OR `Skip`. Records granted/skipped state in `onboarding_state.mic_permission`.

### 4. Accessibility permission (macOS only)

Skipped on Windows and Linux — step is not rendered, stage advances silently (D13 locked).

macOS flow: rationale (system audio capture needs it) + `Open System Settings` CTA + `Skip` link. Deep-link to `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`.

**Completion signal:** user clicks `Continue` (even if OS dialog not resolved — app polls the permission at runtime) OR `Skip`.

### 5. Models download

Runs `download_model` for two models **in parallel**:

- **Whisper** — size chosen by user via segmented control (Tiny / Base / Small / Medium). Defaults to `Base`.
- **bge-small-en-v1.5** — required; no user choice.

UI: combined progress bar (weighted by bytes), per-model sub-rows with individual percentages. Each file's sha256 verified against the `ModelInfo` registry entries (populated in Phase A).

**Failure policy (D14 locked — soft skip):**
- Retry with exponential backoff (3 attempts, 2s → 8s → 32s).
- If still failing, show `Skip and set up later in Settings → Models`.
- Semantic search + transcription gracefully degrade; FTS-only remains functional, mic records audio but doesn't auto-transcribe.

**Completion signal:** both downloads complete OR user skips. Records `onboarding_state.models_downloaded = ['whisper-base', 'bge-small-en-v1.5']` or the partial/empty list.

### 6. Vault location

Two CTAs: `Use default` (shows the resolved path) and `Choose a folder…` (opens Tauri dialog). Default path from D15 below.

Post-selection: app validates write permission, creates `<vault>/.handy.lock` as a smoke test, writes the resolved absolute path to `user_preferences.vault_root`, releases the lock (the real acquire happens on next boot).

**Completion signal:** path resolved and writable. Sets `onboarding_state.completed_at = <unix_ts>`, advances to `login` stage.

---

## Persisted state

New table (Phase B migration):

```sql
CREATE TABLE IF NOT EXISTS onboarding_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_step TEXT NOT NULL,           -- 'welcome' | 'theme' | 'mic' | 'accessibility' | 'models' | 'vault' | 'done'
  mic_permission TEXT,                  -- 'granted' | 'denied' | 'skipped' | NULL
  accessibility_permission TEXT,        -- same, or 'not_applicable' on non-macOS
  models_downloaded TEXT,               -- JSON array of model ids
  vault_root TEXT,                      -- absolute path
  started_at INTEGER NOT NULL,
  completed_at INTEGER                  -- NULL until step 6 finishes
);
```

Why a table, not `user_preferences` (D12 locked): (a) clearer shape for partial-completion recovery on crash, (b) auditable history if we later add analytics, (c) isolates onboarding schema churn from the pref-value churn loop.

**Resume semantics:** on boot, if `onboarding_state.completed_at IS NULL` and `current_step != 'welcome'`, `OnboardingShell` mounts directly at the persisted step. User never re-does completed steps.

**Reset (D16 locked):** Settings → Advanced → `Reset onboarding`. `DELETE FROM onboarding_state`; next boot enters onboarding from step 1. The theme, vault, and downloaded models are **not** touched — reset is about the guided flow, not user data.

---

## LoadingScreen integration

`src/entry/LoadingScreen.tsx` is the IRS-ported 3D lemniscate. Phase B changes:

- Replace the existing 5-second mock ramp with the real hydration-signal ramp (table above).
- Accept `progress` prop from `EntryContext`; remove the internal wall-clock timer beyond the 3000ms floor.
- Wire the failure-toast slot — when a stage errors, LoadingScreen dims the orb and surfaces the error + Retry inline.

No visual rework; only wiring.

---

## LoginPage integration

`src/entry/LoginPage.tsx` stays exactly as designed (app-level lock, Argon2id-hashed passphrase in `user_preferences`, vault-file encryption out of scope for v1).

Phase B wiring: resolve `user_preferences.passphrase_hash` after onboarding. Absent → skip LoginPage, jump to AppShell. Present → mount LoginPage; `onUnlock(passphrase)` validates against Argon2id hash.

First-time passphrase setup happens in Settings → Security after onboarding (not during — keeps the 6-step flow distraction-free).

---

## Files touched in Phase B

**New components (flat `src/components/` per IRS convention):**

- `src/components/OnboardingShell.tsx` — owns the step router, reads `onboarding_state`, renders the active step.
- `src/components/OnboardingStepWelcome.tsx`
- `src/components/OnboardingStepTheme.tsx`
- `src/components/OnboardingStepMic.tsx`
- `src/components/OnboardingStepAccessibility.tsx`
- `src/components/OnboardingStepModels.tsx`
- `src/components/OnboardingStepVault.tsx`

**Extended:**

- `src/entry/EntryContext.tsx` — adds `'onboarding'` stage + wiring.
- `src/main.tsx` — stage dispatch renders the right root.
- `src/entry/LoadingScreen.tsx` — real progress wiring.

**Backend:**

- New migration: `onboarding_state` table.
- New Tauri commands in `src-tauri/src/commands/onboarding.rs`:
  - `get_onboarding_state() -> OnboardingState`
  - `update_onboarding_state(patch: OnboardingStatePatch)`
  - `reset_onboarding()`
- Reuse existing: `request_microphone_access`, `download_model`, `cancel_download`, `set_active_model`.

**Styles:**

- Concern-file `src/styles/entry.css` introduced (per D17 — see PLAN.md). Contains the onboarding panel geometry, step transitions, segmented control. Inline `style={}` still used for dynamic state-driven values (Rule 18 §4).
- Token-name reconciliation: `--radius-scale + arithmetic` literals replaced with `--radius-lg` / `--radius-container` per Rule 12's radius hierarchy.

---

## Out of scope for Phase B

- Google OAuth sign-in (Phase G).
- Passphrase setup UI (Settings → Security, post-onboarding).
- Vault encryption at rest (deferred indefinitely per CLAUDE.md).
- i18n of onboarding copy (Phase I sweep).
- Onboarding analytics / telemetry.
