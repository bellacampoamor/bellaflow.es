import { beforeEach, describe, expect, it } from 'vitest'
import { loadSnapshot } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { addDays } from '../src/domain/calc'
import { seedDemo } from '../src/domain/demo'
import { deliverableReport, parsePurchasesParam, purchaseFlow, purchasesHref } from '../src/domain/purchaseFlow'
import { assignShipmentsToTransport, convertPurchaseProformas, createDelivery, createOrder, lineFromProduct, markDelivered, markReady, markReceivedInNl, receiveGoods, setTransportStatus } from '../src/domain/services'

const TODAY = '2026-11-04'
let db: LocalDriver
let sellerId = ''
beforeEach(async () => { db = new LocalDriver(false); await seedDemo(db, TODAY); sellerId = db.data.salespeople[0].id })

const header = (customer_id: string) => ({
  customer_id, order_date: TODAY, channel: 'winkel' as const, salesperson_id: sellerId, customer_reference: '', order_type: 'bestelling' as const,
  fulfilment: 'bezorgen' as const, requested_date: null, promised_date: null, delivery_name: 'X', delivery_phone: '', delivery_address: 'Calle 1',
  delivery_postal_code: '', delivery_city: '', delivery_latitude: null, delivery_longitude: null, floor: '', has_elevator: false, needs_assembly: false, remove_old_furniture: false, delivery_notes: '', notes: '',
})
const flowOf = async (poId: string, today = TODAY) => { const s = await loadSnapshot(db); return purchaseFlow(s, s.purchase_orders.find((p) => p.id === poId)!, today) }
const states = async (poId: string, today = TODAY) => Object.fromEntries((await flowOf(poId, today)).phases.map((p) => [p.key, p.state]))

describe('inkoop-flow per inkooporder', () => {
  it('proforma → inkooporder → in NL → transport → ontvangst → aflevering aan de klant', async () => {
    let s = await loadSnapshot(db)
    const product = s.products.find((p) => p.supplier_id)!
    const soId = await createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 1, source: 'bestelling', warehouse_id: null })] })
    s = await loadSnapshot(db)
    const sol = s.sales_order_lines.find((l) => l.sales_order_id === soId)!
    const pf = s.purchase_orders.find((p) => p.status === 'proforma' && s.purchase_order_lines.some((l) => l.purchase_order_id === p.id && l.sales_order_line_id === sol.id))!
    expect(await flowOf(pf.id)).toMatchObject({ follow: 'actie', next: { key: 'proforma', href: `#inkoop-omzetten-${pf.id}` } })

    const [po] = await convertPurchaseProformas(db, { ids: [pf.id], order_date: TODAY })
    s = await loadSnapshot(db)
    const x = s.inbound_shipments.find((r) => r.purchase_order_id === po)!
    expect(await states(po)).toMatchObject({ proforma: 'done', inkooporder: 'done', nl: 'wacht', transport: 'open', ontvangst: 'open', aflevering: 'open' })
    expect((await flowOf(po)).follow).toBe('wacht')
    // Na de verwachte datum in NL is hij te laat.
    expect(await flowOf(po, addDays(x.original_date, 1))).toMatchObject({ follow: 'te_laat', next: { key: 'nl' } })

    await markReceivedInNl(db, [x.id], TODAY)
    expect(await flowOf(po)).toMatchObject({ follow: 'actie', next: { key: 'transport', href: `#inkomend-klaar-${x.id}` } })

    const t = s.transports.find((r) => r.status === 'planned' && r.arrival_date > TODAY)!
    await assignShipmentsToTransport(db, [x.id], t.id)
    expect(await flowOf(po)).toMatchObject({ follow: 'wacht', next: { key: 'ontvangst', state: 'wacht' } })
    expect(await flowOf(po, t.arrival_date)).toMatchObject({ follow: 'actie', next: { key: 'ontvangst', label: 'Inboeken' } })
    expect(await flowOf(po, addDays(t.arrival_date, 1))).toMatchObject({ follow: 'te_laat', next: { key: 'ontvangst' } })

    await setTransportStatus(db, t.id, 'departed')
    s = await loadSnapshot(db)
    const almoradi = s.warehouses.find((w) => w.name === 'Magazijn Almoradí')!
    const sl = s.inbound_shipment_lines.find((l) => l.shipment_id === x.id)!
    await receiveGoods(db, { transport_id: t.id, received_date: TODAY, delivery_note: '', received_by: '', notes: '', rows: [{ shipment_line_id: sl.id, warehouse_id: almoradi.id, qty_received: 1, qty_damaged: 0, location_bin: '' }] })
    // Ontvangen: verder in de verkooporder. De verkooporder is nu leverbaar vanaf Almoradí.
    expect(await flowOf(po)).toMatchObject({ follow: 'wacht', next: { key: 'aflevering', href: `#orders-${soId}` } })
    s = await loadSnapshot(db)
    const row = deliverableReport(s).find((r) => r.orderId === soId)!
    expect(row).toMatchObject({ state: 'volledig', ready: [{ lineId: sol.id, qty: 1, warehouseId: almoradi.id }] })

    const d = await createDelivery(db, { sales_order_id: soId, method: 'eigen_team', planned_date: TODAY, carrier: '', notes: '', lines: [{ sales_order_line_id: sol.id, qty: 1 }] })
    expect(deliverableReport(await loadSnapshot(db)).some((r) => r.orderId === soId)).toBe(false)
    await markReady(db, d, { approved_by: 'Jan', date: TODAY })
    await markDelivered(db, d, { date: TODAY, signed_by: 'Klant', signed_note_received: true })
    expect(await flowOf(po)).toMatchObject({ follow: 'afgerond', next: null })
  })

  it('inkoop voor magazijn of showroom slaat proforma en aflevering over', async () => {
    const s = await loadSnapshot(db)
    const po = s.purchase_orders.find((p) => p.label === 'showroom')!
    const st = await states(po.id)
    expect(st.proforma).toBe('skip')
    expect(st.aflevering).toBe('skip')
  })

  it('leverbaar: deels als een deel binnen is en een deel nog niet', async () => {
    const s = await loadSnapshot(db)
    const rows = deliverableReport(s)
    for (const r of rows) {
      if (r.state === 'volledig') expect(r.waiting).toHaveLength(0)
      if (r.state === 'deels') expect(r.ready.length && r.waiting.length).toBeTruthy()
      if (r.state === 'nog_niet') expect(r.ready).toHaveLength(0)
    }
    const order = rows.map((r) => r.state)
    expect([...order].sort((a, b) => ['volledig', 'deels', 'nog_niet'].indexOf(a) - ['volledig', 'deels', 'nog_niet'].indexOf(b))).toEqual(order)
  })

  it('links naar de lijst Inkooporders', () => {
    expect(purchasesHref('opvolgen', 'transport')).toBe('#inkoop-lijst-opvolgen-transport')
    expect(parsePurchasesParam('lijst-loopt-nl')).toEqual({ tab: 'loopt', phase: 'nl' })
    expect(parsePurchasesParam('proforma')).toEqual({ tab: 'opvolgen', phase: 'proforma' })
    expect(parsePurchasesParam('')).toEqual({ tab: 'opvolgen', phase: null })
  })
})
