import { beforeEach, describe, expect, it } from 'vitest'
import { loadSnapshot } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { addDays } from '../src/domain/calc'
import { seedDemo } from '../src/domain/demo'
import { activeIn, followUpCount, inOrdersTab, orderFlow, ordersHref, parseOrdersParam, PHASES } from '../src/domain/orderFlow'
import { overview } from '../src/domain/overview'
import { assignShipmentsToTransport, convertPurchaseProformas, createDelivery, createOrder, invoiceProformas, lineFromProduct, markDelivered, markReady, markReceivedInNl } from '../src/domain/services'

const TODAY = '2026-11-04'
let db: LocalDriver
let sellerId = ''
beforeEach(async () => { db = new LocalDriver(false); await seedDemo(db, TODAY); sellerId = db.data.salespeople[0].id })

const header = (customer_id: string, over = {}) => ({
  customer_id, order_date: TODAY, channel: 'winkel' as const, salesperson_id: sellerId, customer_reference: '', order_type: 'bestelling' as const,
  fulfilment: 'bezorgen' as const, requested_date: null, promised_date: null, delivery_name: 'X', delivery_phone: '', delivery_address: 'Calle 1',
  delivery_postal_code: '', delivery_city: '', delivery_latitude: null, delivery_longitude: null, floor: '', has_elevator: false, needs_assembly: false, remove_old_furniture: false, delivery_notes: '', notes: '', ...over,
})
const flowOf = async (id: string, today = TODAY) => { const s = await loadSnapshot(db); return orderFlow(s, s.sales_orders.find((o) => o.id === id)!, today) }
const state = async (id: string, today = TODAY) => Object.fromEntries((await flowOf(id, today)).phases.map((p) => [p.key, p.state]))

describe('verkoop-flow per verkooporder', () => {
  it('uit voorraad: plannen, afleveren en factureren, met deellevering', async () => {
    const s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const id = await createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 2, warehouse_id: s.warehouses[1].id })] })
    let f = await flowOf(id)
    expect(f.phases.map((p) => p.key)).toEqual([...PHASES])
    expect(f).toMatchObject({ follow: 'actie', next: { key: 'planning' } })
    expect(await state(id)).toMatchObject({ proforma: 'skip', verkooporder: 'done', goederen: 'done', planning: 'actie', afleveren: 'open', factureren: 'open' })

    const line = (await loadSnapshot(db)).sales_order_lines.find((l) => l.sales_order_id === id)!
    const plan = (qty: number, date: string) => createDelivery(db, { sales_order_id: id, method: 'eigen_team', planned_date: date, carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty }] })
    // Deel ingepland: de rest moet nog gepland worden, dus blijft het opvolgen.
    const first = await plan(1, TODAY)
    expect((await flowOf(id)).next?.key).toBe('planning')
    // Vandaag gepland en nog niet klaargezet: klaarzetten is de volgende actie zodra alles gepland is.
    const second = await plan(1, addDays(TODAY, 3))
    f = await flowOf(id)
    expect(f).toMatchObject({ follow: 'actie', next: { key: 'afleveren', label: 'Klaarzetten', href: `#levering-naar-${first}` } })
    await markReady(db, first, { approved_by: 'Jan', date: TODAY })
    await markDelivered(db, first, { date: TODAY, signed_by: 'Klant', signed_note_received: true })
    // Deellevering afgemeld: de proforma (PF) moet direct gefactureerd worden.
    f = await flowOf(id)
    expect(f).toMatchObject({ follow: 'actie', next: { key: 'factureren', href: `#facturatie-naar-${first}` } })
    expect(f.phases.find((p) => p.key === 'afleveren')).toMatchObject({ state: 'wacht', partial: true })
    const pf = (await loadSnapshot(db)).deliveries.find((d) => d.id === first)!
    await invoiceProformas(db, { delivery_ids: [pf.id], invoice_date: TODAY })
    // Nu loopt hij: de tweede bezorging is pas over drie dagen.
    expect(await flowOf(id)).toMatchObject({ follow: 'wacht', next: { key: 'afleveren' } })
    // Is de bezorgdag voorbij zonder aflevering, dan is hij te laat.
    expect(await flowOf(id, addDays(TODAY, 4))).toMatchObject({ follow: 'te_laat', next: { key: 'afleveren', state: 'laat' } })
    await markReady(db, second, { approved_by: 'Jan', date: TODAY })
    await markDelivered(db, second, { date: TODAY, signed_by: 'Klant', signed_note_received: true })
    await invoiceProformas(db, { delivery_ids: [second], invoice_date: TODAY })
    f = await flowOf(id)
    expect(f).toMatchObject({ follow: 'afgerond', next: null })
    expect(f.phases.every((p) => p.state === 'done' || p.state === 'skip')).toBe(true)
  })

  it('op bestelling: inkooporder maken, op transport zetten, wachten op ontvangst, te laat na de verwachte datum', async () => {
    let s = await loadSnapshot(db)
    const product = s.products.find((p) => p.supplier_id)!
    const id = await createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 1, source: 'bestelling', warehouse_id: null })] })
    expect(await flowOf(id)).toMatchObject({ follow: 'actie', next: { key: 'goederen', label: 'Inkooporder maken' } })
    expect((await state(id)).planning).toBe('open')
    s = await loadSnapshot(db)
    const line = s.sales_order_lines.find((l) => l.sales_order_id === id)!
    const pf = s.purchase_orders.find((p) => p.status === 'proforma' && s.purchase_order_lines.some((l) => l.purchase_order_id === p.id && l.sales_order_line_id === line.id))!
    expect((await flowOf(id)).next?.href).toBe(`#inkoop-omzetten-${pf.id}`)
    const [po] = await convertPurchaseProformas(db, { ids: [pf.id], order_date: TODAY })
    s = await loadSnapshot(db)
    const transport = s.transports.find((t) => t.status === 'planned')!
    const shipment = s.inbound_shipments.find((x) => x.purchase_order_id === po)!
    // Besteld, nog bij de leverancier: wachten tot het in Nederland klaarstaat. Pas dan kan het op een transport.
    expect(await flowOf(id)).toMatchObject({ follow: 'wacht', next: { key: 'goederen', state: 'wacht', args: [shipment.original_date] } })
    await expect(assignShipmentsToTransport(db, [shipment.id], transport.id)).rejects.toThrow(/in Nederland/)
    await markReceivedInNl(db, [shipment.id], TODAY)
    expect(await flowOf(id)).toMatchObject({ follow: 'actie', next: { key: 'goederen', label: 'Op transport zetten', href: `#inkomend-klaar-${shipment.id}` } })
    await assignShipmentsToTransport(db, [shipment.id], transport.id)
    expect(await flowOf(id)).toMatchObject({ follow: 'wacht', next: { key: 'goederen', state: 'wacht', args: [transport.arrival_date] } })
    expect(await flowOf(id, addDays(transport.arrival_date, 1))).toMatchObject({ follow: 'te_laat', next: { key: 'goederen', state: 'laat' } })
  })

  it('klant neemt alles mee: geen planning, direct factureren', async () => {
    const s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const id = await createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 1, warehouse_id: s.warehouses[1].id, take_now: true })] })
    expect(await state(id)).toMatchObject({ goederen: 'done', planning: 'skip', afleveren: 'done', factureren: 'actie' })
    expect((await flowOf(id)).next?.key).toBe('factureren')
  })

  it('telt voor de stappenbalk alleen verkooporders die opvolging vragen', async () => {
    const s = await loadSnapshot(db)
    const n = s.sales_orders.filter((o) => o.status !== 'cancelled' && ['te_laat', 'actie'].includes(orderFlow(s, o, TODAY).follow)).length
    expect(followUpCount(s, TODAY)).toBe(n)
    expect(n).toBeGreaterThan(0)
  })

  it('links naar de lijst bewaren tabblad en fase, en onbekend valt terug op Opvolgen', () => {
    expect(ordersHref('opvolgen', 'planning')).toBe('#orders-lijst-opvolgen-planning')
    expect(parseOrdersParam('lijst-opvolgen-planning')).toEqual({ tab: 'opvolgen', phase: 'planning' })
    expect(parseOrdersParam('lijst-alle')).toEqual({ tab: 'alle', phase: null })
    expect(parseOrdersParam('')).toEqual({ tab: 'opvolgen', phase: null })
    expect(parseOrdersParam('lijst-onzin-xyz')).toEqual({ tab: 'opvolgen', phase: null })
  })

  it('de tegels en groepen op Overzicht openen precies de verkooporders die ze tellen', async () => {
    const s = await loadSnapshot(db)
    const o = overview(s, TODAY)
    const listed = (href: string) => {
      const { tab, phase } = parseOrdersParam(href.replace('#orders-', ''))
      return s.sales_orders.filter((x) => { const f = orderFlow(s, x, TODAY); return inOrdersTab(tab, f.follow) && (!phase || activeIn(f, phase)) }).map((x) => x.id).sort()
    }
    const plan = o.actions.find((a) => a.key === 'plannen')
    expect(plan?.href).toBe(o.links.toPlan)
    expect(listed(o.links.toPlan)).toEqual(o.sales.toPlan.map((x) => x.id).sort())
    expect(listed(o.links.waiting)).toEqual(o.sales.waiting.map((x) => x.id).sort())
    expect(listed(o.links.proformas)).toEqual(o.sales.proformas.map((x) => x.id).sort())
    expect(o.sales.toPlan.length + o.sales.waiting.length).toBeGreaterThan(0)
  })
})
