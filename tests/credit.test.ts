import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { beforeEach, describe, expect, it } from 'vitest'
import { toSeedSql } from '../scripts/seed-sql'
import { loadSnapshot, newId } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { seedDemo } from '../src/domain/demo'
import { invoiceBalance, invoiceState, onHandMap, stockKey } from '../src/domain/calc'
import { creditableAmount, creditableLines, creditsOf, isCredit } from '../src/domain/credit'
import { kassaDay } from '../src/domain/cashClosing'
import { createCreditInvoice, findInvoiceByNumber, payInvoice, posCheckout, refundCredit } from '../src/domain/services'
import { DUMMY_SKU, type PosLine } from '../src/domain/pos'

const DAY = '2026-11-08'
let db: LocalDriver
let seller = ''
beforeEach(async () => {
  db = new LocalDriver(false)
  await seedDemo(db, DAY)
  seller = db.data.salespeople.find((p) => p.is_active)!.id
})

const shopId = () => db.data.warehouses.find((w) => w.kind === 'winkel')!.id
/** Een product uit de voorbeeldgegevens; ontbreekt de voorraad in de winkel, dan boekt de kassa het verschil bij. */
const shopProduct = () => db.data.products.find((p) => p.sku !== DUMMY_SKU && p.is_active)!
async function sellAtPos(issuer: 'bella' | 'hdb' = 'bella', method: 'pin' | 'contant' = 'contant') {
  const p = shopProduct()
  const lines: PosLine[] = [
    { key: newId(), product_id: p.id, code: p.sku, description: p.name, qty: 2, unit_price: 100, discount_pct: 0, vat_rate: 21 },
    { key: newId(), dummy: true, code: DUMMY_SKU, description: 'Kussen', qty: 1, unit_price: 20, discount_pct: 0, vat_rate: 21 },
  ]
  const r = await posCheckout(db, { salesperson_id: seller, customer_id: null, date: DAY, lines, payment: { method, reference: '' }, issuer })
  return { ...r, product: p }
}

describe('Creditfacturen en retouren', () => {
  it('kassa: retour van één artikel, contant terug, terug in voorraad en in de kasopmaak', async () => {
    const sale = await sellAtPos('bella', 'contant')
    let s = await loadSnapshot(db)
    const stockBefore = onHandMap(s).get(stockKey(sale.product.id, shopId())) ?? 0
    const lines = creditableLines(s, sale.invoiceId)
    const art = lines.find((l) => l.stockable)!
    expect(lines.find((l) => !l.stockable)?.line.description).toBe('Kussen')
    const id = await createCreditInvoice(db, { invoice_id: sale.invoiceId, date: DAY, reason: 'Retour, klant wil een andere kleur', lines: [{ invoice_line_id: art.line.id, qty: 1, return_warehouse_id: shopId() }], refund: { method: 'contant', reference: '' } })
    s = await loadSnapshot(db)
    const credit = s.invoices.find((i) => i.id === id)!
    expect(isCredit(credit)).toBe(true)
    expect(credit.number.startsWith('FRS-BELLA-2026-')).toBe(true)
    expect(credit.simplified).toBe(true)
    expect(credit.total).toBe(-100)
    expect(credit.credit_of).toBe(sale.invoiceId)
    expect(invoiceBalance(s, credit)).toBe(0)
    expect(onHandMap(s).get(stockKey(sale.product.id, shopId()))).toBe(stockBefore + 1)
    expect(s.stock_movements.some((m) => m.kind === 'retour' && m.ref_id === credit.number)).toBe(true)
    // Kasopmaak: 220 ontvangen, 100 terug = 120 contant; de creditfactuur telt mee in de omzet van de dag.
    const day = kassaDay(s, 'bella', DAY)
    expect(day.cash).toBe(120)
    expect(day.total).toBe(120)
    expect(creditableLines(s, sale.invoiceId).find((l) => l.line.id === art.line.id)!.remaining).toBe(1)
    expect(creditableAmount(s, s.invoices.find((i) => i.id === sale.invoiceId)!)).toBe(120)
  })

  it('HDB krijgt een eigen reeks creditfacturen; Diversen kan niet retour in voorraad', async () => {
    const sale = await sellAtPos('hdb', 'pin')
    const s = await loadSnapshot(db)
    const dummy = creditableLines(s, sale.invoiceId).find((l) => !l.stockable)!
    await expect(createCreditInvoice(db, { invoice_id: sale.invoiceId, date: DAY, reason: 'Retour', lines: [{ invoice_line_id: dummy.line.id, qty: 1, return_warehouse_id: shopId() }], refund: { method: 'pin', reference: '' } })).rejects.toThrow(/geen voorraad/)
    const id = await createCreditInvoice(db, { invoice_id: sale.invoiceId, date: DAY, reason: 'Kussen beschadigd', lines: [{ invoice_line_id: dummy.line.id, qty: 1, return_warehouse_id: null }], refund: { method: 'pin', reference: '' } })
    const credit = (await loadSnapshot(db)).invoices.find((i) => i.id === id)!
    expect(credit.number.startsWith('FRS-HDB-2026-')).toBe(true)
    expect(credit.issuer).toBe('hdb')
  })

  it('gewone factuur: eerst verrekenen met wat openstaat, de rest staat als terug te betalen', async () => {
    let s = await loadSnapshot(db)
    // Voorbeeldgegevens: deelfactuur met vooruitbetaling, nog niet helemaal betaald.
    const open = s.invoices.find((i) => !i.simplified && invoiceBalance(s, i) > 0)!
    const openBefore = invoiceBalance(s, open)
    const all = creditableLines(s, open.id)
    const id = await createCreditInvoice(db, { invoice_id: open.id, date: DAY, reason: 'Fout in de factuur', lines: all.map((l) => ({ invoice_line_id: l.line.id, qty: l.remaining, return_warehouse_id: null })), refund: { method: 'later', reference: '' } })
    s = await loadSnapshot(db)
    const credit = s.invoices.find((i) => i.id === id)!
    expect(credit.number.startsWith('FR-2026-')).toBe(true)
    expect(credit.total).toBe(-open.total)
    expect(invoiceBalance(s, s.invoices.find((i) => i.id === open.id)!)).toBe(0)
    expect(s.payments.filter((p) => p.method === 'verrekening').map((p) => p.amount).sort()).toEqual([-openBefore, openBefore].sort())
    const owed = -invoiceBalance(s, credit)
    expect(owed).toBeCloseTo(open.total - openBefore)
    expect(invoiceState(s, credit)).toBe('terugbetalen')
    await expect(refundCredit(db, { invoice_id: id, amount: owed + 1, method: 'overboeking', paid_at: DAY, reference: '' })).rejects.toThrow(/terug te betalen/)
    await refundCredit(db, { invoice_id: id, amount: owed, method: 'overboeking', paid_at: DAY, reference: 'NL..' })
    s = await loadSnapshot(db)
    expect(invoiceState(s, s.invoices.find((i) => i.id === id)!)).toBe('betaald')
    expect(creditableAmount(s, s.invoices.find((i) => i.id === open.id)!)).toBe(0)
  })

  it('korting achteraf als bedrag, zonder artikel', async () => {
    const s = await loadSnapshot(db)
    const paid = s.invoices.find((i) => !i.simplified && invoiceBalance(s, i) === 0)!
    const id = await createCreditInvoice(db, { invoice_id: paid.id, date: DAY, reason: 'Schade aan de tafel', lines: [], extra: { description: 'Vergoeding schade', amount: 121, vat_rate: 21 }, refund: { method: 'overboeking', reference: '' } })
    const credit = (await loadSnapshot(db)).invoices.find((i) => i.id === id)!
    expect(credit.total).toBe(-121)
    expect(credit.base_amount).toBe(-100)
    expect(credit.vat_amount).toBe(-21)
  })

  it('weigert: zonder reden, meer dan gefactureerd, een creditfactuur crediteren, terugdateren, meer dan de factuur', async () => {
    const sale = await sellAtPos()
    const s = await loadSnapshot(db)
    const art = creditableLines(s, sale.invoiceId).find((l) => l.stockable)!
    const base = { invoice_id: sale.invoiceId, date: DAY, refund: { method: 'contant' as const, reference: '' } }
    await expect(createCreditInvoice(db, { ...base, reason: ' ', lines: [{ invoice_line_id: art.line.id, qty: 1, return_warehouse_id: null }] })).rejects.toThrow(/reden/)
    await expect(createCreditInvoice(db, { ...base, reason: 'Retour', lines: [{ invoice_line_id: art.line.id, qty: 3, return_warehouse_id: null }] })).rejects.toThrow(/nog maar 2/)
    await expect(createCreditInvoice(db, { ...base, reason: 'Retour', lines: [] })).rejects.toThrow(/minimaal één/)
    await expect(createCreditInvoice(db, { ...base, date: '2026-11-01', reason: 'Retour', lines: [{ invoice_line_id: art.line.id, qty: 1, return_warehouse_id: null }] })).rejects.toThrow(/voor/)
    await expect(createCreditInvoice(db, { ...base, reason: 'Korting', lines: [], extra: { description: 'Te veel', amount: 500, vat_rate: 21 } })).rejects.toThrow(/nog maar/)
    const id = await createCreditInvoice(db, { ...base, reason: 'Retour', lines: [{ invoice_line_id: art.line.id, qty: 1, return_warehouse_id: null }] })
    await expect(createCreditInvoice(db, { ...base, invoice_id: id, reason: 'Retour', lines: [] })).rejects.toThrow(/zelf niet/)
    await expect(payInvoice(db, { invoice_id: id, amount: 10, method: 'pin', paid_at: DAY, reference: '' })).rejects.toThrow(/terugbetaling/)
    expect(creditsOf(await loadSnapshot(db), sale.invoiceId).length).toBe(1)
  })

  it('de creditfactuur als pdf: titel en verwijzing naar de factuur', async () => {
    const sale = await sellAtPos()
    let s = await loadSnapshot(db)
    const art = creditableLines(s, sale.invoiceId).find((l) => l.stockable)!
    const id = await createCreditInvoice(db, { invoice_id: sale.invoiceId, date: DAY, reason: 'Retour', lines: [{ invoice_line_id: art.line.id, qty: 1, return_warehouse_id: null }], refund: { method: 'contant', reference: '' } })
    s = await loadSnapshot(db)
    const { invoicePdf } = await import('../src/domain/invoicePdf')
    const pdf = await invoicePdf(s, id)
    expect(pdf.name).toMatch(/^Factura rectificativa simplificada FRS-BELLA-2026-\d{4}\.pdf$/)
    expect(pdf.base64.length).toBeGreaterThan(1000)
  })

  it('vindt een factuur op nummer, ook met kleine letters en spaties', async () => {
    const sale = await sellAtPos()
    const s = await loadSnapshot(db)
    expect(findInvoiceByNumber(s, ` ${sale.invoiceNumber.toLowerCase()} `)?.id).toBe(sale.invoiceId)
    expect(findInvoiceByNumber(s, 'XX-1')).toBeNull()
  })

  it('creditfacturen, verrekening en retour passen in de database', async () => {
    const sale = await sellAtPos()
    let s = await loadSnapshot(db)
    const art = creditableLines(s, sale.invoiceId).find((l) => l.stockable)!
    await createCreditInvoice(db, { invoice_id: sale.invoiceId, date: DAY, reason: 'Retour', lines: [{ invoice_line_id: art.line.id, qty: 1, return_warehouse_id: shopId() }], refund: { method: 'contant', reference: '' } })
    const open = s.invoices.find((i) => !i.simplified && invoiceBalance(s, i) > 0)!
    await createCreditInvoice(db, { invoice_id: open.id, date: DAY, reason: 'Fout', lines: [], extra: { description: 'Correctie', amount: 50, vat_rate: 21 }, refund: { method: 'later', reference: '' } })
    s = await loadSnapshot(db)
    const pg = new PGlite({ extensions: { pg_trgm } })
    await pg.exec('create role authenticated; create role anon; create role service_role;')
    await pg.exec(readdirSync('supabase/migrations').sort().map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n'))
    await pg.exec(toSeedSql(s))
    const r = await pg.query<{ n: number }>("select count(*)::int as n from invoices where kind = 'creditfactuur' and credit_of is not null")
    expect(r.rows[0].n).toBe(2)
    expect((await pg.query<{ n: number }>("select count(*)::int as n from payments where method = 'verrekening'")).rows[0].n).toBe(2)
    expect((await pg.query<{ n: number }>("select count(*)::int as n from stock_movements where kind = 'retour'")).rows[0].n).toBe(1)
    // Een creditfactuur zonder reden weigert de database.
    await expect(pg.exec(`insert into invoices (number, sales_order_id, customer_id, kind, invoice_date, due_date, base_amount, vat_amount, total, credit_of) select 'X-1', sales_order_id, customer_id, 'creditfactuur', '${DAY}', '${DAY}', -1, 0, -1, id from invoices limit 1`)).rejects.toThrow()
  }, 60000)
})
