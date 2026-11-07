import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSnapshot, newId } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import type { CatalogArticle } from '../src/data/types'
import { freeAt, freeTotal, linesToPurchase, orderStage, orderTab, scanWarehouse } from '../src/domain/calc'
import { seedDemo } from '../src/domain/demo'
import { addToBasket, articleNumberFromScan, removeFromBasket, stockShortage } from '../src/domain/scan'
import { confirmProforma, createOrder, createProformaOrder, findArticleByCode, importShowroom, productForArticle, saveProforma, syncCatalogArticles, type OrderInput } from '../src/domain/services'
import { toSeedSql } from '../scripts/seed-sql'

const TODAY = '2026-11-07'
const LOL = 'Life Outdoor Living International B.V.'
const HEAD = 'supplier_name,supplier_sku,name,ean,series,categories,price,currency,available_date,available_text,image_url,product_url,scraped_at'
const SHOWROOM = [HEAD,
  `${LOL},P-TAF,Proformatafel Mara,8719000000017,Testserie,Tuintafels,500,EUR,,,,,2026-11-06T17:00:00Z`,
  `${LOL},P-STO,Proformastoel Mara,,Testserie,Tuinstoelen,100,EUR,,,,,2026-11-06T17:00:00Z`,
].join('\n')

let db: LocalDriver
let table: CatalogArticle, chair: CatalogArticle
let seller = ''
beforeEach(async () => {
  db = new LocalDriver(false)
  await seedDemo(db, TODAY)
  await importShowroom(db, SHOWROOM)
  await syncCatalogArticles(db)
  table = (await db.searchArticles({ q: 'P-TAF' }))[0]
  chair = (await db.searchArticles({ q: 'P-STO' }))[0]
  seller = db.data.salespeople[0].id
})

/** Zet een aantal vrij op voorraad in de showroom. */
async function stockInShowroom(a: CatalogArticle, qty: number) {
  const pid = await productForArticle(db, a)
  const showroom = db.data.warehouses.find((w) => w.kind === 'winkel')!
  await db.insert('stock_movements', [{ id: newId(), product_id: pid, warehouse_id: showroom.id, qty, kind: 'correctie', ref_id: '', note: 'test', moved_at: TODAY }])
  return { pid, showroom: showroom.id }
}

const confirmInput = (id: string, over: Partial<OrderInput['header']> = {}): OrderInput => {
  const o = db.data.sales_orders.find((x) => x.id === id)!
  const { id: _i, number: _n, status: _s, ...header } = o
  return { header: { ...header, customer_id: db.data.customers[0].id, fulfilment: 'meenemen', ...over }, lines: db.data.sales_order_lines.filter((l) => l.sales_order_id === id).map(({ sales_order_id: _x, ...l }) => l) }
}

describe('scannen in de winkel', () => {
  it('leest een eigen artikelnummer uit een scan', () => {
    expect(articleNumberFromScan(' lol-taf-0000000012 ')).toBe('LOL-TAF-0000000012')
    expect(articleNumberFromScan('8719000000017')).toBeNull()
  })
  it('vindt een artikel op eigen artikelnummer, artikelnummer leverancier en EAN', async () => {
    expect((await findArticleByCode(db, table.article_number))?.id).toBe(table.id)
    expect((await findArticleByCode(db, table.article_number.toLowerCase()))?.id).toBe(table.id)
    expect((await findArticleByCode(db, 'p-taf'))?.id).toBe(table.id)
    expect((await findArticleByCode(db, '8719000000017'))?.id).toBe(table.id)
    expect(await findArticleByCode(db, 'BESTAATNIET')).toBeNull()
  })
  it('telt hetzelfde artikel op en verwijdert per artikel', () => {
    let rows = addToBasket([], { article: table, qty: 1, price: 500, noStock: false })
    rows = addToBasket(rows, { article: chair, qty: 4, price: 100, noStock: true })
    rows = addToBasket(rows, { article: table, qty: 2, price: 500, noStock: true })
    expect(rows.map((r) => [r.article.supplier_sku, r.qty, r.noStock])).toEqual([['P-TAF', 3, true], ['P-STO', 4, true]])
    expect(removeFromBasket(rows, chair.article_number).map((r) => r.article.supplier_sku)).toEqual(['P-TAF'])
  })
  it('waarschuwt pas als er niet genoeg vrij is, ook met wat al gescand is', () => {
    expect(stockShortage(3, 0, 3)).toBeNull()
    expect(stockShortage(3, 2, 2)).toEqual({ free: 1, short: 1 })
    expect(stockShortage(0, 0, 1)).toEqual({ free: 0, short: 1 })
  })
})

describe('proforma', () => {
  it('wordt een verkooporder met status Proforma, zonder klant, op naam van de medewerker en met een tijdelijk nummer', async () => {
    const { pid, showroom } = await stockInShowroom(table, 2)
    const { id, number } = await createProformaOrder(db, { salesperson_id: seller, date: TODAY, lines: [{ article: table, qty: 1 }, { article: chair, qty: 2 }, { article: table, qty: 2 }] })
    const o = db.data.sales_orders.find((x) => x.id === id)!
    expect(number).toBe('PRO-2026-0001')
    expect(o).toMatchObject({ status: 'proforma', customer_id: null, salesperson_id: seller, number })
    const s = await loadSnapshot(db)
    expect(orderStage(s, o)).toBe('proforma')
    expect(orderTab(s, o)).toBe('proforma')
    // 3 tafels: 2 vrij in de showroom, 1 op bestelling. Stoelen zijn nergens op voorraad.
    const lines = s.sales_order_lines.filter((l) => l.sales_order_id === id)
    expect(lines.filter((l) => l.product_id === pid).map((l) => [l.qty, l.source, l.warehouse_id])).toEqual([[2, 'voorraad', showroom], [1, 'bestelling', null]])
    expect(lines.find((l) => l.description === chair.name)).toMatchObject({ qty: 2, source: 'bestelling', unit_price: 100 })
    // Gereserveerd, maar nog niet in te kopen.
    expect(freeAt(s, pid, showroom)).toBe(0)
    expect(freeTotal(s, pid)).toBe(0)
    expect(linesToPurchase(s).some((l) => l.sales_order_id === id)).toBe(false)
  })

  it('kiest eerst de showroom, anders de locatie met voorraad', async () => {
    const { pid, showroom } = await stockInShowroom(table, 1)
    const s = await loadSnapshot(db)
    expect(scanWarehouse(s, pid, 1)).toBe(showroom)
    expect(scanWarehouse(s, pid, 5)).toBe(showroom)
  })

  it('weigert zonder medewerker of zonder artikelen', async () => {
    await expect(createProformaOrder(db, { salesperson_id: '', date: TODAY, lines: [{ article: table, qty: 1 }] })).rejects.toThrow(/wie je bent/)
    await expect(createProformaOrder(db, { salesperson_id: seller, date: TODAY, lines: [] })).rejects.toThrow(/Scan/)
  })

  it('kan bewaard worden zonder klant; het nummer blijft PRO', async () => {
    const { id, number } = await createProformaOrder(db, { salesperson_id: seller, date: TODAY, lines: [{ article: chair, qty: 1 }] })
    const input = confirmInput(id, { customer_id: '' })
    input.lines[0].qty = 3
    await saveProforma(db, id, input)
    const o = db.data.sales_orders.find((x) => x.id === id)!
    expect(o).toMatchObject({ status: 'proforma', number, customer_id: null })
    expect(db.data.sales_order_lines.filter((l) => l.sales_order_id === id).map((l) => l.qty)).toEqual([3])
  })

  it('krijgt pas bij bevestigen met klant het VO-nummer, en de VO-nummering slaat niets over', async () => {
    const { id } = await createProformaOrder(db, { salesperson_id: seller, date: TODAY, lines: [{ article: chair, qty: 1 }] })
    await expect(confirmProforma(db, id, confirmInput(id, { customer_id: '' }))).rejects.toThrow(/klant/)
    expect(db.data.sales_orders.find((x) => x.id === id)!.status).toBe('proforma')
    const number = await confirmProforma(db, id, confirmInput(id, { fulfilment: 'bezorgen', delivery_address: 'Calle 1' }))
    const o = db.data.sales_orders.find((x) => x.id === id)!
    expect(number).toMatch(/^VO-2026-\d{4}$/)
    expect(o).toMatchObject({ status: 'open', number, customer_id: db.data.customers[0].id })
    // De volgende gewone verkooporder volgt direct op dit nummer.
    const next = await createOrder(db, { header: { ...confirmInput(id).header, fulfilment: 'bezorgen', delivery_address: 'Calle 1' }, lines: [{ product_id: db.data.products[0].id, description: 'x', options: '', qty: 1, unit_price: 1, discount_pct: 0, vat_rate: 21, source: 'bestelling', warehouse_id: null, take_now: false }] })
    expect(Number(db.data.sales_orders.find((x) => x.id === next)!.number.slice(-4))).toBe(Number(number.slice(-4)) + 1)
    expect(db.data.order_events.some((e) => e.sales_order_id === id && e.kind === 'bevestigd')).toBe(true)
    // Nu gewoon in de inkoop.
    expect(linesToPurchase(await loadSnapshot(db)).some((l) => l.sales_order_id === id)).toBe(true)
    await expect(confirmProforma(db, id, confirmInput(id))).rejects.toThrow(/geen proforma/)
  })

  it('wat de klant bij bevestigen direct meeneemt, wordt meteen afgeleverd met een proforma voor facturatie', async () => {
    const { showroom } = await stockInShowroom(table, 1)
    const { id } = await createProformaOrder(db, { salesperson_id: seller, date: TODAY, lines: [{ article: table, qty: 1 }] })
    const input = confirmInput(id)
    input.lines = input.lines.map((l) => ({ ...l, take_now: true, warehouse_id: showroom }))
    await confirmProforma(db, id, input)
    const d = db.data.deliveries.filter((x) => x.sales_order_id === id)
    expect(d.map((x) => [x.method, x.status])).toEqual([['meenemen', 'delivered']])
  })
})

describe('proforma in de database', () => {
  it('alleen een proforma mag zonder klant', async () => {
    const pg = new PGlite({ extensions: { pg_trgm } })
    await pg.exec('create role authenticated;')
    await pg.exec(readdirSync('supabase/migrations').sort().map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n'))
    await pg.exec(toSeedSql(await loadSnapshot(db)))
    const seller = (await pg.query<{ id: string }>('select id from salespeople limit 1')).rows[0].id
    const ins = (status: string, nr: string) => pg.query(`insert into sales_orders (number, customer_id, order_date, salesperson_id, order_type, fulfilment, status) values ($1, null, '${TODAY}', $2, 'bestelling', 'meenemen', $3)`, [nr, seller, status])
    await ins('proforma', 'PRO-2026-0001')
    await expect(ins('open', 'VO-2026-9999')).rejects.toThrow()
  }, 60000)
})
