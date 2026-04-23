import {
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

/**
 * Thin wrapper around `@tanstack/react-virtual` for vertical lists. Hides
 * the boilerplate so consumers only pass `items` + a `row` renderer.
 *
 * Used for Home recents (Phase 4), search results, and any list the auditor
 * flags as > 500 rows (CLAUDE.md Performance Targets).
 */
export interface VirtualListProps<T> {
  items: ReadonlyArray<T>
  /** Fixed row height in px, or a function `(index) => number` for variable. */
  estimateSize: number | ((index: number) => number)
  row: (item: T, index: number) => ReactNode
  /** Number of rows to render outside the visible window. Default 6. */
  overscan?: number
  /** Key getter — defaults to the item's index. */
  getItemKey?: (item: T, index: number) => string | number
  className?: string
  style?: CSSProperties
}

export function VirtualList<T>({
  items,
  estimateSize,
  row,
  overscan = 6,
  getItemKey,
  className,
  style,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize:
      typeof estimateSize === 'number' ? () => estimateSize : estimateSize,
    overscan,
    getItemKey: getItemKey
      ? (index) => getItemKey(items[index], index)
      : undefined,
  })

  const containerStyle: CSSProperties = {
    height: '100%',
    width: '100%',
    overflow: 'auto',
    contain: 'strict',
    ...style,
  }

  const totalStyle: CSSProperties = {
    height: virtualizer.getTotalSize(),
    width: '100%',
    position: 'relative',
  }

  return (
    <div ref={parentRef} className={className} style={containerStyle}>
      <div style={totalStyle}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const item = items[vItem.index]
          const rowStyle: CSSProperties = {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: vItem.size,
            transform: `translateY(${vItem.start}px)`,
          }
          return (
            <div key={vItem.key} data-index={vItem.index} style={rowStyle}>
              {row(item, vItem.index)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
