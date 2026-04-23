import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Field, FieldType } from '../../types/workspace'
import { FIELD_TYPE_CATALOG, type FieldTypeCatalogEntry } from '@/lib/fieldTypeCatalog'
import {
  fieldTypeForPicker,
  fieldTypesEquivalent,
} from '@/lib/workspaceFieldSelect'
import { WorkspaceMenuSurface } from '@/components/workspace/chrome/workspaceMenuChrome'
import {
  WorkspaceFloatingPortal,
  fitRectInViewport,
  placeMenuAtPointer,
  workspaceFloatingZ,
} from '@/lib/workspaceFloatingLayer'

interface AddProps {
  mode: 'add'
  position: { x: number; y: number }
  onAdd: (name: string, fieldType: string) => void
  onClose: () => void
  /** Field types hidden from the picker (current type is still shown in edit mode). */
  excludedFieldTypes?: readonly FieldType[]
}

interface EditProps {
  mode: 'edit'
  field: Field
  position: { x: number; y: number }
  onRename: (fieldId: string, name: string) => void | Promise<void>
  onDelete: (fieldId: string) => void
  /** Persist column group label (empty clears). */
  onSetGroup?: (fieldId: string, group: string) => void | Promise<void>
  /** When set, user can change non-primary column type on Save. */
  onSetFieldType?: (fieldId: string, fieldType: string) => void | Promise<void>
  onClose: () => void
  /** Field types hidden when picking a new type (current column type is always shown). */
  excludedFieldTypes?: readonly FieldType[]
}

type Props = AddProps | EditProps

const POPOVER_W = 300
const TYPE_LIST_MAX_H = 220

const ESTIMATE_H_ADD = 340
const ESTIMATE_H_EDIT = 440

export function FieldEditorPopover(props: Props) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(props.mode === 'edit' ? props.field.name : '')
  const [selectedType, setSelectedType] = useState<string>(
    props.mode === 'edit' ? fieldTypeForPicker(props.field.field_type) : 'rich_text',
  )
  const [group, setGroup] = useState(props.mode === 'edit' ? (props.field.group ?? '') : '')

  const editFieldId = props.mode === 'edit' ? props.field.id : ''

  const estimateH = props.mode === 'edit' ? ESTIMATE_H_EDIT : ESTIMATE_H_ADD
  const [surfacePos, setSurfacePos] = useState(() =>
    placeMenuAtPointer(props.position.x, props.position.y, {
      menuWidth: POPOVER_W,
      menuHeight: estimateH,
    }),
  )

  useLayoutEffect(() => {
    const initial = placeMenuAtPointer(props.position.x, props.position.y, {
      menuWidth: POPOVER_W,
      menuHeight: estimateH,
    })
    setSurfacePos(initial)
    const id = requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setSurfacePos(
        fitRectInViewport({
          top: initial.top,
          left: initial.left,
          width: r.width,
          height: r.height,
        }),
      )
    })
    return () => cancelAnimationFrame(id)
  }, [props.position.x, props.position.y, props.mode, estimateH, editFieldId])

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    if (props.mode !== 'edit') return
    setName(props.field.name)
    setSelectedType(fieldTypeForPicker(props.field.field_type))
    setGroup(props.field.group ?? '')
  }, [props.mode, editFieldId])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) props.onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [props.onClose])

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (props.mode === 'add') {
      props.onAdd(trimmed, selectedType)
      props.onClose()
      return
    }
    try {
      await Promise.resolve(props.onRename(props.field.id, trimmed))
      if (props.onSetGroup) {
        await Promise.resolve(props.onSetGroup(props.field.id, group.trim()))
      }
      if (
        props.onSetFieldType &&
        !props.field.is_primary &&
        !fieldTypesEquivalent(selectedType, props.field.field_type)
      ) {
        await Promise.resolve(props.onSetFieldType(props.field.id, selectedType))
      }
      props.onClose()
    } catch (err) {
      console.error(err)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleSave()
    if (e.key === 'Escape') props.onClose()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    border: '1px solid var(--workspace-border)',
    borderRadius: 4,
    fontSize: 12,
    fontFamily: 'Space Grotesk, sans-serif',
    color: 'var(--workspace-text)',
    background: 'var(--workspace-panel)',
    outline: 'none',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--workspace-text-soft)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 4,
  }

  const isEdit = props.mode === 'edit'
  const isPrimary = isEdit && props.field.is_primary
  const canEditFieldType = isEdit && Boolean(props.onSetFieldType) && !isPrimary

  const excludedFieldTypes: readonly FieldType[] = props.excludedFieldTypes ?? []
  const typeCatalogEntries = FIELD_TYPE_CATALOG.filter((entry) => {
    if (excludedFieldTypes.includes(entry.type)) {
      if (props.mode === 'edit' && fieldTypesEquivalent(entry.type, props.field.field_type))
        return true
      return false
    }
    return true
  })

  const selectFieldType = useCallback(
    (entry: FieldTypeCatalogEntry) => {
      setSelectedType(entry.type)
      if (props.mode !== 'edit') return
      if (fieldTypesEquivalent(entry.type, props.field.field_type)) {
        setName(props.field.name)
      } else {
        setName(t(entry.labelKey, entry.labelDefault))
      }
    },
    [props, t],
  )

  return (
    <WorkspaceFloatingPortal>
      <WorkspaceMenuSurface
        ref={ref}
        style={{
          position: 'fixed',
          top: surfacePos.top,
          left: surfacePos.left,
          zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
          padding: 12,
          width: POPOVER_W,
          maxWidth: 'min(100vw - 24px, 320px)',
          fontFamily: 'Space Grotesk, sans-serif',
          boxShadow: 'var(--workspace-shadow)',
        }}
      >
      <div style={{ marginBottom: 10 }}>
        <div style={labelStyle}>{t('workspace.fieldEditor.name', 'Field name')}</div>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('workspace.fieldEditor.namePlaceholder', 'Field name')}
          style={inputStyle}
        />
      </div>

      {isEdit && (
        <div style={{ marginBottom: 10 }}>
          <div style={labelStyle}>{t('workspace.fieldEditor.columnGroup', 'Column group')}</div>
          <input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('workspace.fieldEditor.columnGroupPlaceholder', 'Optional — same name groups headers')}
            style={inputStyle}
          />
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <div style={labelStyle}>{t('workspace.fieldEditor.fieldType', 'Field type')}</div>
        {isEdit && !canEditFieldType && (
          <p
            style={{
              margin: '0 0 8px 0',
              fontSize: 10,
              lineHeight: 1.35,
              color: 'var(--workspace-text-muted)',
            }}
          >
            {t(
              'workspace.fieldEditor.typeReadOnlyHint',
              'Type is set when the column is created. Add a new column to use a different type.',
            )}
          </p>
        )}
        {isPrimary && (
          <p
            style={{
              margin: '0 0 8px 0',
              fontSize: 10,
              color: 'var(--workspace-text-muted)',
            }}
          >
            {t('workspace.fieldEditor.primaryTypeLocked', 'The title column stays Text (rich_text).')}
          </p>
        )}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            maxHeight: TYPE_LIST_MAX_H,
            overflowY: 'auto',
            border: '1px solid var(--workspace-border)',
            borderRadius: 6,
            padding: 4,
            background: 'var(--workspace-panel-muted, #faf8f5)',
          }}
        >
          {typeCatalogEntries.map((entry) => {
            const label = t(entry.labelKey, entry.labelDefault)
            const desc = t(entry.descriptionKey, entry.descriptionDefault)
            const current = fieldTypesEquivalent(selectedType, entry.type)
            const interactive =
              !isEdit || canEditFieldType ? !(isPrimary && entry.type !== 'rich_text') : false

            if (isEdit && isPrimary && entry.type !== 'rich_text') {
              return (
                <div
                  key={entry.type}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '5px 6px',
                    borderRadius: 4,
                    opacity: 0.45,
                    fontSize: 11,
                    color: 'var(--workspace-text-muted)',
                  }}
                  title={desc}
                >
                  <span style={{ width: 16, textAlign: 'center', flexShrink: 0 }}>{entry.icon}</span>
                  <span>
                    <span style={{ display: 'block', fontWeight: 500 }}>{label}</span>
                    <span style={{ fontSize: 9, opacity: 0.85 }}>{desc}</span>
                  </span>
                </div>
              )
            }

            if (isEdit && !canEditFieldType) {
              return (
                <div
                  key={entry.type}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '5px 6px',
                    borderRadius: 4,
                    background: current ? 'rgba(183,35,1,0.08)' : 'transparent',
                    border: current ? '1px solid rgba(183,35,1,0.2)' : '1px solid transparent',
                    fontSize: 11,
                    color: current ? 'var(--workspace-accent)' : 'var(--workspace-text)',
                    fontWeight: current ? 600 : 400,
                  }}
                  title={desc}
                >
                  <span style={{ width: 16, textAlign: 'center', flexShrink: 0 }}>{entry.icon}</span>
                  <span>
                    <span style={{ display: 'block' }}>{label}</span>
                    <span
                      style={{
                        fontSize: 9,
                        color: 'var(--workspace-text-muted)',
                        fontWeight: 400,
                      }}
                    >
                      {desc}
                    </span>
                  </span>
                </div>
              )
            }

            return (
              <button
                key={entry.type}
                type="button"
                disabled={!interactive}
                onClick={() => interactive && selectFieldType(entry)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '5px 6px',
                  border: 'none',
                  borderRadius: 4,
                  background: current ? 'rgba(183,35,1,0.07)' : 'transparent',
                  color: current ? 'var(--workspace-accent)' : 'var(--workspace-text)',
                  fontSize: 11,
                  fontFamily: 'Space Grotesk, sans-serif',
                  fontWeight: current ? 600 : 400,
                  cursor: interactive ? 'pointer' : 'default',
                  textAlign: 'left',
                  transition: 'background 100ms',
                }}
                title={desc}
                onMouseEnter={(e) => {
                  if (!interactive || current) return
                  e.currentTarget.style.background = 'rgba(0,0,0,0.04)'
                }}
                onMouseLeave={(e) => {
                  if (current) e.currentTarget.style.background = 'rgba(183,35,1,0.07)'
                  else e.currentTarget.style.background = 'transparent'
                }}
              >
                <span style={{ width: 16, textAlign: 'center', flexShrink: 0 }}>{entry.icon}</span>
                <span>
                  <span style={{ display: 'block' }}>{label}</span>
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--workspace-text-muted)',
                      fontWeight: 400,
                    }}
                  >
                    {desc}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        {isEdit && (
          <button
            type="button"
            onClick={() => {
              props.onDelete(props.field.id)
              props.onClose()
            }}
            style={{
              flex: 1,
              padding: '5px 0',
              border: '1px solid rgba(220,38,38,0.3)',
              borderRadius: 4,
              background: 'transparent',
              color: '#dc2626',
              fontSize: 11,
              fontFamily: 'Space Grotesk, sans-serif',
              cursor: 'pointer',
              transition: 'background 100ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(220,38,38,0.06)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {t('workspace.fieldEditor.delete', 'Delete')}
          </button>
        )}
        <button
          type="button"
          onClick={props.onClose}
          style={{
            flex: 1,
            padding: '5px 0',
            border: '1px solid var(--workspace-border)',
            borderRadius: 4,
            background: 'transparent',
            color: 'var(--workspace-text-muted)',
            fontSize: 11,
            fontFamily: 'Space Grotesk, sans-serif',
            cursor: 'pointer',
            transition: 'background 100ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0,0,0,0.04)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          {t('workspace.fieldEditor.cancel', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!name.trim()}
          style={{
            flex: 1,
            padding: '5px 0',
            borderRadius: 4,
            background: name.trim() ? 'linear-gradient(180deg, #fffef9, #f0e8df)' : 'rgba(0,0,0,0.06)',
            color: name.trim() ? '#1c1c19' : 'var(--workspace-text-soft)',
            border: name.trim() ? '1px solid rgba(183, 35, 1, 0.28)' : 'none',
            fontSize: 11,
            fontFamily: 'Space Grotesk, sans-serif',
            fontWeight: 600,
            cursor: name.trim() ? 'pointer' : 'default',
            transition: 'background 100ms',
          }}
        >
          {props.mode === 'add'
            ? t('workspace.fieldEditor.add', 'Add')
            : t('workspace.fieldEditor.save', 'Save')}
        </button>
      </div>
    </WorkspaceMenuSurface>
    </WorkspaceFloatingPortal>
  )
}
