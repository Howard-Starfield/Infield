# Atmospheric Stack

> The three-layer backdrop recipe that gives Infield its "elegant
> radiant" cinematic feel. All three layers derive from theme tokens, so
> a new preset retints the entire atmosphere by overriding CSS variables
> — never by forking components.
>
> Companion docs: [theme-module.md](theme-module.md) (how tokens flow
> from ThemeProvider to `:root`), [entry-experience.md](entry-experience.md)
> (where this stack first lands).

## The three layers

Rendered back-to-front. Each layer is a dedicated primitive in
`src/shell/primitives/`; no component reimplements the effect inline.

| # | Layer | Primitive | What it does | Backing tokens |
|---|---|---|---|---|
| 1 | **Mesh** | `AtmosphericBackground` | Three overlapping radial gradients on the brand colour, drifting via `infield-mesh-shift` keyframe over 20s. Sets the overall warmth of the scene. | `--atmospheric-mesh`, `--atmospheric-mesh-base` |
| 2 | **Grain** | `GrainOverlay` | SVG `feTurbulence` noise at fractalNoise baseFrequency `0.4`, 4 octaves, alpha slope `0.05`. Blend mode `overlay` or `soft-light` in light mode. Kills colour banding, makes mesh look physical. | `--heros-grain-opacity`, `--grain-blend-mode`, `--grain-size` |
| 3 | **Bloom** | `RadiantGlow` | Soft-blurred radial light source placed behind elevated panels so glass reads as lit from within rather than floating on a flat wash. | `--heros-bloom-color`, `--heros-bloom-blur`, `--heros-bloom-spread` |

## Tuning one theme preset

All three layers react to a handful of tokens. A preset author edits
`src/theme/presets.ts` primitives (brand, surfaceBase, grainOpacity) and
`src/theme/semantic.css` overrides — never the primitive source files.

### Built-in recipes

**HerOS Terracotta (default):**
- Mesh = three radials mixing `--heros-brand` with black at 20%, 40%, 0%
- Grain = overlay blend at `--heros-grain-opacity: 1`
- Bloom = `--heros-ribbon-cream` at 15% alpha, 60px blur, 70% spread

**HerOS Midnight (indigo):**
- Mesh inherits from brand override — no CSS edit needed
- Grain same
- Bloom should be rebalanced: indigo doesn't need cream warmth, try
  `color-mix(in srgb, var(--heros-brand) 18%, transparent)` for a
  cool violet halo

**HerOS Paper (light mode):**
- Grain blend swaps to `soft-light` automatically (semantic.css override
  on `html[data-theme-mode="light"]`)
- Bloom darkens: `color-mix(in srgb, black 8%, transparent)` so the
  glow reads as a subtle shade instead of an overexposed hot spot

**HerOS High-Contrast:**
- Bloom should be disabled entirely: `--heros-bloom-color: transparent`
  so the panel silhouette is unambiguous at AAA contrast

### Disabling layers

Any layer can be neutralised by zeroing its token without touching the
primitive. Useful for:

- **Performance-constrained surfaces** (export previews, print) — set
  `--heros-grain-opacity: 0` and `--heros-bloom-color: transparent`
- **Reduced-motion preference** — mesh animation already slows with
  `--duration-scale`; setting `--duration-scale: 0.001` freezes it
- **Brand-flat presets** — set `--atmospheric-mesh: none` and
  `--heros-bloom-color: transparent` to return to a solid surface

## Adding a new preset cleanly

The process, short form:

1. Add a new `ThemePreset` to `src/theme/presets.ts`. Define primitives
   only (brand, surfaceBase, onSurface, glassFillOpacity, grainOpacity
   etc.). Do **not** add component-specific tokens here.
2. If the preset needs atmospheric-stack overrides (e.g. different bloom
   colour), add them to `src/theme/semantic.css` under a preset-scoped
   selector:
   ```css
   html[data-theme-mode="dark"][data-preset="your-preset"] {
     --heros-bloom-color: /* your recipe */;
     --grain-blend-mode: /* optional */;
   }
   ```
3. Register the preset in `PRESETS` in `presets.ts`. The theme editor
   surface picks it up automatically.
4. Run the contrast-check unit tests — presets that fail WCAG AA on
   `--workspace-text-muted` surface the warning immediately.

No primitive source files are touched. Every atmospheric effect a
future preset needs is either a primitive-level override (new brand
hex) or a semantic token override — in both cases, one file.

## Consumption pattern

Consumers compose the three primitives back-to-front inside a
positioned container. LoginPage is the canonical example:

```tsx
<div style={{ position: 'fixed', inset: 0 }}>
  <AtmosphericBackground style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
  <GrainOverlay zIndex={1} />
  <main>
    <RadiantGlow centered={false} style={{ inset: '-12%', zIndex: 5 }} />
    <motion.div style={{ position: 'relative', zIndex: 10 }}>
      {/* Glass panel + content */}
    </motion.div>
  </main>
</div>
```

Key invariants:

- **Mesh** wraps the whole surface at `zIndex: 0`
- **Grain** sits above mesh at `zIndex: 1`, pointer-events disabled
- **Bloom** goes inside whatever container frames the hero element,
  slightly overflowing its bounds so the halo extends past the panel
- **Content** mounts at a higher z-index than all three layers, with
  `position: relative` so its own z-index applies

If you're adding a new entry surface (Settings splash, first-run
tutorial, vault unlock during long sync), reach for the same composition.
The mesh drift, grain texture, and bloom recipe should always come from
the primitives — never rewritten in the consumer.

## Anti-patterns to flag in code review

- ❌ Inline `radial-gradient(...)` or `filter: blur(60px)` outside
  `src/shell/primitives/` — it means someone reinvented a layer
- ❌ Hardcoded `rgba(240, 216, 208, 0.15)` or similar kit-specific
  numbers — should be `var(--heros-bloom-color)` or similar
- ❌ `animation: meshShift 20s ...` in a component — the keyframe lives
  in `semantic.css` and primitives consume it; consumers shouldn't need
  to touch it
- ❌ A new preset that overrides component tokens (`--tree-node-hover-bg`,
  `--workspace-grid-bg-cell`) instead of primitives — preset scope
  should stop at the primitive tier (brand, surfaceBase, grain). Let
  the semantic cascade do the rest.

## Change log

- **2026-04-21**: three-layer atmospheric stack canonicalised. Mesh +
  grain existed; bloom added as `RadiantGlow` primitive with
  `--heros-bloom-*` tokens. LoginPage wired as the first consumer.
