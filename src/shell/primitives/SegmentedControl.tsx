import type { CSSProperties, ReactNode } from 'react'

/**
 * Grouped pill selector — exactly one child is "active" at a time. Generic
 * over a value type so it can back any enum or id set.
 *
 * Consumes `--segmented-*` tokens. No hardcoded literals.
 */
export interface SegmentedControlOption<T extends string> {
  value: T
  label: ReactNode
  'aria-label'?: string
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  value: T
  onChange: (next: T) => void
  options: ReadonlyArray<SegmentedControlOption<T>>
  /** Accessible group label. */
  'aria-label'?: string
  className?: string
  style?: CSSProperties
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  style,
  ...aria
}: SegmentedControlProps<T>) {
  const containerStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0,
    padding: 'var(--segmented-padding)',
    background: 'var(--segmented-bg)',
    border: 'var(--workspace-hairline-inner)',
    borderRadius: 'var(--segmented-radius)',
    ...style,
  }
  const itemBase: CSSProperties = {
    padding: 'calc(4px * var(--density-scale, 1) * var(--ui-scale, 1)) calc(12px * var(--density-scale, 1) * var(--ui-scale, 1))',
    fontSize: 'calc(12px * var(--ui-scale, 1))',
    fontWeight: 500,
    borderRadius: 'var(--segmented-item-radius)',
    border: 'none',
    background: 'transparent',
    color: 'var(--workspace-text-muted)',
    cursor: 'pointer',
    transitionProperty: 'background, color',
    transitionDuration: 'calc(120ms * var(--duration-scale, 1))',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    whiteSpace: 'nowrap',
  }
  return (
    <div
      role="tablist"
      aria-label={aria['aria-label']}
      className={className}
      style={containerStyle}
    >
      {options.map((opt) => {
        const selected = opt.value === value
        const itemStyle: CSSProperties = {
          ...itemBase,
          background: selected ? 'var(--segmented-item-bg-active)' : 'transparent',
          color: selected ? 'var(--workspace-text)' : 'var(--workspace-text-muted)',
          ...(opt.disabled && { opacity: 0.45, cursor: 'not-allowed' }),
        }
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={opt['aria-label']}
            disabled={opt.disabled}
            onClick={() => !opt.disabled && !selected && onChange(opt.value)}
            style={itemStyle}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
