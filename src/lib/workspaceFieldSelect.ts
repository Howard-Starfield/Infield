import type { FieldType } from '@/types/workspace'

/** Kanban / board column field: stored as `board` (new) or legacy `single_select`; same cell shape. */
export function isBoardColumnFieldType(ft: string): boolean {
  return ft === 'board' || ft === 'single_select'
}

/** Field-type picker normalizes legacy rows to `board` for labels and selection state. */
export function fieldTypeForPicker(ft: FieldType): FieldType {
  return ft === 'single_select' ? 'board' : ft
}

export function fieldTypesEquivalent(a: string, b: string): boolean {
  if (a === b) return true
  return isBoardColumnFieldType(a) && isBoardColumnFieldType(b)
}

/** Row cell JSON keeps `type: "single_select"` for formulas and shared evaluation paths. */
export function persistedCellFieldType(fieldType: string): string {
  return fieldType === 'board' ? 'single_select' : fieldType
}
