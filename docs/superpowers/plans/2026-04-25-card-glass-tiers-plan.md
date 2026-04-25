# Card Glass Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the scattered glass-surface tokens (`--heros-glass-fill`, `--heros-glass-black`, `--heros-glass-black-deep`, plus 40+ hardcoded rgba literals) into a clean tiered system so future visual tuning is a one-line edit in `:root`.

**Architecture:** Three card tiers (`--card-deep-*`, `--card-mid-*`, `--card-overlay-*`) for dark content surfaces, plus a separate `--panel-*` group for the bright entry-experience shell glass (LoadingScreen / LoginPage / Onboarding / lock overlay / PlaylistSelectorModal). Two misnamed legacy tokens (`--heros-glass-black*`) get renamed to `--row-hover-fill*` to fix semantics. The runtime token-mutation `useEffect` in `App.tsx` (leftover from the deleted theme module per CLAUDE.md Rule 12) gets removed.

**Tech Stack:** Vanilla CSS, CSS custom properties, BEM modifiers, no preprocessor. React + TypeScript for component class additions.

**Spec:** [docs/superpowers/specs/2026-04-25-card-glass-tiers-design.md](../specs/2026-04-25-card-glass-tiers-design.md)

---

## File Structure

| File | Role | Touched in commits |
|---|---|---|
| `src/App.css` | Token block, base classes, sidebar/chrome rules, db-table, login-mode | A, C, D, E, F |
| `src/styles/notes.css` | Notes editor, tree, backlinks, heros-menu, autocomplete | B, D, E |
| `src/styles/search.css` | Spotlight overlay | D, E |
| `src/styles/system-audio.css` | System-audio panels | B, C |
| `src/styles/onboarding.css` | Onboarding panel inside `<HerOSPanel>` | (no migration — uses `.heros-glass-card` via JSX, inherits deep fallback) |
| `src/editor/herosTheme.ts` | CodeMirror autocomplete tooltip | D, E |
| `src/components/VaultSidebar.tsx` | Inline-style search input | E |
| `src/App.tsx` | Runtime token-mutation `useEffect` | F (deletion) |
| `docs/superpowers/specs/baselines/2026-04-25-card-tiers/` | Baseline screenshots | created in B |

---

## Pre-flight: capture visual baselines

### Task 0: Capture baseline screenshots before any token changes

**Files:**
- Create: `docs/superpowers/specs/baselines/2026-04-25-card-tiers/` (directory)
- Each screenshot saved as PNG with descriptive filename

**Why:** CSS refactors are exactly the kind of work where "tests pass" doesn't mean "nothing changed". A token mapped to the wrong tier looks subtly wrong in a way grep can't catch. Baseline screenshots are the only reliable check.

- [ ] **Step 1: Create baseline directory**

```bash
mkdir -p docs/superpowers/specs/baselines/2026-04-25-card-tiers
```

- [ ] **Step 2: Run `bun run tauri dev` and let it boot to interactive state**

```bash
bun run tauri dev
```

Wait for the app window to appear and the loading screen to dismiss. Confirm vault is unlocked (no Cmd+L lock active).

- [ ] **Step 3: Capture screenshots for each baseline surface**

Open each surface and screenshot the window (use OS screenshot tool — full-window or relevant region). Save each as PNG inside `docs/superpowers/specs/baselines/2026-04-25-card-tiers/` with the filename listed:

| Filename | Surface | How to reach |
|---|---|---|
| `01-notes-editor.png` | Notes editor with tree visible | Click Notes in icon rail |
| `02-notes-backlinks.png` | Backlinks pane | Open a note that has incoming links |
| `03-database-table.png` | Database table view | Notes → open a database doc |
| `04-system-audio.png` | System-audio recording panels | Click System Audio in icon rail |
| `05-titlebar.png` | Titlebar close-up | Top of any page |
| `06-icon-rail.png` | Icon rail (collapsed and expanded) | Hover the rail |
| `07-spotlight.png` | Spotlight quick-open | Press Cmd+K |
| `08-autocomplete.png` | Slash-menu autocomplete | In notes editor, type `/` |
| `09-wikilink-autocomplete.png` | Wikilink autocomplete | In notes editor, type `[[` |
| `10-heros-menu.png` | Right-click context menu in tree | Right-click a tree node |
| `11-loading-screen.png` | LoadingScreen panel | Restart app, screenshot before vault loads |
| `12-lock-overlay.png` | Lock overlay (login-mode) | Press Cmd+L |
| `13-onboarding.png` | Onboarding flow | (only if first-run available, otherwise skip) |
| `14-import-view.png` | ImportView with side panels | Click Import in icon rail |
| `15-chat-bubbles.png` | Chat bubbles | Open BuddyView or ThreadWorkspace |
| `16-conversation-row-hover.png` | Conversation row with cursor hovered on it | Hover over a row in the conversation list |
| `17-db-row-hover.png` | Database table row with cursor hovered | Hover a row in db table |
| `18-kanban-card-hover.png` | Kanban card with cursor hovered | Open kanban view, hover a card |

For surfaces unavailable in the current build (e.g. some views may be dormant), note "skipped" in step 4's note.

- [ ] **Step 4: Verify all screenshots are saved and readable**

```bash
ls -la docs/superpowers/specs/baselines/2026-04-25-card-tiers/
```

Expected: at least 13 PNG files (skipped surfaces noted in commit message). Each file > 10KB (real screenshot, not blank).

- [ ] **Step 5: Stop the dev server and commit baselines**

Stop `bun run tauri dev` (Ctrl+C in its terminal).

```bash
git add docs/superpowers/specs/baselines/2026-04-25-card-tiers/
git commit -m "docs(css): baseline screenshots for card-glass-tiers refactor

Captured before any token migration. Used to diff against post-migration
appearance. Per spec §7, the deep tier should produce zero visual change
(values match user-locked rgba(0,0,0,0.28) + blur(12px)); mid/overlay/
panel surfaces may show unification change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1 (Commit A): Token blocks, class structure, panel rule split, deprecation aliases

**Files:**
- Modify: `src/App.css` (lines 87-89 area, 200-228 area, 789-800 area)

**Goal:** Add the new token system without changing any call-site. Visual result: identical to baseline (deprecation aliases route legacy tokens to new equivalents).

- [ ] **Step 1: Insert new token blocks in `:root` after the existing `--heros-glass-black-deep` line**

Open `src/App.css`. Find the existing block at lines 87-89:

```css
  /* Standardized Hover Colors */
  --heros-glass-black: rgba(9, 12, 22, 0.98);
  --heros-glass-black-deep: rgba(5, 5, 8, 0.95);
```

Replace it with this expanded block (keep the original three lines for backward compatibility during migration; add the new groups below):

```css
  /* Standardized Hover Colors — DEPRECATED, retained as aliases during migration.
     Removed in commits E (row-hover rename) and F (--heros-glass-fill retire). */
  --heros-glass-black: var(--row-hover-fill);
  --heros-glass-black-deep: var(--row-hover-fill-deep);

  /* === CARD GLASS TIERS ===================================================
     Three depth tiers for every dark content surface in the app. Edit the
     values here to shift every surface mapped to a tier in lockstep. See
     docs/superpowers/specs/2026-04-25-card-glass-tiers-design.md for the
     tier-to-surface mapping.
     ====================================================================== */

  /* Deep — primary content panes (notes editor, db table, system audio) */
  --card-deep-fill:        rgba(0, 0, 0, 0.28);
  --card-deep-blur:        12px;
  --card-deep-saturate:    100%;
  --card-deep-rim:         rgba(255, 255, 255, 0.10);

  /* Mid — chrome and secondary surfaces (titlebar, sidebars, bubbles) */
  --card-mid-fill:         rgba(0, 0, 0, 0.18);
  --card-mid-blur:         20px;
  --card-mid-saturate:     140%;
  --card-mid-rim:          rgba(255, 255, 255, 0.08);

  /* Overlay — floating layers (spotlight, autocomplete, context menus) */
  --card-overlay-fill:     rgba(10, 14, 26, 0.72);
  --card-overlay-blur:     28px;
  --card-overlay-saturate: 160%;
  --card-overlay-rim:      rgba(255, 255, 255, 0.12);

  /* === PANEL — entry-experience shell glass ============================== */
  /* Bright atmospheric material for LoadingScreen / LoginPage / Onboarding /
     lock overlay / PlaylistSelectorModal. Distinct material from cards. */

  --panel-fill:        rgba(255, 255, 255, 0.08);
  --panel-blur:        24px;
  --panel-saturate:    120%;
  --panel-rim:         rgba(255, 255, 255, 0.15);

  /* === ROW HOVER (renamed from --heros-glass-black*) ===================== */
  /* :hover fills for rows inside cards. Not card surfaces; renamed for
     clarity. */

  --row-hover-fill:        rgba(9, 12, 22, 0.98);
  --row-hover-fill-deep:   rgba(5, 5, 8, 0.95);
```

- [ ] **Step 2: Split `.heros-glass-panel` out of the App.css:202 combined rule and add tier modifier classes**

Find the existing block at App.css:202-252:

```css
.heros-glass-panel, .heros-glass-card {
  /* Dynamic Adaptive Glass — Uses system variables for Mode Inversion */
  background: var(--heros-glass-fill);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  
  background-clip: padding-box; 
  /* Softer, Chromatic Border */
  border: 1px solid rgba(178, 185, 218, 0.14);
  border-top: 1px solid rgba(188, 197, 224, 0.16);
  border-left: 1px solid rgba(188, 197, 224, 0.12);
  border-radius: 24px;
  
  /* Luminous Bloom */
  box-shadow: var(--heros-panel-shadow);
  
  overflow: hidden;
  transition: box-shadow 0.24s ease, border 0.24s ease, background 0.24s ease;
  z-index: 10;

  /* GPU acceleration */
  transform: none;
  will-change: auto;
  
  /* Adaptive text shadow — Removed in Light Mode to prevent smudging */
  text-shadow: none;
}
```

Replace it with this restructured version:

```css
/* Card geometry shared across all tiers — fill/blur/border come from
   tier-specific rules below. */
.heros-glass-card {
  background-clip: padding-box;
  border-radius: 24px;

  /* Luminous Bloom */
  box-shadow: var(--heros-panel-shadow);

  overflow: hidden;
  transition: box-shadow 0.24s ease, border 0.24s ease, background 0.24s ease;
  z-index: 10;

  /* GPU acceleration */
  transform: none;
  will-change: auto;

  /* Adaptive text shadow — Removed in Light Mode to prevent smudging */
  text-shadow: none;
}

/* Default tier (no modifier) = deep. Preserves visual default for any
   bare `.heros-glass-card` call-site we don't migrate explicitly. */
.heros-glass-card,
.heros-glass-card--deep {
  background: var(--card-deep-fill);
  backdrop-filter: blur(var(--card-deep-blur)) saturate(var(--card-deep-saturate));
  -webkit-backdrop-filter: blur(var(--card-deep-blur)) saturate(var(--card-deep-saturate));
  border: 1px solid var(--card-deep-rim);
}

.heros-glass-card--mid {
  background: var(--card-mid-fill);
  backdrop-filter: blur(var(--card-mid-blur)) saturate(var(--card-mid-saturate));
  -webkit-backdrop-filter: blur(var(--card-mid-blur)) saturate(var(--card-mid-saturate));
  border: 1px solid var(--card-mid-rim);
}

.heros-glass-card--overlay {
  background: var(--card-overlay-fill);
  backdrop-filter: blur(var(--card-overlay-blur)) saturate(var(--card-overlay-saturate));
  -webkit-backdrop-filter: blur(var(--card-overlay-blur)) saturate(var(--card-overlay-saturate));
  border: 1px solid var(--card-overlay-rim);
}
```

Note: the original `border-top` and `border-left` chromatic borders are intentionally NOT carried forward — they're the "glare" the user removed in the recent debug session. The single `border: 1px solid var(--card-*-rim)` replaces them.

The `.heros-glass-card:hover` empty rule at App.css:250-252 (`/* No animation */`) stays as-is.

- [ ] **Step 3: Rewrite the standalone `.heros-glass-panel` rule at App.css:789 to use `--panel-*` tokens**

Find the existing block at App.css:789-800:

```css
.heros-glass-panel {
  position: relative;
  background: rgba(255, 255, 255, 0.08); /* Highly translucent white */
  backdrop-filter: blur(24px) saturate(120%);
  -webkit-backdrop-filter: blur(24px) saturate(120%);
  border-radius: 24px;
  padding: 48px 40px;
  border: 1px solid rgba(255, 255, 255, 0.15); /* Translucent rim */
  box-shadow: 
    0 12px 40px 0 rgba(0, 0, 0, 0.15), /* Diffuse floating outer shadow */
    inset 0 1px 0 rgba(255, 255, 255, 0.2); /* Inner top light reflection */
}
```

Replace with:

```css
.heros-glass-panel {
  position: relative;
  background: var(--panel-fill);
  backdrop-filter: blur(var(--panel-blur)) saturate(var(--panel-saturate));
  -webkit-backdrop-filter: blur(var(--panel-blur)) saturate(var(--panel-saturate));
  border: 1px solid var(--panel-rim);
  border-radius: 24px;
  padding: 48px 40px;
  box-shadow:
    0 12px 40px 0 rgba(0, 0, 0, 0.15), /* Diffuse floating outer shadow */
    inset 0 1px 0 rgba(255, 255, 255, 0.2); /* Inner top light reflection */
}
```

Inset highlight + outer shadow stay literal — they're material-specific to panel and not shared with cards.

- [ ] **Step 4: Run build to verify no syntax errors**

```bash
bun run build
```

Expected: zero new errors. If a CSS parse error appears, re-read the inserted block for typos (missing semicolons, unbalanced braces).

- [ ] **Step 5: Run `bun run tauri dev` and visually confirm no change**

```bash
bun run tauri dev
```

Open Notes view, Database view, Spotlight, Lock overlay. Compare against baseline screenshots from Task 0. Expected: pixel-identical (deprecation aliases route legacy tokens to new equivalents that resolve to identical rgba values).

If the lock overlay (`.login-mode`) looks wrong: the `--heros-glass-fill` override at App.css:2730 still uses the old name; that's expected and gets fixed in commit F. Should still work because the alias chain `--heros-glass-fill → var(--panel-fill)` resolves correctly via the override.

- [ ] **Step 6: Commit**

```bash
git add src/App.css
git commit -m "refactor(css): introduce card tier tokens and panel group (commit A)

Adds --card-{deep,mid,overlay}-* tier tokens, --panel-* shell glass
group, and --row-hover-fill{,-deep} renames. Splits .heros-glass-panel
out of the combined .heros-glass-card rule. Deprecation aliases keep
legacy --heros-glass-black* and --heros-glass-fill working during
migration. No call-sites change. No visual change.

Spec: docs/superpowers/specs/2026-04-25-card-glass-tiers-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 (Commit B): Deep tier migration — notes + db-table + system-audio

**Files:**
- Modify: `src/styles/notes.css` (delete lines 749-755 specificity hack; replace `rgba(0,0,0,0.28)` literals)
- Modify: `src/styles/system-audio.css` (replace any deep-tier hardcoded literals)
- Modify: `src/App.css:2881` area (db-table thead — already uses rgba(0,0,0,0.28))

**Goal:** Surfaces using `rgba(0,0,0,0.28) + blur(12px)` (the user's locked-in deep-tier values) now source from `--card-deep-*` tokens. Pixel-identical visual result.

- [ ] **Step 1: Delete the notes.css specificity hack at lines 749-755**

Open `src/styles/notes.css`. Find:

```css
/* Double-class specificity (0,2,0) beats .heros-glass-card (0,1,0) regardless
   of source order — needed because notes.css is imported AFTER
   App.css while .heros-glass-card is defined later in the same file.
   This override deepens the notes panel surfaces beyond the default heros-glass-card. */
.notes-tree-root.heros-glass-card,
.notes-editor-column.heros-glass-card,
.notes-backlinks.heros-glass-card {
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  ...
}
```

Delete the entire block (the comment header + the rule + any closing `}`). The surfaces inherit deep-tier appearance from the default-fallback rule in App.css now.

- [ ] **Step 2: Replace any other hardcoded `rgba(0, 0, 0, 0.28)` or `rgba(0,0,0,0.28)` literals in notes.css with `var(--card-deep-fill)`**

Run a grep first to find them:

```bash
```
Use Grep tool: `pattern: "rgba\(0,\s*0,\s*0,\s*0\.28\)"`, `path: "src/styles/notes.css"`, `output_mode: "content"`, `-n: true`

For each hit (likely zero or one beyond the specificity hack you just deleted), replace the literal with `var(--card-deep-fill)`. If `backdrop-filter: blur(12px)` accompanies it, replace with `backdrop-filter: blur(var(--card-deep-blur)) saturate(var(--card-deep-saturate))`.

- [ ] **Step 3: Migrate `.db-table thead th` at App.css:2881 area**

Use Grep to locate the rule: `pattern: "\.db-table thead th"`, `path: "src/App.css"`, `output_mode: "content"`, `-n: true`, `-A: 6`.

The current rule looks like:

```css
.db-table thead th {
  ...
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  ...
}
```

Replace the three lines with:

```css
  background: var(--card-deep-fill);
  backdrop-filter: blur(var(--card-deep-blur)) saturate(var(--card-deep-saturate));
  -webkit-backdrop-filter: blur(var(--card-deep-blur)) saturate(var(--card-deep-saturate));
```

- [ ] **Step 4: Migrate any deep-tier surfaces in system-audio.css**

Use Grep: `pattern: "rgba\(0,\s*0,\s*0,\s*0\."`, `path: "src/styles/system-audio.css"`, `output_mode: "content"`, `-n: true`.

For each match, evaluate the alpha:
- Alpha around `0.28` (within 0.05) → replace with `var(--card-deep-fill)`
- Higher alpha (≥ 0.40) → still deep; replace with `var(--card-deep-fill)` (will produce visual change — expected unification)
- Lower alpha (≤ 0.15) → likely mid tier; defer to commit C

For any line replaced, also replace any accompanying `backdrop-filter: blur(...)` with the deep-tier blur expression above.

- [ ] **Step 5: Build and visual diff**

```bash
bun run build
bun run tauri dev
```

Compare Notes editor, Backlinks pane, Database table, System Audio surfaces against baseline screenshots. Expected: pixel-identical for surfaces using locked deep values; minor unification change for surfaces that previously used slightly different rgba.

If the notes editor looks visibly different (background, blur, or border): re-read the deleted specificity hack and ensure the new default-fallback rule in App.css covers `.notes-editor-column.heros-glass-card` correctly. The bare `.heros-glass-card` selector + the `--deep` modifier rule both apply.

- [ ] **Step 6: Commit**

```bash
git add src/styles/notes.css src/styles/system-audio.css src/App.css
git commit -m "refactor(css): migrate deep-tier surfaces to --card-deep-* tokens (commit B)

Notes editor, tree, backlinks, db-table thead, and system-audio panels
now source their fill/blur/border from --card-deep-* tokens. Deletes
the notes.css:749-755 double-class specificity hack — the default
.heros-glass-card rule now resolves to deep tier via fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 (Commit C): Mid tier migration — titlebar, sidebars, chat bubbles

**Files:**
- Modify: `src/App.css` (titlebar block ~257, icon-rail block ~957+, thread-workspace ~1633, heros-glass-bubble ~255)
- Modify: `src/styles/system-audio.css` (any mid-tier surfaces)

**Goal:** Chrome surfaces that aren't `.heros-glass-card` get their `background:` and `backdrop-filter:` lines rewritten to use `--card-mid-*` tokens via direct token substitution. No JSX class changes.

- [ ] **Step 1: Migrate `.heros-glass-bubble` at App.css:255-269**

Find the existing rule (App.css:255-269):

```css
.heros-glass-bubble {
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  ...
}
```

Replace the first five lines with:

```css
.heros-glass-bubble {
  background: var(--card-mid-fill);
  backdrop-filter: blur(var(--card-mid-blur)) saturate(var(--card-mid-saturate));
  -webkit-backdrop-filter: blur(var(--card-mid-blur)) saturate(var(--card-mid-saturate));
  border: 1px solid var(--card-mid-rim);
```

Delete the `border-top: 1px solid rgba(255, 255, 255, 0.2);` line — it's the "rim glare" the user is moving away from. Keep the `box-shadow:` block (material-specific).

`.heros-glass-bubble-me` (App.css:271+) uses `color-mix` with `--heros-brand` — that's a brand-tinted variant, not a glass surface. Leave it untouched.

- [ ] **Step 2: Migrate the titlebar rule**

Use Grep: `pattern: "^\\.titlebar\\b"`, `path: "src/App.css"`, `output_mode: "content"`, `-n: true`, `-A: 10`.

Find the rule (likely near App.css:257 or in the area covered by the recent W7 work). Locate the `background:`, `backdrop-filter:`, `-webkit-backdrop-filter:`, and `border:` declarations.

Replace them with:

```css
  background: var(--card-mid-fill);
  backdrop-filter: blur(var(--card-mid-blur)) saturate(var(--card-mid-saturate));
  -webkit-backdrop-filter: blur(var(--card-mid-blur)) saturate(var(--card-mid-saturate));
  border-bottom: 1px solid var(--card-mid-rim);
```

Preserve any titlebar-specific properties (height, padding, drag region attributes).

- [ ] **Step 3: Migrate the `.icon-rail, .account-sidebar, .conversation-list, .thread-workspace, .inspector-panel` group at App.css:957**

Find the rule at App.css:957+ (use Grep: `pattern: "^\\.icon-rail,"`, `path: "src/App.css"`, `output_mode: "content"`, `-n: true`, `-A: 15`).

This is a multi-selector rule. Locate its `background:`, `backdrop-filter:`, `border:` declarations.

Replace with:

```css
  background: var(--card-mid-fill);
  backdrop-filter: blur(var(--card-mid-blur)) saturate(var(--card-mid-saturate));
  -webkit-backdrop-filter: blur(var(--card-mid-blur)) saturate(var(--card-mid-saturate));
  border: 1px solid var(--card-mid-rim);
```

If the rule has more specific borders (e.g. `border-right` only on `.icon-rail`), preserve the layout-specific borders and only replace the chromatic ones.

- [ ] **Step 4: Migrate `.thread-workspace` at App.css:1633 if it has its own rule**

Use Grep: `pattern: "^\\.thread-workspace\\s*\\{"`, `path: "src/App.css"`, `output_mode: "content"`, `-n: true`, `-A: 10`.

If it has a standalone rule beyond the group at line 957, apply the same `--card-mid-*` substitution. If it doesn't (only appears in the group selector), this step is a no-op.

- [ ] **Step 5: Migrate any mid-tier surfaces in system-audio.css**

Use Grep: `pattern: "backdrop-filter|background:\\s*rgba"`, `path: "src/styles/system-audio.css"`, `output_mode: "content"`, `-n: true`.

For surfaces with rgba alpha around 0.04-0.08 + blur 16-22px (mid range), substitute mid tokens. For surfaces with rgba alpha 0.025 (very faint, e.g. system-audio.css:78, 90, 183), these are inner panels not main surfaces — leave them untouched.

The mid-range candidate is system-audio.css:146-147:

```css
  backdrop-filter: blur(18px) saturate(120%);
  -webkit-backdrop-filter: blur(18px) saturate(120%);
```

Replace with:

```css
  backdrop-filter: blur(var(--card-mid-blur)) saturate(var(--card-mid-saturate));
  -webkit-backdrop-filter: blur(var(--card-mid-blur)) saturate(var(--card-mid-saturate));
```

Note this is a slight value change (18→20 blur, 120%→140% saturate). That's expected unification.

- [ ] **Step 6: Build and visual diff**

```bash
bun run build
bun run tauri dev
```

Compare titlebar, icon rail, sidebars, chat bubbles, and system-audio panels against baseline. Expected: noticeable shifts on these surfaces (current values are inconsistent — unification produces change). Compare side-by-side: do they still feel like premium glass? If a surface feels too dark/light, note it as an open-question item to revisit during tuning (don't tweak token values now — phase 1 is architectural).

- [ ] **Step 7: Commit**

```bash
git add src/App.css src/styles/system-audio.css
git commit -m "refactor(css): migrate mid-tier surfaces to --card-mid-* tokens (commit C)

Titlebar, icon rail, sidebars (account-sidebar, conversation-list,
inspector-panel), thread-workspace, and chat bubble surfaces now source
fill/blur/border from --card-mid-* via direct token substitution.
No JSX class changes. Removes per-surface 'rim glare' border-top
declarations in favor of single uniform mid-tier rim.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 (Commit D): Overlay tier migration — autocomplete, spotlight, context menus

**Files:**
- Modify: `src/editor/herosTheme.ts` (line 55, `.cm-tooltip-autocomplete`)
- Modify: `src/styles/search.css` (line 195, `.spotlight`)
- Modify: `src/styles/notes.css` (lines 313, 387, 573 — `.heros-menu` and similar overlay surfaces)

**Goal:** Floating overlay surfaces (autocomplete tooltips, spotlight, context menus) source from `--card-overlay-*` tokens. Visual change is expected: overlay tier defaults are lighter/more transparent than the current `--heros-glass-black` (rgba 9,12,22,0.98) — that's the unification.

- [ ] **Step 1: Migrate `.cm-tooltip-autocomplete` in `src/editor/herosTheme.ts:55`**

Open `src/editor/herosTheme.ts`. Find:

```ts
  '.cm-tooltip-autocomplete': {
    background: 'var(--heros-glass-black)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-container)',
    boxShadow: 'var(--shadow-lg)',
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    padding: 'var(--space-1)',
  },
```

Change the `background` line to:

```ts
    background: 'var(--card-overlay-fill)',
    backdropFilter: 'blur(var(--card-overlay-blur)) saturate(var(--card-overlay-saturate))',
    WebkitBackdropFilter: 'blur(var(--card-overlay-blur)) saturate(var(--card-overlay-saturate))',
    border: '1px solid var(--card-overlay-rim)',
```

Note: CodeMirror's `EditorView.theme()` accepts CSS-in-JS — `backdropFilter` and `WebkitBackdropFilter` (camelCase). Replace the `border:` line too.

- [ ] **Step 2: Migrate `.spotlight` in `src/styles/search.css:195`**

Open `src/styles/search.css`. Find:

```css
.spotlight {
  width: 100%;
  max-width: 600px;
  background: var(--heros-glass-black);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-container);
  box-shadow: var(--shadow-lg);
  ...
}
```

Replace with:

```css
.spotlight {
  width: 100%;
  max-width: 600px;
  background: var(--card-overlay-fill);
  backdrop-filter: blur(var(--card-overlay-blur)) saturate(var(--card-overlay-saturate));
  -webkit-backdrop-filter: blur(var(--card-overlay-blur)) saturate(var(--card-overlay-saturate));
  border: 1px solid var(--card-overlay-rim);
  border-radius: var(--radius-container);
  box-shadow: var(--shadow-lg);
  ...
}
```

- [ ] **Step 3: Migrate `.heros-menu` in `src/styles/notes.css:313`**

Open `src/styles/notes.css`. Find the rule at line 309-319:

```css
.heros-menu {
  position: fixed;
  z-index: 1000;
  background: var(--heros-glass-black);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-container);
  box-shadow: var(--shadow-lg);
  padding: var(--space-1);
  min-width: 160px;
  color: var(--heros-text-premium);
}
```

Replace with:

```css
.heros-menu {
  position: fixed;
  z-index: 1000;
  background: var(--card-overlay-fill);
  backdrop-filter: blur(var(--card-overlay-blur)) saturate(var(--card-overlay-saturate));
  -webkit-backdrop-filter: blur(var(--card-overlay-blur)) saturate(var(--card-overlay-saturate));
  border: 1px solid var(--card-overlay-rim);
  border-radius: var(--radius-container);
  box-shadow: var(--shadow-lg);
  padding: var(--space-1);
  min-width: 160px;
  color: var(--heros-text-premium);
}
```

- [ ] **Step 4: Migrate the other two overlay surfaces in notes.css at lines 387 and 573**

Use Grep: `pattern: "background:\\s*var\\(--heros-glass-black\\)"`, `path: "src/styles/notes.css"`, `output_mode: "content"`, `-n: true`, `-B: 8`.

For each remaining hit, look at the parent selector (the lines above show the rule's `}`-bounded class). Classify:

- If the selector ends in `:hover` or contains `tr:hover td` / similar → **row hover** (handled in commit E, leave for now)
- If the selector is a popup/menu/tooltip surface (e.g. `.notes-tab-menu`, `.notes-popup`, `.notes-autocomplete`) → **overlay**, migrate now

For overlay matches, apply the same substitution as step 3 (background + backdrop-filter + border, keep other properties).

- [ ] **Step 5: Build and visual diff**

```bash
bun run build
bun run tauri dev
```

Trigger Spotlight (Cmd+K), open the notes editor and trigger the slash menu (`/`) and wikilink autocomplete (`[[`), right-click in the tree to open `.heros-menu`. Compare against baseline screenshots.

Expected: visible change. The current overlays are nearly opaque (rgba alpha 0.98), the new overlay tier is rgba alpha 0.72 — they'll look more transparent and "floaty". Confirm this reads as a premium glass effect rather than "broken / unreadable". If text contrast is poor on the lighter overlay, note it as a tuning candidate for phase 2 (don't change token values now).

- [ ] **Step 6: Commit**

```bash
git add src/editor/herosTheme.ts src/styles/search.css src/styles/notes.css
git commit -m "refactor(css): migrate overlay surfaces to --card-overlay-* tokens (commit D)

Spotlight, slash-menu autocomplete, wikilink autocomplete, .heros-menu
context menu, and notes overlay surfaces now source from
--card-overlay-* tokens. Adds backdrop-filter + saturate to surfaces
that previously had only opaque fill, completing the liquid-glass
treatment for floating layers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 (Commit E): Row-hover rename — `--heros-glass-black*` → `--row-hover-fill*`

**Files:**
- Modify: `src/App.css` (lines 1492, 2838, 2862, 2891, 2951, 3032, 3058)
- Modify: `src/styles/notes.css` (lines 387 and/or 573 if they're row-hover, not overlay)
- Modify: `src/components/VaultSidebar.tsx` (line 104, inline-style search input)
- Modify: `src/App.css` (delete the deprecation aliases at lines ~88-89)

**Goal:** Rename the two legacy tokens to clearer names. Behavior preserved — values are identical. Pure semantic cleanup.

- [ ] **Step 1: Replace `--heros-glass-black` with `--row-hover-fill` in App.css row-hover sites**

Use Grep to confirm remaining call-sites: `pattern: "var\\(--heros-glass-black\\)"`, `path: "src/App.css"`, `output_mode: "content"`, `-n: true`.

For each match (lines 1492, 2838, 2862, 2891, 3032, 3058 — based on the scout above), edit the file:

| Line | Selector | Replace |
|---|---|---|
| 1492 | `.conversation-row:hover` | `var(--heros-glass-black)` → `var(--row-hover-fill)` |
| 2838 | `.db-view:hover` | same |
| 2862 | `.db-pill:hover` | same |
| 2891 | `.db-table tr:hover td` | same |
| 3032 | `.list-row:hover` | same |
| 3058 | `.import-row-hover:hover` | same |

Use Edit tool with `replace_all: false` and unique context for each, or a single Edit tool call with `replace_all: true` if the substring `var(--heros-glass-black)` is unique to row-hover sites (it should be after commit D moved overlay sites to overlay tokens).

Verify uniqueness with Grep first: `pattern: "var\\(--heros-glass-black\\)(?!-deep)"`, `path: "src/App.css"`. If only row-hover sites match, use `replace_all: true`.

- [ ] **Step 2: Replace `--heros-glass-black-deep` with `--row-hover-fill-deep` in App.css:2951**

Use Edit tool:

```
old: var(--heros-glass-black-deep)
new: var(--row-hover-fill-deep)
replace_all: true
```

Verify with Grep first that all `--heros-glass-black-deep` usages are now row-hover (the only known one is `.kan-card:hover` at line 2951; commit A's deprecation aliases mean no other CSS file should reference it directly anymore).

- [ ] **Step 3: Migrate any remaining `--heros-glass-black` usages in notes.css that turned out to be row-hover (not overlay)**

If commit D step 4 left any notes.css `--heros-glass-black` references because they were classified as row-hover, replace those now with `--row-hover-fill`.

Run Grep to confirm: `pattern: "--heros-glass-black"`, `path: "src/styles/notes.css"`, `output_mode: "content"`, `-n: true`. Replace all remaining hits.

- [ ] **Step 4: Migrate the inline-style usage in `src/components/VaultSidebar.tsx:104`**

Open `src/components/VaultSidebar.tsx`. Find line 104:

```tsx
          style={{ width: '100%', background: 'var(--heros-glass-black)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 10px 8px 32px', fontSize: '12px', color: '#fff', outline: 'none' }}
```

This is a search input. The current `--heros-glass-black` (almost-opaque dark) was being used as an input field background. The semantic right answer is `--surface-2` (the existing input-field token from the Material scale at App.css:37) — NOT `--row-hover-fill` (it's not a hover state) and NOT a card token (it's an input).

Replace `var(--heros-glass-black)` with `var(--surface-2)`:

```tsx
          style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 10px 8px 32px', fontSize: '12px', color: '#fff', outline: 'none' }}
```

This produces a slight visual change (the input is now a translucent white surface instead of opaque dark) — that's expected unification with the rest of the input-field tokens.

- [ ] **Step 5: Delete the deprecation aliases for row-hover tokens**

Open `src/App.css`. Find the block at the area you edited in Task 1, Step 1:

```css
  /* Standardized Hover Colors — DEPRECATED, retained as aliases during migration.
     Removed in commits E (row-hover rename) and F (--heros-glass-fill retire). */
  --heros-glass-black: var(--row-hover-fill);
  --heros-glass-black-deep: var(--row-hover-fill-deep);
```

Delete these three lines (the comment + the two `--heros-glass-black*: ...` lines). The `--heros-glass-fill` alias (which is in a different block) stays for commit F.

- [ ] **Step 6: Verify zero `--heros-glass-black` references remain**

Run two greps:

Use Grep: `pattern: "--heros-glass-black\\b"`, `path: "src"`, `output_mode: "content"`. Expected: zero matches.

Use Grep: `pattern: "--heros-glass-black-deep"`, `path: "src"`, `output_mode: "content"`. Expected: zero matches.

If any matches remain, edit those files to use `--row-hover-fill` / `--row-hover-fill-deep` accordingly.

- [ ] **Step 7: Build and visual diff**

```bash
bun run build
bun run tauri dev
```

Hover over rows in: conversation list, database table, kanban board, list view, import view. Verify hover backgrounds work identically to baseline (values are unchanged — pure rename). Verify the VaultSidebar search input renders (slight visual change expected per step 4).

- [ ] **Step 8: Commit**

```bash
git add src/App.css src/styles/notes.css src/components/VaultSidebar.tsx
git commit -m "refactor(css): rename --heros-glass-black* to --row-hover-fill* (commit E)

Pure semantic rename — values unchanged. The legacy tokens were misnamed:
they're row-hover fills, not card surfaces. Renamed to --row-hover-fill
and --row-hover-fill-deep across App.css, notes.css, and the inline
VaultSidebar search input. Inline VaultSidebar input migrates to
--surface-2 (correct input-field token). Deprecation aliases for
--heros-glass-black* removed from :root.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 (Commit F): Retire `--heros-glass-fill` + delete App.tsx theme effect

**Files:**
- Modify: `src/App.css` (line 76 token, line 204 reference, line 2730 login-mode override)
- Modify: `src/App.tsx` (delete useEffect block at lines 92-176, preserve celebrationService call)

**Goal:** Last legacy token removed. Runtime token-mutation `useEffect` (theme-module leftover per CLAUDE.md Rule 12) deleted. Final architectural cleanup.

- [ ] **Step 1: Update `.login-mode` override at App.css:2730**

Use Grep to find the exact location: `pattern: "\\.login-mode\\s*\\{"`, `path: "src/App.css"`, `output_mode: "content"`, `-n: true`, `-A: 8`.

Find:

```css
.login-mode {
  --heros-glass-fill: rgba(255, 255, 255, 0.12); /* Denser glass for login */
  ...
}
```

Replace `--heros-glass-fill: rgba(255, 255, 255, 0.12)` with `--panel-fill: rgba(255, 255, 255, 0.12)`. The `.login-mode` body modifier now overrides the panel token directly, preserving the contextual brightening of the lock surface.

```css
.login-mode {
  --panel-fill: rgba(255, 255, 255, 0.12); /* Denser glass for login */
  ...
}
```

- [ ] **Step 2: Verify no other `--heros-glass-fill` references remain**

Use Grep: `pattern: "--heros-glass-fill"`, `path: "src"`, `output_mode: "content"`, `-n: true`.

Expected matches at this point:
- `src/App.css:76` — the original token definition (about to delete)
- `src/App.tsx:137, 155, 164` — the runtime mutation (about to delete in step 5)

If any other matches appear (e.g. `App.css:204` from the original combined-rule body), edit them. Most should be gone after commit A's class-structure rewrite, but double-check.

- [ ] **Step 3: Delete the `--heros-glass-fill` token from `:root`**

Open `src/App.css`. Find line 76:

```css
  --heros-glass-fill:       rgba(10, 14, 26, 0.99);
```

Delete this line. The token is now fully retired.

- [ ] **Step 4: Delete the unused `--heros-glass-blur` and `--heros-glass-saturate` tokens if no longer referenced**

These were declared at App.css:77-78 to support the deleted theme module. Check if anything still uses them:

Use Grep: `pattern: "--heros-glass-(blur|saturate)\\b"`, `path: "src"`, `output_mode: "content"`.

If zero matches outside the `:root` block, delete the two lines from App.css. If anything still references them (unlikely), leave them and note in commit message.

- [ ] **Step 5: Delete the runtime token-mutation `useEffect` in `src/App.tsx`**

Open `src/App.tsx`. Find the block starting around line 92:

```tsx
  // Sync HerOS Design Tokens with Vault Preferences
  React.useEffect(() => {
    if (vaultData?.uiPreferences) {
      const prefs = vaultData.uiPreferences;
      const root = document.documentElement;
      
      if (prefs.themeColor) {
        root.style.setProperty('--heros-brand', prefs.themeColor);
        ...
      }
      
      if (prefs.glassIntensity !== undefined) {
        ...
      }
      
      if (prefs.grainIntensity !== undefined) {
        ...
      }
      
      // Also sync celebration service
      celebrationService.setPreferences(prefs);
    }
  }, [vaultData?.uiPreferences]);
```

Replace this entire block with a smaller effect that only preserves the `celebrationService.setPreferences(prefs)` call:

```tsx
  // Sync celebration service preferences with vault prefs.
  // Note: design-token mutation (theme color, glass intensity, etc.) was
  // removed per CLAUDE.md Rule 12 (no runtime theme switching). Tokens are
  // statically declared in App.css :root.
  React.useEffect(() => {
    if (vaultData?.uiPreferences) {
      celebrationService.setPreferences(vaultData.uiPreferences);
    }
  }, [vaultData?.uiPreferences]);
```

Verify the imports for `celebrationService` and `React` are still in scope at the top of the file. Don't change them.

- [ ] **Step 6: Run build to verify no TypeScript errors**

```bash
bun run build
```

Expected: zero new errors. The deletion removes references to `prefs.themeColor`, `prefs.glassIntensity`, `prefs.grainIntensity` — these fields still exist in the types so unused-field warnings shouldn't surface, but if any TypeScript "field declared but unused in destructuring" warnings appear, ignore them (the types are kept for forward-compatibility).

- [ ] **Step 7: Run final verification greps (per spec §7)**

Run all of these via the Grep tool — every one must come back at the expected count:

| Pattern | Files | Expected |
|---|---|---|
| `pattern: "rgba\\(0,\\s*0,\\s*0,\\s*0\\."`, `path: "src/App.css"` | App.css | only inside `:root` |
| `pattern: "rgba\\(0,\\s*0,\\s*0,\\s*0\\."`, `path: "src/styles/notes.css"` | notes.css | zero or only in comments |
| `pattern: "backdrop-filter:\\s*blur\\(\\d+px\\)"`, `path: "src"` | all | only in `:root` and the panel rule |
| `pattern: "\\.notes-[a-z-]+\\.heros-glass-card"`, `path: "src/styles/notes.css"` | notes.css | zero matches |
| `pattern: "--heros-glass-fill\\b"`, `path: "src"` | all | zero matches |
| `pattern: "--heros-glass-black"`, `path: "src"` | all | zero matches |
| `pattern: "setProperty\\(['\"]--heros-"`, `path: "src/App.tsx"` | App.tsx | zero matches |

For any failed expectation, address before committing.

- [ ] **Step 8: Final visual diff against baseline**

```bash
bun run tauri dev
```

Walk every surface from Task 0's screenshot list. For each:

- Take a fresh screenshot
- Compare side-by-side against the baseline PNG

Expected outcomes per spec §7:

- **Deep tier surfaces** (notes editor, db-table, system-audio, backlinks): pixel-identical to baseline. Tier defaults match the user's locked values exactly.
- **Mid tier surfaces** (titlebar, sidebars, chat bubbles): visible unification change — should still feel like premium glass, just consistent across surfaces.
- **Overlay tier surfaces** (spotlight, autocomplete, context menus): visibly more transparent than before (going from rgba 0.98 → 0.72). Should read as floating glass over content.
- **Panel tier surfaces** (loading screen, lock overlay, onboarding, playlist modal): pixel-identical (token values match the original literal values).
- **Row-hover surfaces**: pixel-identical (pure rename).

If any deep or panel surface shows unexpected change, investigate before committing — it indicates a token resolution bug.

- [ ] **Step 9: Commit**

```bash
git add src/App.css src/App.tsx
git commit -m "refactor(css): retire --heros-glass-fill, delete App.tsx theme effect (commit F)

Final cleanup. Removes:
- --heros-glass-fill from :root (last legacy alias)
- --heros-glass-blur and --heros-glass-saturate (orphaned)
- The runtime token-mutation useEffect in App.tsx (theme-module
  leftover per CLAUDE.md Rule 12 — no UI exposed prefs.themeColor /
  glassIntensity / grainIntensity, so no user-facing control breaks)

Updates .login-mode body modifier to override --panel-fill (was
--heros-glass-fill), preserving the lock-screen brightening pattern.

Closes the card-glass-tiers refactor. Future card surface tuning is
now a one-line edit in App.css :root.

Spec: docs/superpowers/specs/2026-04-25-card-glass-tiers-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Capture post-migration screenshots and resolve open questions

**Goal:** Provide visual evidence of the refactor for the user's "after work" review (per spec §2). Resolve the four flagged open questions while the running app is still in front of the user.

- [ ] **Step 1: Capture post-migration screenshots**

With `bun run tauri dev` still running (or relaunch), retake every screenshot from Task 0 with the same filenames, into a parallel directory:

```bash
mkdir -p docs/superpowers/specs/baselines/2026-04-25-card-tiers-after
```

Save each retaken screenshot under `docs/superpowers/specs/baselines/2026-04-25-card-tiers-after/` with the same filename (`01-notes-editor.png`, etc.).

- [ ] **Step 2: Resolve spec §2 open questions with user (interactive)**

For each open question in the spec, walk the user through the running app and confirm:

1. **`.heros-glass-bubble` (chat bubbles) — `mid` or `deep`?**
   - Currently mid. Open BuddyView or ThreadWorkspace with chat bubbles visible.
   - Ask: "Do these bubbles feel like the same material as the notes editor (deep), or distinct chrome (mid)?"
   - If user wants deep: edit App.css `.heros-glass-bubble` rule to use `--card-deep-*` tokens; recommit as commit G.

2. **`.titlebar` — `mid` or `deep`?**
   - Currently mid. Look at the titlebar against the notes editor side-by-side.
   - Ask: "Should the titlebar feel lighter than content (mid) or as heavy as content (deep)?"
   - If user wants deep: edit titlebar rule similarly.

3. **Any glass surface missed?** Walk the full app — every page, every modal, every dropdown. List any surface that still looks "off" or wasn't migrated. Add follow-up tasks if needed.

4. **ImportView side panels — `panel` or `card`?** Open ImportView, look at the URL inbox + Recent jobs panels.
   - Currently inherit `--panel-*` (bright). Ask: "Do these feel right as bright entry-experience material, or should they be dark like content cards?"
   - If user wants card: change `<section className="import-view__panel heros-glass-panel">` to `<section className="import-view__panel heros-glass-card heros-glass-card--mid">` in `src/components/ImportView.tsx:447, 489`.

- [ ] **Step 3: Commit any resolution edits**

If steps 2 produced any edits, commit each as its own atomic commit:

```bash
git add <changed-files>
git commit -m "refactor(css): move <surface> from <old-tier> to <new-tier> (post-review)

Resolved during user-review of card-glass-tiers refactor. <Brief why>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

If no edits were produced (everything looked right), this step is a no-op.

- [ ] **Step 4: Commit post-migration screenshots**

```bash
git add docs/superpowers/specs/baselines/2026-04-25-card-tiers-after/
git commit -m "docs(css): post-migration screenshots for card-glass-tiers refactor

Visual evidence of the refactor outcome. Compare against
baselines/2026-04-25-card-tiers/ for the diff. Per spec §7:
- deep tier surfaces unchanged
- mid/overlay/panel surfaces show expected unification
- row-hover unchanged (pure rename)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Definition of Done (from spec §8)

After all tasks complete, verify all of these are true:

1. ✅ New `--card-{deep,mid,overlay}-*`, `--panel-*`, and `--row-hover-fill{,-deep}` token blocks exist in `src/App.css :root` under documented banners.
2. ✅ `.heros-glass-card` has `--deep`, `--mid`, `--overlay` BEM modifiers; bare class falls back to deep.
3. ✅ `.heros-glass-panel` is a single rule sourcing from `--panel-*` tokens; removed from the App.css:202 combined rule.
4. ✅ Every glass surface in the four migration files is mapped to a tier (or row-hover, or panel).
5. ✅ notes.css:749-755 specificity hack is **deleted**.
6. ✅ `--heros-glass-fill`, `--heros-glass-black`, `--heros-glass-black-deep` are **removed** from `:root`.
7. ✅ `.login-mode` body modifier overrides `--panel-fill`, not `--heros-glass-fill`.
8. ✅ The five verification greps (per spec §7) come back clean.
9. ✅ Baseline + post-migration screenshots captured under `docs/superpowers/specs/baselines/2026-04-25-card-tiers{,-after}/`.
10. ✅ Open questions in spec §2 are explicitly revisited with user; tier assignments confirmed or moved.
11. ✅ `bun run build` passes with zero new errors.
12. ✅ `bunx vitest run` passes (no test changes expected — this is pure CSS refactor).

When all checks pass, the refactor is complete. Future card surface tuning is a one-line edit to the relevant `--card-*` or `--panel-*` token in `src/App.css :root`.
