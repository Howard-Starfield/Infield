// DatabaseContainer.tsx
// MINIMAL STUB — bridges NoteEditor { databaseId, viewId } → DatabaseShell.
// Uses direct invoke() instead of workspaceStore.loadNode() to avoid polluting global activeNode.
// Full migration to workspaceStore-native callers will happen in Step 9.
import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { DatabaseShell } from '@/components/workspace/DatabaseShell'
import type { WorkspaceNode } from '@/types/workspace'

interface Props {
  databaseId: string
  viewId: string
  name?: string
}

export function DatabaseContainer({ databaseId }: Props) {
  const [node, setNode] = useState<WorkspaceNode | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onSchemaUpdated = useCallback(() => {
    void invoke<WorkspaceNode | null>('get_node', { id: databaseId }).then((n) => {
      if (n) setNode(n)
    })
  }, [databaseId])

  useEffect(() => {
    setNode(null)
    setError(null)
    invoke<WorkspaceNode | null>('get_node', { id: databaseId })
      .then((n) => {
        if (n) {
          setNode(n)
        } else {
          setError(`Node ${databaseId} not found in workspace_nodes`)
        }
      })
      .catch((e: unknown) => setError(String(e)))
  }, [databaseId])

  if (error) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--workspace-text-soft)', fontSize: 13,
        fontFamily: 'Space Grotesk, sans-serif', flexDirection: 'column', gap: 8,
      }}>
        <span>Could not open database</span>
        <span style={{ fontSize: 11, opacity: 0.6 }}>{error}</span>
      </div>
    )
  }

  if (!node) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--workspace-text-soft)', fontSize: 13,
        fontFamily: 'Space Grotesk, sans-serif',
      }}>
        Loading…
      </div>
    )
  }

  return <DatabaseShell node={node} onSchemaUpdated={onSchemaUpdated} />
}
