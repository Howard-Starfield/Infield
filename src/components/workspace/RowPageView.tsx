import { useCallback, useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import {
  parseDatabaseProperties,
  type WorkspaceNode,
} from '../../types/workspace'
import { ChevronRight } from 'lucide-react'
import { WorkspaceNodeListIcon } from './workspaceNodeListIcon'
import { MDXEditorView, type MDXEditorMethods } from '../editor/MDXEditorView'
import { PropertiesSidebar } from './PropertiesSidebar'
import { BacklinksSection } from './BacklinksSection'

interface Props {
  rowNode: WorkspaceNode
  databaseNode: WorkspaceNode
}

export function RowPageView({ rowNode, databaseNode }: Props) {
  const { t } = useTranslation()
  const { updateNode, navigateTo } = useWorkspaceStore()
  const [isSaving, setIsSaving] = useState(false)
  const [markdown, setMarkdown] = useState(rowNode.body ?? '')
  const saveTimeoutRef = useRef<number | null>(null)
  const editorRef = useRef<MDXEditorMethods | null>(null)
  const markdownRef = useRef(markdown)
  markdownRef.current = markdown

  // Get field definitions from the parent database
  const fields = parseDatabaseProperties(databaseNode).fields

  // Sync markdown when rowNode changes
  useEffect(() => {
    setMarkdown(rowNode.body ?? '')
    editorRef.current?.setMarkdown(rowNode.body ?? '')
  }, [rowNode.id])

  const handleSave = useCallback(async (content: string) => {
    if (saveTimeoutRef.current !== null) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    setIsSaving(true)
    try {
      await updateNode(rowNode.id, rowNode.name, rowNode.icon, rowNode.properties, content)
    } catch (e) {
      toast.error(
        t('workspace.saveFailed', { defaultValue: 'Could not save page' }),
        { description: e instanceof Error ? e.message : String(e) },
      )
    } finally {
      setIsSaving(false)
    }
  }, [rowNode, t, updateNode])

  const handleSaveRef = useRef(handleSave)
  handleSaveRef.current = handleSave

  const scheduleAutoSave = useCallback((content: string) => {
    if (saveTimeoutRef.current !== null) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      handleSave(content)
      saveTimeoutRef.current = null
    }, 1000)
  }, [handleSave])

  // Cmd/Ctrl+S immediate save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (saveTimeoutRef.current !== null) {
          clearTimeout(saveTimeoutRef.current)
          saveTimeoutRef.current = null
        }
        void handleSave(markdownRef.current)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      if (saveTimeoutRef.current !== null) {
        clearTimeout(saveTimeoutRef.current)
      }
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleSave])

  // Flush debounced save before unmount / row switch (after keyboard effect so cleanup runs first).
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current !== null) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
        void handleSaveRef.current(markdownRef.current)
      }
    }
  }, [rowNode.id])

  // Handle breadcrumb click to return to database view
  const handleDatabaseClick = useCallback(() => {
    void navigateTo(databaseNode.id, { source: 'tree' })
  }, [databaseNode.id, navigateTo])

  // Handle property field change — update the row node
  const handleFieldChange = useCallback(async (fieldId: string, newValue: unknown) => {
    // Get current cells
    const currentCells = JSON.parse(rowNode.properties || '{}').cells || {}

    // Look up the field type so we wrap as { type, value }
    const fieldType = fields.find(f => f.id === fieldId)?.field_type ?? 'rich_text'

    // Update the specific cell — must wrap as { type, value } to match updateCell format
    const updatedCells = { ...currentCells, [fieldId]: { type: fieldType, value: newValue } }

    // Serialize back to properties
    const updatedProperties = JSON.stringify({ cells: updatedCells })

    setIsSaving(true)
    try {
      await updateNode(rowNode.id, rowNode.name, rowNode.icon, updatedProperties, rowNode.body)
    } catch (e) {
      toast.error(
        t('workspace.saveFailed', { defaultValue: 'Could not save page' }),
        { description: e instanceof Error ? e.message : String(e) },
      )
    } finally {
      setIsSaving(false)
    }
  }, [fields, rowNode, t, updateNode])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        height: '100%',
        background: 'transparent',
      }}
    >
      {/* Breadcrumb navigation */}
      {/* Breadcrumb — matches DocumentEditor slim top bar style */}
      <div style={{
        height: 36, flexShrink: 0,
        display: 'flex', alignItems: 'center',
        padding: '0 18px',
        borderBottom: '1px solid var(--workspace-border)',
        background: 'var(--workspace-note-topbar-bg)',
        backdropFilter: 'blur(var(--workspace-panel-blur))',
        userSelect: 'none',
        boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.45)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 11, fontFamily: 'Inter, sans-serif',
          textTransform: 'uppercase', letterSpacing: '.08em',
          minWidth: 0, overflow: 'hidden',
        }}>
          <span
            onClick={handleDatabaseClick}
            style={{
              color: 'var(--workspace-text-muted)', cursor: 'pointer',
              flexShrink: 0, transition: 'color 80ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--workspace-text)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--workspace-text-muted)' }}
          >
            {databaseNode.icon || '🗂'} {databaseNode.name || 'Database'}
          </span>
          <ChevronRight size={9} style={{ flexShrink: 0, color: 'var(--workspace-text-soft)' }} />
          <span style={{
            color: 'var(--workspace-text)', fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {rowNode.name || 'Untitled'}
          </span>
        </div>

        {/* Saving indicator — matches DocumentEditor */}
        <div style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 11, fontFamily: 'Inter, sans-serif',
            color: isSaving ? 'var(--workspace-text-soft)' : 'var(--workspace-accent-secondary)',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {isSaving ? 'Saving…' : 'Saved'}
          </span>
        </div>
      </div>

      {/* Main content area: body (left) + properties sidebar (right) */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', padding: '24px', gap: 24 }}>
        {/* Body content (left, flex: 1) */}
        <div
          className="workspace-paper-surface"
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            padding: '32px 40px 72px',
          }}
        >
          {/* Row title */}
          <div
            style={{
              fontSize: 28,
              fontWeight: 500,
              fontFamily: 'Georgia, Iowan Old Style, Times New Roman, serif',
              color: 'var(--workspace-text)',
              letterSpacing: '-0.03em',
              marginBottom: 12,
              lineHeight: 1.08,
            }}
          >
            {rowNode.icon && (
              <span style={{ marginRight: 8, display: 'inline-flex', verticalAlign: 'middle' }}>
                <WorkspaceNodeListIcon icon={rowNode.icon} size={28} strokeWidth={1.75} />
              </span>
            )}
            {rowNode.name || 'Untitled'}
          </div>

          {/* MDX Editor for body */}
          <div style={{ marginTop: 24 }}>
            <MDXEditorView
              ref={editorRef}
              markdown={markdown}
              onChange={(content) => {
                setMarkdown(content)
                scheduleAutoSave(content)
              }}
              className="mdx-shell"
            />
          </div>

          {/* Backlinks section — below the body */}
          <BacklinksSection targetId={rowNode.id} />
        </div>

        {/* Properties sidebar (right, 280px) */}
        <PropertiesSidebar
          rowNode={rowNode}
          fields={fields}
          onFieldChange={handleFieldChange}
        />
      </div>
    </div>
  )
}
