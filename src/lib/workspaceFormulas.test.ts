import { describe, expect, it } from 'vitest'
import type { Field } from '@/types/workspace'
import { evaluateSameRowFormulas } from './workspaceFormulas'

const mkField = (id: string, name: string, ft: Field['field_type'], pos: number): Field => ({
  id,
  database_id: 'db',
  name,
  field_type: ft,
  is_primary: pos === 0,
  type_option: {},
  position: pos,
})

describe('evaluateSameRowFormulas', () => {
  it('evaluates same-row reference', () => {
    const fields = [mkField('a', 'A', 'number', 0), mkField('b', 'B', 'number', 1), mkField('c', 'C', 'rich_text', 2)]
    const cells = {
      a: { type: 'number', value: 2 },
      b: { type: 'number', value: 3 },
      c: { type: 'rich_text', value: null, formula: '=A1+B1' },
    }
    const ev = evaluateSameRowFormulas(fields, cells)
    expect(ev.c?.value).toBe(5)
  })
})
