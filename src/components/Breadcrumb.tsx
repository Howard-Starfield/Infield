import { useEffect, useState, useMemo } from 'react'
import { commands } from '../bindings'
import type { WorkspaceNode } from '../bindings'
import { getAncestors } from '../editor/ancestors'

export interface BreadcrumbProps {
  nodeId: string
  onNavigate: (nodeId: string) => void
}

const COLLAPSE_THRESHOLD = 60  // total chars incl. separators

export function Breadcrumb({ nodeId, onNavigate }: BreadcrumbProps) {
  const [ancestors, setAncestors] = useState<WorkspaceNode[] | null>(null)
  const [expandedOverride, setExpandedOverride] = useState(false)

  useEffect(() => {
    let cancelled = false
    setAncestors(null)
    setExpandedOverride(false)
    void getAncestors(nodeId, commands).then((chain) => {
      if (!cancelled) setAncestors(chain)
    })
    return () => { cancelled = true }
  }, [nodeId])

  const totalLength = useMemo(() => {
    if (!ancestors) return 0
    return ancestors.reduce((acc, n) => acc + n.name.length, 0) + (ancestors.length - 1) * 3
  }, [ancestors])

  if (!ancestors) {
    return (
      <nav className="breadcrumb breadcrumb--loading" aria-label="Breadcrumb">
        <span className="breadcrumb__skeleton">—</span>
      </nav>
    )
  }
  if (ancestors.length === 0) {
    return <nav className="breadcrumb" aria-label="Breadcrumb" />
  }

  const shouldCollapse =
    !expandedOverride &&
    ancestors.length > 3 &&
    totalLength > COLLAPSE_THRESHOLD

  const visible: Array<WorkspaceNode | 'ellipsis'> = shouldCollapse
    ? [ancestors[0], 'ellipsis', ancestors[ancestors.length - 1]]
    : ancestors

  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {visible.map((item, i) => {
        const isLast = i === visible.length - 1
        if (item === 'ellipsis') {
          return (
            <span key={`ell-${i}`} className="breadcrumb__segment-wrap">
              <button
                type="button"
                className="breadcrumb__segment breadcrumb__segment--ellipsis"
                onClick={() => setExpandedOverride(true)}
                aria-label="Expand breadcrumb"
              >
                …
              </button>
              <span className="breadcrumb__sep">›</span>
            </span>
          )
        }
        return (
          <span key={item.id} className="breadcrumb__segment-wrap">
            <button
              type="button"
              className={
                'breadcrumb__segment' +
                (isLast ? ' breadcrumb__segment--leaf' : '')
              }
              disabled={isLast}
              onClick={() => !isLast && onNavigate(item.id)}
            >
              {item.name}
            </button>
            {!isLast && <span className="breadcrumb__sep">›</span>}
          </span>
        )
      })}
    </nav>
  )
}
