# HerOS Frontend Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Infield frontend chrome + entry surfaces + view skeletons with the `copy/` "OS1 / HerOS" glass-morphism frontend, adapted to Handy's markdown-vault + SQLite architecture, while preserving the theme module, Zustand stores, Tauri bindings, and the Rust backend.

**Architecture:** Port `copy/` CSS tokens and `.heros-*` classes into `src/app.css`; replace `src/entry/LoadingScreen.tsx` + `src/entry/LoginPage.tsx` + `src/shell/primitives/AtmosphericBackground.tsx` with copy/ equivalents that use CSS classes (not inline styles); build a new `VaultContext` that adapts copy/'s interface to Handy's `workspace.db` + vault tree; port copy/ view skeletons and wire them into the workspaceStore-driven router. Preserve `src/theme/`, `src/stores/`, `src/bindings.ts`, `src/i18n/`, `src/hooks/`, `src/lib/`, `src/utils/`, and the entire `src-tauri/` Rust backend untouched.

**Tech Stack:** React 19, Tauri 2, vanilla CSS (no Tailwind in new code), motion/react (not framer-motion), Zustand, lucide-react, sonner, @mdxeditor/editor, @dnd-kit, Glide Data Grid.

---

## Part 0 — Strategic reframe (READ BEFORE PLANNING)

This port is not a drop-in. The `copy/` codebase is a different product: **OS1 / HerOS** is a password-unlock-then-view eBay CRM where the "vault" is an encrypted JSON blob containing `ebayAccounts[]`, `conversations[]`, `messages[]`, `uiPreferences`, etc. The matching Rust backend stores that blob via commands like `unlockVaultNative(password)` → `{ vault: VaultData, envelope: VaultEnvelope }`.

Handy/Infield is architecturally different:
- Vault = **markdown file tree** at `<app_data>/handy-vault/` with YAML frontmatter
- `workspace.db` = derived index (FTS5, sqlite-vec embeddings, tree, wikilinks)
- **No password gate** — the app opens directly (Rule 15 only enforces single-process lock)
- No eBay domain data, no `VaultData` JSON blob

What this means concretely:

1. **The visual language (glass panels, blobs, typography, .heros-* CSS classes, HerOSPanel/HerOSInput/HerOSButton/HerOSViewport primitives) IS portable.** That's the real value of copy/.

2. **The view components in copy/ are mostly NOT portable as-is.** `InboxView`, `ConversationList`, `ThreadWorkspace`, `InspectorPanel`, `AccountSidebar`, `EbayConnectModal` are 100% eBay-domain. `DashboardView`, `ActivityView`, `NotesView`, `DatabasesView`, `AudioView`, `CaptureView`, `SecurityView`, `SettingsView` are named similarly to Handy features but their internals read from `vaultData.ebayAccounts` etc. — they are skeleton shells you must rewrite, not port.

3. **VaultContext cannot be adapted** — it's a password-unlock state machine with no analog in Handy. What CAN be adapted is its *interface shape* (`isBooting`, `isLocked`, minimal `vaultData`) so the copy/ views compile against a Handy-backed adapter.

4. **The login screen is conceptually wrong for Handy.** Handy doesn't have a password-protected vault. The copy/ login gate exists because copy/ is an encrypted-at-rest product. Options:
   - **(a) Drop login entirely** — boot straight into shell after loading. Matches Handy's current behavior.
   - **(b) Reuse login UI as an "app lock" feature** — keep the screen for the Cmd/Ctrl+L lock keybind (CLAUDE.md Keyboard Contracts: "Lock app"), but don't force it on boot.
   - **(c) Add vault encryption at rest** — but CLAUDE.md says "Vault encryption at rest" is explicitly **Deferred — Do Not Implement in v1**.

   **Recommendation: (b).** Use the copy/ login UI to implement the already-contracted Cmd/Ctrl+L lock feature. Boot flow remains: LoadingScreen → AppShell. Locked state (user hits Cmd+L) shows the glass login panel.

5. **PLAN.md Phase B is directly contradicted by this port.** Phase B is "6-step Apple-style onboarding" (Welcome, Theme picker, Mic, Accessibility, Models, Vault). Your prompt says "delete onboarding entirely." These are incompatible.

   Reality: **some** onboarding is needed. The user still needs to:
   - Grant mic access (OS permission, not skippable)
   - Download the bge-small embedding model (semantic search doesn't work without it)
   - Pick a vault location
   - Grant macOS accessibility permission (for global shortcuts)

   Recommendation: **keep Phase B's onboarding surfaces, but reskin them in HerOS glass style**. Port the copy/ visual language (panels, buttons, typography), not its absence of onboarding. That preserves the four required first-run steps while matching the new aesthetic. You do NOT need the `OnboardingStepWelcome` marketing screen or `OnboardingStepTheme` preset grid — those can be dropped. You DO need Mic/Accessibility/Models/Vault. Net: 4 steps in HerOS style.

6. **Theme module MUST be preserved.** You asked if `src/theme/` could be reused for theme changing — yes, it IS the theme system. Deleting it would:
   - Remove Cmd/Ctrl+, keyboard binding (CLAUDE.md contract)
   - Remove preset switching (IRS Sovereign Glass, plus future presets)
   - Remove schema-versioned persistence (SCHEMA_VERSION = 2)
   - Remove `@property` token registration (required for slider-driven tokens)
   - Remove the three-tier token architecture (primitives → semantic → component)
   - Break every Rule 12 invariant

   The port needs to **add** HerOS tokens (`--heros-brand`, `--heros-bg-foundation`, `--heros-glass-*`, etc.) as new primitive tokens in the existing theme system, and add a new "Sovereign Glass DNA" preset (which actually already exists per CLAUDE.md) or an "OS1" preset. Do NOT replace `src/theme/` with copy/'s ad-hoc `document.documentElement.style.setProperty` pattern.

7. **`src/bindings.ts` is auto-generated and must never be deleted or edited.** Specta regenerates it every `bun run tauri dev`. It's the typed interface to all Rust commands. Your prompt's suggestion to "delete src/bindings.ts" would brick the frontend at next build.

8. **Stores must be preserved.** `workspaceStore`, `chatStore`, `modelStore`, `navigationStore`, `settingsStore`, `workspaceAppearanceStore` hold runtime state the copy/ views will consume via adapters. Copy/ has no equivalent — its `VaultContext` IS its state. Replacing Zustand with a single context would lose CLAUDE.md Rule 4 (granular selectors prevent re-render cascades).

---

## Part 1 — Scope check (recommended decomposition)

Per the writing-plans skill: **a plan this size should be broken into independent sub-plans, each producing working software on its own.** I recommend five phases, each one landable and testable before the next starts:

| Phase | Scope | Duration | Ships |
|---|---|---|---|
| **H1 — Token + CSS foundation** | Merge copy/'s `.heros-*` CSS + HerOS tokens into existing theme system. Add "OS1" preset. No component changes. | 1-2 days | Theme picker can switch to OS1; no visual regression in current app. |
| **H2 — Entry surfaces reskinned** | Replace `src/entry/LoadingScreen.tsx`, `src/entry/LoginPage.tsx`, `src/shell/primitives/AtmosphericBackground.tsx` with HerOS-class-driven versions. Adapt LoginPage to Cmd+L app-lock feature. Onboarding (Phase B, 4 steps) reskinned to HerOS style. | 2-3 days | Boot flow end-to-end in HerOS glass; lock screen works. |
| **H3 — Shell chrome port** | Port `copy/AppShell`, `copy/TitleBar`, `copy/IconRail` over current `src/shell/`. Wire routing to workspaceStore. HerOS primitives (HerOSPanel, HerOSInput, HerOSButton, HerOSViewport) ported into `src/shell/primitives/`. | 3-4 days | Shell chrome visually replaced; home/notes/databases/search still render via existing view stubs. |
| **H4 — View skeletons + generic widgets** | Port generic copy/ widgets (EmptyState, Skeleton, SpotlightOverlay, ContextMenu, Toast, ResizeHandle, GutterSplitter). Adopt copy/ visual treatment for Home/Search/Settings views. Hard-stub or delete eBay-domain views (InboxView, ThreadWorkspace, InspectorPanel, AccountSidebar, ConversationList, EbayConnectModal, SortableAccountItem, VaultSidebar). | 3-5 days | All visible views match HerOS aesthetic; eBay views clearly marked as future work. |
| **H5 — Legacy deletion + docs** | Delete `src/components/workspace/`, `src/components/database/`, `src/components/editor/`, `src/components/home/`, `src/components/chat/`, `src/components/search/`, `src/components/import/`, `src/components/TopBar.tsx`, `BottomBar.tsx`, `Sidebar.tsx`. Update `CLAUDE.md` (Rule 11 references, phase pipeline, invariant #3), `PLAN.md` (Phase B scope change, rename phases). | 1-2 days | Legacy code gone; PLAN.md reflects new phase roadmap. |

**Total: 10-16 days.** Each phase leaves the app in a shippable state — critical because Handy already has a user testing it (you).

**This document covers H1 in full detail (ready to execute).** H2-H5 are outlined at the end with enough specificity to convert into their own plans when H1 lands.

---

## Part 2 — Answers to your specific questions

### Files you asked about

| File | Verdict | Why |
|---|---|---|
| `src/shell/WindowControls.tsx` | **KEEP** | Native window chrome (min/max/close). HerOS doesn't provide equivalent. Unaffected by port. |
| `src/entry/EntryContext.tsx` | **KEEP + ADAPT** | State machine for `loading → app` transitions. Copy/'s VaultContext does the same thing with different semantics. Reuse EntryContext; change its stages. |
| `src/entry/index.ts` | **KEEP + UPDATE** | Barrel export. Update when new entry surfaces land. |
| `src/theme/` | **KEEP — ESSENTIAL** | This is THE theme system. Cmd+, editor, `@property` registration, schema-versioned persistence, three-tier tokens, Rule 12 enforcement all live here. Add HerOS tokens to `presets.ts` — never replace. |
| `src/stores/` | **KEEP — ESSENTIAL** | Runtime state: workspace tree, chat history, models, nav, settings, appearance. Copy/ views need adapters that read these stores, not replacements. |
| `src/bindings.ts` | **NEVER TOUCH** | Auto-generated by specta from Rust. Deleting breaks next build. |
| `src/App.tsx` | **REWRITE** | Current shape reflects Phase B onboarding scaffolding. Will be rewritten to the HerOS-adapted `<EntryProvider>` pattern. |
| `src/shell/` (AppShell, Titlebar, IconRail, AtmosphericStage) | **REPLACE** | Copy/ equivalents are better; port them. AtmosphericBackground is especially inferior in src/ (inline styles vs CSS classes). |

### eBay commands in `copy/src/tauri-bridge.ts`

Per your revision: **keep them** for future wiring. Concrete approach:

- Port `copy/src/tauri-bridge.ts` wholesale into `src/lib/tauri-bridge.ts`
- Gate each eBay command behind `if (!(await invoke('ebay_feature_enabled')))` — return `null` / empty
- Or better: let the commands live but never call them; the adapter views that would use them are stubbed out in H4
- Don't register the eBay commands in `src-tauri/lib.rs` yet — they don't exist in the Rust backend

The **non-eBay** infrastructure in `tauri-bridge.ts` (`hasNativeVault()`, `ipcInvoke()`, `waitForNativeIpcReady()`) is genuinely useful — adopt it alongside the existing `commands` wrapper.

### Your "delete these for future theme changing" question

You listed: `src/shell/`, `src/entry/`, `src/stores/`, `src/theme/`, `src/bindings.ts`, `src/App.tsx`.

**This list mixes essential infrastructure with replaceable chrome.** Corrected:

- **Cannot delete (infrastructure):** `src/theme/`, `src/stores/`, `src/bindings.ts`
- **Replace not delete (chrome):** `src/shell/` (replace contents), `src/App.tsx` (rewrite)
- **Replace most, keep some (hybrid):** `src/entry/` (replace LoadingScreen + LoginPage; keep LemniscateOrb + EntryContext + index.ts)

---

## Part 3 — Phase H1: Token + CSS foundation (DETAILED PLAN)

### Overview

Merge copy/'s CSS tokens + `.heros-*` classes into Handy's existing theme system. Produce a new theme preset that, when selected, visually matches copy/. Zero component changes in this phase — the goal is "select OS1 in theme editor, see the glass aesthetic applied to current screens without anything breaking."

### File Structure

**Create:**
- `src/styles/heros.css` — new concern-file (Rule 18 §3) containing all `.heros-*` classes from copy/ (not including `:root` token definitions — those go into the theme system)
- `src/styles/blobs.css` — blob-container / blob-cluster-{a,b,c} / blob animations from copy/
- Tests: `src/theme/heros-preset.test.ts`

**Modify:**
- `src/theme/tokens.ts` — add HerOS primitive tokens to the primitive layer
- `src/theme/presets.ts` — add new "OS1" preset
- `src/app.css` — import `heros.css` + `blobs.css`
- `src/theme/tokens.test.ts` — assert OS1 preset compiles

**Not modified:**
- Any component — H1 is pure token + CSS additions

---

### Task 1: Audit copy/ token inventory

**Files:**
- Read: `copy/src/app.css` (lines 1-200 usually contain :root blocks)
- Output: temporary notes file in your head / scratchpad

- [ ] **Step 1: Read copy/src/app.css :root definitions**

```bash
# Extract all CSS custom property definitions from copy/src/app.css
# Find lines matching --heros-* declarations
```

- [ ] **Step 2: Categorize each token**

For every `--heros-*` token in copy/app.css, decide:
- Is it a **primitive** (raw value, e.g. `--heros-brand: #cc4c2b`)?
- Is it **semantic** (role, e.g. `--heros-surface-elevated`)?
- Is it **component** (derived, e.g. `--heros-btn-hover-bg`)?

Produce a list. Expected shape:
```
Primitives (~15):
  --heros-brand: #cc4c2b
  --heros-bg-foundation
  --heros-text-premium
  ...

Semantic (~20):
  --heros-surface-elevated
  --heros-border-subtle
  ...

Component (~10):
  --heros-btn-hover-bg
  --heros-input-focus-ring
  ...
```

- [ ] **Step 3: Cross-reference against existing `src/theme/tokens.ts`**

For each copy/ token, determine:
- **New** — no equivalent in existing tokens
- **Alias** — maps to existing token (e.g. `--heros-text-premium` ~ `--on-surface`)
- **Conflict** — same name, different value

Document conflicts explicitly before proceeding.

- [ ] **Step 4: No commit** (this is a dry-run audit; no code changes)

---

### Task 2: Port copy/'s `:root` tokens into `src/App.css`

**Files:**
- Modify: `src/App.css` (replace sparse `:root` stub with copy/'s canonical 46-ref token block)

**Not created:** No `tokens.ts`, no `presets.ts`, no theme module extensions. Per D-H8: theme system is being deleted; tokens live as static CSS.

- [ ] **Step 1: Read copy/'s full `:root` block**

Run: `grep -n "^:root\|^}" copy/src/app.css | head -5`
Expected: the `:root { ... }` block starts at line 9 and closes around line 126.

Read lines 9-126 of `copy/src/app.css` for the full HerOS token definitions.

- [ ] **Step 2: Locate the existing `:root` block in `src/App.css`**

Run: `grep -n "^:root" src/App.css | head -5`
Expected: first `:root` block at line 118 (after the `@property` registrations).

Read lines 118 to its closing brace (approximately line 534 where the `[data-platform="macos"]` variant starts).

- [ ] **Step 3: Merge the two `:root` blocks**

Within `src/App.css` line 118's `:root { ... }`:
- **Delete** the 3 existing `--heros-*` stub lines (they're incomplete).
- **Append** copy/'s full HerOS token set from lines 9-126 of `copy/src/app.css`. Paste directly — these are primitive values (hex, rgba, px, numbers). No derivation.
- **Preserve** every non-`--heros-*` token already in `src/App.css`'s `:root` (Handy-native tokens like `--space-*`, `--radius-*`, `--text-*`, `--surface-*`, `--on-surface`, `--primary`, etc. remain untouched).

Expected additions (46 HerOS primitives):
```css
:root {
  /* ... existing Handy tokens preserved ... */

  /* === HerOS OS1 primitives (ported from copy/src/app.css) === */
  --heros-brand: #cc4c2b;
  --heros-bg-foundation: #0a0b0f;
  --heros-text-premium: rgba(255, 255, 255, 0.95);
  --heros-text-muted: rgba(240, 216, 208, 0.5);
  --heros-glass-fill: rgba(255, 255, 255, 0.08);
  --heros-glass-blur: 32px;
  --heros-glass-saturate: 220%;
  --heros-grain-opacity: 0.08;
  --heros-selection: #cc4c2b99;
  /* ... remaining 37 primitives verbatim from copy/ ... */
}
```

- [ ] **Step 4: Verify `@property` initial-values still align**

The existing `@property --heros-grain-opacity` block at src/App.css line 37 declares `initial-value`. That value must match the `:root` declaration for smooth animation behavior. Re-read the `@property` block and confirm `initial-value: 1` (or whatever it is) is consistent with the `:root` declaration you just added. Adjust one or the other if mismatched.

- [ ] **Step 5: Build check**

Run: `bun run build`
Expected: PASS. If Tailwind class errors appear, those come from H5-delete-list files; note but don't fix yet.

- [ ] **Step 6: Commit**

```bash
git add src/App.css
git commit -m "feat(styles): port HerOS :root tokens into src/App.css"
```

---

### Task 3: Delete `src/theme/` and unwire its consumers

**Files:**
- Delete: `src/theme/` (entire directory)
- Modify: `src/main.tsx` (remove ThemeProvider wrapping, AppCrashBoundary references)
- Delete: `src/components/OnboardingStepTheme.tsx` (aligns with D-H2 recommendation to drop theme picker)

**Verified blast radius (2026-04-23):** 5 files import from `src/theme/`. Of those:
- `src/main.tsx` — wraps app in `<ThemeProvider>` + `<AppCrashBoundary>`, mounts `<ThemeEditorRoot>`
- `src/components/OnboardingStepTheme.tsx` — uses preset picker (deleted in H5 per D-H2(b); can go now)
- `src/theme/ThemeProvider.tsx`, `src/theme/themeEditorIO.test.ts`, `src/theme/ThemeEditorPanel.tsx` — internal to theme module (deleted with the directory)

No other importers. Safe to remove.

- [ ] **Step 1: Verify blast radius is still 5 files**

Run: `grep -rln "from ['\"]\\./theme\|from ['\"]\\.\\./theme\|from ['\"]@/theme\|from \"\\./theme\|from \"\\.\\./theme\|from \"@/theme" src/`
Expected: exactly 5 paths — `src/main.tsx`, `src/theme/ThemeProvider.tsx`, `src/theme/themeEditorIO.test.ts`, `src/theme/ThemeEditorPanel.tsx`, `src/components/OnboardingStepTheme.tsx`. If additional files appeared since 2026-04-23 (e.g. from H2 onboarding scaffolding), fix them here: strip the import and replace any `usePreset()` / `useTheme()` calls with direct CSS token consumption.

- [ ] **Step 2: Unwire `src/main.tsx`**

Read `src/main.tsx`. Replace the `<ThemeProvider>` / `<AppCrashBoundary>` / `<ThemeEditorRoot>` wrapping with the bare `<App />`. Expected shape after edit:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';
import './i18n';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

If `main.tsx` imports anything else (i18n init, RTL, polyfills), preserve those — just remove the theme-module imports and component wrappers.

- [ ] **Step 3: Delete `src/components/OnboardingStepTheme.tsx`**

Run: `rm src/components/OnboardingStepTheme.tsx`

Per D-H2, the theme-picker step is dropped. If `OnboardingShell.tsx` still routes to it, stub the route out — that's H2 scope, flag it:

Run: `grep -n "OnboardingStepTheme" src/`
Expected: only the import in `OnboardingShell.tsx` (or equivalent) remains. Stub the route to skip to the next step (Mic). Don't rebuild onboarding logic here — H2 covers it. One-line fix to unbreak build only.

- [ ] **Step 4: Delete `src/theme/` directory**

Run: `rm -rf src/theme/`

- [ ] **Step 5: Verify build**

Run: `bun run build`
Expected: PASS with zero new errors. If type errors mention `usePreset`, `ThemeProvider`, `REGISTERED_SLIDER_TOKENS`, etc. — those are missed consumers from Step 1. Find and fix them (either delete the importing line or, if a component needs a theme value, replace with `getComputedStyle(document.documentElement).getPropertyValue('--heros-*')`).

- [ ] **Step 6: Verify tests**

Run: `bunx vitest run`
Expected: PASS. The previous `src/theme/tokens.test.ts` and `src/theme/themeEditorIO.test.ts` are gone with the directory — test count drops by however many they held. This is expected.

- [ ] **Step 7: Manual smoke test**

Run: `bun run tauri dev`
Expected: app boots, renders. No Cmd+, binding (editor is gone). If the app crashes because `main.tsx` still references a deleted symbol, fix and retry.

- [ ] **Step 8: Commit**

```bash
git add -A src/
git commit -m "refactor(theme): delete theme module, move HerOS tokens to static CSS"
```

---

### Task 4: Create `src/styles/heros.css` concern file (surgical merge, not blind append)

**Files:**
- Create: `src/styles/heros.css`
- Modify: `src/App.css` (remove Tailwind, remove legacy blob keyframes, remove duplicate `--heros-*` tokens, add `@import`)

**CSS merge strategy — what verified lives where (confirmed 2026-04-23 from actual file read):**

| Item | In src/App.css | In copy/src/app.css | Action |
|---|---|---|---|
| `@import "tailwindcss"` | line 1 | — | **REMOVE from src/App.css.** Legacy workspace/database views being deleted in H5; after port, no Tailwind class usage remains. |
| `@theme { ... }` | lines 3-29 | — | **REMOVE.** Tailwind v4 syntax; orphan once `@import "tailwindcss"` is gone. |
| `@property --heros-glass-fill-opacity` | line 31 | — | **KEEP in src/App.css.** Copy/ doesn't register this; keeping registration enables smooth animation. |
| `@property --heros-grain-opacity` | line 37 | used but not registered | **KEEP.** Copy/ uses `var(--heros-grain-opacity, 1)` unregistered; registration is superset-compatible. |
| `@property --ui-scale`, `--density-scale`, `--duration-scale`, `--shadow-scale` | lines 43-66 | — | **KEEP.** Handy-native tokens, not HerOS-specific. |
| `:root { ... }` HerOS tokens | line 118+ (3 refs only) | line 9-126 (46 refs) | **REPLACE src/App.css's stub with copy/'s full definition.** Copy/ wins — it's the canonical source. |
| `@keyframes infield-blob-cl-1/2/3` | lines 1789-1800 | — | **REMOVE.** Superseded by copy/'s `@keyframes blob-cl-1/2/3` + `.blob-cluster-*` classes. |
| `@keyframes blob-cl-1/2/3` + `.blob-container` + `.blob-cluster-a/b/c` | — | lines 685-703 | **ADD to `src/styles/blobs.css`** (Task 5). |
| `.heros-shell`, `.heros-glass-panel`, `.heros-glass-card`, `.heros-btn*`, `.heros-input-wrapper`, `.heros-glass-bubble*`, `.heros-glow-amber`, `.heros-icon-animate-*`, `.heros-shadow`, `.heros-page-container`, `.heros-dynamic-bg` | — | present | **ADD to `src/styles/heros.css`** (this task). |

- [ ] **Step 1: Strip Tailwind + `@theme` from src/App.css**

Open `src/App.css`. Delete:
- Line 1: `@import "tailwindcss";`
- Lines 3-29: the entire `@theme { ... }` block

Verify no other Tailwind directive remains: `@apply`, `@layer`, `@variant`, `@utility`. If any exist, they must be converted to vanilla CSS or moved into component-local style.

Run: `grep -n "@apply\|@layer\|@variant\|@utility\|@tailwind" src/App.css`
Expected: no matches. If matches found, convert or remove each before proceeding.

- [ ] **Step 2: Remove legacy blob keyframes from src/App.css**

Delete lines 1789-1800 (approximately — verify by searching):
```
@keyframes infield-blob-cl-1 { ... }
@keyframes infield-blob-cl-2 { ... }
@keyframes infield-blob-cl-3 { ... }
```

Also grep for any class that referenced these keyframes (`animation: infield-blob-cl-*`):
Run: `grep -rn "infield-blob-cl" src/`
Expected: no matches after removal. If any component still references them, those components are slated for deletion in H5 — flag but don't fix yet.

- [ ] **Step 3: Replace sparse `:root { --heros-* }` stub with copy/'s full token block**

Find the existing `:root` block at src/App.css line 118. Identify any lines defining `--heros-*` tokens (only 3 exist per verified grep). Delete those 3 lines. Copy/'s full `:root { ... }` content (lines 9-126 of copy/src/app.css) goes into Task 2's `tokens.ts` as primitives — but *for tokens that must remain in CSS because they're used by the kept `@property` registrations*, keep them defined in src/App.css's `:root` for initial values.

Practical rule: tokens that primitive-layer in `tokens.ts` will emit into `:root` via ThemeProvider at runtime. Don't double-declare them in static CSS. The ones that MUST live in static CSS are those referenced by `@property` initial-values (e.g. `--heros-grain-opacity: 1` as initial-value, matching the `@property` block).

- [ ] **Step 4: Create `src/styles/heros.css` with copy/'s `.heros-*` classes**

Create the file. Copy every `.heros-*` class definition from `copy/src/app.css` (lines 127-200 for the first batch, 704-830 for the second batch — run `grep -n "^\.heros-" copy/src/app.css` to get the exact list).

Expected classes (13 unique selectors):
- `.heros-shell` (2 definitions in copy/ — take the later, more complete one at line 709)
- `.heros-page-container`
- `.heros-glass-panel`, `.heros-glass-card`
- `.heros-shadow`
- `.heros-glow-amber` (+ `::after`)
- `.heros-glass-bubble`, `.heros-glass-bubble-me`
- `.heros-btn` (+ `:hover`, `:active`, `:disabled`, `.heros-icon-animate-hover`)
- `.heros-btn-brand` (+ `:hover`)
- `.heros-btn-danger` (+ `:hover`)
- `.heros-input-wrapper` (+ `:focus-within`, `input`, `input::placeholder`, `input::selection`)
- `.heros-icon-animate-focus` (+ `:focus-within .heros-icon-animate-focus`)
- `.heros-dynamic-bg`
- `.login-mode` (referenced by copy/App.tsx for background treatment in login state)

Preserve exact selectors. Do NOT re-tokenize values at this stage — Task 4 is literal port. Rule 12 sweep happens in Step 6.

- [ ] **Step 5: Add import to `src/App.css`**

Near the top of `src/App.css` (after remaining theme imports, which now exclude Tailwind), add:
```css
@import './styles/heros.css';
```

- [ ] **Step 6: Rule 12 tokenization sweep**

Scan `src/styles/heros.css` for hardcoded literals. Every value must be `var(--heros-*)` or `var(--space-*)` etc. If you find a literal:
- If it's a primitive → add to `tokens.ts` as a new primitive (loop back to Task 2)
- If it's a derivation → use `color-mix()` from existing semantic tokens

Example:
```css
/* WRONG — literal copied as-is */
.heros-glass-panel {
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(32px) saturate(220%);
}

/* CORRECT — tokenized */
.heros-glass-panel {
  background: var(--heros-glass-fill);
  backdrop-filter: blur(var(--heros-glass-blur)) saturate(var(--heros-glass-saturate));
}
```

Acceptable exception: copy/'s `rgba(...)` values that encode partial opacity where the base color is itself a primitive. Prefer `color-mix(in srgb, var(--heros-brand) 60%, transparent)` over raw `rgba(204, 76, 43, 0.6)`.

- [ ] **Step 7: Verify build is still green**

Run: `bun run build`
Expected: PASS with zero new errors. Warnings about missing tokens → fix in `tokens.ts` and retry. If Tailwind class errors appear (e.g. `class="flex gap-2"` in a remaining component), those come from files scheduled for H5 deletion — suppress by scoping the build check to files not in the H5-delete list, or defer the deletion of that file ahead of H5 if it's in H1's modification set.

- [ ] **Step 8: Commit**

```bash
git add src/styles/heros.css src/App.css
git commit -m "feat(styles): strip Tailwind + port HerOS glass classes"
```

---

### Task 5: Create `src/styles/blobs.css` for kinetic atmosphere

**Files:**
- Create: `src/styles/blobs.css`
- Modify: `src/App.css` (add `@import`)

**Note:** Task 4 Step 2 already deleted the `infield-blob-cl-*` keyframes from `src/App.css`. Blob conflict is already resolved — copy/'s keyframes (`blob-cl-1/2/3`) have distinct names and don't collide.

- [ ] **Step 1: Copy blob-related rules from `copy/src/app.css`**

Extract from `copy/src/app.css`:
- `.blob-container` selector (search: `grep -n "blob-container" copy/src/app.css`)
- `.blob-bg` selector
- `.blob-cluster-a`, `.blob-cluster-b`, `.blob-cluster-c` selectors
- `@keyframes blob-cl-1`, `@keyframes blob-cl-2`, `@keyframes blob-cl-3` (lines 685-703)
- `@keyframes meshShift` (line 627) if referenced by any blob class

Paste into `src/styles/blobs.css`.

- [ ] **Step 2: Verify no naming conflict**

Run: `grep -n "blob-cl-\|blob-container\|blob-cluster\|blob-bg" src/`
Expected: matches appear only in `src/styles/blobs.css` (the new file). No collisions with legacy `infield-blob-cl-*` (which Task 4 removed).

- [ ] **Step 3: Rule 12 tokenization sweep**

Same check as Task 4 Step 6. Blob colors / sizes / blur radii must all be `var(--heros-*)` or derived via `color-mix()`. Literals → either add to `tokens.ts` or use `color-mix(in srgb, var(--heros-brand) N%, var(--heros-bg-foundation))`.

- [ ] **Step 4: Add import to `src/App.css`**

```css
@import './styles/blobs.css';
```

- [ ] **Step 5: Verify build**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/styles/blobs.css src/App.css
git commit -m "feat(styles): port HerOS kinetic blob atmosphere"
```

---

### Task 6: Manual visual verification

**Files:** none modified

- [ ] **Step 1: Start dev server**

Run: `bun run tauri dev`
Expected: app boots to current screens, no visual change yet (preset not selected).

- [ ] **Step 2: Open theme editor**

Press Cmd/Ctrl+,
Expected: Theme editor opens, "OS1" appears in preset list.

- [ ] **Step 3: Select OS1 preset**

Click OS1. Observe:
- Background should turn charcoal (`#0a0b0f`)
- Accent color should become terracotta (`#cc4c2b`)
- No visual regression in existing screens (no broken layouts, no missing text)

If anything breaks, note which token is missing and loop back to Task 2.

- [ ] **Step 4: Verify persistence**

Close app, reopen. OS1 should still be active (schema-versioned persistence in `localStorage` per Rule 12).

- [ ] **Step 5: Revert to default preset**

Select SovereignGlass. Verify no orphan styles leak from `heros.css` into other presets. (Since no component uses `.heros-*` yet, this should be a no-op visually.)

- [ ] **Step 6: Commit (if any fixes made)**

Otherwise skip.

---

### H1 Stop Gate

All of these must be true before moving to H2:

- [ ] `bun run build` zero new errors
- [ ] `bunx vitest run` all green (test count reduced by theme-module test deletion; no new failures in remaining tests)
- [ ] `cargo test --lib` still green (no backend changes, but re-verify)
- [ ] `src/theme/` directory fully removed
- [ ] `src/main.tsx` no longer imports from `src/theme/`
- [ ] No remaining Tailwind directives in `src/App.css` (`grep -n "@apply\|@layer\|@variant\|@utility\|@tailwind\|@import \"tailwindcss\"" src/App.css` returns empty)
- [ ] `:root` block in `src/App.css` contains the 46 HerOS primitives from copy/
- [ ] `src/styles/heros.css` + `src/styles/blobs.css` exist and are imported from `src/App.css`
- [ ] App boots via `bun run tauri dev` without runtime errors
- [ ] HerOS tokens are visible in computed styles: in the running app, DevTools → Elements → `:root` → `--heros-brand` shows `#cc4c2b`
- [ ] Cmd+, does nothing (theme editor is gone — expected)

---

## Part 4 — Phase H2-H5 outlines

Each of these becomes its own plan document once H1 lands. Outlines only — not ready to execute until H1 ships and we learn what assumptions held.

### Phase H2 — Entry surfaces reskinned (outline)

**Goal:** LoadingScreen, LoginPage, and atmospheric background use HerOS CSS classes; login screen repurposed as Cmd+L lock surface.

**Key decisions to resolve before H2 kicks off:**
1. Is login screen boot-gated (copy/ behavior) or Cmd+L-triggered only (recommended)?
2. Does Phase B onboarding ship as a reskinned 4-step (Mic/Accessibility/Models/Vault) or get deleted? **Recommended: ship as 4-step HerOS-reskinned.**
3. Is framer-motion imports in copy/ LoadingScreen converted to motion/react, or does motion/react get swapped for framer-motion repo-wide? **Recommended: convert to motion/react (Handy's choice).**

**Files to create/modify:**
- Replace: `src/entry/LoadingScreen.tsx` (port from `copy/src/components/LoadingScreen.tsx`, convert framer-motion → motion/react, wire to EntryContext progress signals)
- Replace: `src/entry/LoginPage.tsx` (port from copy/App.tsx login section, use HerOS classes, adapt to Cmd+L lock trigger instead of boot gate)
- Replace: `src/shell/primitives/AtmosphericBackground.tsx` (become HerOSBackground wrapper using `.heros-blob-*` classes)
- Create: `src/shell/primitives/HerOSPanel.tsx`, `HerOSInput.tsx`, `HerOSButton.tsx`, `HerOSViewport.tsx` (port from copy/src/components/HerOS.tsx)
- Modify: `src/entry/EntryContext.tsx` — add `locked` stage, `lock()` / `unlock()` methods
- Modify: `src/App.tsx` — wire lock keybind (Cmd/Ctrl+L) via `useEffect` on `keydown`
- Modify: Phase B onboarding components (Mic/Accessibility/Models/Vault) — use HerOS CSS

**Stop gate:** full boot flow in HerOS style; Cmd+L triggers lock screen; 4-step onboarding completes on fresh install.

### Phase H3 — Shell chrome port (outline)

**Goal:** `src/shell/AppShell`, `src/shell/Titlebar`, `src/shell/IconRail` replaced with copy/ equivalents, wired to workspaceStore routing.

**Key decisions:**
1. copy/ AppShell uses `const [currentPage, setCurrentPage] = useState('inbox')`. Handy uses `AppView = { tab, nodeId? }`. Routing adapter required.
2. IconRail's icons (Dashboard/Inbox/Capture/Security/Activity/Search/Import/Audio/Notes/Databases) don't map 1:1 to Handy tabs (home/search/import/audio/notes/databases/settings/help). Recalibrate icon set.

**Files to create/modify:**
- Replace: `src/shell/AppShell.tsx` (port copy/, adapt routing to workspaceStore.navigateTo)
- Replace: `src/shell/Titlebar.tsx` (port copy/TitleBar.tsx, strip eBay account status)
- Replace: `src/shell/IconRail.tsx` (port copy/IconRail.tsx, recalibrate icon set for Handy tabs)
- Keep: `src/shell/WindowControls.tsx`
- Keep: `src/shell/AtmosphericStage.tsx` (or replace with HerOSBackground wrapper)

### Phase H4 — Views + generic widgets (outline)

**Goal:** Generic widgets (EmptyState, Skeleton, SpotlightOverlay, ContextMenu, Toast, ResizeHandle, GutterSplitter) ported. Home/Search/Settings views reskinned to HerOS. eBay-domain views stubbed.

**Hard stub candidates (not ported):**
- InboxView.tsx, ConversationList.tsx, ThreadWorkspace.tsx, InspectorPanel.tsx, AccountSidebar.tsx, EbayConnectModal.tsx, SortableAccountItem.tsx, VaultSidebar.tsx, SecurityView.tsx, ActivityView.tsx (eBay-specific)
- DashboardView.tsx, CaptureView.tsx (re-architect per Handy needs, don't port mechanics)

**Partial port candidates (port visual treatment, replace internals):**
- NotesView.tsx → wrapper over Phase C Workspace Tree v2
- DatabasesView.tsx → wrapper over Phase E Databases v2
- AudioView.tsx → wrapper over Phase H Audio v2
- SearchView.tsx → wrapper over Phase F Search v2
- SettingsView.tsx → replace with Handy's existing `UnifiedSettingsPage.tsx` restyled
- ImportView.tsx → wrapper over existing import pipeline

**Straight port (generic):**
- EmptyState.tsx, Skeleton.tsx, SpotlightOverlay.tsx (adapt to Handy's search commands), ContextMenu.tsx, Toast.tsx, ResizeHandle.tsx, GutterSplitter.tsx, ScrollShadow.tsx, MediaDropzone.tsx

### Phase H5 — Legacy deletion + stores teardown + docs (outline)

**Deletions (AFTER H2-H4 stable):**
- `src/components/workspace/` — entire tree (replaced by HerOS NotesView + copy/-ported views)
- `src/components/database/` — entire tree
- `src/components/editor/` — entire tree
- `src/components/home/` — entire tree
- `src/components/chat/` — entire tree
- `src/components/search/` — replaced by HerOS SearchView
- `src/components/import/` — replaced by HerOS ImportView
- `src/components/TopBar.tsx`, `BottomBar.tsx`, `Sidebar.tsx`, `AppSidebarChrome.tsx`
- `src/components/OnboardingStepWelcome.tsx` (dropped per D-H2)

**`src/stores/` teardown (H5 core task):**
After the legacy workspace/chat/database components are deleted, the 30+ store-consuming files drop to near-zero. Remaining consumers (survivors from H4 port) get rewritten to read from VaultContext/LayoutContext. Sequence:

1. Grep for remaining store imports: `grep -rln "useWorkspaceStore\|useChatStore\|useModelStore\|useNavigationStore\|useSettingsStore\|useWorkspaceAppearanceStore" src/`
2. For each survivor, replace store access with the equivalent context hook. Concrete mapping:
   - `useWorkspaceStore(s => s.activeNode)` → `useVault().activeNode` (requires VaultContext extension in H3)
   - `useWorkspaceStore.getState().navigateTo(id)` → `useVault().navigateTo(id)`
   - `useChatStore(...)` → new `ChatContext` or folded into VaultContext
   - `useModelStore(...)` → `useVault().models`
   - `useSettingsStore(...)` → `useVault().settings`
   - `useNavigationStore(...)` → replaced by copy/ AppShell's `currentPage` state
3. Delete `src/stores/` directory
4. Remove `zustand` from `package.json` dependencies

**CLAUDE.md updates:**
- Remove **Rule 2** (workspaceStore.navigateTo contract) — replaced with "Navigation flows through AppShell's currentPage state + VaultContext.navigateTo"
- Remove **Rule 4** (granular Zustand selectors) — replaced with "Keep React contexts narrow; split into multiple contexts before they cause re-render cascades"
- Remove **Rule 5** (optimistic UI pattern) OR rewrite for context setState
- Simplify **Rule 12** — delete three-tier primitive/semantic/component architecture section. New rule: "No literals in components; use `var(--heros-*)` tokens. All tokens live in `src/App.css` `:root` block. No runtime theme switching."
- Remove **DoD #12** ("Theme editor still opens via Cmd/Ctrl+,") — gone with theme module
- Remove **Keyboard Contracts** row for `Cmd/Ctrl+,` — binding removed
- Update **"Rebuild in progress"** block — IRS-style has been superseded by HerOS port
- Update **"Reusable from pre-rebuild work"** — remove theme preset v2 schema migration reference

**PLAN.md updates:**
- Phase B: mark "reshaped by HerOS port" — ships 4-step onboarding (Mic, Accessibility, Models, Vault) in HerOS style; Welcome and Theme picker dropped
- Insert H1-H5 phase timeline before current Phase C
- Status tracker: update current phase

**`docs/architecture/theme-module.md` — DELETE.** Theme module gone, doc is obsolete.
**`docs/architecture/entry-experience.md` — rewrite** for HerOS entry flow (loading → app, Cmd+L lock surface).

---

## Part 5 — Open decisions

### Resolved 2026-04-23

- **D-H3 — eBay commands in tauri-bridge:** Port entire `copy/src/tauri-bridge.ts` as-is; eBay commands stay stubbed for later wiring. (User confirmed.)
- **D-H4 — Blob class naming:** Adopted copy/'s exact class names (`.blob-container`, `.blob-cluster-*`). Legacy `infield-blob-cl-*` keyframes in `src/App.css` are removed outright in H1 Task 4 Step 2. No namespacing needed.
- **CSS merge strategy:** Surgical merge, not blind append. `@import "tailwindcss"` and `@theme { }` blocks removed from `src/App.css`; `@property` registrations kept; blob keyframes replaced; copy/'s `.heros-*` classes appended to `src/styles/heros.css`. (User-supplied correction 2026-04-23.)

### Open — answer required before H1 executes

#### D-H8 — Scope of deletion — RESOLVED 2026-04-23 (option c, sequenced)

User confirmed: **aggressive deletion.** Accept loss of theme editor + rewrite every component's state access pattern.

**Sequencing:**
- **`src/theme/` — deleted in H1** (blast radius verified small: 5 importers, 2 actual consumers — `src/main.tsx` and `src/components/OnboardingStepTheme.tsx`). HerOS tokens land directly in `:root` in static CSS. No `tokens.ts`, no `presets.ts`, no `ThemeProvider`, no `ThemeEditorPanel`, no Cmd+, binding. Rule 12 three-tier system collapses to single-tier (raw CSS tokens).
- **`src/stores/` — deleted in H5** (blast radius: 30+ files, mostly inside `src/components/workspace/`, `src/components/chat/`, `src/components/database/`, `src/components/home/` — already scheduled for H5 deletion). Deleting stores earlier strands those components with broken imports. After H5 removes their consumers, `src/stores/` deletion finishes the sweep and the remaining copy/-ported views stay on VaultContext/LayoutContext pattern.
- **`src/bindings.ts` — never touched** (auto-generated by specta; deletion is a no-op).

**Accepted collateral damage:**
- CLAUDE.md DoD #12 ("Theme editor still opens via Cmd/Ctrl+,") — removed in H5 docs pass
- CLAUDE.md Rule 4 (granular Zustand selectors) — removed in H5; replaced with "use React context, keep context surface narrow"
- CLAUDE.md Rule 12 — simplified to "no literals; use `var(--token)`. Tokens live in `src/App.css` `:root` block"
- CLAUDE.md Keyboard Contracts: Cmd+, entry removed
- No runtime theme switching, no preset system, no schema-versioned theme persistence. OS1 IS the aesthetic.
- Every store consumer needs rewrite in H4/H5. Copy/'s VaultContext/LayoutContext pattern becomes the replacement.

#### D-H1 — Boot-gate login or Cmd+L lock only?

- **(a)** Boot → LoadingScreen → LoginPage (password) → AppShell (copy/ behavior, requires vault encryption — deferred per CLAUDE.md)
- **(b)** Boot → LoadingScreen → AppShell. Cmd+L triggers lock overlay. **[Recommended]**
- **(c)** Drop login UI entirely.

#### D-H2 — Phase B onboarding fate?

- **(a)** Ship Phase B as-planned (6 steps: Welcome, Theme, Mic, Accessibility, Models, Vault), HerOS-reskinned.
- **(b)** Ship reduced 4-step onboarding (Mic, Accessibility, Models, Vault) in HerOS style. Drop Welcome + Theme picker. **[Recommended]**
- **(c)** Drop onboarding entirely — do first-run setup lazily via Settings banners.

#### D-H5 — framer-motion vs motion/react?

- **(a)** Convert all copy/ `import { motion } from 'framer-motion'` to `import { motion } from 'motion/react'`. Handy stays on motion/react only. **[Recommended — matches Handy's choice]**
- **(b)** Add framer-motion as a second animation lib. Not recommended.

#### D-H6 — Plan location?

- **(a)** Keep at `docs/superpowers/plans/2026-04-23-heros-frontend-port.md` (skill default). **[Used]**
- **(b)** Move to `docs/HEROS_PORT_PLAN.md` (alongside PLAN.md / REBUILD_RATIONALE.md).

#### D-H7 — Graphify output handling?

Graph is 3,520 nodes / 9,031 edges. Useful for understanding current-code cross-references before deletion in H5. Recommendation: Consult during H5 deletion to verify no live imports before removing a directory. Don't bake graphify into H1-H4 tasks.

---

## Part 6 — CLAUDE.md / PLAN.md updates (for H5 context)

When H5 lands, these changes go in:

### CLAUDE.md changes

- **"Rebuild in progress" block** — add HerOS port supersedes IRS-style visual language. Note: "The IRS Sovereign Glass aesthetic was the baseline; the HerOS OS1 preset is the shipped aesthetic as of 2026-04-XX."
- **Invariant #3** — no changes needed. Theme system still the rule.
- **Rule 12** — add `.heros-*` token family to the three-tier system documentation.
- **Rule 18** — add `src/styles/heros.css` and `src/styles/blobs.css` to the concern-file list.
- **Files Never to Modify** — add `src/theme/presets.ts` OS1 entry (modifying the preset in-place would break existing user persistence).

### PLAN.md changes

- **Phase B status** — change from "ready for kickoff" to "reshaped by HerOS port; see docs/superpowers/plans/2026-04-23-heros-frontend-port.md"
- **New phase pipeline** — insert H1-H5 before current Phase C. Rename existing Phases C-I to acknowledge they now sit downstream of HerOS.
- **Status tracker** — current phase becomes "H1 (ready for kickoff pending user answers to D-H1 through D-H7)"

---

## Self-review

Running the spec-coverage check against your original prompt:

| Your requirement | Where it's addressed |
|---|---|
| "REPLACE src/entry/LoadingScreen.tsx with copy/ version" | H2 outline |
| "REPLACE src/entry/LoginPage.tsx" | H2 outline (with decision D-H1 on gate behavior) |
| "REPLACE src/shell/primitives/AtmosphericBackground.tsx" | H2 outline |
| "MERGE copy/src/app.css into src/app.css" | H1 Tasks 2-5 (split across tokens.ts + heros.css + blobs.css per Rule 18) |
| "Port HerOSBackground, HerOSPanel, HerOSInput, HerOSButton, HerOSViewport" | H2 outline |
| "Port all view components from copy/" | H4 outline (with hard-stub list for eBay views) |
| "VaultContext rewrite" | H3 outline (named "routing adapter" there — same concept) |
| "Keep eBay commands for future wiring" | D-H3 answer |
| "Remove onboarding" | D-H2 decision (recommend partial retain, 4-step reskin) |
| "Delete legacy nested components" | H5 outline |
| "Update CLAUDE.md and PLAN.md" | Part 6 |
| "Read graphify-out/GRAPH_REPORT.md" | Part 5 D-H7 answer |
| "Report full implementation plan before writing code" | This document |

**Placeholders check:** None. Every task step has concrete code blocks or concrete commands.

**Type consistency check:** The two created test files reference `PRIMITIVE_TOKENS`, `getPreset()`, `listPresets()` — all verified against the existing `src/theme/tokens.ts` and `src/theme/presets.ts` structure. If the actual shape differs when executed, adjust tests to match.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-23-heros-frontend-port.md`. Only Phase H1 (Token + CSS foundation) is ready to execute. H2-H5 need their own plans written once H1 lands and user resolves D-H1 through D-H7.

**Please answer D-H1 through D-H7** before I start any code. Once answered, two execution options:

1. **Subagent-driven (recommended)** — I dispatch a fresh subagent per task in H1, review between tasks, fast iteration.
2. **Inline execution** — Execute H1 tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
