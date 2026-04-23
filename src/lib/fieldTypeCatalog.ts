import type { FieldType } from '@/types/workspace'
import { isBoardColumnFieldType } from '@/lib/workspaceFieldSelect'

export interface FieldTypeCatalogEntry {
  type: FieldType
  icon: string
  labelKey: string
  labelDefault: string
  /** Shown in popover helper text. */
  descriptionKey: string
  descriptionDefault: string
}

/** Single source of truth for workspace field types shown in UI (order = display order). */
export const FIELD_TYPE_CATALOG: FieldTypeCatalogEntry[] = [
  {
    type: 'rich_text',
    icon: '📝',
    labelKey: 'workspace.fieldType.rich_text',
    labelDefault: 'Text',
    descriptionKey: 'workspace.fieldTypeDesc.rich_text',
    descriptionDefault: 'Titles and long text',
  },
  {
    type: 'number',
    icon: '#',
    labelKey: 'workspace.fieldType.number',
    labelDefault: 'Number',
    descriptionKey: 'workspace.fieldTypeDesc.number',
    descriptionDefault: 'Numeric values and formulas',
  },
  {
    type: 'checkbox',
    icon: '☑',
    labelKey: 'workspace.fieldType.checkbox',
    labelDefault: 'Checkbox',
    descriptionKey: 'workspace.fieldTypeDesc.checkbox',
    descriptionDefault: 'Yes / no',
  },
  {
    type: 'date',
    icon: '📅',
    labelKey: 'workspace.fieldType.date',
    labelDefault: 'Date',
    descriptionKey: 'workspace.fieldTypeDesc.date',
    descriptionDefault: 'Calendar date',
  },
  {
    type: 'date_time',
    icon: '📆',
    labelKey: 'workspace.fieldType.date_time',
    labelDefault: 'Date & time',
    descriptionKey: 'workspace.fieldTypeDesc.date_time',
    descriptionDefault: 'Timestamp',
  },
  {
    type: 'time',
    icon: '🕐',
    labelKey: 'workspace.fieldType.time',
    labelDefault: 'Time',
    descriptionKey: 'workspace.fieldTypeDesc.time',
    descriptionDefault: 'Time of day',
  },
  {
    type: 'url',
    icon: '🔗',
    labelKey: 'workspace.fieldType.url',
    labelDefault: 'URL',
    descriptionKey: 'workspace.fieldTypeDesc.url',
    descriptionDefault: 'Web links',
  },
  {
    type: 'board',
    icon: '📋',
    labelKey: 'workspace.fieldType.board',
    labelDefault: 'Board',
    descriptionKey: 'workspace.fieldTypeDesc.board',
    descriptionDefault: 'One option per card; powers board columns',
  },
  {
    type: 'multi_select',
    icon: '☐',
    labelKey: 'workspace.fieldType.multi_select',
    labelDefault: 'Multi-select',
    descriptionKey: 'workspace.fieldTypeDesc.multi_select',
    descriptionDefault: 'Multiple options',
  },
  {
    type: 'checklist',
    icon: '✓',
    labelKey: 'workspace.fieldType.checklist',
    labelDefault: 'Checklist',
    descriptionKey: 'workspace.fieldTypeDesc.checklist',
    descriptionDefault: 'Subtasks with checkboxes',
  },
  {
    type: 'media',
    icon: '🖼',
    labelKey: 'workspace.fieldType.media',
    labelDefault: 'Media',
    descriptionKey: 'workspace.fieldTypeDesc.media',
    descriptionDefault: 'Images or files',
  },
  {
    type: 'last_edited_time',
    icon: '✎',
    labelKey: 'workspace.fieldType.last_edited_time',
    labelDefault: 'Last edited',
    descriptionKey: 'workspace.fieldTypeDesc.last_edited_time',
    descriptionDefault: 'Auto-updated edit time',
  },
  {
    type: 'created_time',
    icon: '⏱',
    labelKey: 'workspace.fieldType.created_time',
    labelDefault: 'Created time',
    descriptionKey: 'workspace.fieldTypeDesc.created_time',
    descriptionDefault: 'When the row was created',
  },
  {
    type: 'protected',
    icon: '🔒',
    labelKey: 'workspace.fieldType.protected',
    labelDefault: 'Protected',
    descriptionKey: 'workspace.fieldTypeDesc.protected',
    descriptionDefault: 'Masked value in the grid',
  },
]

export function getFieldTypeCatalogEntry(type: FieldType): FieldTypeCatalogEntry | undefined {
  const canonical: FieldType = isBoardColumnFieldType(type) ? 'board' : type
  return FIELD_TYPE_CATALOG.find((e) => e.type === canonical)
}
