// Voorraadverschil overrulen bij meegeven (besluit Rick 11 november 2026): de voorraad in Bella Flow klopt niet vanaf dag 1,
// dus een verkoop die de klant meeneemt mag niet worden opgehouden. Het tekort wordt als correctie bijgeboekt.
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSnapshot } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { freeAt, onHandMap, stockKey } from '../src/domain/calc'
import { seedDemo } from '../src/domain/demo'
import { takeNowShortfalls } from '../src/domain/pos'
import { createOrder, lineFromProduct } from '../src/domain/services'

const TODAY = '2026-11-11'
let db: LocalDriver
let sellerId = ''
beforeEach(async () => { db = new LocalDriver(false); await seedDemo(db, TODAY); sellerId = db.data.salespeople[0].id })

const header = (customer_id: string) => ({
  customer_id, order_date: TODAY, channel: 'winkel' as const, salesperson_id: sellerId, customer_reference: '', order_type: 'direct' as const,
  fulfilment: 'meenemen' as const, requested_date: null, promised_date: null, delivery_name: 'X', delivery_phone: '', delivery_address: '',
  delivery_postal_code: '', delivery_city: '', delivery_latitude: null, delivery_longitude: null, floor: '', has_elevator: false, needs_assembly: false, remove_old_furniture: false, delivery_notes: '', notes: '',
})

describe('Voorraadverschil bij meegeven', () => {
  it('zonder toestemming geweigerd, met toestemming bijgeboekt, afgeleverd en gefactureerd', async () => {
    const s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const wh = s.warehouses[1]
    const free = Math.max(0, freeAt(s, product.id, wh.id))
    const qty = free + 3
    const lines = [lineFromProduct(product, { qty, warehouse_id: wh.id, take_now: true, unit_price: 100 })]
    await expect(createOrder(db, { header: header(s.customers[0].id), lines })).rejects.toThrow(/om mee te nemen/)

    const id = await createOrder(db, { header: header(s.customers[0].id), lines }, { invoiceNow: true, invoiceDate: TODAY, allowShortfall: true })
    const after = await loadSnapshot(db)
    const order = after.sales_orders.find((o) => o.id === id)!
    const corr = after.stock_movements.filter((m) => m.kind === 'correctie' && m.ref_id === order.number)
    expect(corr).toHaveLength(1)
    expect(corr[0]).toMatchObject({ product_id: product.id, warehouse_id: wh.id, qty: 3 })
    expect(after.deliveries.find((d) => d.sales_order_id === id)!.status).toBe('delivered')
    expect(after.invoices.filter((i) => i.sales_order_id === id)).toHaveLength(1)
    expect(after.order_events.some((e) => e.sales_order_id === id && e.kind === 'voorraad')).toBe(true)
    // De voorraad eindigt niet negatief.
    expect(onHandMap(after).get(stockKey(product.id, wh.id)) ?? 0).toBeGreaterThanOrEqual(0)
  })

  it('boekt niets bij als er genoeg vrij is', async () => {
    const s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const wh = s.warehouses[1]
    expect(takeNowShortfalls(s, [{ product_id: product.id, qty: 0, take_now: true, warehouse_id: wh.id }])).toEqual([])
    expect(takeNowShortfalls(s, [{ product_id: product.id, qty: 999, take_now: false, warehouse_id: wh.id }])).toEqual([])
    expect(takeNowShortfalls(s, [{ product_id: product.id, qty: 999, take_now: true, warehouse_id: wh.id }])[0].qty).toBe(999 - Math.max(0, freeAt(s, product.id, wh.id)))
  })
})
