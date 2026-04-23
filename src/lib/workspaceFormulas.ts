/**
 * Same-row formula evaluation using HyperFormula (Excel-style syntax, e.g. =A1+B1).
 * Column letters map to field column order (A = first field by position, B = second, …).
 */
import { HyperFormula } from 'hyperformula'
import type { Field } from '@/types/workspace'
import { extractCellFormula, extractCellLiteralForFormula, hasCellFormula } from '@/lib/workspaceCellPayload'

const LICENSE_KEY = 'gpl-v3'

export function excelColumnLetter(index: number): string {
  let n = index
  let s = ''
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

/** Build one sheet row (row 0) of literals + formulas; evaluate formula cells. */
export function evaluateSameRowFormulas(
  fieldsSorted: Field[],
  cellsByFieldId: Record<string, unknown>,
): Record<string, { value: unknown; evalError?: string }> {
  const colCount = fieldsSorted.length
  if (colCount === 0) return {}

  const row0: (string | number | boolean | null)[] = []
  const out: Record<string, { value: unknown; evalError?: string }> = {}

  for (let c = 0; c < colCount; c++) {
    const f = fieldsSorted[c]
    const raw = cellsByFieldId[f.id]
    if (hasCellFormula(raw)) {
      const expr = extractCellFormula(raw)
      if (!expr) {
        row0[c] = ''
        out[f.id] = { value: '', evalError: 'Empty formula' }
        continue
      }
      let normalized = expr.trim()
      if (!normalized.startsWith('=')) normalized = `=${normalized}`
      row0[c] = normalized
    } else {
      const lit = extractCellLiteralForFormula(raw, f.field_type)
      row0[c] = lit as string | number | boolean | null
      out[f.id] = { value: lit }
    }
  }

  let hf: HyperFormula
  try {
    hf = HyperFormula.buildFromArray([row0], { licenseKey: LICENSE_KEY })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    for (const f of fieldsSorted) {
      out[f.id] = {
        value: extractCellLiteralForFormula(cellsByFieldId[f.id], f.field_type),
        evalError: msg,
      }
    }
    return out
  }

  const sheetNames = hf.getSheetNames()
  const sheet0 = sheetNames[0]
  if (sheet0 === undefined) return out
  const sheetId = hf.getSheetId(sheet0)
  if (sheetId === undefined) return out
  const rowIndex = 0

  for (let c = 0; c < colCount; c++) {
    const f = fieldsSorted[c]
    const raw = cellsByFieldId[f.id]
    if (!hasCellFormula(raw)) continue

    const addr = { sheet: sheetId as number, col: c, row: rowIndex }
    try {
      const val = hf.getCellValue(addr)
      if (typeof val === 'object' && val !== null && 'type' in val) {
        const t = (val as { type: string; message?: string }).type
        if (t === 'ERROR') {
          const msg = (val as { message?: string }).message ?? '#ERROR!'
          out[f.id] = { value: null, evalError: msg }
          continue
        }
      }
      out[f.id] = { value: val as unknown }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      out[f.id] = { value: null, evalError: msg }
    }
  }

  return out
}

/** For docs / UI: how columns map to letters (first fields). */
export function fieldColumnLettersHint(fieldsSorted: Field[]): string {
  return fieldsSorted
    .slice(0, 26)
    .map((f, i) => `${excelColumnLetter(i)}1 = "${f.name}"`)
    .join(', ')
}
