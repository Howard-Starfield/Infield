import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { FilePlus, Link2, LoaderCircle, X } from 'lucide-react'
import { toast } from 'sonner'
import { MDXEditorView, type MDXEditorMethods } from '../editor/MDXEditorView'
import { useWorkspaceStore, type WorkspaceNodeSummary } from '@/stores/workspaceStore'
import type { WorkspaceNode } from '@/types/workspace'
import { parseSidenoteRail, type SidenoteRailPersisted } from '@/lib/sidenoteRail'
import { stripLegacyVoiceMemoAudioLine } from '@/lib/voiceMemoAudioDirective'
import {
  WorkspaceMenuDivider,
  WorkspaceMenuItem,
  WorkspaceMenuSurface,
} from '@/components/workspace/chrome/workspaceMenuChrome'
import { workspaceFloatingZ } from '@/lib/workspaceFloatingLayer'

type SidenoteRailProps = {
  parentNode: WorkspaceNode
  /** Merge `sidenote_rail` patch into parent properties and persist with current main title/body. */
  patchRail: (patch: Partial<SidenoteRailPersisted>) => Promise<void>
}

async function fetchChildDocumentIds(parentId: string): Promise<string[]> {
  const kids = await invoke<WorkspaceNode[]>('get_node_children', { parentId })
  return kids
    .filter((k) => k.node_type === 'document')
    .sort((a, b) => a.position - b.position || a.created_at - b.created_at)
    .map((k) => k.id)
}

/** True if `ancestorCandidate` is `nodeId` itself or any parent walking up from `nodeId`. */
async function isAncestorOfNode(ancestorCandidate: string, nodeId: string): Promise<boolean> {
  let id: string | null = nodeId
  const seen = new Set<string>()
  while (id && !seen.has(id)) {
    seen.add(id)
    if (id === ancestorCandidate) return true
    const node: WorkspaceNode | null = await invoke<WorkspaceNode | null>('get_node', { id })
    id = node?.parent_id ?? null
  }
  return false
}

export function SidenoteRail({ parentNode, patchRail }: SidenoteRailProps) {
  const { t } = useTranslation()
  const { createNode, updateNode } = useWorkspaceStore()
  const [childIds, setChildIds] = useState<string[]>([])
  const [loadingChildren, setLoadingChildren] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sidenoteNode, setSidenoteNode] = useState<WorkspaceNode | null>(null)
  const [loadingSidenote, setLoadingSidenote] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addBtnRef = useRef<HTMLButtonElement | null>(null)
  const [attachOpen, setAttachOpen] = useState(false)
  const [nameById, setNameById] = useState<Record<string, string>>({})
  const editorRef = useRef<MDXEditorMethods | null>(null)
  const saveTimeoutRef = useRef<number | null>(null)
  const sidenoteIdRef = useRef<string | null>(null)

  const rail = useMemo(() => parseSidenoteRail(parentNode.properties), [parentNode.properties])
  const pinnedIds = rail.pinned_ids ?? []

  const orderedTabIds = useMemo(() => {
    const pinFiltered = pinnedIds.filter((id) => !childIds.includes(id))
    return [...childIds, ...pinFiltered]
  }, [childIds, pinnedIds])

  const reloadChildren = useCallback(async () => {
    setLoadingChildren(true)
    try {
      const ids = await fetchChildDocumentIds(parentNode.id)
      setChildIds(ids)
    } catch {
      setChildIds([])
    } finally {
      setLoadingChildren(false)
    }
  }, [parentNode.id])

  useEffect(() => {
    void reloadChildren()
  }, [reloadChildren, parentNode.id])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const m: Record<string, string> = {}
      for (const id of orderedTabIds) {
        try {
          const n = await invoke<WorkspaceNode | null>('get_node', { id })
          if (n) m[id] = n.name
        } catch {
          m[id] = id.slice(0, 8)
        }
      }
      if (!cancelled) setNameById(m)
    })()
    return () => {
      cancelled = true
    }
  }, [orderedTabIds])

  useEffect(() => {
    const preferred = rail.active_id
    if (preferred && orderedTabIds.includes(preferred)) {
      setActiveId(preferred)
      return
    }
    setActiveId(orderedTabIds[0] ?? null)
  }, [orderedTabIds, rail.active_id, parentNode.id])

  useEffect(() => {
    sidenoteIdRef.current = activeId
  }, [activeId])

  useEffect(() => {
    if (!activeId) {
      setSidenoteNode(null)
      return
    }
    let cancelled = false
    setLoadingSidenote(true)
    void (async () => {
      try {
        const n = await invoke<WorkspaceNode | null>('get_node', { id: activeId })
        if (cancelled) return
        if (!n || n.node_type !== 'document') {
          setSidenoteNode(null)
          return
        }
        setSidenoteNode(n)
        queueMicrotask(() => {
          editorRef.current?.setMarkdown(n.body ?? '')
        })
      } catch {
        if (!cancelled) setSidenoteNode(null)
      } finally {
        if (!cancelled) setLoadingSidenote(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeId])

  const flushSidenoteSave = useCallback(async () => {
    const id = sidenoteIdRef.current
    if (!id || !sidenoteNode || sidenoteNode.id !== id) return
    const raw = editorRef.current?.getMarkdown() ?? ''
    const cleaned = stripLegacyVoiceMemoAudioLine(raw)
    try {
      const updated = await updateNode(id, sidenoteNode.name, sidenoteNode.icon, sidenoteNode.properties, cleaned)
      if (updated?.id === id) setSidenoteNode(updated)
    } catch (e) {
      toast.error(String(e))
    }
  }, [sidenoteNode, updateNode])

  const scheduleSidenoteSave = useCallback(() => {
    if (saveTimeoutRef.current !== null) window.clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = null
      void flushSidenoteSave()
    }, 800)
  }, [flushSidenoteSave])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
        void flushSidenoteSave()
      }
    }
  }, [activeId, flushSidenoteSave])

  const setActiveTab = useCallback(
    async (id: string | null) => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
        await flushSidenoteSave()
      }
      setActiveId(id)
      await patchRail({ active_id: id })
    },
    [flushSidenoteSave, patchRail],
  )

  const handleNewChild = useCallback(async () => {
    setAddMenuOpen(false)
    try {
      const created = await createNode(parentNode.id, 'document', t('notes.untitled', { defaultValue: 'Untitled' }))
      await reloadChildren()
      await setActiveTab(created.id)
    } catch (e) {
      toast.error(String(e))
    }
  }, [createNode, parentNode.id, reloadChildren, setActiveTab, t])

  const handleAttachPick = useCallback(
    async (summary: WorkspaceNodeSummary) => {
      if (summary.id === parentNode.id) {
        toast.error(t('workspace.sidenotes.pickInvalidSelf'))
        return
      }
      if (summary.node_type !== 'document') {
        toast.error(t('workspace.sidenotes.pickInvalidType'))
        return
      }
      const summaryIsAboveParent = await isAncestorOfNode(summary.id, parentNode.id)
      if (summaryIsAboveParent) {
        toast.error(t('workspace.sidenotes.pickInvalidAncestor'))
        return
      }
      const nextPinned = [...pinnedIds]
      if (nextPinned.includes(summary.id) || childIds.includes(summary.id)) {
        toast.error(t('workspace.sidenotes.pickDuplicate'))
        await setActiveTab(summary.id)
        setAttachOpen(false)
        return
      }
      nextPinned.push(summary.id)
      await patchRail({ pinned_ids: nextPinned, active_id: summary.id })
      await reloadChildren()
      await setActiveTab(summary.id)
      setAttachOpen(false)
    },
    [parentNode.id, pinnedIds, childIds, patchRail, reloadChildren, setActiveTab, t],
  )

  const tabLabel = (id: string) => nameById[id] || (sidenoteNode?.id === id ? sidenoteNode.name : '…')

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        background: 'var(--editor-bg)',
        borderLeft: '1px solid var(--workspace-border)',
      }}
    >
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          borderBottom: '1px solid var(--workspace-border)',
          minHeight: 36,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--workspace-text-muted)',
            marginRight: 4,
          }}
        >
          {t('workspace.sidenotes.railLabel')}
        </span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 2, overflowX: 'auto' }}>
          {loadingChildren ? (
            <LoaderCircle size={12} className="animate-spin" style={{ opacity: 0.5 }} />
          ) : orderedTabIds.length === 0 ? (
            <span style={{ fontSize: 11, color: 'var(--workspace-text-muted)' }}>{t('workspace.sidenotes.empty')}</span>
          ) : (
            orderedTabIds.map((id) => {
              const pinnedOnly = pinnedIds.includes(id) && !childIds.includes(id)
              const active = activeId === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => void setActiveTab(id)}
                  style={{
                    flexShrink: 0,
                    fontSize: 11,
                    padding: '4px 8px',
                    borderRadius: 4,
                    border: '1px solid',
                    borderColor: active ? 'var(--workspace-accent)' : 'transparent',
                    background: active ? 'rgba(183,35,1,.08)' : 'transparent',
                    color: active ? 'var(--workspace-text)' : 'var(--workspace-text-muted)',
                    cursor: 'pointer',
                    maxWidth: 120,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {pinnedOnly ? `${tabLabel(id)} (${t('workspace.sidenotes.pinnedBadge')})` : tabLabel(id) || '…'}
                </button>
              )
            })
          )}
        </div>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            ref={addBtnRef}
            type="button"
            title={t('workspace.sidenotes.attachMenuTitle')}
            onClick={() => setAddMenuOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              borderRadius: 4,
              border: '1px solid var(--workspace-border)',
              background: 'var(--workspace-panel)',
              cursor: 'pointer',
              color: 'var(--workspace-text)',
            }}
          >
            <FilePlus size={14} />
          </button>
          {addMenuOpen && addBtnRef.current && typeof document !== 'undefined'
            ? createPortal(
                <>
                  <div
                    role="presentation"
                    style={{
                      position: 'fixed',
                      inset: 0,
                      zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12000,
                      background: 'transparent',
                    }}
                    onMouseDown={() => setAddMenuOpen(false)}
                  />
                  <WorkspaceMenuSurface
                    role="menu"
                    style={{
                      position: 'fixed',
                      zIndex: (Number.parseInt(workspaceFloatingZ(), 10) || 12000) + 1,
                      top: addBtnRef.current.getBoundingClientRect().bottom + 4,
                      left: Math.min(
                        addBtnRef.current.getBoundingClientRect().left,
                        window.innerWidth - 200,
                      ),
                      minWidth: 180,
                      padding: 4,
                      boxShadow: 'var(--workspace-shadow)',
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <WorkspaceMenuItem
                      type="button"
                      onClick={() => {
                        void handleNewChild()
                      }}
                    >
                      <FilePlus size={12} />
                      {t('workspace.sidenotes.newChild')}
                    </WorkspaceMenuItem>
                    <WorkspaceMenuDivider />
                    <WorkspaceMenuItem
                      type="button"
                      onClick={() => {
                        setAddMenuOpen(false)
                        setAttachOpen(true)
                      }}
                    >
                      <Link2 size={12} />
                      {t('workspace.sidenotes.attach')}
                    </WorkspaceMenuItem>
                  </WorkspaceMenuSurface>
                </>,
                document.body,
              )
            : null}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', padding: '8px 10px 24px' }}>
        {!activeId ? null : loadingSidenote || !sidenoteNode ? (
          <div style={{ padding: 16, color: 'var(--workspace-text-muted)', fontSize: 12 }}>
            <LoaderCircle size={14} className="animate-spin" style={{ display: 'inline', marginRight: 6 }} />
            {t('workspace.sidenotes.loading')}
          </div>
        ) : (
          <MDXEditorView
            ref={editorRef}
            markdown={sidenoteNode.body ?? ''}
            onChange={scheduleSidenoteSave}
            className="mdx-shell"
          />
        )}
      </div>

      {attachOpen ? (
        <SidenoteAttachModal
          onClose={() => setAttachOpen(false)}
          onPick={(s) => void handleAttachPick(s)}
        />
      ) : null}
    </div>
  )
}

function SidenoteAttachModal({
  onClose,
  onPick,
}: {
  onClose: () => void
  onPick: (s: WorkspaceNodeSummary) => void
}) {
  const { t } = useTranslation()
  const searchNodes = useWorkspaceStore((s) => s.searchNodes)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<WorkspaceNodeSummary[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!q.trim()) {
      setResults([])
      return
    }
    let cancelled = false
    setLoading(true)
    const tmr = window.setTimeout(() => {
      void (async () => {
        try {
          const r = await searchNodes(q, { limit: 12 })
          if (!cancelled) setResults(r)
        } catch {
          if (!cancelled) setResults([])
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(tmr)
    }
  }, [q, searchNodes])

  return createPortal(
    <>
      <div
        role="presentation"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 13000,
          background: 'rgba(0,0,0,.35)',
        }}
        onMouseDown={onClose}
      />
      <WorkspaceMenuSurface
        role="dialog"
        aria-label={t('workspace.sidenotes.attachTitle')}
        style={{
          position: 'fixed',
          zIndex: 13001,
          left: '50%',
          top: '22%',
          transform: 'translateX(-50%)',
          width: 'min(420px, 92vw)',
          maxHeight: 'min(70vh, 520px)',
          display: 'flex',
          flexDirection: 'column',
          padding: 12,
          boxShadow: 'var(--workspace-shadow)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{t('workspace.sidenotes.attachTitle')}</span>
          <button
            type="button"
            aria-label={t('workspace.sidenotes.attachClose')}
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--workspace-text-muted)',
              padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('workspace.sidenotes.attachPlaceholder')}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid var(--workspace-border)',
            marginBottom: 8,
            fontSize: 13,
            background: 'var(--workspace-panel)',
            color: 'var(--workspace-text)',
          }}
        />
        <div style={{ flex: 1, minHeight: 120, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--workspace-text-muted)', padding: 8 }}>
              <LoaderCircle size={12} className="animate-spin" style={{ display: 'inline', marginRight: 6 }} />
              …
            </div>
          ) : results.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--workspace-text-muted)', padding: 8 }}>
              {q.trim() ? t('workspace.sidenotes.attachNoResults') : t('workspace.sidenotes.attachTypeHint')}
            </div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onPick(r)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: 'none',
                  borderRadius: 6,
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: 'var(--workspace-text)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--workspace-tree-hover-strong)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 11, color: 'var(--workspace-text-muted)' }}>
                  {r.node_type}
                  {r.parent_name ? ` · ${r.parent_name}` : ''}
                </div>
              </button>
            ))
          )}
        </div>
      </WorkspaceMenuSurface>
    </>,
    document.body,
  )
}
