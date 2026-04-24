import { useCallback, useEffect, useState } from 'react'
import { Tree } from './Tree'
import { MarkdownEditor } from './MarkdownEditor'
import { BacklinksPane } from './BacklinksPane'
import { commands } from '../bindings'
import { toast } from 'sonner'

export function NotesView() {
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const bumpRefresh = useCallback(() => setRefreshToken((n) => n + 1), [])

  const handleCreateRoot = useCallback(async () => {
    try {
      const res = await commands.createNode(null, 'document', 'Untitled')
      if (res.status !== 'ok') {
        toast.error('Could not create document', { description: res.error })
        return
      }
      setActiveNodeId(res.data.id)
      bumpRefresh()
    } catch (e) {
      toast.error('Could not create document', {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }, [bumpRefresh])

  const handleCreateFolder = useCallback(async () => {
    try {
      const res = await commands.createNode(null, 'document', 'New Folder')
      if (res.status !== 'ok') {
        toast.error('Could not create folder', { description: res.error })
        return
      }
      // Update icon to 📁 immediately so it reads as a folder.
      await commands.updateNode(
        res.data.id,
        res.data.name,
        '📁',
        res.data.properties,
        res.data.body,
        res.data.updated_at,
      )
      setActiveNodeId(res.data.id)
      bumpRefresh()
    } catch (e) {
      toast.error('Could not create folder', {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }, [bumpRefresh])

  const handleCreateChild = useCallback(
    async (parentId: string) => {
      try {
        const res = await commands.createNode(parentId, 'document', 'Untitled')
        if (res.status !== 'ok') {
          toast.error('Could not create child document', {
            description: res.error,
          })
          return
        }
        setActiveNodeId(res.data.id)
        bumpRefresh()
      } catch (e) {
        toast.error('Could not create child document', {
          description: e instanceof Error ? e.message : String(e),
        })
      }
    },
    [bumpRefresh],
  )

  // Listen for external "notes:open" events dispatched by AppShell keyboard
  // shortcuts (Cmd+N, Cmd+Shift+J).
  useEffect(() => {
    const on = (ev: Event) => {
      const id = (ev as CustomEvent).detail
      if (typeof id === 'string') {
        setActiveNodeId(id)
        bumpRefresh()
      }
    }
    window.addEventListener('notes:open', on)
    return () => window.removeEventListener('notes:open', on)
  }, [bumpRefresh])

  return (
    <div className="notes-split">
      <Tree
        activeNodeId={activeNodeId}
        onSelect={setActiveNodeId}
        onCreateRoot={handleCreateRoot}
        onCreateFolder={handleCreateFolder}
        onCreateChild={handleCreateChild}
        refreshToken={refreshToken}
      />
      {activeNodeId ? (
        <section
          className="heros-glass-card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <MarkdownEditor
            nodeId={activeNodeId}
            onNodeLinkClick={(id) => setActiveNodeId(id)}
            onOpenInNewTab={(_id) => {
              /* Task 16 will wire tabs; no-op for now. */
            }}
          />
        </section>
      ) : (
        <section
          className="heros-glass-card"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            className="notes-backlinks__empty"
            style={{ textAlign: 'center' }}
          >
            Select a note or create one with <kbd>⌘N</kbd>.
          </div>
        </section>
      )}
      <BacklinksPane activeNodeId={activeNodeId} onSelect={setActiveNodeId} />
    </div>
  )
}
