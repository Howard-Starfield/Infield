# Theme Module — HerOS Integration Plan

> **Context**: Stable rule is in [CLAUDE.md → Theme Module](../../CLAUDE.md#theme-module--herros-integration-plan-summary). Phase status (shipped vs pending) is in [PLAN.md → M-theme](../../PLAN.md). This file is the **full design spec** — read it when touching theme code, designing a new control, or debugging token flow.

## Vision

One module, three tiers of tokens, every pixel under user control. Opening Settings → Theme reveals a live-preview editor where the user can change the brand color, glass opacity, grain, blur, shadow depth, radius scale, UI density — and watch the entire app (tree, grid, board, editor, login, loading) update in real time. The result persists to `user_preferences` and survives restarts.

## Source of truth

`HerOS_UI_Kit/` is the reference visual system. The tokens in `HerOS_UI_Kit/styles.css` (`--heros-*`, `--surface-*`, `--on-surface*`, `--primary*`, `--radius-*`, `--blur-glass`, `--duration-*`, `--ease-*`, `--shadow-*`, `--text-*`, `--space-*`, `--ui-scale`) are the canonical set. Do not invent new token names without adding them to `src/theme/tokens.ts`.

## Three tiers

```
┌──────────────────────────────────────────────────────────────────┐
│ Tier 1 — PRIMITIVES (user-editable, small set)                    │
│  --heros-brand           #cc4c2b                                  │
│  --heros-bg-foundation   #cc4c2b                                  │
│  --heros-glass-fill      rgba(255,255,255,0.08)                   │
│  --heros-glass-blur      24px                                     │
│  --heros-glass-saturate  120%                                     │
│  --heros-grain-opacity   1                                        │
│  --ui-scale              1.0                                      │
│  --font-family           'Inter, Segoe UI, system-ui, sans-serif' │
└──────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼ derived via color-mix() + calc()
┌──────────────────────────────────────────────────────────────────┐
│ Tier 2 — SEMANTIC (what components consume)                       │
│  --surface-container, --surface-container-high, ...               │
│  --on-surface, --on-surface-variant                               │
│  --primary, --primary-container, --on-primary                     │
│  --ghost-border, --radius-container, --radius-lg                  │
│  --shadow-sm/md/lg/xl, --duration-fast/normal/slow                │
│  --text-xs/sm/base/lg/xl/2xl (scale with --ui-scale)              │
│  --space-1..12 (scale with --ui-scale)                            │
└──────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼ components reference these
┌──────────────────────────────────────────────────────────────────┐
│ Tier 3 — COMPONENT (rarely overridden; derived)                    │
│  --workspace-bg, --workspace-text, --workspace-border             │
│  --tree-row-hover-bg, --tree-row-active-bg                        │
│  --grid-header-height, --cell-padding-h/v, --row-action-width     │
│  --board-card-width, --board-column-gap                           │
│  --row-hover-bg, --row-active-bg                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Architecture

```
src/theme/
  tokens.ts          Typed PrimitiveToken, SemanticToken, ComponentToken types.
                     Export LEGACY_TOKEN_ALIASES mapping old names to new.
  presets.ts         Built-in themes:
                      - 'heros-default' (terracotta on dark glass — HerOS kit default)
                      - 'heros-midnight' (deep blue primitive, same structure)
                      - 'heros-paper' (light-mode variant, deferred v2)
                      - 'heros-high-contrast' (accessibility, deferred v2)
  ThemeProvider.tsx  React provider. On mount:
                      1. Load active theme id + overrides from user_preferences
                      2. Resolve primitives → semantics → components (pure fns)
                      3. Inject as CSS vars on document.documentElement
                      4. Subscribe to themeStore for live updates
  useTheme.ts        { activeTheme, setTheme, overrideToken, resetToken }
  themeStore.ts      Zustand store — activeThemeId + Record<TokenName, string> overrides
  themeStorage.ts    Rust bridge: get_theme_preference / set_theme_preference
                     (new Tauri commands)
  ThemeEditorPanel.tsx  Settings UI:
                        - brand color picker (drives --heros-brand)
                        - glass slider (fill opacity, blur radius, saturation)
                        - grain slider (0-1)
                        - radius slider (maps to --radius-container scale)
                        - UI density (--ui-scale: 0.85, 1.0, 1.15, 1.3)
                        - font-family dropdown (Inter, JetBrains Mono, system)
                        - "Reset to preset" / "Export JSON" / "Import JSON"
```

## Live update contract

- Writing to `themeStore` → `ThemeProvider` effect → `document.documentElement.style.setProperty(--token, value)` for each override
- No full remount, no flicker; CSS variable change triggers only style recalc
- Editor panel uses `flushSync` only for slider drag end, not during drag (60fps)

## Persistence

- `user_preferences` table row: `key = 'theme'`, `value = JSON.stringify({ themeId, overrides })`
- Two new Tauri commands: `get_theme_preference`, `set_theme_preference`
- First-launch default: `'heros-default'`

## User-facing settings — full taxonomy

The Settings → Appearance/Typography/Layout/Motion/Accessibility panels expose ~12 **primitive** controls. Every other visual value is **derived** and never shown to the user directly.

| Category | User-facing control | Drives primitive | Derivation notes |
|---|---|---|---|
| Appearance | Theme base (Light / Dark / System) | `--theme-mode` | Switches the whole preset palette. `System` listens to `matchMedia('(prefers-color-scheme: dark)')`. |
| Appearance | Preset palette picker | `activeThemeId` | HerOS Terracotta / Midnight / Paper / High Contrast. Clears overrides atomically on switch. |
| Appearance | Accent color picker | `--heros-brand` | Primary, selection highlight, link color, active-tab underline — all derived via `color-mix()`. |
| Appearance | Border radius (0 / 4 / 8 / 12 / 16) | `--radius-scale` | All `--radius-*` are `calc(base * --radius-scale)`. |
| Typography | UI font / Content font / Monospace font | `--font-ui`, `--font-content`, `--font-mono` | Bundle variable fonts (Inter, Georgia, JetBrains Mono) so user never sees a silent fallback. |
| Typography | Base font size | `--font-size-base` | `--text-xs..2xl` derive via modular scale (1.125 ratio). |
| Typography | Line height | `--line-height-base` | Unitless; editor and tree inherit. |
| Typography | Max line width (toggle + slider) | `--editor-max-ch` | CSS `max-width: <value>ch` on the editor container. |
| Layout | Density (Compact / Normal / Comfortable) | `--density-scale` | All `--space-*` are `calc(base * --density-scale)`. |
| Layout | Divider thickness (Thin / Medium / Thick) | `--divider-width` | 1 / 2 / 3 px presets — not a slider (three values cover all real cases). |
| Layout | Translucency / blur (platform-gated) | `--glass-blur` + vibrancy plugin call | macOS `NSVisualEffectView`, Win11 Mica, Win10 Acrylic, Linux = `backdrop-filter` fallback with GPU warning. |
| Layout | Window frame (native / frameless) | `window.decorations` | **Requires restart.** Label it explicitly; no runtime hot-swap (Tauri limitation). |
| Motion | Animation speed (Off / Subtle / Normal / Lively) | `--duration-scale` | `Off` = emit `@media (prefers-reduced-motion: reduce)` rule globally, disable Motion springs. |
| Motion | Shadow intensity (None / Soft / Deep) | `--shadow-scale` | All `--shadow-*` derived. |
| Accessibility | UI zoom (0.85 / 1.0 / 1.15 / 1.3) | `--ui-scale` | Scales BOTH `--space-*` AND `--text-*` to keep proportions visually correct. |
| Accessibility | High contrast | `--contrast-boost` | Forces `--on-surface` to pure black/white and bumps `--divider-width` to 2px. |
| Advanced | Import / Export theme JSON | — | Enables bug repros, theme sharing, future theme marketplace. |
| Advanced | Reset (this control / category / everything) | — | Three scopes. Never one nuke button. |

**Derivation rules — pin these in `tokens.ts`:**
- `--ui-scale` MUST scale space AND typography together (`calc(base * --ui-scale)` on both). Scaling only one creates cramped-text / roomy-containers dissonance.
- `--density-scale` and `--ui-scale` compose multiplicatively: final spacing = `base * --density-scale * --ui-scale`.
- Selection highlight = `color-mix(in srgb, var(--heros-brand) 25%, transparent)`. Never a separate picker.
- Muted text = `color-mix(in srgb, var(--on-surface) 65%, transparent)`. Never a separate picker.

## Phased implementation — shipping order

**Phase 1 — primitive cascade + live preview (ship first)**
Theme base, preset palette, accent picker, border radius, density, UI zoom, animation speed, reduce-motion, import/export JSON, reset scoping. Covers ~80% of user perceived customizability. Gates everything downstream because these ARE the cascade.

**Phase 2 — typography & polish**
UI/Content/Mono font pickers (with bundled variable fonts), base size, line height, max line width toggle, shadow intensity, syntax highlighting theme (Shiki preset picker), divider preset.

**Phase 3 — platform integration**
Translucency/blur with runtime platform detection + graceful Linux degrade, frame style toggle (labeled "requires restart"), scrollbar style.

**Phase 4 — editor polish**
Selection color override, cursor color + caret width, focus-mode keyboard shortcut (`Cmd+.`), high-contrast mode.

## Senior-level implementation notes — edge cases that will bite

1. **`@property` registration is mandatory for slider-driven tokens.** CSS `transition` on a `var(--x)` consumer is DISCRETE for unregistered custom properties (MDN). Register the 5-6 slider-driven tokens (`--heros-glass-blur`, `--heros-grain-opacity`, `--ui-scale`, `--density-scale`, `--radius-scale`) in `src/App.css` with `@property` blocks. Without this the sliders **snap** — no interpolation.

2. **Persistence — localStorage is the sync source of truth.** Tauri `set_theme_preference` is async IPC. On a fast tweak-then-quit, the DB write may not land before process exit. Write order:
   - On change: localStorage write (sync, immediate) → Zustand store update → debounced Tauri `set_theme_preference` (durable backup).
   - On boot: inline `<script>` in `index.html` reads localStorage BEFORE React mounts and sets fallback vars on `:root`.
   - ThemeProvider then hydrates fully once `user_preferences` loads, reconciling against localStorage.

3. **FOUT guard — inline sync fallback in `index.html`.** Without this, LoadingScreen renders with CSS defaults and flashes to themed colors once ThemeProvider mounts. The inline script MUST run before React, read localStorage, and set `:root` vars directly. Async load = visible flash.

4. **ThemeProvider wraps `AppBootstrap`, not `WorkspaceLayout`.** The LoadingScreen itself uses `--heros-brand`. Provider must be outermost.

5. **Batch `setProperty` in a single rAF flush.** Writing 40 vars in 40 microtasks = 40 style recalcs. Writing 40 vars in 1 rAF callback = 1 recalc. For a full workspace (2-5k DOM nodes) the difference is 5-15ms vs 200-400ms on density/zoom changes.

6. **Alias writes come LAST in the flush order.** `LEGACY_TOKEN_ALIASES` shims (old `--row-hover-bg` → new `--surface-container` mix) must be written after primary tokens so whichever token a stale component reads, it gets the right value. Pin this ordering with a comment in `tokens.ts`.

7. **flushSync boundary — `onValueCommit`, never `onValueChange`.** Radix Slider gives both. Using `flushSync` inside `onValueChange` triggers React warnings when AnimatePresence is mounted. Only commit on `pointerup`.

8. **Preset switch must atomically clear overrides.** User drags accent slider → switches preset: if the store writes `activeThemeId` and `overrides = {}` in separate setState calls, ThemeProvider's effect can fire twice, producing a one-frame composite of old-overrides × new-base. One `setState({ activeThemeId, overrides: {} })` call.

9. **`prefers-reduced-motion` covers CSS transitions too.** Motion's `useReducedMotion()` handles JS animations but not the CSS transitions we install on `@property`-registered tokens. Add one CSS rule in `App.css`:
   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after { transition-duration: 0.01ms !important; }
   }
   ```

10. **Contrast validation in dev builds.** Runtime check on every token flush: if `--on-surface` vs `--surface-container` falls below WCAG AA 4.5:1, log a console warning. Don't block the write — user sees the broken contrast immediately. Ship as warning-only in v1; block-with-toast in v2.

11. **URL-param theme override for QA.** `?theme=heros-midnight` (and `?theme=custom&overrides=<base64-json>`) short-circuits localStorage + `user_preferences`. Enables screenshot reproduction without polluting user state.

12. **Frame style toggle is not hot-swappable in Tauri.** Changing `decorations: false` at runtime doesn't work cleanly; requires window recreation. Ship as "requires restart" setting or defer entirely. Don't promise live preview for this one control.

13. **Translucency/blur asymmetry.** Per platform:
    - macOS: `tauri-plugin-window-vibrancy` → smooth native blur.
    - Windows 11 (22H2+): Mica via the same plugin.
    - Windows 10 pre-22H2: Acrylic → degraded.
    - Linux (webkitgtk): no native blur; fall back to `backdrop-filter: blur()` with a runtime GPU warning in Settings.
    Runtime-detect support and grey out the toggle with a tooltip on unsupported platforms. Never let the toggle do nothing silently.

14. **Font bundling vs system fallback.** Bundle variable fonts for Inter, Georgia, JetBrains Mono (~300KB total). Without bundling, the silent FS fallback chain hides theme breakage ("why does the font change look wrong?"). Detect user selection against `document.fonts.check()` and warn if missing.

## Migration of existing styles

1. Add `src/theme/` and `ThemeProvider` wrapping `App.tsx`
2. Move HerOS tokens from `HerOS_UI_Kit/styles.css` into `src/theme/presets.ts` (single source)
3. Keep `src/App.css` / `src/workspace.css` but strip color/surface/radius literals — replace with `var(--*)`
4. Existing AppFlowy geometry tokens (`--cell-padding-h`, `--row-hover-bg`, `--board-card-width`, etc.) stay under a `component` tier mapping
5. When touching a workspace/ file, migrate any Tailwind classes AND hardcoded values to tokens (Rule 3 + Rule 12)

**Enforcement:** a CI lint rule (planned) greps for `#[0-9a-fA-F]{3,8}`, `rgba?(`, `\d+px`, `\d+ms` inside `src/**/*.{ts,tsx}` and fails on new occurrences outside `src/theme/`. Until the lint lands, reviewers enforce manually.
