import { describe, expect, it } from 'vitest'
import { issuerInfo, legalLine, tradeName } from '../src/domain/issuers'
import type { Settings } from '../src/data/types'

// Besluit Rick (10 november 2026): de handelsnaam staat op documenten en in klantmails,
// de juridische naam (razón social) met het CIF in de juridische regel.
const co = {
  company_name: 'Haco Invest SL', trade_name: 'Bella Outdoor and Furniture', tax_id: 'B00000000',
  address: 'Calle Ejemplo 1', postal_code: '03000', city: 'Alicante', province: 'Alicante',
} as Settings

describe('Handelsnaam', () => {
  it('documenten en mails gebruiken de handelsnaam', () => {
    expect(tradeName(co)).toBe('Bella Outdoor and Furniture')
  })

  it('zonder handelsnaam de juridische naam', () => {
    expect(tradeName({ ...co, trade_name: '' })).toBe('Haco Invest SL')
    expect(tradeName({ ...co, trade_name: '   ' })).toBe('Haco Invest SL')
    expect(tradeName({ ...co, trade_name: undefined })).toBe('Haco Invest SL')
    expect(tradeName(undefined)).toBe('')
  })

  it('de juridische regel houdt de juridische naam en het CIF', () => {
    const line = legalLine(issuerInfo(co, 'bella'))
    expect(line).toContain('Haco Invest SL')
    expect(line).toContain('CIF: B00000000')
    expect(line).not.toContain('Bella Outdoor and Furniture')
  })
})
