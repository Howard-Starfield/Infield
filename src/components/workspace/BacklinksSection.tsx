import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { ChevronDown, ChevronRight, ArrowUpLeft } from 'lucide-react'
import { WorkspaceNodeListIcon } from './workspaceNodeListIcon'
import type { WorkspaceNode } from '../../types/workspace'

interface Props {
  targetId: string
}

export function BacklinksSection({ targetId }: Props) {
  const [backlinks, setBacklinks] = useState<WorkspaceNode[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigateTo = useWorkspaceStore(s => s.navigateTo)

  useEffect(() => {
    if (!targetId) return
    setLoading(true)
    invoke<WorkspaceNode[]>('get_backlinks', { targetId })
      .then(nodes => {
        setBacklinks(nodes ?? [])
      })
      .catch(() => {
        setBacklinks([])
      })
      .finally(() => {
        setLoading(false)
      })
  }, [targetId])

  if (loading) return null
  if (backlinks.length === 0) return null

  return (
    <div style={{ marginTop: 32, borderTop: '1px solid var(--workspace-border)', paddingTop: 16 }}>
      {/* Collapsible header */}
      <button
        onClick={() => setIsOpen(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 0',
          color: 'var(--workspace-text-muted)',
          fontSize: 11,
          fontFamily: 'Space Grotesk, sans-serif',
          textTransform: 'uppercase',
          letterSpacing: '.08em',
          fontWeight: 600,
        }}
      >
        {isOpen
          ? <ChevronDown size={12} />
          : <ChevronRight size={12} />
        }
        <ArrowUpLeft size={11} />
        Backlinks ({backlinks.length})
      </button>

      {/* Backlink list */}
      {isOpen && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {backlinks.map(node => (
            <button
              key={node.id}
              onClick={() => navigateTo(node.id, { source: 'wikilink' })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
                transition: 'background 80ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <WorkspaceNodeListIcon icon={node.icon} size={14} />
              <span style={{
                fontSize: 13,
                color: 'var(--workspace-text)',
                fontFamily: 'Manrope, sans-serif',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {node.name || 'Untitled'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
