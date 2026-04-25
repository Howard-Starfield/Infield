# Card Glass Tiers — token consolidation for liquid-glass surfaces

**Status:** design locked 2026-04-25 · ready for implementation plan
**Phase:** Cross-cutting CSS architecture refactor. No Rust changes. Independent of W-phase wiring work.
**Companion docs:** [CLAUDE.md Rule 12](../../../CLAUDE.md) (token discipline) · [CLAUDE.md Rule 18](../../../CLAUDE.md) (CSS hygiene).

---

## 1. Goal

Consolidate the sprawling, half-overlapping CSS surface tokens into a
clean tiered system so future visual tuning is a one-line edit in
`src/App.css :root` instead of a multi-file specificity hunt.

The trigger: tweaking the notes editor card background recently
required hunting through both `App.css` (`.heros-glass-card` base) and
`src/styles/notes.css:749-755` (a double-class specificity hack), and
similar patterns are duplicated across `.db-table thead th`,
system-audio panels, and backlinks. The goal is to retain the current
premium liquid-glass depth while making "nudge the notes card a hair
darker" a 30-second edit.

After this lands, every glass surface in the app sources its
appearance from one of three named tiers (`--card-deep-*`,
`--card-mid-*`, `--card-overlay-*`), each with four axes
(`fill`, `blur`, `saturate`, `rim`). Editing one tier shifts every
surface mapped to it, in lockstep.

This is a **dev-ergonomics refactor**, not a runtime feature. CLAUDE.md
Rule 12 (no runtime theme switching, no preset system, no `tokens.ts`)
stays fully intact.

---

## 2. Open questions to verify after work

These are decisions the user wants to revisit visually before
finalizing tier assignment:

1. **`.heros-glass-bubble` (chat bubbles) — `mid` or `deep`?**
   Currently mapped to `mid` (atomic UI, lighter than content). If
   bubbles should feel like the same material as the notes editor,
   move to `deep`.
2. **`.titlebar` — `mid` or `deep`?** Currently mapped to `mid` under
   "chrome should feel lighter than content". Current values
   (`blur(20px) saturate(180%)`) are heavier than the notes deep card,
   so this is a judgment call worth confirming on-screen.
3. **Any glass surface missed?** Tier mapping in §4 is drafted from a
   codebase grep; user should walk the running app and call out any
   surface not assigned.

---

## 3. Scope

### Included

1. **New token block** in `src/App.css :root` defining 12 tier tokens
   plus the deprecation aliases (§5).
2. **Class structure** — `.heros-glass-card` and `.heros-glass-panel`
   gain `--deep` / `--mid` / `--overlay` BEM modifiers (§5).
3. **Default fallback** — `.heros-glass-card` alone (no modifier)
   resolves to `--deep`. Preserves current visual default for any
   call-site we miss.
4. **Migration of every glass surface** in:
   - `src/App.css`
   - `src/styles/notes.css`
   - `src/styles/system-audio.css`
   - `src/styles/onboarding.css`
5. **Retirement** of three legacy tokens after migration:
   `--heros-glass-fill`, `--heros-glass-black`, `--heros-glass-black-deep`.
6. **Deletion** of the notes.css specificity hack
   (`.notes-tree-root.heros-glass-card,
   .notes-editor-column.heros-glass-card,
   .notes-backlinks.heros-glass-card`, lines 749-755).
7. **Baseline screenshot capture** before migration starts, retake
   after each tier's commit, diff visually. Phase 1 = zero visual
   change.

### Explicitly excluded

- **Tuning default tier values past current state.** This refactor is
  architectural cleanup, not value-tuning. The deep tier preserves
  the user's recently-locked values exactly. Mid and overlay tiers
  will produce *some* visual change for surfaces currently using
  inconsistent rgba values — that change is unification, not tuning.
  Intentional tier-value tuning happens in a follow-up sit-down once
  all three tiers are visible side by side and the user has confirmed
  the open questions in §2.
- **`--surface-container-*` Material scale.** Used by non-card surfaces
  (`.account-badge`, `.filter-tab`, `.provider-card`, etc.). Different
  concern, different audit, deferred.
- **`--surface-1/2/hover/active` semantic aliases.** These are
  hover/active states for cells/buttons inside cards, not card
  surfaces themselves. Cards don't hover — things inside them do.
- **`heros.css` and `blobs.css`.** Verbatim ports from `copy/src/app.css`
  per CLAUDE.md Rule 12 carve-out. Original literal values stay.
- **Settings UI / runtime sliders / per-card live control.**
  Contradicts CLAUDE.md Rule 12 and the deferred-list directive that
  the theme module was deleted intentionally. User explicitly chose
  dev-ergonomics-only when offered runtime/dev-panel/hybrid options.

---

## 4. Tier mapping

### `--card-deep-*` — primary content panes

Heaviest fill, lowest blur. The "this is where work happens" surface.

- `.heros-glass-card` base (App.css)
- `.heros-glass-panel` base (App.css)
- `.notes-tree-root`, `.notes-editor-column`, `.notes-backlinks`
  (notes.css — replaces the deleted specificity hack)
- `.db-table thead th` (App.css:2881 — current source-of-truth visual)
- System-audio primary panels (system-audio.css)

### `--card-mid-*` — chrome and secondary surfaces

Medium fill, medium blur. Floats above content but isn't itself
content.

- `.titlebar` / `.heros-titlebar` (~App.css:257) — *flagged in §2*
- `.icon-rail` background
- `.thread-workspace` outer frame
- `.heros-glass-bubble` / `.heros-glass-bubble-me` — *flagged in §2*
- Sidebar surfaces in DashboardView, ImportView, ActivityView

### `--card-overlay-*` — floating layers above content

Lightest fill, highest blur. Anything that appears, dismisses, and
shows the content layer faintly through it.

- `.cm-tooltip-autocomplete` (slash menu, wikilink autocomplete)
- `.spotlight-*` (Cmd+K quick open, onboarding spotlights)
- `.cm-cursor-tooltip` and other CM6 tooltips
- Popovers, dropdowns, context menus
- The lock overlay (`.login-mode`)

---

## 5. Token architecture

New block in `src/App.css :root` under a clearly-marked banner:

```css
/* === CARD GLASS TIERS ===================================================
   Three depth tiers for every glass surface in the app. Edit the values
   here to shift every surface mapped to a tier in lockstep. See
   docs/superpowers/specs/2026-04-25-card-glass-tiers-design.md for the
   tier-to-surface mapping.
   ====================================================================== */

/* Deep — primary content panes */
--card-deep-fill:        rgba(0, 0, 0, 0.28);
--card-deep-blur:        12px;
--card-deep-saturate:    100%;
--card-deep-rim:         rgba(255, 255, 255, 0.10);

/* Mid — chrome and secondary surfaces */
--card-mid-fill:         rgba(0, 0, 0, 0.18);
--card-mid-blur:         20px;
--card-mid-saturate:     140%;
--card-mid-rim:          rgba(255, 255, 255, 0.08);

/* Overlay — floating layers above content */
--card-overlay-fill:     rgba(10, 14, 26, 0.72);
--card-overlay-blur:     28px;
--card-overlay-saturate: 160%;
--card-overlay-rim:      rgba(255, 255, 255, 0.12);
```

### Deep starting values

Match the values the user already locked in during the recent debug
session: `rgba(0, 0, 0, 0.28)` + `blur(12px)`. Phase 1 produces zero
visual change for any surface mapped to deep.

### Mid + overlay starting values

Educated starting points the user dials in after migration. Mid sits
between deep and overlay on every axis. Overlay uses a slightly tinted
fill (`rgba(10, 14, 26, ...)` rather than pure black) to read as a
distinct material against the content layer.

### Saturate kept as a separate axis

User-confirmed: saturate is what makes glass feel "alive" rather than
flat blur. Yoking it to blur would lose that dial.

### Class structure

```css
.heros-glass-card {
  /* shared geometry only — no fill/blur/border here */
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  transition: background 200ms ease;
}

.heros-glass-card,           /* default fallback = deep */
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

`.heros-glass-panel` follows the identical pattern.

### Deprecation aliases (transitional, single commit)

Before retirement, the three doomed tokens alias to their new
equivalents so the migration can proceed call-site-by-call-site:

```css
/* Deprecated — migrate call sites then delete in final commit */
--heros-glass-fill:       var(--card-deep-fill);
--heros-glass-black:      var(--card-deep-fill);
--heros-glass-black-deep: var(--card-overlay-fill);
```

These aliases survive only until §6's final retirement commit.

---

## 6. Migration mechanics

### Sequence (one tier per commit)

1. **Commit A — token block + class modifiers + aliases.** Add the new
   `:root` block, add the BEM modifier classes to `.heros-glass-card`
   and `.heros-glass-panel`, install the deprecation aliases for the
   three doomed tokens. No call sites change. No visual change.
2. **Commit B — deep tier migration.** Add `heros-glass-card--deep`
   modifier to JSX call-sites for deep-tier surfaces. Delete the
   notes.css specificity hack (lines 749-755). Replace any raw
   `rgba(0,0,0,0.28)` literals in deep-tier CSS with
   `var(--card-deep-fill)`.
3. **Commit C — mid tier migration.** Same recipe for mid-tier
   surfaces. Migrate `.titlebar`, `.icon-rail`, chat bubbles, sidebars.
4. **Commit D — overlay tier migration.** Same recipe for
   `.cm-tooltip-autocomplete`, `.spotlight-*`, lock overlay, etc.
5. **Commit E — retire deprecated tokens.** Delete
   `--heros-glass-fill`, `--heros-glass-black`,
   `--heros-glass-black-deep` from `:root`. Verify zero references via
   grep before commit.

Each commit is independently revertable. If commit C makes the
titlebar look wrong, revert C and the design system is back to a
working state with deep tier migrated.

### Three migration recipes

**(a) JSX components.** Add modifier class explicitly:
```tsx
<div className="heros-glass-card heros-glass-card--deep notes-editor-column">
```
~15 sites across NotesView, BacklinksPane, SystemAudioView.

**(b) Specificity hacks.** Delete entirely. The new tier modifier
replaces the override.
```css
/* DELETE notes.css:749-755 */
.notes-tree-root.heros-glass-card,
.notes-editor-column.heros-glass-card,
.notes-backlinks.heros-glass-card { ... }
```

**(c) Hardcoded rgba in CSS.** Substitute the matching tier token:
```css
/* notes.css:792 — system-audio variant */
- background: rgba(6, 9, 20, 0.46) !important;
+ background: var(--card-mid-fill);
```
The `!important` typically goes away with the substitution because
the original was fighting the `.heros-glass-card` base override that
no longer exists.

---

## 7. Verification

### Visual baseline (mandatory)

CSS refactors are exactly the kind of work where "tests pass" doesn't
mean "nothing changed". A token mapped to the wrong tier will look
subtly wrong on one surface in a way grep can't catch.

**Before commit A**, capture baseline screenshots of every surface in
scope under `docs/superpowers/specs/baselines/2026-04-25-card-tiers/`:

- Notes editor (with sidebar tree expanded)
- Database view with table header visible
- System audio recording view
- Backlinks pane
- Titlebar
- Slash menu open in editor
- Wikilink autocomplete open
- Spotlight (Cmd+K) open
- Chat bubble in any visible bubble surface
- Lock overlay (Cmd+L)

**After each migration commit (B, C, D)**, retake screenshots of the
surfaces affected by that tier and diff visually against baseline.

**The bar:** pixel-identical for surfaces using current values.
Surfaces whose current values differ from the new tier defaults
(notably mid and overlay) will show *expected* visual change — those
are the cases where the user dials in tier values during phase 2.

### Verification greps

After commit E, four searches (regex patterns, run via Grep tool or
ripgrep) must come back at the expected level:

| Regex pattern | Files searched | Expected |
|---|---|---|
| `rgba\(0,\s*0,\s*0,\s*0\.` | App.css, notes.css, system-audio.css, onboarding.css | Hits only inside `:root` token definitions |
| `backdrop-filter:\s*blur\(\d+px\)` | same files | Hits only inside `:root` token definitions |
| `\.notes-[a-z-]+\.heros-glass-card` (specificity hack) | notes.css | Zero matches |
| `--heros-glass-fill\|--heros-glass-black\|--heros-glass-black-deep` | entire `src/` tree | Zero matches |

### Build + tests

Per CLAUDE.md Definition of Done:
- `bun run build` zero new errors
- `bunx vitest run` green
- `cargo test --lib` green (no Rust changes — sanity check only)

### Functional smoke test in `bun run tauri dev`

Open notes view, navigate the tree, open a database view, trigger the
slash menu, open spotlight (Cmd+K), trigger autocomplete with `[[`,
lock with Cmd+L. Every surface should render and behave identically
to baseline.

---

## 8. Definition of Done

In addition to CLAUDE.md's standard DoD:

1. New `--card-{deep,mid,overlay}-*` token block exists in
   `src/App.css :root` under the documented banner.
2. `.heros-glass-card` and `.heros-glass-panel` have `--deep`, `--mid`,
   `--overlay` BEM modifiers; bare class falls back to deep.
3. Every glass surface in the four migration files is mapped to a tier.
4. notes.css:749-755 specificity hack is **deleted**.
5. `--heros-glass-fill`, `--heros-glass-black`,
   `--heros-glass-black-deep` are **removed** (not aliased) from `:root`.
6. The three verification greps (§7) come back clean.
7. Baseline + post-migration screenshots captured under
   `docs/superpowers/specs/baselines/2026-04-25-card-tiers/`.
8. Open questions in §2 are explicitly revisited by the user with
   running app visible; tier assignments confirmed or moved.

---

## 9. Risks

**Backdrop-filter compositing artifacts.** Adding `backdrop-filter` to
an ancestor creates a new containing block for `position: fixed`
descendants — the exact bug fixed in the recent CM6 tooltip work.
Mitigation: tier modifiers don't change *whether* a surface has
backdrop-filter (almost all already did), only the value. The CM6
tooltip fix (`tooltips({ parent: document.body })`) already moves the
problem element out of any glass containing block.

**Cumulative cost of re-paints during migration.** Each new
`backdrop-filter` declaration is a GPU-side compositing layer.
Migration consolidates declarations via tokens but doesn't add new
compositing — surface count stays the same. No regression expected.

**Verbatim-port drift.** The migration explicitly excludes `heros.css`
and `blobs.css`. If a future port from `copy/` adds new glass surfaces
to those files, they retain their original literal values per Rule 12
carve-out. The tier system is for app-side surfaces only.

---

## 10. Out of scope (parked)

- Intentional tier-value tuning past current state. Happens in a
  follow-up sit-down once this refactor lands and the user can see all
  three tiers side by side.
- Migrating `--surface-container-*` Material scale (separate audit).
- Settings UI for live tier control (contradicts Rule 12).
- Verbatim-port file modifications.
- New tier introduction (e.g., a fourth `--card-floating-*` for chips).
  If needed, it's a follow-up edit to this same `:root` block.
