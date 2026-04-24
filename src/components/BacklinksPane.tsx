import { useEffect, useState } from 'react'
import { commands, type WorkspaceNode } from '../bindings'

interface BacklinksPaneProps {
  activeNodeId: string | null
  onSelect: (id: string) => void
}

export function BacklinksPane({ activeNodeId, onSelect }: BacklinksPaneProps) {
  const [links, setLinks] = useState<WorkspaceNode[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!activeNodeId) {
      setLinks([])
      return
    }
    let cancelled = false
    setLoading(true)
    void commands.getBacklinks(activeNodeId).then((res) => {
      if (cancelled) return
      if (res.status === 'ok') setLinks(res.data)
      else setLinks([])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [activeNodeId])

  return (
    <section className="heros-glass-card notes-backlinks">
      <div className="notes-backlinks__header">Backlinks</div>
      {!activeNodeId && (
        <div className="notes-backlinks__empty">
          Open a note to see what links to it.
        </div>
      )}
      {activeNodeId && loading && (
        <div className="notes-backlinks__empty">Loading…</div>
      )}
      {activeNodeId && !loading && links.length === 0 && (
        <div className="notes-backlinks__empty">
          No backlinks yet. Link to this doc with <code>[[</code> from
          another note and it&apos;ll appear here.
        </div>
      )}
      {links.map((l) => (
        <div
          key={l.id}
          className="notes-backlinks__item"
          onClick={() => onSelect(l.id)}
        >
          {l.icon} {l.name}
        </div>
      ))}
    </section>
  )
}
