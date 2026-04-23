# HerOS CSS — split for React + Vite

Two files, one import order:

```
heros.tokens.css       ← design tokens only (:root custom properties)
heros.components.css   ← resets, primitives, layout, widgets
heros.css              ← the ORIGINAL combined file (kept for reference; ignore in new apps)
```

## Import order matters

In `src/main.tsx`:

```ts
import './styles/heros.tokens.css';      // 1. declare tokens first
import './styles/heros.components.css';  // 2. rules that USE those tokens
import './app.css';                       // 3. your own globals (optional)
```

Or, in `index.html` if you prefer:

```html
<link rel="stylesheet" href="/src/styles/heros.tokens.css" />
<link rel="stylesheet" href="/src/styles/heros.components.css" />
```

## With CSS Modules

Tokens work with CSS Modules **only if imported globally first** — modules can't redeclare `:root` safely across files. Pattern:

```ts
// main.tsx
import './styles/heros.tokens.css';      // GLOBAL — once
import './styles/heros.components.css';  // GLOBAL — once

// SomeComponent.tsx
import styles from './SomeComponent.module.css';
```

Inside `SomeComponent.module.css` you can freely do:

```css
.card {
  background: var(--heros-glass-fill);
  border-radius: var(--radius-container);
  padding: var(--space-4);
}
```

## Fonts

Token file does **not** `@import` Google Fonts — that's a side effect. Put them in `index.html` for fastest paint:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" />
```

## Token reference (the ones you'll actually use)

| Category | Tokens |
|---|---|
| Brand | `--heros-brand` `--heros-bg-foundation` `--heros-text-premium` |
| Glass | `--heros-glass-fill` `--heros-glass-blur` `--heros-glass-saturate` `--heros-rim-light` `--heros-panel-shadow` |
| Surface | `--surface-dim` through `--surface-bright` (7 tiers) |
| Text | `--on-surface` `--on-surface-variant` |
| Radius | `--radius-container` (14px) `--radius-lg` (24px) |
| Spacing | `--space-1`…`--space-12` (scales with `--ui-scale`) |
| Type | `--text-xs`…`--text-2xl` (scales with `--ui-scale`) |
| Motion | `--duration-fast/normal/slow/slower` `--ease-default/in/out/spring` |
| Shadow | `--shadow-sm/md/lg/xl` |
| Layout | `--title-bar-height` `--icon-rail-width` `--account-sidebar-width` |

## Theming

Change the entire look by overriding tokens in a parent selector:

```css
[data-theme="forest"] {
  --heros-brand: #2f5d3b;
  --heros-bg-foundation: #2f5d3b;
  --heros-selection: rgba(47, 93, 59, 0.6);
}
```
