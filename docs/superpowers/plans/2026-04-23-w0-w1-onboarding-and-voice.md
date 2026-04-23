# W0 + W1 — Spotlight Onboarding + Voice Transcribe Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [docs/superpowers/specs/2026-04-23-w0-w1-onboarding-and-voice-design.md](../specs/2026-04-23-w0-w1-onboarding-and-voice-design.md)

**Goal:** Land a 4-step spotlight onboarding (W0) and wire AudioView's mic UI to Handy's transcription pipeline (W1) — two clean commits, no behaviour changes to the underlying Rust pipeline.

**Architecture:** Frontend reads/writes Rust's `onboarding_state` table via existing `commands.{get,update,reset}OnboardingState`. Onboarding overlay mounts as a fourth `App.tsx` boot-gate branch. AudioView reuses Handy's existing `TranscribeAction` pipeline through two thin Tauri wrappers — no new transcription behaviour.

**Tech Stack:** React 19 + TypeScript + Vite, Tauri 2 + Rust, sonner toasts, motion/react animations, vanilla CSS (Rule 18), `@tauri-apps/plugin-dialog`, `tauri-plugin-macos-permissions-api` (dynamic import).

---

## File Inventory

**Phase W0 — Onboarding (Commit 1):**

| File | Role | Action |
|------|------|--------|
| `src-tauri/src/managers/onboarding.rs` | OnboardingStep enum + manager | Modify: remove Welcome/Theme variants, add legacy self-heal in get(), update tests, change auto-seed to 'mic' |
| `src/contexts/VaultContext.tsx` | React state adapter | Modify: add onboardingStep, onboardingState, completeStep(), refreshOnboarding() additively |
| `src/styles/onboarding.css` | Onboarding visual styles | Create: spotlight backdrop (no blur), panel motion, progress dots, step transitions |
| `src/main.tsx` | Vite entry | Modify: import onboarding.css |
| `src/components/OnboardingStepFrame.tsx` | Shared step shell | Create: header/footer/progress dot UI shared by all 4 steps |
| `src/components/OnboardingStepMic.tsx` | Mic permission step | Create: macOS plugin / Windows registry / Linux auto-grant paths |
| `src/components/OnboardingStepAccessibility.tsx` | Accessibility step | Create: macOS-only render; auto-skip on Win/Linux |
| `src/components/OnboardingStepModels.tsx` | Models picker + downloader | Create: Whisper picker, bge-small required, weighted progress, retry/skip |
| `src/components/OnboardingStepVault.tsx` | Vault path picker | Create: default path or folder picker, D19-honest copy |
| `src/components/OnboardingOverlay.tsx` | Overlay container + step router | Create: routes between steps based on onboardingStep |
| `src/App.tsx` | Boot gate | Modify: add fourth AnimatePresence branch for onboarding |
| `src/bindings.ts` | Specta-generated TS bindings | Auto-regenerate on `bun run tauri dev` |

**Phase W1 — Voice transcribe (Commit 2):**

| File | Role | Action |
|------|------|--------|
| `src-tauri/src/actions.rs` | Recording action pipeline | Modify: add UI_RECORDING_BINDING_ID const + trigger_ui_recording_{start,stop} pub helpers |
| `src-tauri/src/commands/audio.rs` | Audio Tauri commands | Modify: add start_ui_recording / stop_ui_recording wrappers |
| `src-tauri/src/lib.rs` | Tauri runtime + command registry | Modify: register both new commands in collect_commands! list |
| `src/components/AudioView.tsx` | Voice UI | Replace: swap mock data + mock interval for real backend wiring (mic button, transcript stream, error toast) |
| `src/bindings.ts` | Specta-generated TS bindings | Auto-regenerate |

---

# Phase W0 — Spotlight Onboarding (Commit 1)

## Task W0.1: Prune OnboardingStep enum + legacy-row self-heal

**Files:**
- Modify: `src-tauri/src/managers/onboarding.rs:25-60` (enum + from_str + as_str)
- Modify: `src-tauri/src/managers/onboarding.rs:138-196` (get() — auto-seed + legacy self-heal)
- Modify: `src-tauri/src/managers/onboarding.rs:281-407` (tests)

- [ ] **Step 1: Update the enum to remove Welcome/Theme**

Replace lines 23-60 of `src-tauri/src/managers/onboarding.rs` with:

```rust
/// Phases of the 4-step Spotlight onboarding flow, plus `Done` terminal state.
///
/// String values match the DB CHECK constraint (a permissive superset that
/// also accepts legacy 'welcome'/'theme' values from pre-W0 dev runs — see
/// `get()` for the on-read self-heal). Keep this list and the
/// frontend's discriminated union in lockstep.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum OnboardingStep {
    Mic,
    Accessibility,
    Models,
    Vault,
    Done,
}

impl OnboardingStep {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Mic => "mic",
            Self::Accessibility => "accessibility",
            Self::Models => "models",
            Self::Vault => "vault",
            Self::Done => "done",
        }
    }

    /// Parses a step string. Legacy 'welcome' and 'theme' values from any
    /// pre-W0 dev run are coerced to `Mic` so the frontend never sees a
    /// step it doesn't know how to render. The on-read coercion in `get()`
    /// also patches the row so subsequent reads return 'mic' directly.
    fn from_str(s: &str) -> Result<Self, String> {
        Ok(match s {
            "mic" | "welcome" | "theme" => Self::Mic,
            "accessibility" => Self::Accessibility,
            "models" => Self::Models,
            "vault" => Self::Vault,
            "done" => Self::Done,
            other => return Err(format!("unknown onboarding step: {other}")),
        })
    }
}
```

- [ ] **Step 2: Update get() — auto-seed at 'mic' + legacy self-heal**

Replace the body of `pub async fn get(&self)` (lines 138-196). The `if let Some(...)` block becomes:

```rust
        if let Some((step, mic, acc, models_json, vault, started, completed)) = existing {
            let parsed_step = OnboardingStep::from_str(&step)?;
            // Legacy self-heal: if the row had 'welcome' or 'theme', coerce
            // it to 'mic' (parsed_step already reflects this) AND patch the
            // row in-place so we don't re-coerce on every read.
            if step == "welcome" || step == "theme" {
                conn.execute(
                    "UPDATE onboarding_state SET current_step = 'mic' WHERE id = 1",
                    [],
                )
                .map_err(|e| e.to_string())?;
            }
            return Ok(OnboardingState {
                current_step: parsed_step,
                mic_permission: mic
                    .map(|s| PermissionState::from_str(&s))
                    .transpose()?,
                accessibility_permission: acc
                    .map(|s| PermissionState::from_str(&s))
                    .transpose()?,
                models_downloaded: parse_models(models_json)?,
                vault_root: vault,
                started_at: started,
                completed_at: completed,
            });
        }

        // Row doesn't exist — create it at `mic` and return the seed.
        let now = now_unix();
        conn.execute(
            "INSERT INTO onboarding_state
                (id, current_step, started_at)
             VALUES (1, 'mic', ?1)",
            params![now],
        )
        .map_err(|e| e.to_string())?;

        Ok(OnboardingState {
            current_step: OnboardingStep::Mic,
            mic_permission: None,
            accessibility_permission: None,
            models_downloaded: Vec::new(),
            vault_root: None,
            started_at: now,
            completed_at: None,
        })
```

- [ ] **Step 3: Update existing tests + add legacy self-heal test**

Edit the test module starting at line 280. Replace the `get_on_fresh_install_seeds_welcome_row` test:

```rust
    #[tokio::test]
    async fn get_on_fresh_install_seeds_mic_row() {
        let m = manager();
        let state = m.get().await.expect("get");
        assert_eq!(state.current_step, OnboardingStep::Mic);
        assert!(state.mic_permission.is_none());
        assert!(state.vault_root.is_none());
        assert!(state.completed_at.is_none());
        assert!(state.models_downloaded.is_empty());
        assert!(state.started_at > 0);
    }
```

Update `reset_wipes_row_next_get_reseeds_welcome` to assert `Mic`:

```rust
    #[tokio::test]
    async fn reset_wipes_row_next_get_reseeds_mic() {
        let m = manager();
        let _ = m
            .patch(OnboardingStatePatch {
                current_step: Some(OnboardingStep::Models),
                ..Default::default()
            })
            .await
            .expect("advance");
        m.reset().await.expect("reset");
        let state = m.get().await.expect("reseed");
        assert_eq!(state.current_step, OnboardingStep::Mic);
    }
```

Add a new legacy-row self-heal test after `check_constraint_rejects_unknown_step_on_direct_insert`:

```rust
    #[tokio::test]
    async fn legacy_welcome_row_self_heals_to_mic_on_read() {
        // Simulate a row written by pre-W0 code (when 'welcome' was the seed).
        ensure_vec_extension();
        let conn = fresh_conn();
        conn.execute(
            "INSERT INTO onboarding_state (id, current_step, started_at)
             VALUES (1, 'welcome', 0)",
            [],
        )
        .expect("seed legacy row");
        let m = OnboardingManager::new(Arc::new(Mutex::new(conn)));
        // First read coerces + patches in-place.
        let s1 = m.get().await.expect("first read");
        assert_eq!(s1.current_step, OnboardingStep::Mic);
        // Second read sees 'mic' directly (no coercion needed).
        let s2 = m.get().await.expect("second read");
        assert_eq!(s2.current_step, OnboardingStep::Mic);
    }

    #[tokio::test]
    async fn legacy_theme_row_self_heals_to_mic_on_read() {
        ensure_vec_extension();
        let conn = fresh_conn();
        conn.execute(
            "INSERT INTO onboarding_state (id, current_step, started_at)
             VALUES (1, 'theme', 0)",
            [],
        )
        .expect("seed legacy theme row");
        let m = OnboardingManager::new(Arc::new(Mutex::new(conn)));
        let s = m.get().await.expect("read");
        assert_eq!(s.current_step, OnboardingStep::Mic);
    }
```

- [ ] **Step 4: Run Rust tests to verify**

Run from the worktree root:
```bash
cd src-tauri && cargo test --lib --no-default-features onboarding -- --nocapture
```

Expected: all 6 onboarding tests pass (4 existing renamed + 2 new). If features matter, drop `--no-default-features`. If specific test runner errors, run `cargo test --lib onboarding`.

- [ ] **Step 5: Commit (intermediate — Rust prune only)**

```bash
git add src-tauri/src/managers/onboarding.rs
git commit -m "refactor(onboarding): prune OnboardingStep to mic/accessibility/models/vault/done

W0 drops Welcome and Theme. Pre-W0 dev rows with 'welcome' or 'theme'
self-heal to 'mic' on read and patch the row in-place. Auto-seed now
plants 'mic' instead of 'welcome'. CHECK constraint left permissive
(no migration cost; typed enum gates writes).

Spec: docs/superpowers/specs/2026-04-23-w0-w1-onboarding-and-voice-design.md"
```

(Intermediate commit; the bigger W0 commit happens after the frontend lands. This Rust-only commit keeps the Rust change reviewable in isolation.)

---

## Task W0.2: Regenerate bindings.ts

The dev server regenerates `src/bindings.ts` on launch via specta.

- [ ] **Step 1: Launch dev server long enough to regen bindings**

Run from the worktree root:
```bash
bun run tauri dev
```

Wait until you see "Compiled successfully" / app window opens. Then quit (Ctrl+C). The regen happens in the first ~5 seconds of the run; you don't need a full successful boot.

- [ ] **Step 2: Verify the binding now reflects the pruned enum**

```bash
grep -n "OnboardingStep" src/bindings.ts
```

Expected output: a `type OnboardingStep` declaration containing `"mic" | "accessibility" | "models" | "vault" | "done"` — no `"welcome"` or `"theme"`.

If the type still shows the old values, run `bun run tauri dev` again. If it persists, check that the cargo build actually succeeded.

- [ ] **Step 3: Stage but do not commit yet**

The bindings.ts change is part of commit 1 (W0 frontend lands together with the Rust enum prune in the user-facing commit).

```bash
git add src/bindings.ts
```

---

## Task W0.3: Extend VaultContext with onboarding fields (additive only)

**Files:**
- Modify: `src/contexts/VaultContext.tsx:38-65` (interface), throughout the body

- [ ] **Step 1: Import the bindings types**

Add at the top of `src/contexts/VaultContext.tsx`, alongside the existing type imports:

```typescript
import { commands, type OnboardingState, type OnboardingStep, type OnboardingStatePatch } from '../bindings'
```

- [ ] **Step 2: Extend the interface (additive)**

Modify `interface VaultContextType` (line 38) to include the four new members at the end:

```typescript
interface VaultContextType {
  isLocked: boolean
  isBooting: boolean
  vaultData: VaultData | null
  envelope: VaultEnvelope | null
  error: string | null
  unlock: (password: string) => Promise<boolean>
  lock: () => Promise<void>
  updateVaultData: (newData: VaultData) => void
  queueAction: (accountId: string, actionType: string, payload: any) => Promise<void>
  storeMedia: (
    accountId: string,
    conversationId: string,
    fileName: string,
    mimeType: string,
    data: string,
    thumbnail?: string,
  ) => Promise<void>
  storeEvidence: (
    accountId: string,
    orderId: string | null,
    fileName: string,
    mimeType: string,
    data: string,
    notes?: string,
  ) => Promise<void>
  updateUiPreferences: (preferences: UiPreferences) => Promise<void>
  // Onboarding (W0) — additive. Null while initial state loads from Rust.
  onboardingStep: OnboardingStep | null
  onboardingState: OnboardingState | null
  completeStep: (patch: OnboardingStatePatch) => Promise<void>
  refreshOnboarding: () => Promise<void>
}
```

- [ ] **Step 3: Add state + loader inside `VaultProvider`**

Inside `VaultProvider` (around line 189), after `const [error, setError] = useState<string | null>(null)`, add:

```typescript
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null)
  const onboardingStep = onboardingState?.current_step ?? null

  const refreshOnboarding = useCallback(async () => {
    const result = await commands.getOnboardingState()
    if (result.status === 'ok') {
      setOnboardingState(result.data)
    } else {
      console.error('[VaultContext] getOnboardingState failed:', result.error)
    }
  }, [])

  const completeStep = useCallback(async (patch: OnboardingStatePatch) => {
    const result = await commands.updateOnboardingState(patch)
    if (result.status === 'ok') {
      setOnboardingState(result.data)
    } else {
      console.error('[VaultContext] updateOnboardingState failed:', result.error)
      throw new Error(result.error)
    }
  }, [])

  // Load initial onboarding state once on mount. Runs in parallel with the
  // 2.5s boot timer; whichever finishes last is fine — overlay won't mount
  // until both isBooting=false and onboardingStep!==null.
  useEffect(() => {
    void refreshOnboarding()
  }, [refreshOnboarding])
```

- [ ] **Step 4: Wire new fields into the value object + memo deps**

Modify the `value` `useMemo` (around line 271) to include the new fields:

```typescript
  const value = useMemo<VaultContextType>(
    () => ({
      isLocked,
      isBooting,
      vaultData,
      envelope: null,
      error,
      unlock,
      lock,
      updateVaultData,
      queueAction,
      storeMedia,
      storeEvidence,
      updateUiPreferences,
      onboardingStep,
      onboardingState,
      completeStep,
      refreshOnboarding,
    }),
    [
      isLocked,
      isBooting,
      vaultData,
      error,
      unlock,
      lock,
      updateVaultData,
      queueAction,
      storeMedia,
      storeEvidence,
      updateUiPreferences,
      onboardingStep,
      onboardingState,
      completeStep,
      refreshOnboarding,
    ],
  )
```

- [ ] **Step 5: Verify it compiles**

```bash
bun run build
```

Expected: build completes (vite path). TypeScript strict errors elsewhere are pre-existing per CLAUDE.md note.

---

## Task W0.4: Create onboarding.css concern file

**Files:**
- Create: `src/styles/onboarding.css`
- Modify: `src/main.tsx`

- [ ] **Step 1: Create the concern file**

Create `src/styles/onboarding.css` with the following contents:

```css
/* W0 — Onboarding overlay styles.
 *
 * Per Rule 18: vanilla CSS, prefixed class names, no raw colors/spacing
 * literals (use HerOS tokens).
 *
 * Per spec §2.2: NO backdrop blur — atmospheric blob layer remains
 * visible through the overlay. Dimmer is a soft radial vignette only.
 */

.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 15000; /* above AppShell (zIndex 10), below SpotlightOverlay (20000) */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  /* Soft radial dimmer over the blobs. NO blur. */
  background: radial-gradient(circle at center, rgba(0, 0, 0, 0.18) 0%, rgba(0, 0, 0, 0.42) 100%);
  pointer-events: auto;
}

.onboarding-panel {
  width: 100%;
  max-width: 640px;
  border-radius: 24px;
  overflow: hidden;
  position: relative;
  /* Use the existing glass-card class for fill/stroke consistency. */
}

.onboarding-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px 28px 18px 28px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.onboarding-icon-badge {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--heros-brand);
  flex-shrink: 0;
}

.onboarding-title {
  flex: 1;
  font-size: 17px;
  font-weight: 600;
  color: #fff;
  margin: 0;
  letter-spacing: -0.01em;
}

.onboarding-step-counter {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.4);
}

.onboarding-body {
  padding: 28px;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 14px;
  line-height: 1.6;
}

.onboarding-body p {
  margin: 0;
}

.onboarding-body .onboarding-muted {
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
}

.onboarding-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 28px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(0, 0, 0, 0.12);
}

.onboarding-dots {
  display: flex;
  gap: 6px;
}

.onboarding-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  transition: background 0.2s ease, transform 0.2s ease;
}

.onboarding-dot--active {
  background: var(--heros-brand);
  transform: scale(1.2);
}

.onboarding-dot--complete {
  background: rgba(255, 255, 255, 0.4);
}

.onboarding-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

/* Inline error / warning banner reused by mic + models steps. */
.onboarding-banner {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
}

.onboarding-banner--warn {
  background: rgba(204, 76, 43, 0.12);
  border: 1px solid rgba(204, 76, 43, 0.3);
  color: rgba(255, 220, 210, 0.95);
}

.onboarding-banner--info {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.75);
}

/* Models step — per-file progress rows. */
.onboarding-progress-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  align-items: center;
}

.onboarding-progress-row__bar {
  grid-column: 1 / -1;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.onboarding-progress-row__bar-fill {
  height: 100%;
  background: var(--heros-brand);
  transition: width 0.3s ease;
}

/* Whisper picker radio rows. */
.onboarding-pick-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.onboarding-pick-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.onboarding-pick-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.onboarding-pick-row--active {
  background: rgba(204, 76, 43, 0.12);
  border-color: rgba(204, 76, 43, 0.4);
}

.onboarding-pick-row__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.onboarding-pick-row__label {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}

.onboarding-pick-row__sub {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}
```

- [ ] **Step 2: Wire the import**

In `src/main.tsx`, add the CSS import alongside `app.css`:

```typescript
import './app.css'
import './styles/onboarding.css'
```

(Adjust ordering as needed — onboarding styles should come AFTER `app.css` so token vars are defined before consumption.)

- [ ] **Step 3: Verify it compiles**

```bash
bun run build
```

Expected: green.

---

## Task W0.5: Build the OnboardingStepFrame shared shell

**Files:**
- Create: `src/components/OnboardingStepFrame.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/OnboardingStepFrame.tsx`:

```tsx
import React, { type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowRight } from 'lucide-react'
import { HerOSButton } from './HerOS'

export const ONBOARDING_TOTAL_STEPS = 4

interface Props {
  stepIndex: number // 1-based: 1, 2, 3, 4
  icon: ReactNode
  title: string
  /** Disable the Continue button when the step isn't ready (e.g. waiting for permission). */
  canContinue: boolean
  /** Continue label (default "Continue"). */
  continueLabel?: string
  /** Show a Skip button to the left of Continue. */
  onSkip?: () => void
  skipLabel?: string
  onContinue: () => void
  children: ReactNode
}

export function OnboardingStepFrame({
  stepIndex,
  icon,
  title,
  canContinue,
  continueLabel = 'Continue',
  onSkip,
  skipLabel = 'Skip',
  onContinue,
  children,
}: Props) {
  return (
    <motion.div
      key={stepIndex}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="heros-glass-card onboarding-panel"
    >
      <header className="onboarding-header">
        <div className="onboarding-icon-badge">{icon}</div>
        <h2 className="onboarding-title">{title}</h2>
        <span className="onboarding-step-counter">
          {stepIndex} of {ONBOARDING_TOTAL_STEPS}
        </span>
      </header>

      <div className="onboarding-body">{children}</div>

      <footer className="onboarding-footer">
        <div className="onboarding-dots" aria-hidden>
          {Array.from({ length: ONBOARDING_TOTAL_STEPS }).map((_, i) => {
            const idx = i + 1
            const className =
              idx === stepIndex
                ? 'onboarding-dot onboarding-dot--active'
                : idx < stepIndex
                ? 'onboarding-dot onboarding-dot--complete'
                : 'onboarding-dot'
            return <span key={i} className={className} />
          })}
        </div>
        <div className="onboarding-actions">
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.55)',
                fontSize: 13,
                cursor: 'pointer',
                padding: '8px 12px',
              }}
            >
              {skipLabel}
            </button>
          )}
          <HerOSButton
            onClick={onContinue}
            disabled={!canContinue}
            icon={<ArrowRight size={16} />}
            style={{ minWidth: 120 }}
          >
            {continueLabel}
          </HerOSButton>
        </div>
      </footer>
    </motion.div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
bun run build
```

Expected: green.

---

## Task W0.6: Build OnboardingStepMic

**Files:**
- Create: `src/components/OnboardingStepMic.tsx`

- [ ] **Step 1: Write the step component**

Create `src/components/OnboardingStepMic.tsx`:

```tsx
import React, { useEffect, useState } from 'react'
import { Mic, AlertTriangle } from 'lucide-react'
import { commands } from '../bindings'
import { useVault } from '../contexts/VaultContext'
import { OnboardingStepFrame } from './OnboardingStepFrame'
import { HerOSButton } from './HerOS'

type Status = 'unknown' | 'granted' | 'denied' | 'requesting' | 'opened-settings'

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
const isWin = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win')

export function OnboardingStepMic() {
  const { completeStep } = useVault()
  const [status, setStatus] = useState<Status>('unknown')
  const [busy, setBusy] = useState(false)

  // Initial check on mount + on focus (so flipping permission in the OS
  // settings reflects when the user returns to Infield).
  useEffect(() => {
    const check = async () => {
      if (isMac) {
        try {
          const mod: any = await import('tauri-plugin-macos-permissions-api')
          const granted = await mod.checkMicrophonePermission()
          setStatus(granted ? 'granted' : 'denied')
        } catch {
          // Plugin not available — treat as granted to avoid a hard block.
          setStatus('granted')
        }
      } else if (isWin) {
        const result = await commands.getWindowsMicrophonePermissionStatus()
        setStatus(result.overall_access === 'allowed' ? 'granted' : 'denied')
      } else {
        // Linux — assume granted; cpal will surface a clean error at record time.
        setStatus('granted')
      }
    }
    void check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])

  const requestPermission = async () => {
    setBusy(true)
    try {
      if (isMac) {
        const mod: any = await import('tauri-plugin-macos-permissions-api')
        await mod.requestMicrophonePermission()
        const granted = await mod.checkMicrophonePermission()
        setStatus(granted ? 'granted' : 'denied')
      } else if (isWin) {
        const result = await commands.openMicrophonePrivacySettings()
        if (result.status === 'ok') {
          setStatus('opened-settings')
        }
      }
    } catch (err) {
      console.error('[OnboardingStepMic] permission request failed:', err)
      setStatus('denied')
    } finally {
      setBusy(false)
    }
  }

  const advance = async (perm: 'granted' | 'denied' | 'skipped') => {
    await completeStep({
      mic_permission: perm,
      current_step: 'accessibility',
    })
  }

  return (
    <OnboardingStepFrame
      stepIndex={1}
      icon={<Mic size={20} />}
      title="Microphone access"
      canContinue={status === 'granted' || status === 'denied' || status === 'opened-settings'}
      continueLabel="Continue"
      onSkip={() => void advance('skipped')}
      skipLabel="Skip"
      onContinue={() => void advance(status === 'granted' ? 'granted' : 'denied')}
    >
      <p>
        Infield records your voice locally to capture transcribed memos. Audio
        never leaves your machine.
      </p>

      {status === 'granted' && (
        <div className="onboarding-banner onboarding-banner--info">
          Microphone access is enabled.
        </div>
      )}

      {status === 'denied' && (
        <div className="onboarding-banner onboarding-banner--warn">
          <AlertTriangle size={14} /> Permission denied. You can enable it later
          in Settings, but voice notes won't work until then.
        </div>
      )}

      {status === 'opened-settings' && (
        <div className="onboarding-banner onboarding-banner--info">
          Settings opened. After granting permission, return here and continue.
        </div>
      )}

      {(status === 'unknown' || status === 'denied' || status === 'opened-settings') && (
        <div>
          <HerOSButton onClick={() => void requestPermission()} loading={busy} disabled={busy}>
            {isMac ? 'Allow microphone' : 'Open Windows settings'}
          </HerOSButton>
        </div>
      )}
    </OnboardingStepFrame>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
bun run build
```

Expected: green. (If `tauri-plugin-macos-permissions-api` import is flagged unresolved, add `// @ts-ignore` above the dynamic import — it's loaded only at runtime on macOS.)

---

## Task W0.7: Build OnboardingStepAccessibility

**Files:**
- Create: `src/components/OnboardingStepAccessibility.tsx`

- [ ] **Step 1: Write the step component**

Create `src/components/OnboardingStepAccessibility.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react'
import { Shield } from 'lucide-react'
import { useVault } from '../contexts/VaultContext'
import { OnboardingStepFrame } from './OnboardingStepFrame'
import { HerOSButton } from './HerOS'

type Status = 'unknown' | 'granted' | 'denied' | 'requesting'

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

export function OnboardingStepAccessibility() {
  const { completeStep } = useVault()
  const [status, setStatus] = useState<Status>('unknown')
  const [busy, setBusy] = useState(false)
  // Guard so the auto-skip on non-mac runs exactly once even under StrictMode.
  const autoSkipped = useRef(false)

  // Non-macOS: auto-skip on mount.
  useEffect(() => {
    if (isMac) return
    if (autoSkipped.current) return
    autoSkipped.current = true
    void completeStep({
      accessibility_permission: 'not_applicable',
      current_step: 'models',
    })
  }, [completeStep])

  // macOS: poll on mount + on window focus.
  useEffect(() => {
    if (!isMac) return
    const check = async () => {
      try {
        const mod: any = await import('tauri-plugin-macos-permissions-api')
        const granted = await mod.checkAccessibilityPermission()
        setStatus(granted ? 'granted' : 'denied')
      } catch {
        setStatus('granted') // Plugin missing — don't block.
      }
    }
    void check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])

  if (!isMac) {
    // Render nothing while the auto-skip resolves; the overlay swaps in
    // OnboardingStepModels on the next tick.
    return null
  }

  const requestPermission = async () => {
    setBusy(true)
    try {
      const mod: any = await import('tauri-plugin-macos-permissions-api')
      await mod.requestAccessibilityPermission()
      const granted = await mod.checkAccessibilityPermission()
      setStatus(granted ? 'granted' : 'denied')
    } catch (err) {
      console.error('[OnboardingStepAccessibility] request failed:', err)
    } finally {
      setBusy(false)
    }
  }

  const advance = async (perm: 'granted' | 'denied' | 'skipped') => {
    await completeStep({
      accessibility_permission: perm,
      current_step: 'models',
    })
  }

  return (
    <OnboardingStepFrame
      stepIndex={2}
      icon={<Shield size={20} />}
      title="Accessibility access"
      canContinue={status !== 'unknown'}
      continueLabel="Continue"
      onSkip={() => void advance('skipped')}
      skipLabel="Skip"
      onContinue={() => void advance(status === 'granted' ? 'granted' : 'denied')}
    >
      <p>
        macOS requires Accessibility access for global keyboard shortcuts (e.g.
        push-to-talk recording). Without it, you can still use the in-app mic
        button — keybindings just won't reach across other apps.
      </p>

      {status === 'granted' && (
        <div className="onboarding-banner onboarding-banner--info">
          Accessibility access is enabled.
        </div>
      )}

      {status === 'denied' && (
        <div className="onboarding-banner onboarding-banner--warn">
          Permission denied. Open System Settings → Privacy & Security →
          Accessibility to enable.
        </div>
      )}

      <div>
        <HerOSButton onClick={() => void requestPermission()} loading={busy} disabled={busy}>
          Open System Settings
        </HerOSButton>
      </div>
    </OnboardingStepFrame>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
bun run build
```

Expected: green.

---

## Task W0.8: Build OnboardingStepModels

**Files:**
- Create: `src/components/OnboardingStepModels.tsx`

- [ ] **Step 1: Write the step component**

Create `src/components/OnboardingStepModels.tsx`:

```tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Download, AlertTriangle } from 'lucide-react'
import { commands, type ModelInfo } from '../bindings'
import { useVault } from '../contexts/VaultContext'
import { OnboardingStepFrame } from './OnboardingStepFrame'
import { HerOSButton } from './HerOS'

const BGE_ID = 'bge-small-en-v1.5'

type DownloadState = 'idle' | 'downloading' | 'done' | 'failed'

interface ModelProgress {
  modelId: string
  state: DownloadState
  pct: number // 0..100
  attempts: number
}

function formatMb(bytes: number | null | undefined): string {
  if (!bytes) return '—'
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

export function OnboardingStepModels() {
  const { completeStep } = useVault()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [whisperPick, setWhisperPick] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, ModelProgress>>({})
  const [error, setError] = useState<string | null>(null)
  const [showSkip, setShowSkip] = useState(false)
  const pollHandle = useRef<number | null>(null)

  // Load model registry once.
  useEffect(() => {
    const load = async () => {
      const result = await commands.getAvailableModels()
      if (result.status !== 'ok') {
        setError(result.error)
        return
      }
      setModels(result.data)
      // Default Whisper pick = recommended transcription model.
      const whispers = result.data.filter(
        (m) =>
          m.is_transcription_model &&
          (m.engine_type as unknown as string) === 'Whisper',
      )
      const recommended = whispers.find((m) => m.is_recommended) ?? whispers[0]
      if (recommended) setWhisperPick(recommended.id)
    }
    void load()
  }, [])

  const whisperOptions = useMemo(
    () =>
      models.filter(
        (m) =>
          m.is_transcription_model &&
          (m.engine_type as unknown as string) === 'Whisper',
      ),
    [models],
  )
  const bge = useMemo(() => models.find((m) => m.id === BGE_ID) ?? null, [models])

  const updateProgress = (modelId: string, patch: Partial<ModelProgress>) => {
    setProgress((prev) => ({
      ...prev,
      [modelId]: {
        modelId,
        state: 'idle',
        pct: 0,
        attempts: 0,
        ...prev[modelId],
        ...patch,
      },
    }))
  }

  // Poll model registry while a download is active. The Rust side updates
  // ModelInfo.is_downloading + is_downloaded; specta event for granular
  // bytes is not guaranteed, so poll-based is the safe path. 500ms keeps
  // the UI lively without spamming.
  const startPolling = () => {
    if (pollHandle.current) return
    pollHandle.current = window.setInterval(async () => {
      const result = await commands.getAvailableModels()
      if (result.status === 'ok') {
        setModels(result.data)
        let activeCount = 0
        for (const m of result.data) {
          if (m.is_downloading) {
            activeCount += 1
            updateProgress(m.id, { state: 'downloading' })
          } else if (m.is_downloaded) {
            updateProgress(m.id, { state: 'done', pct: 100 })
          }
        }
        if (activeCount === 0) {
          if (pollHandle.current) {
            window.clearInterval(pollHandle.current)
            pollHandle.current = null
          }
        }
      }
    }, 500)
  }

  useEffect(() => {
    return () => {
      if (pollHandle.current) window.clearInterval(pollHandle.current)
    }
  }, [])

  const downloadOne = async (modelId: string, attemptsSoFar = 0): Promise<boolean> => {
    updateProgress(modelId, { state: 'downloading', attempts: attemptsSoFar + 1 })
    startPolling()
    const result = await commands.downloadModel(modelId)
    if (result.status === 'ok') {
      updateProgress(modelId, { state: 'done', pct: 100 })
      return true
    }
    // Backoff on failure: 2s → 8s → 32s, max 3 attempts (per D14).
    if (attemptsSoFar < 2) {
      const delayMs = [2000, 8000, 32000][attemptsSoFar]
      updateProgress(modelId, { state: 'failed' })
      await new Promise((r) => setTimeout(r, delayMs))
      return downloadOne(modelId, attemptsSoFar + 1)
    }
    updateProgress(modelId, { state: 'failed' })
    return false
  }

  const beginDownloads = async () => {
    setError(null)
    setShowSkip(false)
    if (!whisperPick) {
      setError('Pick a Whisper model first.')
      return
    }
    // Run both downloads in parallel; they're CPU/network independent.
    const [whisperOk, bgeOk] = await Promise.all([
      downloadOne(whisperPick),
      bge && !bge.is_downloaded ? downloadOne(bge.id) : Promise.resolve(true),
    ])

    if (whisperOk) {
      // Persist active transcription model selection.
      const setRes = await commands.setActiveModel(whisperPick)
      if (setRes.status !== 'ok') {
        console.warn('[OnboardingStepModels] setActiveModel failed:', setRes.error)
      }
    }

    if (whisperOk && bgeOk) {
      const downloaded: string[] = []
      if (whisperOk) downloaded.push(whisperPick)
      if (bgeOk && bge) downloaded.push(bge.id)
      await completeStep({
        models_downloaded: downloaded,
        current_step: 'vault',
      })
    } else {
      setError('Downloads failed after retries. Continue without and configure later in Settings → Models.')
      setShowSkip(true)
    }
  }

  const skipDownloads = async () => {
    const downloaded = Object.values(progress)
      .filter((p) => p.state === 'done')
      .map((p) => p.modelId)
    await completeStep({
      models_downloaded: downloaded,
      current_step: 'vault',
    })
  }

  const allDone =
    whisperPick != null &&
    progress[whisperPick]?.state === 'done' &&
    (bge == null || bge.is_downloaded || progress[bge?.id]?.state === 'done')

  const downloading = Object.values(progress).some((p) => p.state === 'downloading')

  return (
    <OnboardingStepFrame
      stepIndex={3}
      icon={<Download size={20} />}
      title="Download models"
      canContinue={allDone || showSkip}
      continueLabel={showSkip ? 'Skip and continue' : 'Continue'}
      onContinue={() => (showSkip ? void skipDownloads() : void completeStep({ current_step: 'vault' }))}
    >
      <p>
        Infield needs a transcription model (Whisper) and a semantic-search
        model (bge-small) to work end-to-end. Both run locally on your machine.
      </p>

      <div>
        <div className="onboarding-muted" style={{ marginBottom: 8 }}>
          Whisper size — bigger is more accurate but slower
        </div>
        <div className="onboarding-pick-list">
          {whisperOptions.map((m) => {
            const active = whisperPick === m.id
            return (
              <div
                key={m.id}
                className={
                  active ? 'onboarding-pick-row onboarding-pick-row--active' : 'onboarding-pick-row'
                }
                onClick={() => setWhisperPick(m.id)}
                role="radio"
                aria-checked={active}
                tabIndex={0}
              >
                <div className="onboarding-pick-row__main">
                  <span className="onboarding-pick-row__label">
                    {m.name}
                    {m.is_recommended && (
                      <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--heros-brand)' }}>
                        RECOMMENDED
                      </span>
                    )}
                  </span>
                  <span className="onboarding-pick-row__sub">
                    {formatMb(m.size_bytes)} · {m.is_downloaded ? 'Already downloaded' : 'Not downloaded'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {bge && (
        <div className="onboarding-progress-row">
          <span>Semantic search · {bge.name} (required)</span>
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>
            {bge.is_downloaded ? 'Already downloaded' : formatMb(bge.size_bytes)}
          </span>
          <div className="onboarding-progress-row__bar">
            <div
              className="onboarding-progress-row__bar-fill"
              style={{
                width: `${
                  bge.is_downloaded ? 100 : progress[bge.id]?.pct ?? 0
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {whisperPick && progress[whisperPick] && (
        <div className="onboarding-progress-row">
          <span>{whisperPick}</span>
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>
            {progress[whisperPick].state === 'done'
              ? 'Done'
              : progress[whisperPick].state === 'downloading'
              ? 'Downloading…'
              : progress[whisperPick].state === 'failed'
              ? `Failed (attempt ${progress[whisperPick].attempts}/3)`
              : 'Idle'}
          </span>
          <div className="onboarding-progress-row__bar">
            <div
              className="onboarding-progress-row__bar-fill"
              style={{ width: `${progress[whisperPick].pct}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="onboarding-banner onboarding-banner--warn">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {!allDone && !downloading && (
        <div>
          <HerOSButton onClick={() => void beginDownloads()} disabled={!whisperPick}>
            Download
          </HerOSButton>
        </div>
      )}
    </OnboardingStepFrame>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
bun run build
```

Expected: green. If `engine_type` typing rejects the cast, change `(m.engine_type as unknown as string) === 'Whisper'` to match whatever shape `bindings.ts` declares (it's likely an enum-string).

---

## Task W0.9: Build OnboardingStepVault

**Files:**
- Create: `src/components/OnboardingStepVault.tsx`

- [ ] **Step 1: Write the step component**

Create `src/components/OnboardingStepVault.tsx`:

```tsx
import React, { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { useVault } from '../contexts/VaultContext'
import { OnboardingStepFrame } from './OnboardingStepFrame'
import { HerOSButton } from './HerOS'

const DEFAULT_VAULT_LABEL = '~/Documents/Infield'

export function OnboardingStepVault() {
  const { completeStep } = useVault()
  const [chosenPath, setChosenPath] = useState<string | null>(null)

  const pickFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const result = (await open({
        directory: true,
        multiple: false,
        title: 'Pick vault folder',
      })) as string | null
      if (result) setChosenPath(result)
    } catch (err) {
      console.error('[OnboardingStepVault] folder pick failed:', err)
    }
  }

  const finish = async () => {
    const now = Math.floor(Date.now() / 1000)
    await completeStep({
      vault_root: chosenPath ?? DEFAULT_VAULT_LABEL,
      current_step: 'done',
      completed_at: now,
    })
  }

  return (
    <OnboardingStepFrame
      stepIndex={4}
      icon={<FolderOpen size={20} />}
      title="Vault location"
      canContinue
      continueLabel="Finish setup"
      onContinue={() => void finish()}
    >
      <p>
        Infield will store your markdown notes at{' '}
        <strong style={{ color: '#fff' }}>{chosenPath ?? DEFAULT_VAULT_LABEL}</strong>.
        Custom locations land in a future release — your choice is saved now so it
        applies automatically once the integration ships.
      </p>

      <div>
        <HerOSButton onClick={() => void pickFolder()}>Choose a folder…</HerOSButton>
      </div>

      {chosenPath && (
        <div className="onboarding-banner onboarding-banner--info">
          Custom path saved: {chosenPath}
        </div>
      )}
    </OnboardingStepFrame>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
bun run build
```

Expected: green.

---

## Task W0.10: Build the OnboardingOverlay router

**Files:**
- Create: `src/components/OnboardingOverlay.tsx`

- [ ] **Step 1: Write the overlay**

Create `src/components/OnboardingOverlay.tsx`:

```tsx
import React from 'react'
import { AnimatePresence } from 'motion/react'
import { useVault } from '../contexts/VaultContext'
import { OnboardingStepMic } from './OnboardingStepMic'
import { OnboardingStepAccessibility } from './OnboardingStepAccessibility'
import { OnboardingStepModels } from './OnboardingStepModels'
import { OnboardingStepVault } from './OnboardingStepVault'

export function OnboardingOverlay() {
  const { onboardingStep } = useVault()

  if (onboardingStep == null || onboardingStep === 'done') return null

  return (
    <div className="onboarding-overlay">
      {/* Drag region so the user can move the window during onboarding. */}
      <div
        data-tauri-drag-region
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 32 }}
      />
      <AnimatePresence mode="wait">
        {onboardingStep === 'mic' && <OnboardingStepMic key="mic" />}
        {onboardingStep === 'accessibility' && (
          <OnboardingStepAccessibility key="accessibility" />
        )}
        {onboardingStep === 'models' && <OnboardingStepModels key="models" />}
        {onboardingStep === 'vault' && <OnboardingStepVault key="vault" />}
      </AnimatePresence>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
bun run build
```

Expected: green.

---

## Task W0.11: Wire the boot gate in App.tsx

**Files:**
- Modify: `src/App.tsx:24` (add `onboardingStep` to useVault destructure)
- Modify: `src/App.tsx:257-360` (AnimatePresence — insert onboarding branch)
- Modify: `src/App.tsx:16-21` (imports — add OnboardingOverlay)

- [ ] **Step 1: Add the import**

Add to the imports block at the top of `src/App.tsx` (alongside other component imports):

```typescript
import { OnboardingOverlay } from './components/OnboardingOverlay';
```

- [ ] **Step 2: Destructure onboardingStep from useVault**

Change line 24 from:

```typescript
  const { isLocked, isBooting, unlock, error, vaultData, updateUiPreferences } = useVault();
```

to:

```typescript
  const { isLocked, isBooting, unlock, error, vaultData, updateUiPreferences, onboardingStep } = useVault();
```

- [ ] **Step 3: Insert the onboarding branch in AnimatePresence**

In the `AnimatePresence` block (line 257), the current shape is `isBooting ? <LoadingScreen> : isLocked ? <Lock> : <Shell>`. Insert a third condition between `isLocked` and the shell. Replace the `: isLocked ? (...)` ... `) : (` section so that the chain becomes:

`isBooting → LoadingScreen → isLocked → Lock → onboardingStep && onboardingStep !== 'done' → OnboardingOverlay branch → Shell`.

Concretely, find the line:

```typescript
        ) : (
          <motion.div
            key="shell"
```

and replace it with:

```typescript
        ) : (onboardingStep != null && onboardingStep !== 'done') ? (
          <motion.div
            key="onboarding"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            style={{ position: 'absolute', inset: 0, zIndex: 10 }}
          >
            <OnboardingOverlay />
          </motion.div>
        ) : (
          <motion.div
            key="shell"
```

- [ ] **Step 4: Verify it compiles**

```bash
bun run build
```

Expected: green.

---

## Task W0.12: End-to-end manual verification (W0)

- [ ] **Step 1: Reset onboarding state**

In a Rust shell or via `tauri dev`'s console, the easiest path is to delete the workspace.db onboarding row. Quickest manual reset — quit the app, then in Git Bash from the worktree root:

```bash
sqlite3 "$APPDATA/com.handy.app/handy-vault.db" "DELETE FROM onboarding_state;" 2>/dev/null || \
  sqlite3 "$APPDATA/Handy/handy-vault.db" "DELETE FROM onboarding_state;" 2>/dev/null || \
  sqlite3 "$APPDATA/com.handy.dev/workspace.db" "DELETE FROM onboarding_state;" 2>/dev/null || \
  echo "Could not auto-locate workspace.db — find it via 'Open App Data Dir' in Settings and delete onboarding_state row manually"
```

(The exact path depends on Tauri identifier; one of those will work, or use the Settings > Open App Data Dir UI to find it.)

- [ ] **Step 2: Boot the app**

```bash
bun run tauri dev
```

Wait for the LoadingScreen to fade. The Onboarding Mic step should appear over the atmospheric blob background (no blur).

- [ ] **Step 3: Walk all 4 steps**

Click through Mic → Accessibility (auto-skip on Win/Linux) → Models (pick smallest Whisper, hit Download, wait) → Vault (Continue with default).

Expected: AppShell appears after Vault step. Drag bar at top works during onboarding.

- [ ] **Step 4: Regression — Cmd/Ctrl+L still locks**

Press Ctrl+L. The LockOverlay must appear. Cancel by entering any password.

- [ ] **Step 5: Regression — UI scale still works**

Press Ctrl+= / Ctrl+- a few times. Window content should scale via native zoom (Rule 20).

- [ ] **Step 6: Regression — second boot skips onboarding**

Quit and re-launch `bun run tauri dev`. AppShell should appear directly (no overlay) — `current_step === 'done'`.

- [ ] **Step 7: Run vitest + cargo tests**

```bash
bunx vitest run
cd src-tauri && cargo test --lib
cd ..
```

Expected: vitest 9/9 pass, cargo lib tests all green (125+ from Phase A + 6 onboarding).

---

## Task W0.13: Commit W0

- [ ] **Step 1: Stage the W0 files**

```bash
git add src/App.tsx \
  src/contexts/VaultContext.tsx \
  src/main.tsx \
  src/styles/onboarding.css \
  src/components/OnboardingOverlay.tsx \
  src/components/OnboardingStepFrame.tsx \
  src/components/OnboardingStepMic.tsx \
  src/components/OnboardingStepAccessibility.tsx \
  src/components/OnboardingStepModels.tsx \
  src/components/OnboardingStepVault.tsx \
  src/bindings.ts \
  docs/superpowers/specs/2026-04-23-w0-w1-onboarding-and-voice-design.md \
  docs/superpowers/plans/2026-04-23-w0-w1-onboarding-and-voice.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(onboarding): spotlight overlay for first-run mic/a11y/models/vault

W0 — first-run onboarding lands as a 4-step spotlight overlay:
  1. Microphone permission (macOS plugin / Windows registry / Linux auto)
  2. Accessibility permission (macOS only; auto-skip elsewhere per D13)
  3. Models — Whisper picker + bge-small required (3-attempt soft-skip)
  4. Vault location — ~/Documents/Infield default; D19-honest copy

Visual: HerOS glass panel over a soft radial dimmer; NO backdrop blur
so the atmospheric blob layer remains visible (per design call).
Source of truth = Rust onboarding_state table; VaultContext gains
onboardingStep / onboardingState / completeStep / refreshOnboarding
additively. App.tsx grows a fourth boot-gate branch between isLocked
and AppShell.

Backend: OnboardingStep enum prunes Welcome/Theme; legacy rows from
pre-W0 dev runs self-heal to 'mic' on read. CHECK constraint left
permissive (typed enum gates writes).

Spec: docs/superpowers/specs/2026-04-23-w0-w1-onboarding-and-voice-design.md
Plan: docs/superpowers/plans/2026-04-23-w0-w1-onboarding-and-voice.md
EOF
)"
```

- [ ] **Step 3: Verify**

```bash
git log -1 --stat
```

Expected: one commit covering the listed files. Sanity-check the file list matches §6 of the spec.

---

# Phase W1 — Voice Transcribe Wiring (Commit 2)

## Task W1.1: Add UI-recording trigger helpers in actions.rs

**Files:**
- Modify: `src-tauri/src/actions.rs` (add public helpers + const after the existing `TranscribeAction` impl)

- [ ] **Step 1: Add helpers**

After the `impl ShortcutAction for TranscribeAction { ... }` block in `src-tauri/src/actions.rs` (search for the closing `}` of the trait impl that contains `fn stop`), insert:

```rust
/// Synthetic binding id used by UI-initiated recordings (W1).
///
/// The full TranscribeAction pipeline (history, voice-session,
/// cancel-shortcut register/unregister, voice-memo doc append per
/// CLAUDE.md Rule 9) is keyed by `binding_id`. UI recordings re-use
/// the pipeline by passing this fixed id.
pub const UI_RECORDING_BINDING_ID: &str = "ui-mic";

/// Start a UI-initiated mic recording. Reuses TranscribeAction so
/// every behaviour the keybinding path provides — model load, audio
/// feedback, recording overlay, voice-memo doc per Rule 9 — happens
/// identically here.
pub fn trigger_ui_recording_start(app: &AppHandle) {
    let action = TranscribeAction { post_process: false };
    action.start(app, UI_RECORDING_BINDING_ID, "");
}

/// Stop a UI-initiated mic recording started via
/// [`trigger_ui_recording_start`]. Drives the same finalisation path
/// as the keybinding stop.
pub fn trigger_ui_recording_stop(app: &AppHandle) {
    let action = TranscribeAction { post_process: false };
    action.stop(app, UI_RECORDING_BINDING_ID, "");
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd src-tauri && cargo check --lib
```

Expected: green. If `TranscribeAction` is private to a different scope, the helpers should be inserted in the same module so they have visibility — actions.rs is the right module.

---

## Task W1.2: Add start/stop UI recording Tauri commands

**Files:**
- Modify: `src-tauri/src/commands/audio.rs` (append two commands at end of file)

- [ ] **Step 1: Append commands**

At the end of `src-tauri/src/commands/audio.rs`, after the existing `is_recording` command, add:

```rust
/// W1 — UI-initiated mic recording start.
///
/// Drives the same `TranscribeAction` pipeline used by the keybinding
/// path, including voice-memo doc append per CLAUDE.md Rule 9.
#[tauri::command]
#[specta::specta]
pub fn start_ui_recording(app: AppHandle) -> Result<(), String> {
    crate::actions::trigger_ui_recording_start(&app);
    Ok(())
}

/// W1 — UI-initiated mic recording stop. Pairs with
/// [`start_ui_recording`].
#[tauri::command]
#[specta::specta]
pub fn stop_ui_recording(app: AppHandle) -> Result<(), String> {
    crate::actions::trigger_ui_recording_stop(&app);
    Ok(())
}
```

- [ ] **Step 2: Register in lib.rs**

In `src-tauri/src/lib.rs` find the `commands::audio::is_recording,` line (around line 740) and append two new lines after it:

```rust
            commands::audio::is_recording,
            commands::audio::start_ui_recording,
            commands::audio::stop_ui_recording,
```

- [ ] **Step 3: Verify Rust builds**

```bash
cd src-tauri && cargo check --lib
```

Expected: green.

---

## Task W1.3: Regenerate bindings + verify

- [ ] **Step 1: Launch dev server to regen bindings**

```bash
cd .. && bun run tauri dev
```

Wait for the app window to open, then quit (Ctrl+C in the terminal).

- [ ] **Step 2: Verify new bindings present**

```bash
grep -n "startUiRecording\|stopUiRecording" src/bindings.ts
```

Expected: two `async startUiRecording()` and `async stopUiRecording()` entries.

If missing, the cargo build failed silently — re-run `cd src-tauri && cargo build` and inspect.

---

## Task W1.4: Wire AudioView to backend

**Files:**
- Modify: `src/components/AudioView.tsx` (replace mock-data internals with real wiring)

- [ ] **Step 1: Replace AudioView entirely**

Overwrite `src/components/AudioView.tsx` with:

```tsx
import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Mic, Square, Brain, Sparkles, Trash2, Download, Shield } from 'lucide-react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { commands } from '../bindings'
import { ScrollShadow } from './ScrollShadow'

interface Line {
  id: string
  ts: string
  speaker: 'You' | 'System'
  text: string
}

interface BodyUpdatedPayload {
  node_id: string
  body: string
  updated_at: number
}

interface TranscriptionSyncedPayload {
  node_id: string
  source: string
}

interface RecordingErrorPayload {
  error_type: string
  detail: string | null
}

const formatTime = (s: number) => {
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/**
 * Pull the latest voice-memo block from a workspace doc body. The Rust side
 * appends `::voice_memo_recording{...}\n<transcript>` per Rule 9; we surface
 * just the transcript text after the most recent directive line.
 */
function extractLatestTranscript(body: string): string {
  const marker = '::voice_memo_recording'
  const idx = body.lastIndexOf(marker)
  if (idx === -1) return ''
  // Skip past the directive line ({...} closing brace + newline).
  const closeIdx = body.indexOf('}', idx)
  if (closeIdx === -1) return ''
  return body.slice(closeIdx + 1).trimStart()
}

export function AudioView() {
  const [isRecording, setIsRecording] = useState(false)
  const [timer, setTimer] = useState(0)
  const [transcript, setTranscript] = useState<Line[]>([])
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [selectedMic, setSelectedMic] = useState<string>('—')
  const scrollRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<number | null>(null)

  // Timer.
  useEffect(() => {
    let interval: number | undefined
    if (isRecording) {
      interval = window.setInterval(() => setTimer((t) => t + 1), 1000)
    } else {
      setTimer(0)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isRecording])

  // Auto-scroll to bottom on new lines.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [transcript])

  // Load selected mic name once.
  useEffect(() => {
    const load = async () => {
      const result = await commands.getSelectedMicrophone()
      if (result.status === 'ok') setSelectedMic(result.data || 'Default')
    }
    void load()
  }, [])

  // Subscribe to Tauri events for the lifetime of the component.
  useEffect(() => {
    const unlisteners: UnlistenFn[] = []

    const setup = async () => {
      unlisteners.push(
        await listen<BodyUpdatedPayload>('workspace-node-body-updated', (event) => {
          const { node_id, body } = event.payload
          if (activeNodeId && node_id !== activeNodeId) return
          if (!activeNodeId) setActiveNodeId(node_id)
          const text = extractLatestTranscript(body)
          if (!text) return
          setTranscript((prev) => {
            // Replace the live partial line if last is partial-from-this-node, else append.
            const next = prev.filter((l) => l.id !== `live-${node_id}`)
            next.push({
              id: `live-${node_id}`,
              ts: startRef.current ? formatTime(Math.floor((Date.now() - startRef.current) / 1000)) : '00:00',
              speaker: 'You',
              text,
            })
            return next
          })
        }),
      )

      unlisteners.push(
        await listen<TranscriptionSyncedPayload>('workspace-transcription-synced', (event) => {
          if (event.payload.source !== 'voice_memo') return
          setActiveNodeId(event.payload.node_id)
          // Lock in the live partial as a final entry by stripping the live- prefix.
          setTranscript((prev) =>
            prev.map((l) =>
              l.id === `live-${event.payload.node_id}` ? { ...l, id: `final-${Date.now()}` } : l,
            ),
          )
        }),
      )

      unlisteners.push(
        await listen<RecordingErrorPayload>('recording-error', (event) => {
          const { error_type, detail } = event.payload
          if (error_type === 'microphone_permission_denied') {
            toast.error('Microphone permission denied', {
              description: 'Open Settings → Privacy to grant microphone access.',
            })
          } else if (error_type === 'no_input_device') {
            toast.error('No microphone detected', {
              description: 'Connect a microphone and try again.',
            })
          } else {
            toast.error('Recording failed', { description: detail ?? error_type })
          }
          setIsRecording(false)
          startRef.current = null
        }),
      )
    }

    void setup()
    return () => {
      for (const u of unlisteners) u()
    }
  }, [activeNodeId])

  const startRecording = async () => {
    const result = await commands.startUiRecording()
    if (result.status !== 'ok') {
      toast.error('Could not start recording', { description: result.error })
      return
    }
    startRef.current = Date.now()
    setIsRecording(true)
  }

  const stopRecording = async () => {
    const result = await commands.stopUiRecording()
    if (result.status !== 'ok') {
      toast.error('Could not stop recording', { description: result.error })
      return
    }
    setIsRecording(false)
    startRef.current = null
  }

  const clearTranscript = () => {
    setTranscript([])
    setActiveNodeId(null)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', height: '100%', gap: 5 }}>
      {/* Transcript Column */}
      <section
        className="heros-glass-card"
        style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div
          style={{
            padding: '24px 32px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: isRecording ? '#ff4b3e' : 'rgba(255,255,255,0.1)',
                boxShadow: isRecording ? '0 0 16px rgba(255,75,62,0.7)' : 'none',
              }}
            />
            <span
              style={{
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: '#fff',
              }}
            >
              {isRecording ? 'Recording' : 'Idle'}
            </span>
          </div>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: '24px',
              fontWeight: 300,
              color: '#fff',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatTime(timer)}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <ScrollShadow containerRef={scrollRef} style={{ flex: 1, padding: '32px 32px 140px 32px' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 24,
                maxWidth: '800px',
                margin: '0 auto',
              }}
            >
              {transcript.length === 0 && !isRecording && (
                <p style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 64 }}>
                  Press the mic button to start recording. Transcripts append to today's
                  Voice Memos doc.
                </p>
              )}
              {transcript.map((line) => (
                <motion.div
                  key={line.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 20 }}
                >
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      color: 'rgba(255,255,255,0.3)',
                      paddingTop: 4,
                    }}
                  >
                    {line.ts}
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: '10px',
                        fontWeight: 800,
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        color: 'rgba(255,255,255,0.4)',
                        marginBottom: 6,
                      }}
                    >
                      {line.speaker}
                    </div>
                    <div
                      style={{
                        fontSize: '16px',
                        lineHeight: 1.6,
                        fontWeight: 300,
                        color: 'rgba(255,255,255,0.85)',
                      }}
                    >
                      {line.text}
                    </div>
                  </div>
                </motion.div>
              ))}

              {isRecording && transcript.length === 0 && (
                <motion.div
                  animate={{ opacity: [0.3, 0.7, 0.3] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 20 }}
                >
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      color: 'rgba(255,255,255,0.3)',
                      paddingTop: 4,
                    }}
                  >
                    {formatTime(timer)}
                  </div>
                  <div
                    style={{
                      fontSize: '16px',
                      color: 'rgba(255,255,255,0.3)',
                      fontStyle: 'italic',
                    }}
                  >
                    Listening…
                  </div>
                </motion.div>
              )}
            </div>
          </ScrollShadow>

          {/* Floating Controls */}
          <div
            style={{
              position: 'absolute',
              bottom: '32px',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              zIndex: 10,
            }}
          >
            <button
              className="icon-btn"
              style={{ padding: 12, background: 'rgba(255,255,255,0.03)', opacity: 0.5, cursor: 'not-allowed' }}
              disabled
              title="Export — coming in W6"
            >
              <Download size={20} />
            </button>

            <button
              onClick={() => void (isRecording ? stopRecording() : startRecording())}
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: isRecording ? 'var(--heros-brand)' : '#fff',
                color: isRecording ? '#fff' : '#7a2e1a',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: isRecording
                  ? '0 12px 40px rgba(204, 76, 43, 0.4)'
                  : '0 8px 32px rgba(0,0,0,0.25)',
                transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                transform: isRecording ? 'scale(1.1)' : 'scale(1)',
              }}
              className="hover-glow"
              aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            >
              {isRecording ? <Square size={24} fill="currentColor" /> : <Mic size={32} />}
            </button>

            <button
              className="icon-btn"
              onClick={clearTranscript}
              style={{ padding: 12, background: 'rgba(255,255,255,0.03)' }}
              title="Clear visible transcript (does not delete the saved doc)"
            >
              <Trash2 size={20} />
            </button>
          </div>
        </div>
      </section>

      {/* Info Column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <section className="heros-glass-card" style={{ padding: '24px' }}>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 800,
              color: 'rgba(255,255,255,0.3)',
              textTransform: 'uppercase',
              letterSpacing: '0.2em',
              marginBottom: 16,
            }}
          >
            AI Insight
          </div>
          <div
            style={{
              padding: '16px',
              borderRadius: 12,
              background: 'rgba(204, 76, 43, 0.08)',
              border: '1px solid rgba(204, 76, 43, 0.18)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--heros-brand)',
                fontSize: '12px',
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              <Sparkles size={14} /> Coming in W6
            </div>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
              Live insights from the model land once AI chat is wired up.
            </p>
          </div>
        </section>

        <section className="heros-glass-card" style={{ padding: '24px', flex: 1 }}>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 800,
              color: 'rgba(255,255,255,0.3)',
              textTransform: 'uppercase',
              letterSpacing: '0.2em',
              marginBottom: 16,
            }}
          >
            Device
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: 'rgba(255,255,255,0.5)',
              }}
            >
              <span>Microphone</span>
              <span style={{ color: '#fff' }}>{selectedMic}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: 'rgba(255,255,255,0.5)',
              }}
            >
              <span>Storage</span>
              <span
                style={{
                  color: 'var(--success, #fff)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Shield size={12} /> Local vault
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
bun run build
```

Expected: green.

---

## Task W1.5: End-to-end manual verification (W1)

- [ ] **Step 1: Launch the app**

```bash
bun run tauri dev
```

App should boot to AppShell (onboarding already completed in W0).

- [ ] **Step 2: Navigate to Audio**

Click the Audio icon in the IconRail (or however it's named in the rail).

- [ ] **Step 3: Click the mic button**

Expected:
- Mic icon swaps to Square (stop) icon
- Red status dot + "Recording" label in header
- Tray icon flips to recording state (visible if tray is shown)
- Timer ticks
- After ~5 seconds of speech, a partial transcript line appears in the body

- [ ] **Step 4: Click stop**

Expected:
- Square icon swaps back to Mic
- "Idle" label returns
- The final transcript line stays visible (live- prefix swapped to final-)
- Tray icon returns to idle

- [ ] **Step 5: Verify Rule 9 vault doc was created**

Open the vault folder (Settings → Open App Data Dir, or check `~/Documents/Infield` — the directory the user picked in W0). Look under `Mic Transcribe/Voice Memos — YYYY-MM-DD.md`. The file should contain a `::voice_memo_recording{...}` directive followed by the transcript text.

- [ ] **Step 6: Re-record — same daily doc**

Press mic again, speak, stop. Open the same doc — it should now have a SECOND `::voice_memo_recording{...}` block appended. Same file.

- [ ] **Step 7: Permission denied path (optional)**

If on Windows, revoke mic permission in Windows Settings → Privacy → Microphone for desktop apps. Click record. Expected: a Sonner toast "Microphone permission denied" with a CTA to open Settings; recording state stays Idle.

- [ ] **Step 8: Run tests**

```bash
bunx vitest run
cd src-tauri && cargo test --lib
cd ..
```

Expected: green.

- [ ] **Step 9: Regression spot-checks**

- Cmd/Ctrl+L still locks
- Ctrl+= / Ctrl+- still scales the UI (Rule 20)
- Onboarding doesn't reappear

---

## Task W1.6: Commit W1

- [ ] **Step 1: Stage W1 files**

```bash
git add src-tauri/src/actions.rs \
  src-tauri/src/commands/audio.rs \
  src-tauri/src/lib.rs \
  src/components/AudioView.tsx \
  src/bindings.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(audio): wire AudioView mic to Handy transcription pipeline

W1 — AudioView's mic button now drives the same TranscribeAction
pipeline used by global keybindings, including the voice-memo doc
append per CLAUDE.md Rule 9 (ISO title, Mic Transcribe folder,
::voice_memo_recording directive).

Backend: actions.rs gains trigger_ui_recording_{start,stop} pub
helpers + UI_RECORDING_BINDING_ID const. commands/audio.rs exposes
start_ui_recording / stop_ui_recording Tauri wrappers; lib.rs
registers them.

Frontend: AudioView listens for workspace-node-body-updated (live
partials), workspace-transcription-synced (final lock), and
recording-error (permission/no-device toasts). Mock data, mock AI
insight panel, and mock device diagnostics removed; real selectedMic
read from getSelectedMicrophone(). AI Insight panel marked "Coming
in W6" with honest copy.

Spec: docs/superpowers/specs/2026-04-23-w0-w1-onboarding-and-voice-design.md
Plan: docs/superpowers/plans/2026-04-23-w0-w1-onboarding-and-voice.md
EOF
)"
```

- [ ] **Step 3: Verify**

```bash
git log -2 --stat
```

Expected: two commits (W0 then W1) with the file lists matching spec §6.

---

## Self-Review Checklist (writing-plans)

- ✅ **Spec coverage:** Every section in the spec has a task. §2.1 (4 steps) → W0.6-W0.9. §2.2 (UI shape) → W0.4 (CSS) + W0.5 (frame). §2.3 (boot gate) → W0.11. §2.4 (VaultContext) → W0.3. §2.5 (backend) → W0.1. §2.6 (file layout) → File Inventory + W0.5-W0.10. §2.7 (per-step behaviour) → W0.6-W0.9. §2.8 (verification) → W0.12. §3.1 (W1 backend) → W1.1-W1.2. §3.2 (AudioView wiring) → W1.4. §3.3 (cosmetic decisions) → W1.4 (covered inline). §3.4 (verification) → W1.5. §4 (risks) → flagged inline where they affect a step (e.g. binding-id risk in W1.1, model-progress event in W0.8). §6 (commit shape) → W0.13 + W1.6.
- ✅ **No placeholders.** Every code block is complete; no "implement appropriately" or "similar to above".
- ✅ **Type consistency.** `OnboardingStep` is the same shape across Rust + bindings + React. `OnboardingStatePatch.current_step` accepts the snake_case strings. `commands.startUiRecording / stopUiRecording` consistent throughout.
- ✅ **Atomic steps.** Each step is 2-5 minutes of work or a verification command.
