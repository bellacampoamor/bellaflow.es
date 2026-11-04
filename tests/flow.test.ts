import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSnapshot } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { TABLES } from '../src/data/types'
import { flowCounts, invoiceBalance, onHandMap, orderStage, reservedMap, stockKey, vatBreakdown } from '../src/domain/calc'
import { seedDemo } from '../src/domain/demo'
import {
  createDelivery, createInvoice, createOrder, createPurchaseOrder, lineFromProduct, markDelivered, receiveGoods, splitQty, transferStock,
} from '../src/domain/services'
import { toSeedSql } from '../scripts/seed-sql'

const TODAY = '2026-11-04'
let db: LocalDriver
beforeEach(async () => { db = new LocalDriver(false); await seedDemo(db, TODAY) })

const header = (customer_id: string, over = {}) => ({
  customer_id, order_date: TODAY, channel: 'winkel' as const, salesperson: '', customer_reference: '', order_type: 'bestelling' as const,
  fulfilment: 'bezorgen' as const, requested_date: null, promised_date: null, delivery_name: 'X', delivery_phone: '', delivery_address: 'Calle 1',
  delivery_postal_code: '', delivery_city: '', floor: '', has_elevator: false, needs_assembly: false, remove_old_furniture: false, delivery_notes: '', notes: '', ...over,
})

describe('rekenen', () => {
  it('verdeelt aantallen zonder verlies', () => {
    expect(splitQty(5, [50, 50])).toEqual([3, 2])
    expect(splitQty(1, [50, 50])).toEqual([1, 0])
    expect(splitQty(24, [50, 25, 25])).toEqual([12, 6, 6])
  })
  it('haalt IVA uit een prijs inclusief', () => {
    expect(vatBreakdown([{ total: 121, vat_rate: 21 }])).toMatchObject({ base: 100, vat: 21, total: 121 })
  })
})

describe('van inkoop tot factuur', () => {
  it('doorloopt de hele keten met splitsing over magazijnen en twee deelleveringen', async () => {
    let s = await loadSnapshot(db)
    const [shop, north, south] = s.warehouses
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const customer = s.customers[0]
    const stockAt = async (w: string) => onHandMap(await loadSnapshot(db)).get(stockKey(product.id, w)) ?? 0
    const beforeNorth = await stockAt(north.id), beforeSouth = await stockAt(south.id)

    // Klant bestelt 10 stuks op bestelling, met 500 vooruit.
    const orderId = await createOrder(db, {
      header: header(customer.id),
      lines: [lineFromProduct(product, { qty: 10, source: 'bestelling', unit_price: 121 })],
      deposit: { amount: 500, method: 'pin', reference: '' },
    })
    s = await loadSnapshot(db)
    const line = s.sales_order_lines.find((l) => l.sales_order_id === orderId)!
    expect(orderStage(s, s.sales_orders.find((o) => o.id === orderId)!)).toBe('wacht_op_goederen')

    // Inkoop 50/50.
    const poId = await createPurchaseOrder(db, {
      supplier_id: s.suppliers[0].id, order_date: TODAY, supplier_reference: '', notes: '',
      lines: [{ product_id: product.id, qty: 10, unit_cost: 100, sales_order_line_id: line.id }],
      shipments: [
        { expected_date: TODAY, warehouse_id: north.id, carrier: '', pct: 50 },
        { expected_date: TODAY, warehouse_id: south.id, carrier: '', pct: 50 },
      ],
    })
    s = await loadSnapshot(db)
    const shipments = s.inbound_shipments.filter((x) => x.purchase_order_id === poId)
    expect(shipments).toHaveLength(2)
    const sl1 = s.inbound_shipment_lines.find((l) => l.shipment_id === shipments[0].id)!

    // Te veel ontvangen wordt geweigerd en laat niets achter.
    await expect(receiveGoods(db, { shipment_id: shipments[0].id, received_date: TODAY, delivery_note: '', received_by: '', notes: '', rows: [{ shipment_line_id: sl1.id, warehouse_id: north.id, qty_received: 6, qty_damaged: 0, location_bin: '' }] })).rejects.toThrow(/nog 5 open/)

    // Eerste zending verdeeld over twee magazijnen, één beschadigd blijft open.
    await receiveGoods(db, {
      shipment_id: shipments[0].id, received_date: TODAY, delivery_note: 'PB1', received_by: '', notes: '',
      rows: [
        { shipment_line_id: sl1.id, warehouse_id: north.id, qty_received: 3, qty_damaged: 1, location_bin: '' },
        { shipment_line_id: sl1.id, warehouse_id: south.id, qty_received: 1, qty_damaged: 0, location_bin: '' },
      ],
    })
    expect(await stockAt(north.id)).toBe(beforeNorth + 3)
    expect(await stockAt(south.id)).toBe(beforeSouth + 1)
    s = await loadSnapshot(db)
    expect(s.inbound_shipments.find((x) => x.id === shipments[0].id)!.status).toBe('partial')
    expect(s.sales_order_lines.find((l) => l.id === line.id)!.warehouse_id).toBe(north.id)
    expect(reservedMap(s).get(stockKey(product.id, north.id))).toBeGreaterThanOrEqual(10)

    // Deellevering 1: 3 stuks, wordt 363 op de factuur, deposit dekt alles.
    const d1 = await createDelivery(db, { sales_order_id: orderId, method: 'eigen_team', planned_date: TODAY, time_slot: '', carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 3 }] })
    await markDelivered(db, d1, { date: TODAY, signed_by: 'X' })
    expect(await stockAt(north.id)).toBe(beforeNorth)
    const i1 = await createInvoice(db, { sales_order_id: orderId, delivery_ids: [d1], invoice_date: TODAY, settle_deposit: true })
    s = await loadSnapshot(db)
    const inv1 = s.invoices.find((i) => i.id === i1)!
    expect(inv1).toMatchObject({ kind: 'deelfactuur', total: 363, base_amount: 300, vat_amount: 63, deposit_settled: 363 })
    expect(invoiceBalance(s, inv1)).toBe(0)

    // Dezelfde levering nogmaals factureren kan niet.
    await expect(createInvoice(db, { sales_order_id: orderId, delivery_ids: [d1], invoice_date: TODAY, settle_deposit: true })).rejects.toThrow(/al gefactureerd/)

    // Terugdateren kan niet.
    await expect(createInvoice(db, { sales_order_id: orderId, delivery_ids: [d1], invoice_date: '2026-01-01', settle_deposit: true })).rejects.toThrow(/mag niet voor/)

    // Meer plannen dan er open staat kan niet.
    await expect(createDelivery(db, { sales_order_id: orderId, method: 'eigen_team', planned_date: TODAY, time_slot: '', carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 8 }] })).rejects.toThrow(/nog 7 open/)

    // Rest leveren: voorraad moet er zijn, dus eerst overboeken en de tweede zending ontvangen.
    s = await loadSnapshot(db)
    const sl2 = s.inbound_shipment_lines.find((l) => l.shipment_id === shipments[1].id)!
    await receiveGoods(db, { shipment_id: shipments[1].id, received_date: TODAY, delivery_note: 'PB2', received_by: '', notes: '', rows: [{ shipment_line_id: sl2.id, warehouse_id: north.id, qty_received: 5, qty_damaged: 0, location_bin: '' }] })
    await transferStock(db, { product_id: product.id, from_id: south.id, to_id: north.id, qty: 1, note: '', date: TODAY })
    const d2 = await createDelivery(db, { sales_order_id: orderId, method: 'eigen_team', planned_date: TODAY, time_slot: '', carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 7 }] })
    await markDelivered(db, d2, { date: TODAY, signed_by: 'X' })
    const i2 = await createInvoice(db, { sales_order_id: orderId, delivery_ids: [d2], invoice_date: TODAY, settle_deposit: true })
    s = await loadSnapshot(db)
    const inv2 = s.invoices.find((i) => i.id === i2)!
    expect(inv2).toMatchObject({ kind: 'eindfactuur', total: 847, deposit_settled: 137 })
    expect(invoiceBalance(s, inv2)).toBe(710)
    expect(orderStage(s, s.sales_orders.find((o) => o.id === orderId)!)).toBe('gefactureerd')
    expect(shop).toBeTruthy()
  })

  it('weigert levering als de voorraad niet op die locatie ligt', async () => {
    const s = await loadSnapshot(db)
    const [shop] = s.warehouses
    const product = s.products.find((p) => p.sku === 'TAF-EK-240')!
    const id = await createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 1, warehouse_id: shop.id })] })
    const after = await loadSnapshot(db)
    const line = after.sales_order_lines.find((l) => l.sales_order_id === id)!
    const d = await createDelivery(db, { sales_order_id: id, method: 'eigen_team', planned_date: TODAY, time_slot: '', carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 1 }] })
    await expect(markDelivered(db, d, { date: TODAY, signed_by: '' })).rejects.toThrow(/Boek eerst voorraad/)
  })

  it('factureert automatisch als dat is ingesteld', async () => {
    await db.update('settings', 'default', { invoice_mode: 'auto' })
    const s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const count = s.invoices.length
    await createOrder(db, { header: header(s.customers[0].id, { order_type: 'direct', fulfilment: 'meenemen' }), lines: [lineFromProduct(product, { qty: 1, warehouse_id: s.warehouses[1].id })] })
    expect((await loadSnapshot(db)).invoices.length).toBe(count + 1)
  })

  it('voorbeeldgegevens hebben geen negatieve voorraad en werk in elke stap', async () => {
    const s = await loadSnapshot(db)
    for (const v of onHandMap(s).values()) expect(v).toBeGreaterThanOrEqual(0)
    const c = flowCounts(s, TODAY)
    for (const key of ['inkoop', 'inkomend', 'ontvangst', 'orders', 'levering', 'facturatie'] as const) expect(c[key], key).toBeGreaterThan(0)
  })
})

describe('database', () => {
  it('migratie en voorbeeldgegevens passen op Postgres, en de regels gelden daar ook', async () => {
    const pg = new PGlite()
    await pg.exec('create role authenticated;')
    await pg.exec(readFileSync('supabase/migrations/20261104120000_bella_flow_schema.sql', 'utf8'))
    await pg.exec(toSeedSql(await loadSnapshot(db)))

    const snap = await loadSnapshot(db)
    for (const t of TABLES) {
      const r = await pg.query<{ n: number }>(`select count(*)::int as n from ${t}`)
      expect(r.rows[0].n, t).toBe(snap[t].length)
    }
    // v_stock komt overeen met wat de app berekent.
    const view = await pg.query<{ product_id: string; warehouse_id: string; on_hand: number; reserved: number }>('select * from v_stock')
    const hand = onHandMap(snap), res = reservedMap(snap)
    for (const r of view.rows) {
      expect(r.on_hand).toBe(hand.get(stockKey(r.product_id, r.warehouse_id)) ?? 0)
      expect(r.reserved).toBe(res.get(stockKey(r.product_id, r.warehouse_id)) ?? 0)
    }
    // Nummering loopt door op de bestaande reeks.
    const series = snap.number_series.find((x) => x.id === 'F-2026')!
    const n = await pg.query<{ next_number: string }>(`select next_number('F', 2026)`)
    expect(n.rows[0].next_number).toBe(`F-2026-${String(series.last_number + 1).padStart(4, '0')}`)
    // Factuur wijzigen en terugdateren worden door de database geweigerd.
    await expect(pg.exec(`update invoices set total = 1`)).rejects.toThrow(/niet worden gewijzigd/)
    const inv = snap.invoices[0]
    await expect(pg.query(`insert into invoices (number, sales_order_id, customer_id, kind, invoice_date, due_date, base_amount, vat_amount, total) values ('X', $1, $2, 'volledig', '2000-01-01', '2000-01-01', 0, 0, 0)`, [inv.sales_order_id, inv.customer_id])).rejects.toThrow(/ligt voor/)
  })
})
