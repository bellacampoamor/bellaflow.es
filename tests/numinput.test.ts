import { describe, expect, it } from 'vitest'
import { parseNum } from '../src/ui/NumInput'

describe('getalveld', () => {
  it('leest komma en punt als decimaalteken', () => {
    expect(parseNum('149,95')).toBe(149.95)
    expect(parseNum('25.5')).toBe(25.5)
    expect(parseNum(' 7 ')).toBe(7)
  })
  it('leeg of half getypt is geen getal, zodat het veld leeg kan blijven', () => {
    expect(parseNum('')).toBeNull()
    expect(parseNum('-')).toBeNull()
    expect(parseNum(',')).toBeNull()
    expect(parseNum('abc')).toBeNull()
  })
})
