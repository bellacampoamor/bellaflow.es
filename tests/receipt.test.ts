import { describe, expect, it } from 'vitest'
import { receiptLegalLine, receiptLines, receiptPayments, simplifiedPrint } from '../src/domain/receipt'
import { spanishDescription } from '../src/domain/spanish'
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
  it('regel: omschrijving (Spaans), artikelnummer, aantal x prijs en korting, regeltotaal', () => {
    const line = { article_number: 'LOL-STO-0000000001', description: 'Stoel', qty: 2, unit_price: 50, discount_pct: 10, vat_rate: 21, line_total: 90 }
    expect(receiptLines([line], (n) => n.toFixed(2))[0]).toEqual({ description: 'Silla', code: 'LOL-STO-0000000001', detail: '2 x 50.00 -10%', total: 90, vat_rate: 21 })
    expect(receiptLines([line], (n) => n.toFixed(2), 'nl')[0].description).toBe('Stoel')
  })
  it('Spaanse naam van de leverancier (HDB) gaat voor de woordenlijst', () => {
    const line = { article_number: 'HDB-VER-0000000001', description: 'Lamp Model Varuna', product_name: 'Lamp Model Varuna', name_es: 'Lámpara Modelo Varuna', qty: 1, unit_price: 99, discount_pct: 0, vat_rate: 21, line_total: 99 }
    expect(receiptLines([line], (n) => n.toFixed(2))[0].description).toBe('Lámpara Modelo Varuna')
    expect(receiptLines([{ ...line, description: 'Lamp Model Varuna (Kleur: wit)' }], (n) => n.toFixed(2))[0].description).toBe('Lámpara Modelo Varuna (Kleur: wit)')
    expect(receiptLines([line], (n) => n.toFixed(2), 'en')[0].description).toBe('Lamp Model Varuna')
    expect(receiptLines([{ ...line, name_es: null }], (n) => n.toFixed(2))[0].description).toBe('Lámpara Model Varuna')
  })
  it('kop zonder adres: alleen naam en CIF', () => {
    expect(receiptLegalLine({ name: 'Voorbeeld SL', tax_id: 'B00000000' })).toBe('Voorbeeld SL · CIF: B00000000')
    expect(receiptLegalLine({ name: 'Voorbeeld SL', tax_id: '' })).toBe('Voorbeeld SL')
  })
  it('Spaanse omschrijving uit Nederlandse en Engelse catalogusnamen', () => {
    expect(spanishDescription('Loungebank Marbella 3-zits')).toBe('Sofá lounge Marbella 3 plazas')
    expect(spanishDescription('Eettafel Altea 240')).toBe('Mesa de comedor Altea 240')
    expect(spanishDescription('Zweefparasol 3 m')).toBe('Sombrilla excéntrica 3 m')
    expect(spanishDescription('Ronde tuintafel teak 120 cm')).toBe('Mesa de jardín redonda de teca 120 cm')
    expect(spanishDescription('Teak Root Bowl Large')).toBe('Cuenco de teca y raíz grande')
    expect(spanishDescription('Set of 3 Rattan Baskets')).toBe('Juego de 3 cestas de ratán')
    expect(spanishDescription('Tuinstoelen wit')).toBe('Sillas de jardín blancas')
    expect(spanishDescription('Kussens antraciet')).toBe('Cojines antracita')
    expect(spanishDescription('DIVERSEN')).toBe('DIVERSEN')
  })
  it('betalingen per betaalwijze, zonder verrekening', () => {
    expect(receiptPayments([{ method: 'contant', amount: 20 }, { method: 'pin', amount: 30.1 }, { method: 'contant', amount: 5.2 }, { method: 'verrekening', amount: 10 }]))
      .toEqual([{ method: 'contant', amount: 25.2 }, { method: 'pin', amount: 30.1 }])
  })
})
