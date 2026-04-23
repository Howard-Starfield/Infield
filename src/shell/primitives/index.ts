/**
 * Infield shell primitives — the atom layer of the new unified shell.
 *
 * Every component here:
 *   - Consumes only theme tokens (Rule 12 — no hardcoded literals).
 *   - Uses inline styles + CSS vars, not Tailwind (Rule 3 in workspace/;
 *     kept consistent here for the same reason).
 *   - Stateless where possible. Stateful primitives document their state
 *     contract inline.
 *
 * Built in Phase 1 of `frontendplan.md`. Consumers arrive in Phases 2–6.
 */

export { AtmosphericBackground } from './AtmosphericBackground'
export type { AtmosphericBackgroundProps } from './AtmosphericBackground'

export { GrainOverlay } from './GrainOverlay'
export type { GrainOverlayProps } from './GrainOverlay'

export { RadiantGlow } from './RadiantGlow'
export type { RadiantGlowProps } from './RadiantGlow'

export { GlassPanel } from './GlassPanel'
export type {
  GlassPanelProps,
  GlassPanelVariant,
  GlassPanelElevation,
} from './GlassPanel'

export { GlassWell } from './GlassWell'
export type { GlassWellProps } from './GlassWell'

export { GlassStage } from './GlassStage'
export type { GlassStageProps } from './GlassStage'

export { Eyebrow } from './Eyebrow'
export type { EyebrowProps } from './Eyebrow'

export { PageHeader } from './PageHeader'
export type { PageHeaderProps } from './PageHeader'

export { Chip } from './Chip'
export type { ChipProps, StaticChipProps, ChipVariant } from './Chip'

export { CompactButton } from './CompactButton'
export type { CompactButtonProps } from './CompactButton'

export { SegmentedControl } from './SegmentedControl'
export type {
  SegmentedControlProps,
  SegmentedControlOption,
} from './SegmentedControl'

export { VirtualList } from './VirtualList'
export type { VirtualListProps } from './VirtualList'

export { AppCrashBoundary } from './AppCrashBoundary'

// HerOS primitives (verbatim ports from copy/src/components/HerOS.tsx).
// See CLAUDE.md → HerOS Design System for usage contract.
export { HerOSPanel } from './HerOSPanel'
export type { HerOSPanelProps } from './HerOSPanel'

export { HerOSInput } from './HerOSInput'
export type { HerOSInputProps } from './HerOSInput'

export { HerOSButton } from './HerOSButton'
export type { HerOSButtonProps } from './HerOSButton'

export { HerOSViewport } from './HerOSViewport'
export type { HerOSViewportProps } from './HerOSViewport'
