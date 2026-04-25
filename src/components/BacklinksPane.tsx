import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { commands, type WorkspaceNode } from '../bindings'
import { Link2, Sparkles } from 'lucide-react'

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
    commands
      .getBacklinks(activeNodeId)
      .then((res) => {
        if (cancelled) return
        if (res.status === 'ok') {
          setLinks(res.data)
        } else {
          setLinks([])
          toast.error("Couldn't load backlinks", { description: res.error })
        }
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setLinks([])
        setLoading(false)
        toast.error("Couldn't load backlinks", {
          description: e instanceof Error ? e.message : String(e),
        })
      })
    return () => {
      cancelled = true
    }
  }, [activeNodeId])

  return (
    <section className="heros-glass-card notes-backlinks">
      <div className="notes-backlinks__top">
        <div className="notes-backlinks__header">
          Backlinks <span className="notes-backlinks__count">{links.length}</span>
        </div>
        <Sparkles size={15} aria-hidden />
      </div>
      {!activeNodeId && (
        <div className="notes-backlinks__empty">
          Open a note to see what links to it.
        </div>
      )}
      {activeNodeId && loading && (
        <div className="notes-backlinks__empty">Loading…</div>
      )}
      {activeNodeId && !loading && links.length === 0 && (
        <div className="notes-backlinks__empty notes-backlinks__empty--center">
          <div className="notes-backlinks__graph" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <strong>No backlinks yet</strong>
          <p>
            Links to this note from other notes will appear here.
          </p>
          <div className="notes-backlinks__hint">
            <Link2 size={14} />
            Type <code>[[</code> in another note to create one
          </div>
        </div>
      )}
      {links.map((l) => (
        <button
          key={l.id}
          type="button"
          className="notes-backlinks__item"
          onClick={() => onSelect(l.id)}
        >
          <span className="notes-backlinks__item-icon" aria-hidden>{l.icon}</span>
          <span className="notes-backlinks__item-title">{l.name}</span>
        </button>
      ))}
    </section>
  )
}
