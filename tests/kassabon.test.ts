// Besluit Rick 13 november 2026: een kassabon (factura simplificada) is niet meer dan dat. Geen verkooporder,
// geen levering, geen proforma; alleen de eigen reeks uit Instellingen (FS-BELLA, FS-HDB).
import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { posInvoiceOf, posOrderIds } from '../src/domain/calc'
import { seedDemo } from '../src/domain/demo'
import { DUMMY_SKU, type PosLine } from '../src/domain/pos'
import { globalSearch } from '../src/domain/search'
import { createCreditInvoice, posCheckout } from '../src/domain/services'

const TODAY = '2026-11-13'
let db: LocalDriver
let seller = ''
beforeEach(async () => {
  db = new LocalDriver(false)
  await seedDemo(db, TODAY)
  seller = db.data.salespeople[0].id
})

const diversen = (price: number): PosLine => ({ key: newId(), code: DUMMY_SKU, dummy: true, description: 'Kussen (verzonnen)', qty: 1, unit_price: price, discount_pct: 0, vat_rate: 21 })
const checkout = (issuer: 'bella' | 'hdb') =>
  posCheckout(db, { salesperson_id: seller, customer_id: null, date: TODAY, lines: [diversen(39.95)], payment: { method: 'pin', reference: '' }, issuer })
const seq = (n: string) => Number(n.split('-').pop())

describe('Kassabon zonder verkooporder', () => {
  it('verbruikt geen VO-, LV- of PF-nummer', async () => {
    const before = { vo: await db.nextNumber('VO', 2026), lv: await db.nextNumber('LV', 2026), pf: await db.nextNumber('PF', 2026) }
    await checkout('hdb')
    await checkout('bella')
    expect(seq(await db.nextNumber('VO', 2026))).toBe(seq(before.vo) + 1)
    expect(seq(await db.nextNumber('LV', 2026))).toBe(seq(before.lv) + 1)
    expect(seq(await db.nextNumber('PF', 2026))).toBe(seq(before.pf) + 1)
  })

  it('alles draagt het nummer van de kassabon, uit de eigen reeks van het bedrijf', async () => {
    const hdb = await checkout('hdb')
    const bella = await checkout('bella')
    expect(hdb.invoiceNumber).toMatch(/^FS-HDB-2026-\d{4}$/)
    expect(bella.invoiceNumber).toMatch(/^FS-BELLA-2026-\d{4}$/)
    for (const r of [hdb, bella]) {
      expect(r.orderNumber).toBe(r.invoiceNumber)
      const d = db.data.deliveries.find((x) => x.sales_order_id === r.orderId)!
      expect(d.number).toBe(r.invoiceNumber)
      expect(d.proforma_number).toBe(r.invoiceNumber)
      expect(db.data.stock_movements.filter((m) => m.ref_id.startsWith('KASSA-'))).toHaveLength(0)
      expect(db.data.order_events.filter((e) => e.sales_order_id === r.orderId).map((e) => e.message).join(' ')).not.toMatch(/Verkooporder|KASSA-|VO-|LV-/)
    }
  })

  it('staat niet bij verkooporders of leveringen, wel als factuur', async () => {
    const r = await checkout('hdb')
    expect(posOrderIds(db.data).has(r.orderId)).toBe(true)
    expect(posInvoiceOf(db.data, r.orderId)?.number).toBe(r.invoiceNumber)
    const hits = globalSearch(db.data, r.invoiceNumber)
    expect(hits.some((h) => h.kind === 'verkooporder' || h.kind === 'levering')).toBe(false)
    expect(hits.some((h) => h.kind === 'factuur' && h.id === r.invoiceId)).toBe(true)
  })

  it('een retour op de kassabon maakt de verkoop niet weer een verkooporder', async () => {
    const r = await checkout('hdb')
    const line = db.data.invoice_lines.find((l) => l.invoice_id === r.invoiceId)!
    await createCreditInvoice(db, { invoice_id: r.invoiceId, date: TODAY, reason: 'Retour', lines: [{ invoice_line_id: line.id, qty: 1, return_warehouse_id: null }], refund: { method: 'pin', reference: '' } })
    expect(posInvoiceOf(db.data, r.orderId)?.id).toBe(r.invoiceId)
    expect(posOrderIds(db.data).has(r.orderId)).toBe(true)
  })
})
