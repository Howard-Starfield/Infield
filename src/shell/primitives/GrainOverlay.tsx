import type { CSSProperties } from 'react'

/**
 * SVG `feTurbulence` grain overlay. Token-driven opacity
 * (`--heros-grain-opacity`) and blend mode (`--grain-blend-mode`) from
 * `semantic.css`.
 *
 * Sits absolutely positioned above the surface it sits over; pointer-events
 * are disabled so clicks pass through. Rendered as a CSS background of an
 * inline SVG data URI — one element, zero JS once mounted.
 *
 * Place inside any container that establishes a positioning context.
 */
export interface GrainOverlayProps {
  /** Override stacking. Defaults to 1 (above surface, below content). */
  zIndex?: number
  style?: CSSProperties
}

// SVG params match the HerOS kit grain filter 1:1 (baseFrequency 0.4,
// numOctaves 4, feComponentTransfer slope 0.05). Using feComponentTransfer
// on the alpha channel instead of a raw feColorMatrix matches the kit's
// finer, denser grain density — coarser feColorMatrix alphas produce
// visibly sparser static.
const GRAIN_SVG = [
  "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'>",
  "<filter id='n'>",
  "<feTurbulence type='fractalNoise' baseFrequency='0.4' numOctaves='4' stitchTiles='stitch'/>",
  "<feColorMatrix type='saturate' values='0'/>",
  "<feComponentTransfer><feFuncA type='linear' slope='0.05'/></feComponentTransfer>",
  '</filter>',
  "<rect width='100%' height='100%' filter='url(#n)'/>",
  '</svg>',
].join('')

const GRAIN_URI = `url("data:image/svg+xml;utf8,${encodeURIComponent(GRAIN_SVG)}")`

export function GrainOverlay({ zIndex = 1, style }: GrainOverlayProps) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex,
        opacity: 'var(--heros-grain-opacity, 0.12)',
        mixBlendMode: 'var(--grain-blend-mode, overlay)' as CSSProperties['mixBlendMode'],
        backgroundImage: GRAIN_URI,
        backgroundSize: 'var(--grain-size, 220px) var(--grain-size, 220px)',
        backgroundRepeat: 'repeat',
        ...style,
      }}
    />
  )
}
