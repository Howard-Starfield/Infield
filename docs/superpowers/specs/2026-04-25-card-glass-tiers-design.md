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
appearance from one of four named groups:

- Three **card** tiers for dark content surfaces:
  `--card-deep-*`, `--card-mid-*`, `--card-overlay-*`.
- One **panel** group for the bright entry-experience shell glass:
  `--panel-*`.

Each group has four axes (`fill`, `blur`, `saturate`, `rim`). Editing
one group shifts every surface mapped to it, in lockstep. Cards and
panels are deliberately separate **materials** — cards are dark
content surfaces; panel is the bright airy glass used by
LoadingScreen, LoginPage, OnboardingFlow, the lock overlay, and the
PlaylistSelectorModal.

Two legacy tokens (`--heros-glass-black`, `--heros-glass-black-deep`)
that were *misnamed* — they're row-hover fills, not card surfaces —
get **renamed** to `--row-hover-fill` / `--row-hover-fill-deep`,
preserving their behavior while fixing the semantics.

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
4. **Should ImportView's side panels (`.import-view__panel`) belong
   to `--panel-*` or `--card-*`?** Currently use `.heros-glass-panel`
   (so they inherit panel — the bright entry-experience material), but
   they're inside the main app shell, not the entry experience. May
   feel out of place. Confirm visually after migration.

---

## 3. Scope

### Included

1. **New token blocks** in `src/App.css :root`:
   - 12 card-tier tokens (`--card-{deep,mid,overlay}-{fill,blur,saturate,rim}`)
   - 4 panel tokens (`--panel-{fill,blur,saturate,rim}`)
   - 2 row-hover renames (`--row-hover-fill`, `--row-hover-fill-deep`)
   - Plus deprecation aliases for the migration window (§5).
2. **Class structure** — `.heros-glass-card` gains
   `--deep` / `--mid` / `--overlay` BEM modifiers (§5).
   `.heros-glass-panel` gets a single rule sourced from `--panel-*`
   tokens (no modifiers; it's one material).
3. **Default fallback** — `.heros-glass-card` alone (no modifier)
   resolves to `--deep`. Preserves current visual default for any
   call-site we miss.
4. **Migration of every glass surface** in:
   - `src/App.css`
   - `src/styles/notes.css`
   - `src/styles/system-audio.css`
   - `src/styles/onboarding.css`
5. **Sidebar / chrome surfaces without `.heros-glass-card` class**
   (`.icon-rail`, `.thread-workspace`, `.account-sidebar`,
   `.conversation-list`, `.inspector-panel`, `.titlebar`) migrate via
   **direct token substitution** in their existing CSS rules — no
   class changes in JSX.
6. **Retirement of `--heros-glass-fill`** after migration.
7. **Rename `--heros-glass-black` → `--row-hover-fill`** and
   `--heros-glass-black-deep` → `--row-hover-fill-deep`. These are
   row-hover states (`.db-view:hover`, `.kan-card:hover`,
   `.list-row:hover`, `.db-table tr:hover td`, `.db-pill:hover`),
   not card surfaces. Behavior preserved; semantics fixed.
8. **`.login-mode` local override** updated to redefine `--panel-fill`
   (instead of the retired `--heros-glass-fill`), preserving the
   contextual brightening of the lock surface.
9. **Deletion** of the notes.css specificity hack
   (`.notes-tree-root.heros-glass-card,
   .notes-editor-column.heros-glass-card,
   .notes-backlinks.heros-glass-card`, lines 749-755).
10. **Baseline screenshot capture** before migration starts, retake
    after each tier's commit, diff visually.

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

## 4. Surface mapping

### `--card-deep-*` — primary content panes

Heaviest fill, lowest blur. The "this is where work happens" surface.

- `.heros-glass-card` base (App.css line 202 → migrated to use deep
  tokens). Most JSX call-sites use bare `.heros-glass-card` and
  inherit deep via the default-fallback rule — only call-sites
  needing a non-default tier add an explicit modifier.
- `.notes-tree-root`, `.notes-editor-column`, `.notes-backlinks`
  (notes.css — replaces the deleted specificity hack)
- `.db-table thead th` (App.css:2881 — current source-of-truth visual)
- System-audio primary panels (system-audio.css)

### `--card-mid-*` — chrome and secondary surfaces

Medium fill, medium blur. Floats above content but isn't itself
content. These migrate via **direct token substitution** in their
existing CSS rules — no class changes.

- `.titlebar` / `.heros-titlebar` (~App.css:257) — *flagged in §2*
- `.icon-rail` background (App.css:957+)
- `.thread-workspace` outer frame (App.css:1633)
- `.account-sidebar`, `.conversation-list`, `.inspector-panel`
  (App.css:957 group)
- `.heros-glass-bubble` / `.heros-glass-bubble-me` (App.css:255+) —
  *flagged in §2*

### `--card-overlay-*` — floating layers above content

Lightest fill, highest blur. Anything that appears, dismisses, and
shows the content layer faintly through it.

- `.cm-tooltip-autocomplete` (slash menu, wikilink autocomplete)
- `.spotlight-*` (Cmd+K quick open, onboarding spotlights)
- `.cm-cursor-tooltip` and other CM6 tooltips
- Popovers, dropdowns, context menus

### `--panel-*` — bright entry-experience shell glass

White-translucent, heavily blurred. The atmospheric glass for
the boot/lock/onboarding/modal moments. Used by 4 call-sites:

- `.heros-glass-panel` standalone rule (App.css:789) — migrated to
  use `--panel-*` tokens
- Wrappers via `<HerOSPanel>` (HerOS.tsx:42): LoadingScreen,
  LoginPage, OnboardingFlow, lock overlay
- `.import-view__panel` (ImportView side panels — *flagged in §2*)
- `.playlist-modal__panel` (PlaylistSelectorModal popup)

`.login-mode` body modifier locally redefines `--panel-fill` to push
the lock surface even brighter, preserving the existing contextual
override pattern.

### Row-hover surfaces (renamed, not retiered)

These are `:hover` fills on rows/items inside cards — they're not
card surfaces and don't fit the tier system. They keep their
behavior; the tokens just get renamed for clarity:

- `.db-view:hover`, `.db-pill:hover`, `.list-row:hover`,
  `.db-table tr:hover td` → use `--row-hover-fill`
- `.kan-card:hover` → uses `--row-hover-fill-deep`

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

/* === PANEL — entry-experience shell glass ============================== */
/* Bright atmospheric material for LoadingScreen / LoginPage / Onboarding /
   lock overlay / PlaylistSelectorModal. Distinct from cards. */

--panel-fill:        rgba(255, 255, 255, 0.08);
--panel-blur:        24px;
--panel-saturate:    120%;
--panel-rim:         rgba(255, 255, 255, 0.15);

/* === ROW HOVER (renamed from --heros-glass-black*) ===================== */
/* :hover fills for rows inside cards. Not card surfaces; just renamed
   for clarity. */

--row-hover-fill:        rgba(9, 12, 22, 0.98);
--row-hover-fill-deep:   rgba(5, 5, 8, 0.95);
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

Before retirement/rename, the three legacy tokens alias to their new
equivalents so the migration can proceed call-site-by-call-site:

```css
/* Deprecated — migrate call sites then delete in final commit */
--heros-glass-fill:       var(--panel-fill);       /* used by .heros-glass-panel
                                                      and .login-mode override */
--heros-glass-black:      var(--row-hover-fill);
--heros-glass-black-deep: var(--row-hover-fill-deep);
```

These aliases survive only until §6's final retirement commit. Note
that `--heros-glass-fill` aliases to **panel** (not card-deep) because
its actual usage is the `.heros-glass-panel` rule and the
`.login-mode` lock surface — the brightening of the entry experience.

### Class structure for `.heros-glass-panel`

`.heros-glass-panel` is one material (no tiers). The standalone rule
at App.css:789 gets rewritten to source from panel tokens:

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
    0 12px 40px 0 rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}
```

Inset highlight + outer shadow stay literal (not tokenized) because
they're material-specific to panel — different from card shadows.

The combined rule at App.css:202 (`.heros-glass-panel, .heros-glass-card`)
gets split: `.heros-glass-card` keeps the rule (with tier modifiers
added), `.heros-glass-panel` is removed from the selector list since
the standalone rule at App.css:789 fully owns its appearance.

---

## 6. Migration mechanics

### Sequence (one group per commit)

1. **Commit A — tokens + class structure + aliases.** Add the new
   `:root` blocks (card tiers, panel, row-hover renames). Add BEM
   modifier classes to `.heros-glass-card`. Split `.heros-glass-panel`
   out of the App.css:202 combined rule and rewrite the standalone
   App.css:789 rule to use `--panel-*` tokens. Install deprecation
   aliases. No call-sites change. No visual change.
2. **Commit B — deep tier migration.** Delete the notes.css
   specificity hack (lines 749-755). Replace any raw `rgba(0,0,0,0.28)`
   literals in notes.css / system-audio.css with `var(--card-deep-fill)`.
   Add `heros-glass-card--deep` modifier only to JSX call-sites whose
   default tier needs to be deep (most stay bare and inherit deep via
   the fallback rule).
3. **Commit C — mid tier migration.** Direct token substitution in
   existing CSS rules for `.titlebar`, `.icon-rail`,
   `.thread-workspace`, `.account-sidebar`, `.conversation-list`,
   `.inspector-panel`, `.heros-glass-bubble`, `.heros-glass-bubble-me`.
   No JSX changes.
4. **Commit D — overlay tier migration.** Direct token substitution
   for `.cm-tooltip-autocomplete`, `.spotlight-*`, `.cm-cursor-tooltip`,
   popovers, dropdowns. No JSX changes.
5. **Commit E — row-hover rename.** Replace all references to
   `--heros-glass-black` with `--row-hover-fill` and
   `--heros-glass-black-deep` with `--row-hover-fill-deep` across
   App.css and any other `src/styles/*.css` matches. Then delete the
   two deprecated alias lines from `:root`. Verify via grep.
6. **Commit F — retire `--heros-glass-fill`.** Update the
   `.login-mode` override at App.css:2730 to set `--panel-fill`
   instead. Delete the `--heros-glass-fill` alias and the original
   token from `:root`. Verify via grep.

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

After commit F (final), the following searches (regex patterns, run
via Grep tool or ripgrep) must come back at the expected level:

| Regex pattern | Files searched | Expected |
|---|---|---|
| `rgba\(0,\s*0,\s*0,\s*0\.` | App.css, notes.css, system-audio.css, onboarding.css | Hits only inside `:root` token definitions |
| `backdrop-filter:\s*blur\(\d+px\)` | same files | Hits only inside `:root` token definitions and the panel rule |
| `\.notes-[a-z-]+\.heros-glass-card` (specificity hack) | notes.css | Zero matches |
| `--heros-glass-fill\b` | entire `src/` tree | Zero matches |
| `--heros-glass-black(\b\|-deep)` | entire `src/` tree | Zero matches |

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

1. New `--card-{deep,mid,overlay}-*`, `--panel-*`, and
   `--row-hover-fill{,-deep}` token blocks exist in `src/App.css :root`
   under documented banners.
2. `.heros-glass-card` has `--deep`, `--mid`, `--overlay` BEM
   modifiers; bare class falls back to deep.
3. `.heros-glass-panel` is a single rule sourcing from `--panel-*`
   tokens; removed from the App.css:202 combined rule.
4. Every glass surface in the four migration files is mapped to a
   tier (or row-hover, or panel).
5. notes.css:749-755 specificity hack is **deleted**.
6. `--heros-glass-fill`, `--heros-glass-black`,
   `--heros-glass-black-deep` are **removed** from `:root`.
7. `.login-mode` body modifier overrides `--panel-fill`, not
   `--heros-glass-fill`.
8. The five verification greps (§7) come back clean.
9. Baseline + post-migration screenshots captured under
   `docs/superpowers/specs/baselines/2026-04-25-card-tiers/`.
10. Open questions in §2 are explicitly revisited by the user with
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
