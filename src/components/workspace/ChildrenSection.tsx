import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react'
import { WorkspaceNodeListIcon } from './workspaceNodeListIcon'
import type { WorkspaceNode } from '../../types/workspace'

interface Props {
  parentId: string
}

export function ChildrenSection({ parentId }: Props) {
  const [children, setChildren] = useState<WorkspaceNode[]>([])
  const [isOpen, setIsOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const navigateTo = useWorkspaceStore(s => s.navigateTo)

  useEffect(() => {
    if (!parentId) return
    setLoading(true)
    invoke<WorkspaceNode[]>('get_node_children', { parentId })
      .then(nodes => {
        setChildren((nodes ?? []).filter(n => !n.deleted_at))
      })
      .catch(() => {
        setChildren([])
      })
      .finally(() => {
        setLoading(false)
      })
  }, [parentId])

  if (loading) return null
  if (children.length === 0) return null

  return (
    <div style={{ marginTop: 32, borderTop: '1px solid var(--workspace-border)', paddingTop: 16 }}>
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
        <FolderOpen size={11} />
        Children ({children.length})
      </button>

      {isOpen && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {children.map(node => (
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
