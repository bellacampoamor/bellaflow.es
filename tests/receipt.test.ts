import { describe, expect, it } from 'vitest'
import { receiptLines, receiptPayments, simplifiedPrint } from '../src/domain/receipt'
import { settingsUpgrade } from '../src/domain/issuers'

describe('Kassabon 80 mm', () => {
  it('standaard A4; alleen met bon80 een kassabon', () => {
    expect(simplifiedPrint(undefined)).toBe('a4')
    expect(simplifiedPrint({})).toBe('a4')
    expect(simplifiedPrint({ print_invoice_simplified: 'a4' })).toBe('a4')
    expect(simplifiedPrint({ print_invoice_simplified: 'bon80' })).toBe('bon80')
  })
  it('bestaande instellingen krijgen A4 als keuze, een gemaakte keuze blijft', () => {
    expect(settingsUpgrade({}).print_invoice_simplified).toBe('a4')
    expect(settingsUpgrade({ print_invoice_simplified: 'bon80' }).print_invoice_simplified).toBeUndefined()
  })
  it('regel: omschrijving, artikelnummer met aantal x prijs en korting, regeltotaal', () => {
    const [l] = receiptLines([{ article_number: 'LOL-STO-0000000001', description: 'Stoel', qty: 2, unit_price: 50, discount_pct: 10, vat_rate: 21, line_total: 90 }], (n) => n.toFixed(2))
    expect(l).toEqual({ description: 'Stoel', code: 'LOL-STO-0000000001', detail: '2 x 50.00 -10%', total: 90, vat_rate: 21 })
  })
  it('betalingen per betaalwijze, zonder verrekening', () => {
    expect(receiptPayments([{ method: 'contant', amount: 20 }, { method: 'pin', amount: 30.1 }, { method: 'contant', amount: 5.2 }, { method: 'verrekening', amount: 10 }]))
      .toEqual([{ method: 'contant', amount: 25.2 }, { method: 'pin', amount: 30.1 }])
  })
})
