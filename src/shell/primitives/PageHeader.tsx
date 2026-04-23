import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { Eyebrow } from './Eyebrow'

/**
 * Editorial page header — eyebrow label + large heading + optional
 * subtitle and action slot. All typography sizes scale with `--ui-scale`.
 *
 * Layout:
 *   ┌───────────────────────────────────┬──────────┐
 *   │ EYEBROW                           │ actions  │
 *   │ Big Heading                       │          │
 *   │ optional subtitle copy            │          │
 *   └───────────────────────────────────┴──────────┘
 */
export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Short uppercase label above the title. */
  eyebrow?: ReactNode
  /** The main heading. */
  title: ReactNode
  /** Muted copy below the title. */
  subtitle?: ReactNode
  /** Trailing action slot — right-aligned, vertical-centered. */
  actions?: ReactNode
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  style,
  ...rest
}: PageHeaderProps) {
  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 'calc(16px * var(--ui-scale, 1))',
    marginBottom: 'calc(20px * var(--ui-scale, 1))',
    ...style,
  }
  const textBlockStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'calc(6px * var(--ui-scale, 1))',
    minWidth: 0,
    flex: 1,
  }
  const titleStyle: CSSProperties = {
    fontSize: 'calc(22px * var(--ui-scale, 1))',
    fontWeight: 700,
    letterSpacing: '-0.01em',
    color: 'var(--workspace-text)',
    margin: 0,
    lineHeight: 1.2,
  }
  const subtitleStyle: CSSProperties = {
    fontSize: 'calc(13px * var(--ui-scale, 1))',
    color: 'var(--workspace-text-muted)',
    margin: 0,
    lineHeight: 1.5,
  }
  const actionsStyle: CSSProperties = {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 'calc(6px * var(--ui-scale, 1))',
  }

  return (
    <header style={headerStyle} {...rest}>
      <div style={textBlockStyle}>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 style={titleStyle}>{title}</h1>
        {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
      </div>
      {actions && <div style={actionsStyle}>{actions}</div>}
    </header>
  )
}
