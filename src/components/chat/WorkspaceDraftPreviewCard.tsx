import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { fieldColumnLettersHint } from '@/lib/workspaceFormulas'
import type { WorkspaceDatabaseDraft } from '@/lib/workspaceDraftSchema'
import type { Field } from '@/types/workspace'
import { useChatStore } from '@/stores/chatStore'

interface Props {
  draft: WorkspaceDatabaseDraft
  onDismiss: () => void
  /** Anchored composer popup: flush edges, no outer margin. */
  variant?: 'inline' | 'popup'
}

export function WorkspaceDraftPreviewCard({ draft, onDismiss, variant = 'inline' }: Props) {
  const { t } = useTranslation()
  const materializePendingDraft = useChatStore((s) => s.materializePendingDraft)
  const [busy, setBusy] = useState(false)

  const handleConfirm = async () => {
    setBusy(true)
    try {
      const r = await materializePendingDraft(null)
      if (r) {
        toast.success(t('chat.workspace_draft_created', 'Database created'))
        onDismiss()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const maxPreviewRows = 12
  const previewRows = draft.rows.slice(0, maxPreviewRows)
  const hintFields: Field[] = draft.fields.map((f, i) => ({
    id: `c${i}`,
    database_id: '',
    name: f.name,
    field_type: f.field_type,
    is_primary: f.is_primary ?? i === 0,
    type_option: {},
    position: i,
  }))
  const colHint = fieldColumnLettersHint(hintFields)

  const isPopup = variant === 'popup'

  return (
    <div
      style={{
        marginTop: isPopup ? 0 : 10,
        padding: 14,
        borderRadius: isPopup ? 0 : 10,
        border: isPopup ? 'none' : '1px solid var(--workspace-chat-bubble-user-border)',
        background: 'var(--workspace-chat-bubble-user-bg)',
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--workspace-text)' }}>
        {t('chat.workspace_draft_title', 'Workspace table preview')}
      </div>
      <div style={{ fontSize: 11, color: 'var(--workspace-text-muted)', marginBottom: 8 }}>
        {draft.database_name} · {draft.fields.length} {t('chat.columns', 'columns')} · {draft.rows.length}{' '}
        {t('chat.rows', 'rows')}
        {draft.rows.length > maxPreviewRows ? ` (${t('chat.showing_first', 'showing first')} ${maxPreviewRows})` : ''}
      </div>
      <div style={{ fontSize: 10, color: 'var(--workspace-text-soft)', marginBottom: 8, wordBreak: 'break-word' }}>
        {colHint}
      </div>
      <div style={{ overflowX: 'auto', marginBottom: 10 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
          <thead>
            <tr>
              {draft.fields.map((f) => (
                <th
                  key={f.name}
                  style={{
                    textAlign: 'left',
                    padding: '4px 8px',
                    borderBottom: '1px solid var(--workspace-ui-select-table-border)',
                    whiteSpace: 'nowrap',
                    color: 'var(--workspace-text)',
                  }}
                >
                  {f.name}
                  {f.is_primary ? ' *' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, ri) => (
              <tr key={ri}>
                {draft.fields.map((f) => {
                  const v = row[f.name]
                  const cell =
                    v !== null && typeof v === 'object' && v !== null && 'formula' in v
                      ? String((v as { formula: string }).formula)
                      : v === null || v === undefined
                        ? ''
                        : String(v)
                  return (
                    <td
                      key={f.name}
                      style={{
                        padding: '4px 8px',
                        borderBottom: '1px solid var(--workspace-chat-subtle-border-soft)',
                        maxWidth: 160,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontFamily:
                          typeof v === 'object' && v !== null && 'formula' in v
                            ? 'ui-monospace, monospace'
                            : 'inherit',
                      }}
                      title={cell}
                    >
                      {cell}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleConfirm()}
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--workspace-accent)',
            color: 'var(--workspace-on-accent)',
            fontWeight: 600,
            fontSize: 12,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {t('chat.create_database', 'Create database')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid var(--workspace-chat-subtle-border)',
            background: 'transparent',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {t('chat.dismiss', 'Dismiss')}
        </button>
      </div>
    </div>
  )
}
