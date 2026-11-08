import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import type { CatalogArticle } from '../src/data/types'
import { freeAt, onHandMap, stockKey } from '../src/domain/calc'
import { seedDemo } from '../src/domain/demo'
import { addPosLine, DUMMY_SKU, isDummyCode, missingCustomerData, POS_CUSTOMER_NOTE, posTotals, SIMPLIFIED_LIMIT, type PosLine } from '../src/domain/pos'
import { importShowroom, posCheckout, productForArticle, saveRecord, syncCatalogArticles } from '../src/domain/services'
import { invoiceReport } from '../src/domain/calc'
import type { Customer } from '../src/data/types'
import { showNum } from '../src/ui/NumInput'

const TODAY = '2026-11-08'
const LOL = 'Life Outdoor Living International B.V.'
const HEAD = 'supplier_name,supplier_sku,name,ean,series,categories,price,currency,available_date,available_text,image_url,product_url,scraped_at'
const SHOWROOM = [HEAD, `${LOL},K-TAF,Kassatafel Mara,8719000000099,Testserie,Tuintafels,187.4,EUR,,,,,2026-11-06T17:00:00Z`].join('\n')

let db: LocalDriver
let table: CatalogArticle
let seller = ''
let shopId = ''
beforeEach(async () => {
  db = new LocalDriver(false)
  await seedDemo(db, TODAY)
  await importShowroom(db, SHOWROOM)
  await syncCatalogArticles(db)
  table = (await db.searchArticles({ q: 'K-TAF' }))[0]
  seller = db.data.salespeople[0].id
  shopId = db.data.warehouses.find((w) => w.kind === 'winkel')!.id
})

const line = (p: Partial<PosLine>): PosLine => ({ key: newId(), code: table.article_number, article: table, description: table.name, qty: 1, unit_price: 187.4, discount_pct: 0, vat_rate: 21, ...p })
const checkout = (lines: PosLine[], extra: Partial<Parameters<typeof posCheckout>[1]> = {}) =>
  posCheckout(db, { salesperson_id: seller, customer_id: null, date: TODAY, lines, payment: { method: 'pin', reference: '' }, ...extra })

describe('Kassa (POS)', () => {
  it('maakt verkooporder, factuur van vandaag en betaling in één keer', async () => {
    const pid = await productForArticle(db, table)
    await db.insert('stock_movements', [{ id: newId(), product_id: pid, warehouse_id: shopId, qty: 2, kind: 'correctie', ref_id: '', note: 'test', moved_at: TODAY }])
    const r = await checkout([line({ qty: 2 })])
    const inv = db.data.invoices.find((i) => i.id === r.invoiceId)!
    expect(inv.invoice_date).toBe(TODAY)
    expect(inv.total).toBeCloseTo(374.8)
    const paid = db.data.payments.filter((p) => p.sales_order_id === r.orderId && p.kind === 'betaling').reduce((n, p) => n + p.amount, 0)
    expect(paid).toBeCloseTo(374.8)
    expect(db.data.deliveries.find((d) => d.sales_order_id === r.orderId)?.status).toBe('delivered')
    expect(r.corrections).toHaveLength(0)
    expect(onHandMap(db.data).get(stockKey(pid, shopId)) ?? 0).toBe(0)
  })

  it('boekt een voorraadverschil bij als het artikel niet vrij in de winkel staat', async () => {
    const r = await checkout([line({ qty: 1 })])
    expect(r.corrections).toHaveLength(1)
    const pid = db.data.products.find((p) => p.catalog_article_number === table.article_number)!.id
    const corr = db.data.stock_movements.filter((m) => m.product_id === pid && m.kind === 'correctie')
    expect(corr).toHaveLength(1)
    expect(corr[0].qty).toBe(1)
    expect(corr[0].ref_id).toBe(r.orderNumber)
    // Na de verkoop staat de voorraad op 0, niet negatief.
    expect(onHandMap(db.data).get(stockKey(pid, shopId)) ?? 0).toBe(0)
    expect(db.data.order_events.some((e) => e.sales_order_id === r.orderId && e.kind === 'voorraad')).toBe(true)
  })

  it('reservering voor een andere klant blijft staan: alleen het tekort wordt bijgeboekt', async () => {
    const pid = await productForArticle(db, table)
    await db.insert('stock_movements', [{ id: newId(), product_id: pid, warehouse_id: shopId, qty: 1, kind: 'correctie', ref_id: '', note: 'test', moved_at: TODAY }])
    const r = await checkout([line({ qty: 3 })])
    expect(r.corrections[0].qty).toBe(2)
    expect(freeAt(db.data, pid, shopId)).toBe(0)
  })

  it('dummy-artikel DIVERSEN met eigen omschrijving, zonder voorraad', async () => {
    const r = await checkout([{ key: 'd', dummy: true, code: DUMMY_SKU, description: 'Kussen uit de etalage', qty: 1, unit_price: 25, discount_pct: 0, vat_rate: 21 }])
    const dummy = db.data.products.find((p) => p.sku === DUMMY_SKU)!
    expect(dummy).toBeTruthy()
    const il = db.data.invoice_lines.filter((l) => l.invoice_id === r.invoiceId)
    expect(il[0].article_number).toBe(DUMMY_SKU)
    expect(il[0].description).toBe('Kussen uit de etalage')
    expect(onHandMap(db.data).get(stockKey(dummy.id, shopId)) ?? 0).toBe(0)
    // Een tweede keer gebruikt hetzelfde product.
    await checkout([{ key: 'e', dummy: true, code: DUMMY_SKU, description: 'Kaars', qty: 2, unit_price: 5, discount_pct: 0, vat_rate: 21 }])
    expect(db.data.products.filter((p) => p.sku === DUMMY_SKU)).toHaveLength(1)
  })

  it('weigert een dummy zonder omschrijving en laat dan niets achter', async () => {
    const before = db.data.stock_movements.length
    await expect(checkout([{ key: 'd', dummy: true, code: DUMMY_SKU, description: ' ', qty: 1, unit_price: 5, discount_pct: 0, vat_rate: 21 }])).rejects.toThrow()
    expect(db.data.stock_movements.length).toBe(before)
    expect(db.data.invoices.length).toBe(db.data.invoices.length)
  })

  it('zonder klant: vaste klant Kassaverkoop; met klant: die klant op de factuur', async () => {
    const r = await checkout([line({})])
    const inv = db.data.invoices.find((i) => i.id === r.invoiceId)!
    expect(db.data.customers.find((c) => c.id === inv.customer_id)?.notes).toBe(POS_CUSTOMER_NOTE)
    await checkout([line({})])
    expect(db.data.customers.filter((c) => c.notes === POS_CUSTOMER_NOTE)).toHaveLength(1)
    const cust = db.data.customers.find((c) => c.notes !== POS_CUSTOMER_NOTE)!
    const r2 = await checkout([line({})], { customer_id: cust.id })
    expect(db.data.invoices.find((i) => i.id === r2.invoiceId)!.customer_id).toBe(cust.id)
  })

  it('weigert zonder medewerker of zonder regels, en een ongeldig mailadres', async () => {
    await expect(checkout([line({})], { salesperson_id: '' })).rejects.toThrow()
    await expect(checkout([])).rejects.toThrow()
    await expect(checkout([line({})], { invoiceEmail: 'geen-adres' })).rejects.toThrow()
  })

  it('hetzelfde artikel twee keer scannen telt op; diversen nooit', () => {
    let l = addPosLine([], line({ key: 'a' }))
    l = addPosLine(l, line({ key: 'b' }))
    expect(l).toHaveLength(1)
    expect(l[0].qty).toBe(2)
    const d = { key: 'd', dummy: true, code: DUMMY_SKU, description: '', qty: 1, unit_price: 0, discount_pct: 0, vat_rate: 21 }
    l = addPosLine(addPosLine(l, d), { ...d, key: 'e' })
    expect(l).toHaveLength(3)
    expect(isDummyCode(' diversen ')).toBe(true)
    expect(posTotals(l.slice(0, 1)).total).toBeCloseTo(374.8)
  })
})

const dummy = (price: number): PosLine => ({ key: newId(), dummy: true, code: DUMMY_SKU, description: 'Loungeset uit de showroom', qty: 1, unit_price: price, discount_pct: 0, vat_rate: 21 })
const person = (p: Partial<Customer> = {}) => saveRecord(db, 'customers', { kind: 'particulier', name: 'Verzonnen Klant', company: '', tax_id: 'X0000000T', email: '', phone: '', language: 'es', address: 'Calle Inventada 1', postal_code: '03189', city: 'Orihuela Costa', province: 'Alicante', country: 'España', notes: '', ...p } as Customer)

describe('Factura simplificada (kassa)', () => {
  it('kassafacturen krijgen een eigen nummerreeks met het voorvoegsel uit Beheer', async () => {
    const r = await checkout([dummy(50)])
    const inv = db.data.invoices.find((i) => i.id === r.invoiceId)!
    expect(inv.simplified).toBe(true)
    expect(inv.number).toMatch(/^FS-2026-\d{4}$/)
    await db.update('settings', db.data.settings[0].id, { prefix_invoice_simplified: 'TPV' })
    const r2 = await checkout([dummy(20)])
    expect(r2.invoiceNumber).toMatch(/^TPV-2026-0002$/)
  })

  it('gewone facturen houden hun reeks en staan niet in het kassaoverzicht', async () => {
    await checkout([dummy(50)])
    const kassa = invoiceReport(db.data, '2026-01-01', '2026-12-31', true)
    const gewoon = invoiceReport(db.data, '2026-01-01', '2026-12-31', false)
    expect(kassa.rows.every((r) => r.invoice.simplified)).toBe(true)
    expect(kassa.rows).toHaveLength(1)
    expect(gewoon.rows.length).toBeGreaterThan(0)
    expect(gewoon.rows.every((r) => !r.invoice.simplified)).toBe(true)
    expect(gewoon.rows.every((r) => r.invoice.number.startsWith('F-'))).toBe(true)
  })

  it(`tot ${SIMPLIFIED_LIMIT} euro zonder klantgegevens, precies op de grens ook`, async () => {
    const r = await checkout([dummy(1000)])
    expect(db.data.invoices.find((i) => i.id === r.invoiceId)!.simplified).toBe(true)
  })

  it('boven de grens: zonder klant geweigerd, en zonder volledige gegevens geweigerd', async () => {
    await expect(checkout([dummy(1000.01)])).rejects.toThrow(/verplicht/)
    const incomplete = await person({ tax_id: '', address: '' })
    await expect(checkout([dummy(1500)], { customer_id: incomplete })).rejects.toThrow(/Adres/)
    expect(db.data.invoices.filter((i) => i.simplified)).toHaveLength(0)
  })

  it('boven de grens met naam, adres, woonplaats en NIE of paspoort: simplificada met die klant', async () => {
    const id = await person({ tax_id: 'PAS123456' })
    const r = await checkout([dummy(1500)], { customer_id: id })
    const inv = db.data.invoices.find((i) => i.id === r.invoiceId)!
    expect(inv.simplified).toBe(true)
    expect(inv.customer_id).toBe(id)
  })

  it('missingCustomerData noemt wat ontbreekt; de vaste kassaklant mist alles', () => {
    const c = { name: 'A', company: '', address: '', city: 'B', tax_id: '', notes: '' }
    expect(missingCustomerData(c)).toEqual(['Adres', 'NIE of paspoortnummer'])
    expect(missingCustomerData({ ...c, notes: POS_CUSTOMER_NOTE })).toHaveLength(4)
  })
})

describe('Bedragen met twee decimalen', () => {
  it('showNum met twee decimalen', () => {
    expect(showNum(187.4, 2)).toBe('187,40')
    expect(showNum(5, 2)).toBe('5,00')
    expect(showNum(187.4)).toBe('187,4')
  })
})
