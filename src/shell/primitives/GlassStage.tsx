import {
  forwardRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react'

/**
 * The outer stage container that wraps a page's content. Softer than a
 * GlassPanel — no border, larger padding, and optional ambient edge glows
 * consumed from `--workspace-shell-glow-*`.
 *
 * Used as the Phase-3+ page background: titlebar + rail + utility chrome
 * sit outside; `<GlassStage>` is the scroll container for the current page.
 */
export interface GlassStageProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
  /** Render ambient edge glows. Default true. */
  glow?: boolean
  /** Interior scroll direction. Default 'vertical'. */
  scroll?: 'vertical' | 'horizontal' | 'both' | 'none'
}

const SCROLL_STYLE: Record<
  NonNullable<GlassStageProps['scroll']>,
  Pick<CSSProperties, 'overflowX' | 'overflowY'>
> = {
  vertical: { overflowX: 'hidden', overflowY: 'auto' },
  horizontal: { overflowX: 'auto', overflowY: 'hidden' },
  both: { overflowX: 'auto', overflowY: 'auto' },
  none: { overflowX: 'hidden', overflowY: 'hidden' },
}

export const GlassStage = forwardRef<HTMLDivElement, GlassStageProps>(
  function GlassStage(
    { glow = true, scroll = 'vertical', style, children, ...rest },
    ref,
  ) {
    const composed: CSSProperties = {
      position: 'relative',
      flex: 1,
      minHeight: 0,
      minWidth: 0,
      padding: 'var(--shell-stage-inset)',
      background: 'var(--workspace-panel-muted)',
      border: 'var(--workspace-hairline-inner)',
      borderRadius: 'var(--workspace-panel-radius)',
      backdropFilter:
        'blur(var(--workspace-panel-blur)) saturate(var(--heros-glass-saturate))',
      WebkitBackdropFilter:
        'blur(var(--workspace-panel-blur)) saturate(var(--heros-glass-saturate))',
      boxShadow: glow
        ? [
            'var(--workspace-shadow-soft)',
            'inset 0 1px 0 var(--workspace-shell-glow-top)',
            'inset -1px 0 0 var(--workspace-shell-glow-right)',
            'inset 0 -1px 0 var(--workspace-shell-glow-bottom)',
          ].join(', ')
        : 'var(--workspace-shadow-soft)',
      ...SCROLL_STYLE[scroll],
      ...style,
    }
    return (
      <div ref={ref} style={composed} {...rest}>
        {children}
      </div>
    )
  },
)
