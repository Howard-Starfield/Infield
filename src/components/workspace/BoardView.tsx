import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  defaultDropAnimationSideEffects,
  type DragStartEvent,
  type DragEndEvent,
  type DragCancelEvent,
  type DropAnimation,
  type SensorDescriptor,
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useWorkspaceStore, type SelectColor } from '@/stores/workspaceStore'
import {
  BOARD_VIEW_GROUP_FIELD_OPTION_KEY,
  parseDatabaseProperties,
} from '@/types/workspace'
import { isBoardColumnFieldType } from '@/lib/workspaceFieldSelect'
import type { Field, NodeView, WorkspaceNode } from '@/types/workspace'
import { BoardColumn } from './BoardColumn'
import { BoardCard } from './BoardCard'
import { BoardRowEditModal } from './BoardRowEditModal'
import { boardCardBodyPreviewFromRow } from './board/boardCardPreview'
import { AddColumnTrailing } from './AddColumnTrailing'
import { cursorDebugLog } from '@/lib/cursorDebugLog'
import { WORKSPACE_BOARD_DATABASE_ATTR } from './board/workspaceDropDataAttrs'
import { useBoardDragPointerTracking } from './board/useBoardDragPointer'
import { startCrossDatabaseBoardDropIfNeeded } from './board/applyCrossDatabaseBoardDrop'
import { persistBoardCardDropAfterDrag } from './board/boardCardDropPersistence'

/** Confirms DndContext subtree mounted and sensor descriptor count (activators non-empty when >0). */
function BoardDndTelemetry({ sensorCount, databaseId }: { sensorCount: number; databaseId: string }) {
  useLayoutEffect(() => {
    cursorDebugLog({
      hypothesisId: 'H_ctx_mount',
      message: 'board_dnd_context_mounted',
      data: { sensorCount, databaseId },
    })
  }, [sensorCount, databaseId])
  return null
}

interface Props {
  databaseId: string
  /** Schema source (must match databaseId); avoids relying on global activeNode when embedded in DatabaseContainer. */
  databaseNode: WorkspaceNode
  /** Active board tab; `view_options.boardGroupFieldId` selects which single-select groups columns when several exist. */
  activeView: NodeView
  onSchemaUpdated?: () => void
}

type ActiveItem = { type: 'card'; id: string } | { type: 'column'; id: string } | null

const boardDropAnimation: DropAnimation = {
  duration: 200,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0.35' } },
  }),
}

export function BoardView({ databaseId, databaseNode, activeView, onSchemaUpdated }: Props) {
  const { t } = useTranslation()
  const [active, setActive] = useState<ActiveItem>(null)
  const [columnOrder, setColumnOrder] = useState<string[]>([])
  const [editorRowId, setEditorRowId] = useState<string | null>(null)
  const boardPointerRef = useBoardDragPointerTracking(!!active)

  const {
    activeNodeChildren,
    loadNodeChildren,
    addSingleSelectField,
    createSelectOption,
    renameSelectOption,
    updateSelectOptionColor,
    deleteSelectOption,
    reorderSelectOptions,
    createRowInGroup,
    updateCell,
    moveNode,
    updateView,
    navigateTo,
  } = useWorkspaceStore()

  useEffect(() => {
    void loadNodeChildren(databaseId)
  }, [databaseId, loadNodeChildren])

  const fields = useMemo(() => {
    if (!databaseNode || databaseNode.node_type !== 'database') return []
    return parseDatabaseProperties(databaseNode).fields
  }, [databaseNode])

  const singleSelectFields = useMemo(
    () => fields.filter((f): f is Field => isBoardColumnFieldType(f.field_type)),
    [fields],
  )

  const groupField = useMemo(() => {
    if (singleSelectFields.length === 0) return undefined
    let persistedId: string | undefined
    try {
      const o = JSON.parse(activeView.view_options || '{}') as Record<string, unknown>
      const raw = o[BOARD_VIEW_GROUP_FIELD_OPTION_KEY]
      persistedId = typeof raw === 'string' ? raw : undefined
    } catch {
      persistedId = undefined
    }
    if (persistedId) {
      const hit = singleSelectFields.find((f) => f.id === persistedId)
      if (hit) return hit
    }
    return singleSelectFields[0]
  }, [singleSelectFields, activeView.view_options])

  const handleGroupFieldChange = useCallback(
    async (fieldId: string) => {
      let prev: Record<string, unknown> = {}
      try {
        prev = JSON.parse(activeView.view_options || '{}') as Record<string, unknown>
      } catch {
        prev = {}
      }
      const nextOpts = JSON.stringify({
        ...prev,
        [BOARD_VIEW_GROUP_FIELD_OPTION_KEY]: fieldId,
      })
      await updateView(
        activeView.id,
        activeView.name,
        activeView.color,
        activeView.filters,
        activeView.sorts,
        nextOpts,
      )
    },
    [activeView, updateView],
  )

  const primaryField = useMemo(
    () => fields.find((f: Field) => f.is_primary),
    [fields]
  )

  const contentField = useMemo(
    () => fields.find((f) => f.name === 'card_content' && f.field_type === 'rich_text'),
    [fields],
  )

  const options = useMemo(() => {
    if (!groupField || !isBoardColumnFieldType(groupField.field_type)) return []
    return groupField.type_option?.options ?? []
  }, [groupField])

  const orderedOptions = useMemo(() => {
    if (columnOrder.length === 0) return options
    return [
      ...columnOrder
        .map((id) => options.find((o: { id: string }) => o.id === id))
        .filter(Boolean),
      ...options.filter((o: { id: string }) => !columnOrder.includes(o.id)),
    ] as typeof options
  }, [options, columnOrder])

  const rowsByOption = useMemo(() => {
    const map = new Map<string | null, typeof activeNodeChildren>()
    for (const opt of options) map.set(opt.id, [])
    map.set(null, [])
    for (const row of activeNodeChildren) {
      if (row.node_type !== 'row') continue
      const cells = JSON.parse(row.properties).cells ?? {}
      const fieldId = groupField?.id
      const cell = fieldId ? cells[fieldId] : undefined
      const optId = (cell as { value?: string } | undefined)?.value ?? null
      const bucket = map.get(optId) ?? map.get(null)!
      bucket.push(row)
    }
    return map
  }, [activeNodeChildren, options, groupField])

  const getCellTitle = (rowId: string) => {
    if (!primaryField) return ''
    const row = activeNodeChildren.find((r) => r.id === rowId)
    if (!row) return ''
    const cells = JSON.parse(row.properties).cells ?? {}
    const cell = cells[primaryField.id]
    return (cell as { value?: string } | undefined)?.value ?? ''
  }

  const getCellBodyPreview = useCallback(
    (rowId: string) => {
      const row = activeNodeChildren.find((r) => r.id === rowId)
      if (!row) return ''
      return boardCardBodyPreviewFromRow(row, contentField)
    },
    [activeNodeChildren, contentField],
  )

  const editorRow = useMemo(
    () =>
      editorRowId
        ? activeNodeChildren.find((r) => r.node_type === 'row' && r.id === editorRowId) ?? null
        : null,
    [editorRowId, activeNodeChildren],
  )

  const handleNewCardInColumn = useCallback(
    async (optionId: string) => {
      if (!groupField) return
      const node = await createRowInGroup(
        databaseId,
        groupField.id,
        optionId,
        t('database.newCard', { defaultValue: 'Untitled' }),
      )
      setEditorRowId(node.id)
    },
    [createRowInGroup, databaseId, groupField, t],
  )

  // Stable descriptor list (avoid useSensors + fresh inline options churn). Pointer + Keyboard matches dnd-kit defaults pattern.
  const sensors = useMemo<SensorDescriptor<any>[]>(
    () => [
      { sensor: PointerSensor, options: { activationConstraint: { distance: 5 } } },
      { sensor: KeyboardSensor, options: { coordinateGetter: sortableKeyboardCoordinates } },
    ],
    [],
  )

  const handleDragStart = (event: DragStartEvent) => {
    const { active: activeData } = event
    const data = activeData.data.current
    // #region agent log
    if (import.meta.env.DEV) {
      console.warn('[board-debug] dragStart', { activeId: String(activeData.id), dataType: (data as { type?: string } | undefined)?.type })
    }
    cursorDebugLog({
      hypothesisId: 'H2_H5',
      location: 'BoardView.tsx:handleDragStart',
      message: 'board_drag_start',
      data: {
        databaseId,
        activeId: String(activeData.id),
        dataType: data && typeof data === 'object' && 'type' in data ? String((data as { type?: string }).type) : 'none',
      },
      runId: 'pre',
    })
    fetch('http://127.0.0.1:7495/ingest/3dfc22e3-3e32-4833-af5d-3a71f45298aa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '840aad' },
      body: JSON.stringify({
        sessionId: '840aad',
        hypothesisId: 'H2_H5',
        location: 'BoardView.tsx:handleDragStart',
        message: 'board_drag_start',
        data: {
          databaseId,
          activeId: String(activeData.id),
          dataType: data && typeof data === 'object' && 'type' in data ? String((data as { type?: string }).type) : 'none',
        },
        timestamp: Date.now(),
        runId: 'pre',
      }),
    }).catch(() => {})
    // #endregion
    if (data?.type === 'column') {
      setActive({ type: 'column', id: activeData.id as string })
    } else {
      setActive({ type: 'card', id: activeData.id as string })
    }
  }

  const handleDragCancel = (event: DragCancelEvent) => {
    const { active: activeData } = event
    const data = activeData.data.current
    // #region agent log
    if (import.meta.env.DEV) {
      console.warn('[board-debug] dragCancel', { activeId: String(activeData.id), dataType: (data as { type?: string } | undefined)?.type })
    }
    cursorDebugLog({
      hypothesisId: 'H6',
      location: 'BoardView.tsx:handleDragCancel',
      message: 'board_drag_cancel',
      data: {
        activeId: String(activeData.id),
        dataType:
          data && typeof data === 'object' && 'type' in data ? String((data as { type?: string }).type) : 'none',
      },
      runId: 'pre',
    })
    fetch('http://127.0.0.1:7495/ingest/3dfc22e3-3e32-4833-af5d-3a71f45298aa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '840aad' },
      body: JSON.stringify({
        sessionId: '840aad',
        hypothesisId: 'H6',
        location: 'BoardView.tsx:handleDragCancel',
        message: 'board_drag_cancel',
        data: {
          activeId: String(activeData.id),
          dataType:
            data && typeof data === 'object' && 'type' in data ? String((data as { type?: string }).type) : 'none',
        },
        timestamp: Date.now(),
        runId: 'pre',
      }),
    }).catch(() => {})
    // #endregion
    setActive(null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: activeData, over } = event
    const rowCount = activeNodeChildren.filter((n) => n.node_type === 'row').length
    // #region agent log
    cursorDebugLog({
      hypothesisId: 'H1_H2_H4',
      location: 'BoardView.tsx:handleDragEnd:entry',
      message: 'board_drag_end_entry',
      data: {
        databaseId,
        activeType:
          activeData.data.current && typeof activeData.data.current === 'object' && 'type' in activeData.data.current
            ? String((activeData.data.current as { type?: string }).type)
            : 'none',
        activeId: String(activeData.id),
        hasOver: !!over,
        overId: over ? String(over.id) : null,
        hasGroupField: !!groupField,
        groupFieldId: groupField?.id ?? null,
        rowChildCount: rowCount,
      },
      runId: 'pre',
    })
    fetch('http://127.0.0.1:7495/ingest/3dfc22e3-3e32-4833-af5d-3a71f45298aa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '840aad' },
      body: JSON.stringify({
        sessionId: '840aad',
        hypothesisId: 'H1_H2_H4',
        location: 'BoardView.tsx:handleDragEnd:entry',
        message: 'board_drag_end_entry',
        data: {
          databaseId,
          activeType:
            activeData.data.current && typeof activeData.data.current === 'object' && 'type' in activeData.data.current
              ? String((activeData.data.current as { type?: string }).type)
              : 'none',
          activeId: String(activeData.id),
          hasOver: !!over,
          overId: over ? String(over.id) : null,
          hasGroupField: !!groupField,
          groupFieldId: groupField?.id ?? null,
          rowChildCount: rowCount,
        },
        timestamp: Date.now(),
        runId: 'pre',
      }),
    }).catch(() => {})
    // #endregion

    if (activeData.data.current?.type === 'column' && over) {
      const oldIndex = orderedOptions.findIndex((o) => o.id === activeData.id)
      const newIndex = orderedOptions.findIndex((o) => o.id === over.id)
      if (oldIndex !== newIndex) {
        const newOrder = arrayMove(
          orderedOptions.map((o) => o.id),
          oldIndex,
          newIndex
        )
        setColumnOrder(newOrder)
        if (groupField) {
          void reorderSelectOptions(databaseId, groupField.id, newOrder).then(() => {
            onSchemaUpdated?.()
          })
        }
      }
      setActive(null)
      return
    }

    if (activeData.data.current?.type === 'card' && over && groupField) {
      const activeId = activeData.id as string
      const overId = over.id as string
      void persistBoardCardDropAfterDrag({
        activeId,
        overId,
        childrenSnapshot: [...activeNodeChildren],
        optionIds: orderedOptions.map((o) => o.id),
        groupFieldId: groupField.id,
        databaseId,
        updateCell,
        moveNode,
        loadNodeChildren,
        toastError: (m) => toast.error(m),
        onFinished: () => setActive(null),
      })
      return
    }

    if (activeData.data.current?.type === 'card' && groupField) {
      const started = startCrossDatabaseBoardDropIfNeeded({
        databaseId,
        rowId: String(activeData.id),
        pointer: boardPointerRef.current,
        over,
        successMessage: t('workspace.board.rowMovedToDatabase', { defaultValue: 'Row moved to the other database.' }),
        moveNode,
        loadNodeChildren,
        toastSuccess: (m) => toast.success(m),
        toastError: (m) => toast.error(m),
        onFinished: () => setActive(null),
      })
      if (started) return
    }

    // #region agent log
    if (activeData.data.current?.type === 'card') {
      cursorDebugLog({
        hypothesisId: 'H1',
        location: 'BoardView.tsx:handleDragEnd:fallback',
        message: 'card_drag_no_persist_branch',
        data: {
          reason: !over ? 'no_over' : !groupField ? 'no_group_field' : 'unexpected',
          activeId: String(activeData.id),
        },
        runId: 'pre',
      })
      fetch('http://127.0.0.1:7495/ingest/3dfc22e3-3e32-4833-af5d-3a71f45298aa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '840aad' },
        body: JSON.stringify({
          sessionId: '840aad',
          hypothesisId: 'H1',
          location: 'BoardView.tsx:handleDragEnd:fallback',
          message: 'card_drag_no_persist_branch',
          data: {
            reason: !over ? 'no_over' : !groupField ? 'no_group_field' : 'unexpected',
            activeId: String(activeData.id),
          },
          timestamp: Date.now(),
          runId: 'pre',
        }),
      }).catch(() => {})
    }
    // #endregion
    setActive(null)
  }

  if (!groupField) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: 'var(--workspace-text-muted)' }}>
        <div style={{ fontSize: 13, textAlign: 'center', maxWidth: 280 }}>
          Board view needs a <strong>board</strong> column (single-select style) to group cards into columns.
        </div>
        <button
          onClick={async () => {
            await addSingleSelectField(databaseId, 'board')
            onSchemaUpdated?.()
          }}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--workspace-accent)',
            color: '#fff',
            fontSize: 13,
            fontFamily: 'Space Grotesk, sans-serif',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Add Board field
        </button>
      </div>
    )
  }

  return (
    <>
      {singleSelectFields.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 20px 0',
            fontSize: 12,
            color: 'var(--workspace-text-muted)',
            flexShrink: 0,
          }}
        >
          <label htmlFor="board-group-field" style={{ fontWeight: 500 }}>
            {t('database.groupBy')}
          </label>
          <select
            id="board-group-field"
            value={groupField.id}
            onChange={(e) => void handleGroupFieldChange(e.target.value)}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid var(--workspace-border)',
              background: 'var(--workspace-panel)',
              color: 'var(--workspace-text)',
              fontFamily: 'inherit',
            }}
          >
            {singleSelectFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <BoardDndTelemetry sensorCount={sensors.length} databaseId={databaseId} />
      <div
        className="workspace-board-strip"
        {...{ [WORKSPACE_BOARD_DATABASE_ATTR]: databaseId }}
        style={{
          display: 'flex',
          gap: 20,
          padding: '16px 20px',
          height: '100%',
          overflowX: 'auto',
          alignItems: 'flex-start',
          background: 'var(--workspace-bg-soft)',
        }}
      >
        <SortableContext
          id="database-board-columns"
          items={orderedOptions.map((o: { id: string }) => o.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            {orderedOptions.map((opt) => (
              <BoardColumn
                key={opt.id}
                columnId={opt.id}
                name={opt.name}
                color={opt.color as SelectColor}
                rows={rowsByOption.get(opt.id) ?? []}
                fields={fields}
                primaryFieldId={primaryField?.id ?? ''}
                boardGroupFieldId={groupField.id}
                getCellTitle={getCellTitle}
                getCellBodyPreview={getCellBodyPreview}
                onRename={(name) =>
                  void renameSelectOption(databaseId, groupField.id, opt.id, name).then(() => {
                    onSchemaUpdated?.()
                  })
                }
                onColorChange={(color) =>
                  void updateSelectOptionColor(databaseId, groupField.id, opt.id, color).then(() => {
                    onSchemaUpdated?.()
                  })
                }
                onDelete={() => {
                  const count = (rowsByOption.get(opt.id) ?? []).length
                  const msg = t('database.deleteColumnConfirm', { name: opt.name, count })
                  if (count === 0 || window.confirm(msg)) {
                    void deleteSelectOption(databaseId, groupField.id, opt.id).then(() => {
                      onSchemaUpdated?.()
                    })
                  }
                }}
                onAddCardTop={() => void handleNewCardInColumn(opt.id)}
                onCreateCard={() => void handleNewCardInColumn(opt.id)}
                onOpenRow={(row) => setEditorRowId(row.id)}
              />
            ))}
          </div>
        </SortableContext>
        <AddColumnTrailing
          onAdd={async (name) => {
            try {
              await createSelectOption(databaseId, groupField.id, name)
              onSchemaUpdated?.()
            } catch (e) {
              toast.error(String(e))
            }
          }}
        />
      </div>
      <DragOverlay dropAnimation={boardDropAnimation}>
        {active?.type === 'card' && (() => {
          const row = activeNodeChildren.find((r) => r.id === active.id)
          const cells = row ? JSON.parse(row.properties).cells ?? {} : {}
          return row ? (
            <BoardCard
              id={row.id}
              title={getCellTitle(row.id)}
              bodyPreview={getCellBodyPreview(row.id)}
              fields={fields}
              cells={cells}
              suppressChipFieldIds={
                groupField ? [groupField.id] : undefined
              }
              isOverlay
            />
          ) : null
        })()}
        {active?.type === 'column' && (() => {
          const col = orderedOptions.find((o: { id: string }) => o.id === active.id)
          return col ? (
            <div
              style={{
                width: 280,
                borderRadius: 'var(--workspace-panel-radius)',
                border: '1px solid var(--workspace-border-strong)',
                background: 'var(--workspace-panel)',
                boxShadow: 'var(--workspace-shadow)',
                transform: 'rotate(1deg) scale(1.02)',
              }}
            >
              <BoardColumn
                columnId={col.id}
                name={col.name}
                color={col.color as SelectColor}
                rows={rowsByOption.get(col.id) ?? []}
                fields={fields}
                primaryFieldId={primaryField?.id ?? ''}
                boardGroupFieldId={groupField?.id}
                getCellTitle={getCellTitle}
                getCellBodyPreview={getCellBodyPreview}
                onRename={() => {}}
                onColorChange={() => {}}
                onDelete={() => {}}
                onAddCardTop={() => {}}
                onCreateCard={() => {}}
              />
            </div>
          ) : null
        })()}
      </DragOverlay>
    </DndContext>
      <BoardRowEditModal
        open={Boolean(editorRowId && editorRow)}
        row={editorRow}
        primaryField={primaryField}
        contentField={contentField}
        databaseId={databaseId}
        onClose={() => setEditorRowId(null)}
        onOpenFullPage={(r) => navigateTo(r.id, { source: 'tree' })}
      />
    </>
  )
}
