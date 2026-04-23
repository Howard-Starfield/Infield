import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import type { Field, WorkspaceNode } from '@/types/workspace'
import { boardCardContentSourceText } from './board/boardCardPreview'

const SAVE_DEBOUNCE_MS = 500

/** Primary field types we edit as a plain string in the board modal (matches common DB templates). */
function isPrimaryStringEditable(field: Field): boolean {
  return (
    field.field_type === 'rich_text' ||
    field.field_type === 'protected' ||
    field.field_type === 'url' ||
    field.field_type === 'number'
  )
}

function readPrimaryCellString(row: WorkspaceNode, primaryField: Field): string {
  try {
    const cells = JSON.parse(row.properties || '{}').cells ?? {}
    const cell = cells[primaryField.id] as { value?: unknown } | undefined
    const v = cell?.value
    if (v == null) return ''
    if (primaryField.field_type === 'number' && typeof v === 'number') return String(v)
    return typeof v === 'string' ? v : String(v)
  } catch {
    return ''
  }
}

interface Props {
  open: boolean
  row: WorkspaceNode | null
  primaryField: Field | undefined
  /** When set (new DB template), body edits persist to this `rich_text` column instead of `row.body`. */
  contentField?: Field
  databaseId: string
  onClose: () => void
  onOpenFullPage?: (row: WorkspaceNode) => void | Promise<void>
}

export function BoardRowEditModal({
  open,
  row,
  primaryField,
  contentField,
  databaseId,
  onClose,
  onOpenFullPage,
}: Props) {
  const { t } = useTranslation()
  const { updateCell, loadNodeChildren, bumpWorkspaceTreeRevision } = useWorkspaceStore()
  const [titleDraft, setTitleDraft] = useState('')
  const [bodyDraft, setBodyDraft] = useState('')
  const lastSaved = useRef({ title: '', body: '' })
  const debounceRef = useRef<number | null>(null)
  /** Last row id we seeded drafts for (while `open`). */
  const seededForRowId = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      seededForRowId.current = null
      return
    }
    if (!row) return
    if (seededForRowId.current === row.id) return
    seededForRowId.current = row.id
    const title = primaryField ? readPrimaryCellString(row, primaryField) : row.name
    const body =
      contentField?.field_type === 'rich_text'
        ? boardCardContentSourceText(row, contentField)
        : (row.body ?? '')
    setTitleDraft(title)
    setBodyDraft(body)
    lastSaved.current = { title, body }
  }, [open, row, primaryField, contentField])

  const rowRef = useRef(row)
  rowRef.current = row

  const flushSave = useCallback(async () => {
    const r = rowRef.current
    if (!r || !open) return

    const titleChanged = titleDraft !== lastSaved.current.title
    const bodyChanged = bodyDraft !== lastSaved.current.body
    if (!titleChanged && !bodyChanged) return

    try {
      if (titleChanged) {
        if (primaryField && isPrimaryStringEditable(primaryField)) {
          const raw =
            primaryField.field_type === 'number'
              ? (titleDraft.trim() === '' ? 0 : Number(titleDraft))
              : titleDraft
          if (primaryField.field_type === 'number' && Number.isNaN(raw as number)) {
            toast.error(t('workspace.board.invalidNumber', { defaultValue: 'Enter a valid number for this field.' }))
            return
          }
          await updateCell(r.id, primaryField.id, primaryField.field_type, raw, true)
        } else if (primaryField) {
          toast.message(
            t('workspace.board.primaryTypeUnsupported', {
              defaultValue: 'This primary field type cannot be edited here. Use Open full page.',
            }),
          )
          if (!bodyChanged) return
        }
      }

      if (bodyChanged) {
        if (contentField?.field_type === 'rich_text' && isPrimaryStringEditable(contentField)) {
          await updateCell(r.id, contentField.id, contentField.field_type, bodyDraft, false)
          bumpWorkspaceTreeRevision()
          await loadNodeChildren(databaseId)
        } else {
          const latest =
            useWorkspaceStore.getState().activeNodeChildren.find((n) => n.id === r.id) ?? r
          await invoke<WorkspaceNode>('update_node', {
            id: r.id,
            name: latest.name,
            icon: latest.icon,
            properties: latest.properties,
            body: bodyDraft,
          })
          bumpWorkspaceTreeRevision()
          await loadNodeChildren(databaseId)
        }
      }

      lastSaved.current = { title: titleDraft, body: bodyDraft }
    } catch (e) {
      toast.error(String(e))
    }
  }, [
    open,
    titleDraft,
    bodyDraft,
    primaryField,
    contentField,
    databaseId,
    updateCell,
    loadNodeChildren,
    bumpWorkspaceTreeRevision,
    t,
  ])

  useEffect(() => {
    if (!open || !row) return
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      void flushSave()
    }, SAVE_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [open, row?.id, titleDraft, bodyDraft, flushSave])

  const handleClose = useCallback(() => {
    void (async () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      await flushSave()
      onClose()
    })()
  }, [flushSave, onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        void handleClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleClose])

  if (!open || !row) return null

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'rgba(28, 28, 25, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) void handleClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-row-edit-title"
        style={{
          width: 'min(520px, 100%)',
          maxHeight: 'min(88vh, 720px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 20,
          borderRadius: 12,
          background: 'var(--workspace-panel)',
          border: '1px solid var(--workspace-border-strong)',
          boxShadow: 'var(--workspace-shadow)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 id="board-row-edit-title" style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--workspace-text)' }}>
            {t('workspace.board.editCard', { defaultValue: 'Edit card' })}
          </h2>
          <button
            type="button"
            onClick={() => void handleClose()}
            style={{
              border: 'none',
              background: 'var(--workspace-panel-muted)',
              borderRadius: 6,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--workspace-text-muted)',
            }}
          >
            {t('common.close', { defaultValue: 'Close' })}
          </button>
        </div>

        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--workspace-text-muted)' }}>
          {primaryField?.name ?? t('workspace.board.title', { defaultValue: 'Title' })}
        </label>
        <input
          type={primaryField?.field_type === 'number' ? 'number' : 'text'}
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          autoFocus
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--workspace-border)',
            fontSize: 14,
            fontFamily: 'inherit',
            background: 'var(--workspace-bg-soft)',
            color: 'var(--workspace-text)',
            boxSizing: 'border-box',
          }}
        />

        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--workspace-text-muted)' }}>
          {contentField?.name?.trim() ||
            t('workspace.board.content', { defaultValue: 'Content' })}
        </label>
        <textarea
          value={bodyDraft}
          onChange={(e) => setBodyDraft(e.target.value)}
          placeholder={t('workspace.board.bodyPlaceholder', { defaultValue: 'Markdown…' })}
          style={{
            width: '100%',
            minHeight: 200,
            flex: 1,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--workspace-border)',
            fontSize: 13,
            fontFamily: 'ui-monospace, monospace',
            lineHeight: 1.45,
            resize: 'vertical',
            background: 'var(--workspace-bg-soft)',
            color: 'var(--workspace-text)',
            boxSizing: 'border-box',
          }}
        />

        <p style={{ margin: 0, fontSize: 11, color: 'var(--workspace-text-muted)' }}>
          {t('workspace.board.autoSaveHint', { defaultValue: 'Changes save automatically.' })}
        </p>

        {onOpenFullPage ? (
          <button
            type="button"
            onClick={() => {
              void (async () => {
                await flushSave()
                onClose()
                await onOpenFullPage(row)
              })()
            }}
            style={{
              alignSelf: 'flex-start',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--workspace-accent)',
              textDecoration: 'underline',
              padding: 0,
            }}
          >
            {t('workspace.board.openFullPage', { defaultValue: 'Open full page' })}
          </button>
        ) : null}
      </div>
    </div>
  )
}
