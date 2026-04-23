# UI Polish Plan — Handy Workspace

> **Goal:** Close the gap between "functional" and "polished product" across the
> workspace feature (sidebar tree, databases, board, calendar, document editor).
> Theme system, animation tokens, and skeleton loading are the remaining gaps.
> No backend Rust changes required.

---

## Current Theme System

Handy already has a **3-preset theme system** with density support:

### Theme Presets

| Preset | Character | Accent | Text | BG |
|--------|----------|--------|------|-----|
| **paper-warm** (default) | Creamy, editorial | `#b72301` | `#1c1c19` | `#fdf9f3` |
| **system-audio** | Dark, ambient glass | `#ff9254` | `#f5f7fb` | `#090c11` |
| **graphite-focus** | Cool slate | `#d97745` | `#1b1b19` | `#20252d` |

### Density Presets

| Preset | Row Height | Cell Padding H | Editor Max Width |
|--------|-----------|----------------|-----------------|
| **comfortable** (default) | 26px | 8px | 1200px |
| **compact** | 24px | 7px | 1080px |
| **airy** | 30px | 10px | 1280px |

### What's Implemented

- ✅ 3 theme presets with full color derivation (`workspaceAppearance.ts`)
- ✅ Per-preset ambient glow + shadow depth + panel blur + border radius
- ✅ Grid/DataGrid theming (`workspaceDataGridTheme()`)
- ✅ Calendar category colors, widget dot colors, status lights
- ✅ Surface token system (`workspaceSurfaceTokens.ts`)
- ✅ CSS custom properties cascade from `applyWorkspaceAppearanceToDocument()`
- ✅ Light-mode forced throughout (editor, MDX, Glide portal)
- ✅ Custom scrollbars (macOS overlay vs Windows/Linux thin)
- ✅ Keyframe animations: `nav-item-in`, `nav-group-in`, `sidebar-in`, `popIn`
- ✅ Hover/active states on interactive elements (`workspace-interactive`, `workspace-row-hover`)
- ✅ `react-resizable-panels` for panel layout

### What's Missing

- ❌ No formal **spacing scale** (--space-1 through --space-12)
- ❌ No **animation/duration tokens** (--duration-fast, --ease-out, etc.)
- ❌ No **typography scale** (--text-xs through --text-2xl)
- ❌ No **skeleton/shimmer** loading component
- ❌ No right-click **context menu** system for workspace nodes/rows

---

## Priority Matrix

| Priority | Category | Impact | Effort |
|----------|----------|--------|--------|
| 🔴 P0 | Animation & Duration Tokens | Very High | Low |
| 🔴 P0 | Spacing Scale | High | Low |
| 🟠 P1 | Skeleton / Shimmer Loading | High | Medium |
| 🟠 P1 | Right-Click Context Menus | High | Medium |
| 🟡 P2 | Typography Scale | Medium | Low |
| 🟡 P2 | Focus Rings | Medium | Medium |

---

## 🔴 P0 — Animation & Duration Tokens

### What's Already in App.css

```css
/* Scattered throughout — no unified token system */
transition: background 160ms ease;      /* sidebar-nav-btn */
transition: background 80ms ease;        /* workspace-row-hover */
animation: nav-item-in 240ms cubic-bezier(0.22, 1, 0.36, 1);
animation: popIn 120ms ease;
```

### What to Add

Define tokens in `app.css` under `:root`:

```css
/* Animation duration tokens */
--duration-fast: 80ms;
--duration-normal: 120ms;
--duration-slow: 200ms;
--duration-page: 240ms;

/* Animation easing tokens */
--ease-default: cubic-bezier(0.4, 0, 0.2, 1);
--ease-out: cubic-bezier(0, 0, 0.2, 1);
--ease-in: cubic-bezier(0.4, 0, 1, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
--ease-panel: cubic-bezier(0.22, 1, 0.36, 1);  /* for nav animations */
```

Then audit and replace hardcoded values across all workspace components.
Use `rg --type tsx '(\d+)ms' src/components/workspace/` to find remaining instances.

**File to modify:** `app.css`

---

## 🔴 P0 — Spacing Scale

### What to Add

```css
/* Spacing scale — 4px grid */
--space-0: 0px;
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
```

Audit padding/margin usage with `rg '(padding|margin)(Left|Right|Top|Bottom)?\s*:\s*\d+' src/components/workspace/` and replace with scale values.

**File to modify:** `app.css`

---

## 🟠 P1 — Skeleton / Shimmer Loading

### What to Create

`src/components/ui/Skeleton.tsx`:

```tsx
interface SkeletonProps {
  variant: 'text' | 'row' | 'card' | 'avatar'
  width?: string | number
  height?: string | number
  className?: string
}
```

Shimmer CSS to add to `app.css`:

```css
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--surface-2) 25%,
    var(--surface-3) 50%,
    var(--surface-2) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
```

### Where to Apply

- `WorkspaceTree.tsx` — while loading children
- `GridView.tsx` — while fetching rows
- `CalendarView.tsx` — while loading events
- `BoardView.tsx` — while loading columns

**Files to create:** `src/components/ui/Skeleton.tsx`
**Files to modify:** `app.css`, workspace view components

---

## 🟠 P1 — Right-Click Context Menus

### Scope for Handy Workspace

Context menus apply to:

- **Workspace tree node** → Rename, Delete, Duplicate, Copy link
- **Grid/Board row** → Open row page, Duplicate row, Delete row
- **Calendar event** → Edit event, Delete, Duplicate
- **View tabs** → Rename view, Duplicate, Delete, Change icon/color

### Implementation Approach

```tsx
// Generic portal-based context menu
interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

interface ContextMenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}
```

Use `onContextMenu` on workspace components. Render via `createPortal` to `document.body`.
Dismiss on click-outside, scroll, or Escape.

**Files to create:** `src/components/ui/ContextMenu.tsx`
**Files to modify:** `WorkspaceTree.tsx`, `GridView.tsx`, `BoardView.tsx`, `CalendarView.tsx`, `ViewTabContextMenu.tsx`

---

## 🟡 P2 — Typography Scale

### What to Add

```css
/* Type scale — 4px baseline */
--text-xs:   11px;   /* line-height: 16px (4×4) */
--text-sm:   12px;   /* line-height: 16px */
--text-base: 14px;   /* line-height: 20px (4×5) */
--text-lg:   16px;   /* line-height: 24px (4×6) */
--text-xl:   20px;   /* line-height: 28px (4×7) */
--text-2xl:  24px;   /* line-height: 32px (4×8) */
--text-3xl:  32px;   /* line-height: 40px (4×10) */

/* Font weights — only these three */
--weight-normal: 400;
--weight-medium: 500;
--weight-semibold: 600;
--weight-bold: 700;
```

Replace ad-hoc `fontSize: 13` / `fontSize: 14` in components. Use `rg 'fontSize:\s*\d+' src/components/workspace/` to find candidates.

**Files to modify:** `app.css`, workspace components

---

## 🟡 P2 — Focus Rings

### What's Needed

Replace inconsistent focus styles with a consistent `:focus-visible` system:

```css
/* Global focus ring — keyboard navigation only */
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--workspace-accent-soft);
}

/* Workspace-specific overrides */
button:focus-visible,
[role="button"]:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--workspace-accent) 38%, transparent);
}
```

Currently mixed — some components have `outline: none` only, others have inconsistent ring styles.

**Files to modify:** `app.css`, workspace interactive components

---

## Design Tokens Reference (Existing + Proposed)

```css
/* ── Workspace colors (already defined) ─────── */
--workspace-bg:          #fdf9f3;   /* paper-warm default */
--workspace-bg-soft:     #f7f3ee;
--workspace-panel:       #fffef9;
--workspace-panel-muted: #f4eee6;
--workspace-border:      rgba(28, 28, 25, 0.12);
--workspace-border-strong: rgba(28, 28, 25, 0.20);
--workspace-text:        #1c1c19;
--workspace-text-muted:  rgba(60, 50, 45, 0.82);
--workspace-text-soft:   rgba(60, 50, 45, 0.55);
--workspace-accent:      #b72301;
--workspace-accent-secondary: #6d4c3d;

/* ── Spacing (proposed) ─────── */
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;
--space-4: 16px;  --space-5: 20px;  --space-6: 24px;
--space-8: 32px;  --space-10: 40px; --space-12: 48px;

/* ── Animation (proposed) ─────── */
--duration-fast:   80ms;
--duration-normal: 120ms;
--duration-slow:   200ms;
--duration-page:   240ms;
--ease-default: cubic-bezier(0.4, 0, 0.2, 1);
--ease-out:    cubic-bezier(0, 0, 0.2, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

/* ── Shadow scale (existing) ─────── */
--workspace-shadow:     0 18px 40px rgba(28, 28, 25, 0.10);
--workspace-shadow-soft: 0 10px 24px rgba(28, 28, 25, 0.08);

/* ── Typography (proposed) ─────── */
--text-xs:   11px;   --text-sm:   12px;
--text-base: 14px;   --text-lg:   16px;
--text-xl:   20px;   --text-2xl:  24px;
--weight-normal: 400; --weight-medium: 500;
--weight-semibold: 600; --weight-bold: 700;
```

---

## Implementation Order

```
Phase 1 (P0) — Animation & Spacing tokens
├── Define --duration-* and --ease-* tokens in app.css
├── Define --space-* scale in app.css
├── Audit workspace components, replace hardcoded values
└── ~1–2 hours

Phase 2 (P1) — Loading & Interaction
├── Create Skeleton component + shimmer CSS
├── Wire to WorkspaceTree, GridView, CalendarView
├── Create ContextMenu component
├── Wire to WorkspaceTree, GridCell, BoardView
└── ~3–4 hours

Phase 3 (P2) — Polish
├── Define --text-* type scale
├── Audit fontSize values, replace with tokens
├── Standardize :focus-visible across workspace
└── ~2 hours
```

---

## Notes

- The theme preset system (`workspaceAppearance.ts`) is the **authority** on colors.
  All manual hex values in components should derive from CSS vars, never hardcoded.
- Dark mode is **not** in scope — `color-scheme: light` is forced throughout.
  The three presets handle visual diversity through theme selection, not OS preference.
- Glide Data Grid portal (`#portal`) has its own light-mode overrides in `app.css`.
  Any change to grid colors must update both the CSS vars AND the Glide theme object
  returned by `workspaceDataGridTheme()`.
