import type { CellData } from '@/types/workspace'

export interface CellPayload extends CellData {
  formula?: string | null
  evalError?: string | null
}

export function extractCellFormula(rawCell: unknown): string | null {
  if (rawCell === null || rawCell === undefined) return null
  if (typeof rawCell === 'object' && rawCell !== null && 'formula' in rawCell) {
    const f = (rawCell as Record<string, unknown>).formula
    if (typeof f === 'string' && f.trim()) return f.trim()
  }
  return null
}

export function hasCellFormula(rawCell: unknown): boolean {
  return extractCellFormula(rawCell) != null
}

export function extractCellEvalError(rawCell: unknown): string | null {
  if (rawCell === null || rawCell === undefined) return null
  if (typeof rawCell === 'object' && rawCell !== null && 'evalError' in rawCell) {
    const e = (rawCell as Record<string, unknown>).evalError
    if (typeof e === 'string' && e) return e
  }
  return null
}

/** Literal used in formula grid / HyperFormula input cell. */
export function extractCellLiteralForFormula(rawCell: unknown, fieldType: string): string | number | boolean | null {
  if (rawCell === null || rawCell === undefined) return null
  if (typeof rawCell === 'object' && rawCell !== null) {
    const o = rawCell as Record<string, unknown>
    if ('formula' in o && typeof o.formula === 'string' && o.formula.trim()) {
      const v = o.value
      if (fieldType === 'number' && typeof v === 'number') return v
      if (fieldType === 'checkbox') return v === true
      if (v === null || v === undefined) return null
      return String(v)
    }
    if ('value' in o) {
      const v = o.value
      if (fieldType === 'number' && typeof v === 'number') return v
      if (fieldType === 'checkbox') return v === true
      if (v === null || v === undefined) return null
      return String(v)
    }
  }
  if (fieldType === 'number' && typeof rawCell === 'number') return rawCell
  if (fieldType === 'checkbox' && typeof rawCell === 'boolean') return rawCell
  return String(rawCell)
}
