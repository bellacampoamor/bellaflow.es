import { inflateSync } from 'node:zlib'
import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { seedDemo } from '../src/domain/demo'
import { invoicePdf } from '../src/domain/invoicePdf'
import { DUMMY_SKU, type PosLine } from '../src/domain/pos'
import { posCheckout } from '../src/domain/services'
import { DOC_MARK } from '../src/domain/noteText'

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

  it('de gewone factuur houdt de QR en de Bella Flow-vermelding', async () => {
    const inv = db.data.invoices.find((i) => !i.simplified)!
    const text = pdfText((await invoicePdf(db.data, inv.id)).base64)
    expect(text).toContain('QR tributario')
    expect(Object.values(DOC_MARK).some((m) => text.includes(m))).toBe(true)
  })
})
