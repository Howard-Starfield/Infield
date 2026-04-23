import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { Folder, Table2 } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import {
  WorkspaceMenuItem,
  WorkspaceMenuSurface,
} from '@/components/workspace/chrome/workspaceMenuChrome'
import {
  WorkspaceFloatingPortal,
  workspaceFloatingBackdropZ,
  workspaceFloatingZ,
} from '@/lib/workspaceFloatingLayer'

interface ImportExportMenuProps {
  onClose: () => void
}

export function ImportExportMenu({ onClose }: ImportExportMenuProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<string | null>(null)
  const { importMarkdownFolder, importCsv } = useWorkspaceStore()

  const handleImportMarkdown = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: t('workspace.importMarkdown') })
      if (selected) {
        setStatus(t('workspace.importSuccess', { count: 1 }))
        await importMarkdownFolder(selected as string)
      }
    } catch (e) {
      setStatus(t('workspace.importError', { error: String(e) }))
    }
    setTimeout(() => { setStatus(null); onClose() }, 1500)
  }

  const handleImportCsv = async () => {
    try {
      const selected = await open({ multiple: false, filters: [{ name: 'CSV', extensions: ['csv'] }], title: t('workspace.importCsv') })
      if (selected) {
        await importCsv(selected as string)
        setStatus(t('workspace.importSuccess', { count: 1 }))
      }
    } catch (e) {
      setStatus(t('workspace.importError', { error: String(e) }))
    }
    setTimeout(() => { setStatus(null); onClose() }, 1500)
  }

  return (
    <WorkspaceFloatingPortal>
      <div
        role="presentation"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: Number.parseInt(workspaceFloatingBackdropZ(), 10) || 12000,
          background: 'transparent',
        }}
        onMouseDown={onClose}
      />
      <WorkspaceMenuSurface
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
          padding: '8px 0',
          minWidth: 220,
          boxShadow: 'var(--workspace-shadow)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '4px 16px 8px', fontSize: 11, fontWeight: 600, color: 'var(--workspace-text-muted)', fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: '.12em' }}>
          {t('workspace.importSection', 'Import')}
        </div>
        <WorkspaceMenuItem
          onMouseDown={(e) => {
            e.preventDefault()
            void handleImportMarkdown()
          }}
        >
          <Folder size={14} className="shrink-0 opacity-70" aria-hidden />
          {t('workspace.importMarkdown')}
        </WorkspaceMenuItem>
        <WorkspaceMenuItem
          onMouseDown={(e) => {
            e.preventDefault()
            void handleImportCsv()
          }}
        >
          <Table2 size={14} className="shrink-0 opacity-70" aria-hidden />
          {t('workspace.importCsv')}
        </WorkspaceMenuItem>
        {status && (
          <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--workspace-accent)' }}>
            {status}
          </div>
        )}
      </WorkspaceMenuSurface>
    </WorkspaceFloatingPortal>
  )
}

export async function exportNode(nodeId: string, nodeType: string): Promise<void> {
  const t = i18n.t.bind(i18n)
  if (nodeType === 'document') {
    const path = await save({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: 'export.md',
      title: t('workspace.exportMarkdown'),
    })
    if (path) {
      await invoke('export_markdown', { nodeId, path })
    }
  } else if (nodeType === 'database') {
    const path = await save({
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      defaultPath: 'export.csv',
      title: t('workspace.exportCsv'),
    })
    if (path) {
      // Use first view or empty string if none
      const views = await invoke<any[]>('get_node_views', { nodeId })
      const viewId = views[0]?.id ?? ''
      await invoke('export_csv', { nodeId, viewId, path })
    }
  }
}
