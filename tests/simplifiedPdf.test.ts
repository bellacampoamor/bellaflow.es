import { inflateSync } from 'node:zlib'
import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { seedDemo } from '../src/domain/demo'
import { invoicePdf } from '../src/domain/invoicePdf'
import { DUMMY_SKU, type PosLine } from '../src/domain/pos'
import { posCheckout } from '../src/domain/services'
import { DOC_MARK } from '../src/domain/noteText'
import { setLanguage } from '../src/i18n'
import { eur } from '../src/ui/kit'
import { showNum } from '../src/ui/NumInput'

const TODAY = '2026-11-08'
let db: LocalDriver
beforeEach(async () => { db = new LocalDriver(false); await seedDemo(db, TODAY) })

/** Alle tekst uit de pdf (pdf-lib schrijft tekst als hex-strings, inhoud gecomprimeerd). */
function pdfText(base64: string) {
  const raw = Buffer.from(base64, 'base64').toString('latin1')
  let out = ''
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let s = ''
    try { s = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1') } catch { s = m[1] }
    for (const h of s.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) out += Buffer.from(h[1], 'hex').toString('latin1') + '\n'
  }
  return out
}

const dummy = (price: number): PosLine => ({ key: newId(), dummy: true, code: DUMMY_SKU, description: 'Testartikel', qty: 1, unit_price: price, discount_pct: 0, vat_rate: 21 })

describe('Eenvoudige factuur als pdf', () => {
  it('zonder QR en zonder Bella Flow-vermelding, met de juridische regel van het bedrijf en rechtsonder bellaflow.es', async () => {
    const r = await posCheckout(db, { salesperson_id: db.data.salespeople[0].id, customer_id: null, date: TODAY, lines: [dummy(50)], payment: { method: 'pin', reference: '' }, issuer: 'hdb' })
    const text = pdfText((await invoicePdf(db.data, r.invoiceId)).base64)
    expect(text).toContain('Factura simplificada')
    expect(text).toContain('B05730825')
    expect(text).not.toContain('QR tributario')
    expect(text).not.toContain(DOC_MARK.es)
    expect(text).toContain('bellaflow.es')
  })

  it('de gewone factuur: QR in de voet, juridische regel van Bella, bellaflow.es en geen Bella Flow-zin', async () => {
    const inv = db.data.invoices.find((i) => !i.simplified)!
    const text = pdfText((await invoicePdf(db.data, inv.id)).base64)
    expect(text).toContain('QR tributario')
    expect(text).toContain('bellaflow.es')
    expect(text).toContain(db.data.settings[0].company_name)
    expect(Object.values(DOC_MARK).some((m) => text.includes(m))).toBe(false)
  })

  it('bedragen altijd in Nederlandse opmaak, ook op een Spaanse factuur', async () => {
    const inv = db.data.invoices.find((i) => !i.simplified)!
    await db.update('settings', db.data.settings[0].id, { language_invoice: 'es' })
    const text = pdfText((await invoicePdf(db.data, inv.id)).base64)
    // In de pdf is € het WinAnsi-teken 0x80; het staat vóór het bedrag, met punt voor duizendtallen.
    expect(text).toMatch(/[€\x80][\s\xa0]\d{1,3}\.\d{3},\d{2}/)
    expect(text).not.toMatch(/\d,\d{2}[\s\xa0]?[€\x80]/)
  })
})

describe('Getallen op het scherm', () => {
  it('eur en getalvelden volgen in elke schermtaal de Nederlandse opmaak', () => {
    for (const lang of ['nl', 'en', 'es'] as const) {
      setLanguage(lang)
      expect(eur(1460).replace(/\s/g, ' ')).toBe('€ 1.460,00')
      expect(eur(9.95).replace(/\s/g, ' ')).toBe('€ 9,95')
      expect(showNum(187.4, 2)).toBe('187,40')
    }
    setLanguage('nl')
  })
  it('veel regels: vervolgbladen met suma y sigue, suma anterior en paginanummer; totalen alleen op het laatste blad', async () => {
    const lines = Array.from({ length: 90 }, (_, k) => ({ ...dummy(10), description: `Testartikel ${k + 1}` }))
    const r = await posCheckout(db, { salesperson_id: db.data.salespeople[0].id, customer_id: null, date: TODAY, lines, payment: { method: 'pin', reference: '' }, issuer: 'bella' })
    const text = pdfText((await invoicePdf(db.data, r.invoiceId)).base64)
    const pages = Number(/P\xe1gina 1 de (\d+)/.exec(text)?.[1] ?? /Página 1 de (\d+)/.exec(text)?.[1] ?? 0)
    expect(pages).toBeGreaterThan(1)
    expect(text.split('Suma y sigue').length - 1).toBe(pages - 1)
    expect(text.split('Suma anterior').length - 1).toBe(pages - 1)
    expect(text.split('Base imponible').length - 1).toBe(1)
    expect(text).toContain('Testartikel 90')
  })
})
