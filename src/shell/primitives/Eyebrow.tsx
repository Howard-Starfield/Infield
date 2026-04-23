import { createElement, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'

/**
 * Thin uppercase section label — the "eyebrow" above editorial headings.
 * Consumes `--eyebrow-*` tokens. Defaults render as a `<div>`; pass `as` to
 * render as a heading tag if the context demands it.
 */
type EyebrowTag = 'div' | 'span' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

export interface EyebrowProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode
  /** Semantic HTML tag. Default 'div'. */
  as?: EyebrowTag
}

export function Eyebrow({ as = 'div', style, children, ...rest }: EyebrowProps) {
  const composed: CSSProperties = {
    fontSize: 'var(--eyebrow-size)',
    fontWeight: 'var(--eyebrow-weight)' as CSSProperties['fontWeight'],
    letterSpacing: 'var(--eyebrow-letter-spacing)',
    textTransform: 'uppercase',
    color: 'var(--eyebrow-color)',
    lineHeight: 1.2,
    ...style,
  }
  return createElement(as, { style: composed, ...rest }, children)
}
