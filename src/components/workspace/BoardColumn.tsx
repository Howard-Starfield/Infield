import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Field, WorkspaceNode } from '@/types/workspace'
import { SelectColor } from '@/stores/workspaceStore'
import { BOARD_COLUMN_BODY_PREFIX } from './boardDragHelpers'
import { BoardCard } from './BoardCard'
import { BoardColumnHeader } from './BoardColumnHeader'
import { BoardColumnFooter } from './BoardColumnFooter'

interface Props {
  columnId: string
  name: string
  color: SelectColor
  rows: WorkspaceNode[]
  fields: Field[]
  primaryFieldId: string
  /** Single-select field id used to group columns — do not repeat as a card chip. */
  boardGroupFieldId?: string
  getCellTitle: (rowId: string) => string
  getCellBodyPreview: (rowId: string) => string
  onRename: (name: string) => void
  onColorChange: (color: SelectColor) => void
  onDelete: () => void
  onAddCardTop: () => void
  /** Create a new row in this column and open the row editor (replaces title-only footer draft). */
  onCreateCard: () => void | Promise<void>
  /** Double-click a card to open the row editor modal. */
  onOpenRow?: (row: WorkspaceNode) => void
}

export function BoardColumn({
  columnId,
  name,
  color,
  rows,
  fields,
  boardGroupFieldId,
  getCellTitle,
  getCellBodyPreview,
  onRename,
  onColorChange,
  onDelete,
  onAddCardTop,
  onCreateCard,
  onOpenRow,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: columnId,
    data: { type: 'column' },
  })

  const { setNodeRef: setColumnBodyDropRef, isOver: isOverColumnBody } = useDroppable({
    id: `${BOARD_COLUMN_BODY_PREFIX}${columnId}`,
    data: { type: 'columnBody', columnId },
  })

  const style: React.CSSProperties = {
    width: 280,
    flexShrink: 0,
    borderRadius: 12,
    border: isDragging
      ? '1px dashed var(--workspace-accent)'
      : '1px solid transparent',
    background: isDragging ? 'var(--workspace-accent-soft)' : 'transparent',
    display: 'flex',
    flexDirection: 'column',
    transform: CSS.Transform.toString(transform),
    transition: transition ?? 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
    boxSizing: 'border-box',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
    >
      <BoardColumnHeader
        columnId={columnId}
        name={name}
        color={color}
        cardCount={rows.length}
        dragHandleProps={{ ...attributes, ...listeners }}
        onRename={onRename}
        onColorChange={onColorChange}
        onDelete={onDelete}
        onAddCardTop={onAddCardTop}
      />

      {/* id must NOT equal the column useSortable id (columnId) — same string breaks nested SortableContext / activators (listeners {}). */}
      <SortableContext
        id={`board-cards:${columnId}`}
        items={rows.map((r) => r.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setColumnBodyDropRef}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '4px 2px 8px',
            minHeight: rows.length === 0 ? 100 : 40,
            borderRadius: 8,
            transition: 'background 150ms ease',
            background:
              isOverColumnBody
                ? 'var(--workspace-accent-soft)'
                : rows.length === 0
                  ? 'var(--workspace-panel-muted)'
                  : 'transparent',
            border: rows.length === 0 ? '1px dashed var(--workspace-border)' : 'none',
          }}
        >
          {rows.map(row => {
            const cells = JSON.parse(row.properties).cells ?? {}
            return (
              <BoardCard
                key={row.id}
                id={row.id}
                title={getCellTitle(row.id)}
                bodyPreview={getCellBodyPreview(row.id)}
                fields={fields}
                cells={cells}
                suppressChipFieldIds={
                  boardGroupFieldId ? [boardGroupFieldId] : undefined
                }
                onOpenRow={onOpenRow ? () => onOpenRow(row) : undefined}
              />
            )
          })}
        </div>
      </SortableContext>

      <BoardColumnFooter onCreateCard={onCreateCard} />
    </div>
  )
}
