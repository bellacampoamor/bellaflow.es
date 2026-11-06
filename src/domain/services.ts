import { tx } from '../i18n'
// Alle handelingen in het proces. Elke functie controleert eerst en schrijft daarna,
// zodat een geweigerde actie niets half achterlaat.
import { loadSnapshot, newId, type Driver } from '../data/driver'
import type {
  EmailStatus, Language,
  Delivery, Fulfilment, InboundShipment, InvoiceLine, OrderType, Payment, Product, PurchaseLabel, SalesOrder, Settings,
  SalesOrderLine, Snapshot, StockMovement, SupplierCatalogItem, TableName,
} from '../data/types'
import { CATALOG_COLUMNS, catalogItemFromCsv, parseCsv, sameName } from './catalog'
import {
  addDays, depositAvailable, freeAt, linesToPurchase, invoicedDeliveryLineIds, lineTotal, onHandMap, orderLines, plannedQty, round2,
  shipmentLineOpen, shippedQty, stockKey, todayISO, vatBreakdown,
  inboundWarehouse,
} from './calc'

export class FlowError extends Error {}
const fail = (m: string): never => { throw new FlowError(m) }
const yearOf = (iso: string) => Number(iso.slice(0, 4))
const event = (sales_order_id: string, kind: string, message: string, extra: Partial<{ old_date: string | null; new_date: string | null; customer_notified: boolean }> = {}) => ({
  id: newId(), sales_order_id, kind, message, old_date: null, new_date: null, customer_notified: false,
  created_at: new Date().toISOString(), ...extra,
})

// Nummering ----------------------------------------------------------------------

export type PrefixField = 'prefix_sales_order' | 'prefix_purchase' | 'prefix_receipt' | 'prefix_delivery' | 'prefix_invoice' | 'prefix_transport' | 'prefix_proforma'
export const PREFIX_FIELDS: PrefixField[] = ['prefix_sales_order', 'prefix_purchase', 'prefix_receipt', 'prefix_delivery', 'prefix_invoice', 'prefix_transport', 'prefix_proforma']

/** De teller hoort bij de soort document, dus een ander voorvoegsel laat de nummers gewoon doorlopen. */
async function nextDocumentNumber(db: Driver, series: string, field: PrefixField, year: number) {
  const seq = (await db.nextNumber(series, year)).split('-').pop()
  const prefix = (await db.list('settings'))[0]?.[field] || series
  return `${prefix}-${year}-${seq}`
}

export async function saveSettings(db: Driver, patch: Partial<Settings>) {
  for (const field of PREFIX_FIELDS) {
    if (patch[field] !== undefined && !/^[A-Za-z0-9]{1,10}$/.test(patch[field] as string)) fail(tx("Een voorvoegsel bestaat uit 1 tot 10 letters of cijfers, zonder spaties of streepjes."))
  }
  if (patch.shop_email && !isEmail(patch.shop_email)) fail(tx("Vul een geldig winkel e-mailadres in."))
  await db.update('settings', 'default', patch)
}

// Inkoop -----------------------------------------------------------------------

export interface PurchaseInput {
  supplier_id: string; order_date: string; supplier_reference: string; notes: string
  /** Bestemming en eventueel al bekend transport; per regel te overschrijven. */
  warehouse_id?: string; transport_id?: string | null; label?: PurchaseLabel
  lines: { product_id: string; qty: number; unit_cost: number; sales_order_line_id: string | null; warehouse_id?: string; transport_id?: string | null }[]
}

/** Ingekocht is altijd de hele regel. Elke regel krijgt een eigen rij waarmee hij aan een transport wordt gekoppeld. */
export async function createPurchaseOrder(db: Driver, input: PurchaseInput) {
  if (!input.supplier_id) fail(tx("Kies een leverancier."))
  if (!input.lines.length || input.lines.some((l) => !l.product_id || l.qty <= 0)) fail(tx("Voeg minimaal één regel toe met product en aantal."))
  const warehouses = await db.list('warehouses')
  const warehouseId = input.warehouse_id ?? inboundWarehouse(warehouses)?.id
  if (!warehouseId) fail(tx("Stel onder Beheer een actief magazijn in waar de route start."))
  const transports = await db.list('transports')
  const supplier = (await db.list('suppliers')).find((x) => x.id === input.supplier_id)
  // Regels voor een klant maken het altijd een verkoop-inkoop; anders volgt het label de keuze of de bestemming.
  const destination = warehouses.find((w) => w.id === warehouseId)
  const label: PurchaseLabel = input.lines.some((l) => l.sales_order_line_id) ? 'verkoop' : input.label ?? (destination?.kind === 'winkel' ? 'showroom' : 'magazijn')
  const id = newId()
  const number = await nextDocumentNumber(db, 'IO', 'prefix_purchase', yearOf(input.order_date))
  await db.insert('purchase_orders', [{ id, number, supplier_id: input.supplier_id, order_date: input.order_date, supplier_reference: input.supplier_reference, notes: input.notes, status: 'open', label }])
  let sequence = 0
  for (const { warehouse_id, transport_id, ...line } of input.lines) {
    sequence += 1
    const polId = newId(), sid = newId()
    await db.insert('purchase_order_lines', [{ id: polId, purchase_order_id: id, ...line }])
    const transport = transports.find((t) => t.id === (transport_id ?? input.transport_id))
    // Zonder transport is de datum alleen een interne schatting; het scherm toont hem pas na koppeling.
    const expected = transport?.arrival_date ?? addDays(input.order_date, supplier?.lead_time_days ?? 21)
    await db.insert('inbound_shipments', [{ id: sid, purchase_order_id: id, sequence, expected_date: expected, original_date: expected, warehouse_id: (warehouse_id ?? warehouseId)!, carrier: transport?.carrier ?? '', status: 'expected', notes: '', transport_id: transport?.id ?? null }])
    await db.insert('inbound_shipment_lines', [{ id: newId(), shipment_id: sid, purchase_order_line_id: polId, qty: line.qty }])
  }
  return id
}

/** Het label mag wijzigen. Staat er een regel voor een klant op, dan blijft het Verkoop. */
export async function setPurchaseLabel(db: Driver, id: string, label: PurchaseLabel) {
  const lines = (await db.list('purchase_order_lines')).filter((l) => l.purchase_order_id === id)
  const forSale = lines.some((l) => l.sales_order_line_id)
  if (forSale && label !== 'verkoop') fail(tx("Deze inkooporder heeft regels voor een verkooporder en houdt het label Verkoop."))
  if (!forSale && label === 'verkoop') fail(tx("Het label Verkoop hoort bij regels van een verkooporder."))
  await db.update('purchase_orders', id, { label })
}

export interface ConvertInput {
  lines: { sales_order_line_id: string }[]
  order_date: string
}

/** Zet aangevinkte regels van verkooporders door: per leverancier één inkooporder. */
export async function convertLinesToPurchaseOrders(db: Driver, input: ConvertInput) {
  if (!input.lines.length) fail(tx("Vink minimaal één regel aan."))
  const s = await loadSnapshot(db)
  const open = linesToPurchase(s)
  const rows = input.lines.map((l) => {
    const line = open.find((x) => x.id === l.sales_order_line_id)
    if (!line) fail(tx("Een van de regels is al ingekocht. Ververs het overzicht."))
    // Een artikel hoort bij één leverancier; die staat op het product.
    const supplier_id = s.products.find((p) => p.id === line!.product_id)?.supplier_id
    if (!supplier_id) fail(tx("{0} heeft geen leverancier. Stel die in onder Beheer.", line!.description))
    return { line: line!, supplier_id: supplier_id! }
  })
  const ids: string[] = []
  for (const supplier_id of new Set(rows.map((r) => r.supplier_id))) {
    ids.push(await createPurchaseOrder(db, {
      supplier_id, order_date: input.order_date, supplier_reference: '', notes: '',
      lines: rows.filter((r) => r.supplier_id === supplier_id).map(({ line }) => ({
        product_id: line.product_id, qty: line.qty, unit_cost: s.products.find((p) => p.id === line.product_id)?.purchase_price ?? 0, sales_order_line_id: line.id,
      })),
    }))
  }
  return ids
}

export async function closeShipment(db: Driver, shipmentId: string, reason: string) {
  await db.update('inbound_shipments', shipmentId, { status: 'closed', notes: reason })
  await closeTransportIfDone(db, (await db.list('inbound_shipments')).find((x) => x.id === shipmentId)?.transport_id ?? null)
}

export async function cancelPurchaseOrder(db: Driver, id: string) {
  const s = await loadSnapshot(db)
  const shipments = s.inbound_shipments.filter((x) => x.purchase_order_id === id)
  if (s.goods_receipt_lines.some((r) => s.inbound_shipment_lines.some((l) => l.id === r.shipment_line_id && shipments.some((x) => x.id === l.shipment_id)))) fail(tx("Deze inkooporder heeft al ontvangsten en kan niet worden geannuleerd."))
  await db.update('purchase_orders', id, { status: 'cancelled' })
  for (const x of shipments) await db.update('inbound_shipments', x.id, { status: 'closed' })
}

// Transport ----------------------------------------------------------------------

export interface TransportInput { departure_date: string; arrival_date: string; carrier: string; reference: string; capacity_m3: number; notes: string }

function validateTransport(input: TransportInput) {
  if (!input.departure_date || !input.arrival_date) fail(tx("Vul de vertrek- en aankomstdatum in."))
  if (input.arrival_date < input.departure_date) fail(tx("De aankomst kan niet voor het vertrek liggen."))
}

export async function createTransport(db: Driver, input: TransportInput) {
  validateTransport(input)
  const id = newId()
  const number = await nextDocumentNumber(db, 'TR', 'prefix_transport', yearOf(input.departure_date))
  await db.insert('transports', [{ id, number, status: 'planned', ...input }])
  return id
}

/** Een nieuwe aankomstdatum schuift alle openstaande zendingen op deze vrachtwagen mee. */
export async function updateTransport(db: Driver, id: string, input: TransportInput) {
  validateTransport(input)
  await db.update('transports', id, input)
  const shipments = (await db.list('inbound_shipments')).filter((x) => x.transport_id === id && (x.status === 'expected' || x.status === 'partial'))
  for (const x of shipments) await db.update('inbound_shipments', x.id, { expected_date: input.arrival_date, carrier: input.carrier })
}

/** Koppelt inkoopregels aan een transport; de verwachte ontvangstdatum volgt daaruit. Null koppelt los. */
export async function assignShipmentsToTransport(db: Driver, shipmentIds: string[], transportId: string | null) {
  const s = await loadSnapshot(db)
  const t = transportId ? s.transports.find((r) => r.id === transportId) ?? (fail(tx("Transport niet gevonden.")) as never) : null
  if (t && t.status !== 'planned') fail(tx("Dit transport is al vertrokken. Kies een later transport."))
  for (const id of shipmentIds) {
    const x = s.inbound_shipments.find((r) => r.id === id) ?? (fail(tx("Inkoopregel niet gevonden.")) as never)
    if (x.status === 'received' || x.status === 'closed') fail(tx("Deze regel is al ontvangen."))
    const current = s.transports.find((r) => r.id === x.transport_id)
    if (current && current.status !== 'planned') fail(tx("Dit transport is al vertrokken. De regel kan er niet meer af."))
  }
  for (const id of shipmentIds) await db.update('inbound_shipments', id, t ? { transport_id: t.id, expected_date: t.arrival_date, carrier: t.carrier } : { transport_id: null })
}

async function closeTransportIfDone(db: Driver, transportId: string | null) {
  if (!transportId) return
  const shipments = (await db.list('inbound_shipments')).filter((x) => x.transport_id === transportId)
  if (shipments.length && shipments.every((x) => x.status === 'received' || x.status === 'closed')) await db.update('transports', transportId, { status: 'arrived' })
}

export async function setTransportStatus(db: Driver, id: string, status: 'departed' | 'arrived') {
  await db.update('transports', id, { status })
}

export async function cancelTransport(db: Driver, id: string) {
  const s = await loadSnapshot(db)
  const t = s.transports.find((r) => r.id === id)
  if (t?.status !== 'planned') fail(tx("Dit transport is al vertrokken en kan niet worden geannuleerd."))
  for (const x of s.inbound_shipments.filter((r) => r.transport_id === id)) await db.update('inbound_shipments', x.id, { transport_id: null })
  await db.update('transports', id, { status: 'cancelled' })
}

// Goederenontvangst ------------------------------------------------------------

export interface ReceiptRow { shipment_line_id: string; warehouse_id?: string; qty_received: number; qty_damaged: number; location_bin: string }
export interface ReceiptInput { transport_id?: string | null; received_date: string; delivery_note: string; received_by: string; notes: string; rows: ReceiptRow[] }

export async function receiveGoods(db: Driver, input: ReceiptInput) {
  const s = await loadSnapshot(db)
  const standard = inboundWarehouse(s.warehouses)?.id
  const rows = input.rows.filter((r) => r.qty_received > 0 || r.qty_damaged > 0).map((r) => ({ ...r, warehouse_id: r.warehouse_id ?? standard as string }))
  if (!rows.length) fail(tx("Vul bij minimaal één regel een ontvangen aantal in."))
  if (rows.some((r) => !r.warehouse_id)) fail(tx("Stel onder Beheer een actief magazijn in waar de route start."))
  const perLine = new Map<string, number>()
  for (const r of rows) perLine.set(r.shipment_line_id, (perLine.get(r.shipment_line_id) ?? 0) + r.qty_received)
  for (const [lineId, n] of perLine) {
    const open = shipmentLineOpen(s, lineId)
    if (n > open) fail(tx("Er staat nog {0} open op deze regel, maar er is {1} ingevuld. Corrigeer het aantal.", open, n))
  }
  const polOf = (slId: string) => {
    const sl = s.inbound_shipment_lines.find((l) => l.id === slId)!
    return s.purchase_order_lines.find((l) => l.id === sl.purchase_order_line_id)!
  }
  const id = newId()
  const number = await nextDocumentNumber(db, 'OV', 'prefix_receipt', yearOf(input.received_date))
  await db.insert('goods_receipts', [{ id, number, shipment_id: null, transport_id: input.transport_id ?? null, received_date: input.received_date, delivery_note: input.delivery_note, received_by: input.received_by, notes: input.notes }])
  await db.insert('goods_receipt_lines', rows.map((r) => ({ id: newId(), receipt_id: id, product_id: polOf(r.shipment_line_id).product_id, ...r })))
  const moves: StockMovement[] = rows.filter((r) => r.qty_received > 0).map((r) => ({
    id: newId(), product_id: polOf(r.shipment_line_id).product_id, warehouse_id: r.warehouse_id, qty: r.qty_received,
    kind: 'ontvangst', ref_id: number, note: '', moved_at: input.received_date,
  }))
  await db.insert('stock_movements', moves)

  // Bestelde goederen koppelen aan de klantorder die erop wacht.
  for (const r of rows) {
    if (r.qty_received <= 0) continue
    const lineId = polOf(r.shipment_line_id).sales_order_line_id
    const line = lineId && s.sales_order_lines.find((l) => l.id === lineId)
    if (line && !line.warehouse_id) {
      await db.update('sales_order_lines', line.id, { warehouse_id: r.warehouse_id })
      line.warehouse_id = r.warehouse_id
      await db.insert('order_events', [event(line.sales_order_id, 'goederen', `${line.description} is binnen op ${s.warehouses.find((w) => w.id === r.warehouse_id)?.name}. Klaar om te plannen.`)])
    }
  }

  const after = await loadSnapshot(db)
  const shipmentIds = new Set(rows.map((r) => after.inbound_shipment_lines.find((l) => l.id === r.shipment_line_id)!.shipment_id))
  for (const shipmentId of shipmentIds) {
    const allIn = after.inbound_shipment_lines.filter((l) => l.shipment_id === shipmentId).every((l) => shipmentLineOpen(after, l.id) === 0)
    await db.update('inbound_shipments', shipmentId, { status: allIn ? 'received' : 'partial' })
  }
  await closeTransportIfDone(db, input.transport_id ?? null)
  return id
}

// Voorraad ---------------------------------------------------------------------

export async function transferStock(db: Driver, input: { product_id: string; from_id: string; to_id: string; qty: number; note: string; date: string }) {
  if (input.from_id === input.to_id) fail(tx("Kies twee verschillende magazijnen."))
  if (input.qty <= 0) fail(tx("Vul een aantal in."))
  const s = await loadSnapshot(db)
  const have = onHandMap(s).get(stockKey(input.product_id, input.from_id)) ?? 0
  const free = freeAt(s, input.product_id, input.from_id)
  if (input.qty > free) fail(tx("Er zijn {0} stuks vrij om te verhuizen. Van de {1} aanwezig is de rest gereserveerd voor verkooporders.", Math.max(0, free), have))
  const common = { product_id: input.product_id, kind: 'overboeking' as const, ref_id: '', note: input.note, moved_at: input.date }
  await db.insert('stock_movements', [
    { id: newId(), warehouse_id: input.from_id, qty: -input.qty, ...common },
    { id: newId(), warehouse_id: input.to_id, qty: input.qty, ...common },
  ])
}

export async function correctStock(db: Driver, input: { product_id: string; warehouse_id: string; qty: number; note: string; date: string }) {
  if (!input.qty) fail(tx("Vul een afwijking in, bijvoorbeeld -1 of 2."))
  if (!input.note.trim()) fail(tx("Noteer de reden van de correctie."))
  await db.insert('stock_movements', [{ id: newId(), product_id: input.product_id, warehouse_id: input.warehouse_id, qty: input.qty, kind: 'correctie', ref_id: '', note: input.note, moved_at: input.date }])
}

// Verkooporders ----------------------------------------------------------------

export type OrderHeader = Omit<SalesOrder, 'id' | 'number' | 'status'>
export type OrderLineInput = Omit<SalesOrderLine, 'id' | 'sales_order_id'> & { id?: string }
export interface OrderInput {
  header: OrderHeader; lines: OrderLineInput[]
  deposit?: { amount: number; method: Payment['method']; reference: string }
}

function validateOrder(s: Snapshot, input: OrderInput, opts: { checkTakeNow: boolean } = { checkTakeNow: true }) {
  const h = input.header
  if (!h.customer_id) fail(tx("Kies of maak een klant."))
  if (!h.salesperson_id) fail(tx("Kies een verkoper."))
  if (!input.lines.length) fail(tx("Voeg minimaal één product toe."))
  for (const l of input.lines) {
    if (!l.product_id || l.qty <= 0) fail(tx("Elke regel heeft een product en een aantal nodig."))
    if (l.source === 'voorraad' && !l.warehouse_id) fail(tx("Kies bij {0} uit welk magazijn het komt.", l.description))
  }
  const later = input.lines.filter((l) => !l.take_now)
  if (later.length && h.fulfilment !== 'meenemen' && !h.delivery_address.trim()) fail(tx("Vul het afleveradres in."))
  if (input.deposit && input.deposit.amount < 0) fail(tx("Een vooruitbetaling kan niet negatief zijn."))
  const total = round2(input.lines.reduce((n, l) => n + lineTotal(l), 0))
  if (input.deposit && input.deposit.amount > total) fail(tx("De vooruitbetaling is hoger dan het totaal van de verkooporder."))
  if (opts.checkTakeNow) {
    const need = new Map<string, number>()
    for (const l of input.lines.filter((x) => x.take_now)) {
      const k = stockKey(l.product_id, l.warehouse_id!)
      need.set(k, (need.get(k) ?? 0) + l.qty)
    }
    for (const [k, n] of need) {
      const [pid, wid] = k.split('|')
      const free = Math.max(0, freeAt(s, pid, wid))
      if (n > free) fail(tx("{0}: {1} om mee te nemen, maar {2} vrij in dit magazijn. Kies een ander magazijn of zet de rest op bestelling.", s.products.find((x) => x.id === pid)?.name, n, free))
    }
  }
}

export async function createOrder(db: Driver, input: OrderInput, opts: { autoDeliverDate?: string } = {}) {
  const s = await loadSnapshot(db)
  validateOrder(s, input)
  const id = newId()
  const number = await nextDocumentNumber(db, 'VO', 'prefix_sales_order', yearOf(input.header.order_date))
  const allTaken = input.lines.every((l) => l.take_now)
  await db.insert('sales_orders', [{ ...input.header, order_type: allTaken ? 'direct' : 'bestelling', fulfilment: allTaken ? 'meenemen' : input.header.fulfilment, id, number, status: 'open' }])
  const lines = input.lines.map((l) => ({ ...l, id: newId(), sales_order_id: id }))
  await db.insert('sales_order_lines', lines)
  await db.insert('order_events', [event(id, 'aangemaakt', `Verkooporder ${number} aangemaakt.`)])
  if (input.deposit?.amount) {
    await db.insert('payments', [{ id: newId(), sales_order_id: id, invoice_id: null, kind: 'vooruitbetaling', method: input.deposit.method, amount: input.deposit.amount, paid_at: input.header.order_date, reference: input.deposit.reference }])
  }
  // Wat de klant direct meeneemt, gaat meteen de deur uit. De rest volgt als deellevering.
  const taken = lines.filter((l) => l.take_now)
  if (taken.length) {
    const date = opts.autoDeliverDate ?? input.header.order_date
    const did = await createDelivery(db, { sales_order_id: id, method: 'meenemen', planned_date: date, carrier: '', notes: '', lines: taken.map((l) => ({ sales_order_line_id: l.id, qty: l.qty })) })
    await markDelivered(db, did, { date, signed_by: input.header.delivery_name || '' })
  }
  return id
}

export async function updateOrder(db: Driver, id: string, input: OrderInput) {
  const s = await loadSnapshot(db)
  validateOrder({ ...s, sales_order_lines: s.sales_order_lines.filter((l) => l.sales_order_id !== id) }, input, { checkTakeNow: false })
  const order = s.sales_orders.find((o) => o.id === id) ?? fail(tx("Verkooporder niet gevonden."))
  const existing = orderLines(s, id)
  const kept = new Set(input.lines.map((l) => l.id).filter(Boolean))
  for (const old of existing) {
    const planned = plannedQty(s, old.id)
    if (!kept.has(old.id) && planned > 0) fail(tx("{0} staat al op een levering en kan niet worden verwijderd.", old.description))
    const next = input.lines.find((l) => l.id === old.id)
    if (next && next.qty < planned) fail(tx("{0}: er staan al {1} stuks op een levering. Annuleer die levering eerst.", old.description, planned))
  }
  const changes: string[] = []
  for (const old of existing) {
    if (!kept.has(old.id)) {
      if (s.purchase_order_lines.some((l) => l.sales_order_line_id === old.id)) fail(tx("{0} is al ingekocht voor deze verkooporder en kan niet worden verwijderd.", old.description))
      await db.remove('sales_order_lines', old.id); changes.push(`${old.description} verwijderd`)
    }
  }
  for (const l of input.lines) {
    const { id: lineId, ...rest } = l
    if (lineId) {
      const old = existing.find((x) => x.id === lineId)!
      if (old.qty !== l.qty) changes.push(`${l.description}: aantal ${old.qty} naar ${l.qty}`)
      await db.update('sales_order_lines', lineId, rest)
    } else {
      await db.insert('sales_order_lines', [{ ...rest, id: newId(), sales_order_id: id }])
      changes.push(`${l.description} toegevoegd`)
    }
  }
  const prev = order as SalesOrder
  if (prev.promised_date !== input.header.promised_date && existing.every((l) => shippedQty(s, l.id) >= l.qty)) fail(tx("Alles op deze verkooporder is al geleverd. Een geleverde datum kan niet meer wijzigen."))
  const moved = prev.delivery_address !== input.header.delivery_address || prev.delivery_postal_code !== input.header.delivery_postal_code || prev.delivery_city !== input.header.delivery_city
  await db.update('sales_orders', id, moved ? { ...input.header, delivery_latitude: null, delivery_longitude: null } : input.header)
  await db.insert('order_events', [event((order as SalesOrder).id, 'gewijzigd', changes.length ? `Verkooporder gewijzigd: ${changes.join(', ')}.` : 'Gegevens van de verkooporder gewijzigd.')])
}

export async function rescheduleOrder(db: Driver, orderId: string, input: { new_date: string; reason: string; customer_notified: boolean }) {
  if (!input.new_date) fail(tx("Vul de nieuwe leverdatum in."))
  const s = await loadSnapshot(db)
  const order = s.sales_orders.find((o) => o.id === orderId) ?? fail(tx("Verkooporder niet gevonden."))
  const allDelivered = orderLines(s, orderId).every((l) => shippedQty(s, l.id) >= l.qty)
  if (allDelivered) fail(tx("Alles op deze verkooporder is al geleverd. Een geleverde datum kan niet meer wijzigen."))
  const old = (order as SalesOrder).promised_date
  await db.update('sales_orders', orderId, { promised_date: input.new_date })
  await db.insert('order_events', [event(orderId, 'leverdatum', input.reason ? `Leverdatum verschoven: ${input.reason}` : 'Leverdatum verschoven.', { old_date: old, new_date: input.new_date, customer_notified: input.customer_notified })])
  // Geplande leveringen schuiven mee; onderweg of geleverd blijft staan.
  for (const d of s.deliveries.filter((x) => x.sales_order_id === orderId && (x.status === 'planned' || x.status === 'ready'))) {
    await db.update('deliveries', d.id, { planned_date: input.new_date, route_position: null })
  }
}

export async function cancelOrder(db: Driver, id: string, reason: string) {
  const s = await loadSnapshot(db)
  if (orderLines(s, id).some((l) => shippedQty(s, l.id) > 0)) fail(tx("Er is al geleverd op deze verkooporder. Annuleren kan niet meer."))
  for (const d of s.deliveries.filter((x) => x.sales_order_id === id && x.status !== 'cancelled')) await db.update('deliveries', d.id, { status: 'cancelled' })
  await db.update('sales_orders', id, { status: 'cancelled' })
  await db.insert('order_events', [event(id, 'geannuleerd', reason ? `Verkooporder geannuleerd: ${reason}` : 'Verkooporder geannuleerd.')])
}

export async function setLineWarehouse(db: Driver, lineId: string, warehouseId: string) {
  const s = await loadSnapshot(db)
  if (plannedQty(s, lineId) > 0) fail(tx("Deze regel staat al op een levering. Annuleer die eerst om het magazijn te wijzigen."))
  await db.update('sales_order_lines', lineId, { warehouse_id: warehouseId })
}

export async function addOrderPayment(db: Driver, input: { sales_order_id: string; amount: number; method: Payment['method']; paid_at: string; reference: string }) {
  if (input.amount <= 0) fail(tx("Vul een bedrag in."))
  await db.insert('payments', [{ id: newId(), invoice_id: null, kind: 'vooruitbetaling', ...input }])
}

// Levering aan klant -----------------------------------------------------------

export interface DeliveryInput {
  sales_order_id: string; method: Delivery['method']; planned_date: string; carrier: string; notes: string
  lines: { sales_order_line_id: string; qty: number }[]
}

export async function createDelivery(db: Driver, input: DeliveryInput) {
  const s = await loadSnapshot(db)
  const rows = input.lines.filter((l) => l.qty > 0)
  if (!rows.length) fail(tx("Vul bij minimaal één regel een aantal in."))
  if (!input.planned_date) fail(tx("Kies een leverdatum."))
  const lines = rows.map((r) => {
    const line = s.sales_order_lines.find((l) => l.id === r.sales_order_line_id)!
    if (!line.warehouse_id) fail(tx("{0} is nog niet binnen en kan nog niet worden gepland.", line.description))
    const open = line.qty - plannedQty(s, line.id)
    if (r.qty > open) fail(tx("{0}: er staat nog {1} open om te plannen.", line.description, open))
    return { id: newId(), sales_order_line_id: line.id, warehouse_id: line.warehouse_id as string, qty: r.qty }
  })
  const id = newId()
  const sequence = s.deliveries.filter((d) => d.sales_order_id === input.sales_order_id).length + 1
  const number = await nextDocumentNumber(db, 'LV', 'prefix_delivery', yearOf(input.planned_date))
  await db.insert('deliveries', [{ id, number, sales_order_id: input.sales_order_id, sequence, method: input.method, planned_date: input.planned_date, carrier: input.carrier, status: 'planned', proforma_number: null, signature_data: null, signed_at: null, delivered_at: null, signed_by: '', notes: input.notes, ready_at: null, approved_by: '', note_printed_at: null, signed_note_received: false, route_position: null }])
  await db.insert('delivery_lines', lines.map((l) => ({ ...l, delivery_id: id })))
  return id
}

function assertStockForDelivery(s: Snapshot, deliveryId: string) {
  const stock = onHandMap(s)
  const need = new Map<string, number>()
  for (const l of s.delivery_lines.filter((x) => x.delivery_id === deliveryId)) {
    const product = s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)!.product_id
    const k = stockKey(product, l.warehouse_id)
    need.set(k, (need.get(k) ?? 0) + l.qty)
  }
  for (const [k, n] of need) {
    const have = stock.get(k) ?? 0
    if (n > have) {
      const [pid, wid] = k.split('|')
      fail(tx("{0}: {1} nodig, {2} aanwezig op {3}. Boek eerst voorraad over of ontvang de goederen.", s.products.find((p) => p.id === pid)?.name, n, have, s.warehouses.find((w) => w.id === wid)?.name))
    }
  }
}/** Order staat klaar en is akkoord bevonden; vanaf nu kan de afleverbon de deur uit. */

/** Order staat klaar en is akkoord bevonden; vanaf nu kan de afleverbon de deur uit. */
export async function markReady(db: Driver, id: string, input: { approved_by: string; date: string }) {
  if (!input.approved_by.trim()) fail(tx("Noteer wie de levering akkoord heeft bevonden."))
  const s = await loadSnapshot(db)
  const d = s.deliveries.find((x) => x.id === id) ?? (fail(tx("Levering niet gevonden.")) as never)
  if (d.status !== 'planned') fail(tx("Deze levering is al klaargezet."))
  assertStockForDelivery(s, id)
  await db.update('deliveries', id, { status: 'ready', ready_at: input.date, approved_by: input.approved_by })
  await db.insert('order_events', [event(d.sales_order_id, 'levering', `${d.number} klaargezet en akkoord bevonden door ${input.approved_by}.`)])
}

/** Meerdere leveringen tegelijk klaarzetten: alles of niets, eerst wordt alles gecontroleerd. */
export async function markDeliveriesReady(db: Driver, ids: string[], input: { approved_by: string; date: string }) {
  if (!ids.length) fail(tx("Selecteer minimaal één levering."))
  if (!input.approved_by.trim()) fail(tx("Noteer wie de levering akkoord heeft bevonden."))
  const s = await loadSnapshot(db)
  for (const id of ids) {
    const d = s.deliveries.find((x) => x.id === id) ?? (fail(tx("Levering niet gevonden.")) as never)
    if (d.status !== 'planned') fail(tx("Deze levering is al klaargezet."))
    assertStockForDelivery(s, id)
  }
  for (const id of ids) await markReady(db, id, input)
}

export async function markNotePrinted(db: Driver, id: string) {
  await db.update('deliveries', id, { note_printed_at: new Date().toISOString() })
}

export async function saveRouteOrder(db: Driver, deliveryIds: string[]) {
  for (let i = 0; i < deliveryIds.length; i++) await db.update('deliveries', deliveryIds[i], { route_position: i + 1 })
}

export async function setOrderCoordinates(db: Driver, orderId: string, latitude: number, longitude: number) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) fail(tx("Vul de locatie in als breedte, lengte, bijvoorbeeld 37.9113, -0.7436."))
  await db.update('sales_orders', orderId, { delivery_latitude: latitude, delivery_longitude: longitude })
}

export async function setDeliveryInTransit(db: Driver, id: string) {
  const s = await loadSnapshot(db)
  if (s.deliveries.find((x) => x.id === id)?.status !== 'ready') fail(tx("Zet de levering eerst klaar en druk de afleverbon af."))
  await db.update('deliveries', id, { status: 'in_transit' })
}

export async function rescheduleDelivery(db: Driver, id: string, input: { new_date: string; reason: string; customer_notified: boolean }) {
  if (!input.new_date) fail(tx("Vul de nieuwe datum in."))
  const s = await loadSnapshot(db)
  const d = s.deliveries.find((x) => x.id === id)!
  if (d.status === 'delivered') fail(tx("Een geleverde levering kan niet meer van datum wijzigen."))
  await db.update('deliveries', id, { planned_date: input.new_date, route_position: null })
  await db.insert('order_events', [event(d.sales_order_id, 'leverdatum', `${d.number} verschoven${input.reason ? `: ${input.reason}` : '.'}`, { old_date: d.planned_date, new_date: input.new_date, customer_notified: input.customer_notified })])
}

export async function cancelDelivery(db: Driver, id: string) {
  const s = await loadSnapshot(db)
  const d = s.deliveries.find((x) => x.id === id)!
  if (d.status === 'delivered') fail(tx("Een afgeronde levering kan niet worden geannuleerd."))
  await db.update('deliveries', id, { status: 'cancelled' })
  await db.insert('order_events', [event(d.sales_order_id, 'levering', `${d.number} geannuleerd. De artikelen kunnen opnieuw worden gepland.`)])
}

export async function markDelivered(db: Driver, id: string, input: { date: string; signed_by: string; signed_note_received?: boolean }) {
  const s = await loadSnapshot(db)
  const d = s.deliveries.find((x) => x.id === id) ?? (fail(tx("Levering niet gevonden.")) as never)
  if (d.status === 'delivered') fail(tx("Deze levering is al afgerond."))
  if (d.method !== 'meenemen') {
    if (d.status === 'planned') fail(tx("Zet de levering eerst klaar en druk de afleverbon af."))
    if (!input.signed_by.trim()) fail(tx("Noteer wie de afleverbon heeft ondertekend."))
  }
  const lines = s.delivery_lines.filter((l) => l.delivery_id === id)
  const productOf = (lineId: string) => s.sales_order_lines.find((l) => l.id === lineId)!
  assertStockForDelivery(s, id)
  await db.insert('stock_movements', lines.map((l) => ({
    id: newId(), product_id: productOf(l.sales_order_line_id).product_id, warehouse_id: l.warehouse_id, qty: -l.qty,
    kind: 'levering' as const, ref_id: d.number, note: '', moved_at: input.date,
  })))
  await db.update('deliveries', id, { status: 'delivered', delivered_at: input.date, signed_by: input.signed_by, signed_note_received: input.signed_note_received ?? false, proforma_number: await nextDocumentNumber(db, 'PF', 'prefix_proforma', yearOf(input.date)) })
  await db.insert('order_events', [event(d.sales_order_id, 'levering', `${d.number} geleverd.`)])
}

/** Digitale afleverbon: de handtekening van de klant bevestigt de levering en meldt die meteen af. */
export async function signDelivery(db: Driver, id: string, input: { signature: string; signed_by: string; date: string }) {
  if (!input.signature.startsWith('data:image/')) fail(tx("Laat de klant eerst tekenen."))
  const d = (await loadSnapshot(db)).deliveries.find((x) => x.id === id) ?? (fail(tx("Levering niet gevonden.")) as never)
  if (d.status === 'planned') fail(tx("Deze levering is nog niet klaargezet."))
  await markDelivered(db, id, { date: input.date, signed_by: input.signed_by, signed_note_received: true })
  await db.update('deliveries', id, { signature_data: input.signature, signed_at: new Date().toISOString() })
  return mailSignedNote(db, id)
}

const MAIL_TEXT: Record<Language, { subject: (n: string, c: string) => string; body: (name: string, n: string, c: string) => string }> = {
  es: { subject: (n, c) => `Albarán de entrega firmado ${n}, ${c}`, body: (name, n, c) => `Estimado/a ${name}:\n\nAdjuntamos el albarán de entrega firmado ${n}.\n\nGracias por su compra.\n\n${c}` },
  nl: { subject: (n, c) => `Getekende afleverbon ${n}, ${c}`, body: (name, n, c) => `Beste ${name},\n\nHierbij ontvangt u de getekende afleverbon ${n}.\n\nBedankt voor uw aankoop.\n\n${c}` },
  en: { subject: (n, c) => `Signed delivery note ${n}, ${c}`, body: (name, n, c) => `Dear ${name},\n\nPlease find attached the signed delivery note ${n}.\n\nThank you for your purchase.\n\n${c}` },
}
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

/** Mailt de getekende bon naar de klant met een bcc naar de winkel. Een mislukte mail maakt de levering nooit ongedaan. */
export async function mailSignedNote(db: Driver, deliveryId: string): Promise<EmailStatus> {
  const s = await loadSnapshot(db)
  const d = s.deliveries.find((x) => x.id === deliveryId) ?? (fail(tx("Levering niet gevonden.")) as never)
  const o = s.sales_orders.find((x) => x.id === d.sales_order_id)!
  const c = s.customers.find((x) => x.id === o.customer_id)!
  const co = s.settings[0]
  const to = isEmail(c.email ?? '') ? c.email.trim() : ''
  const text = MAIL_TEXT[c.language]
  const existing = s.email_outbox.find((m) => m.delivery_id === deliveryId)
  const id = existing?.id ?? newId()
  const status0: EmailStatus = to ? 'pending' : 'no_recipient'
  const fields = { to_email: to, bcc_email: co?.shop_email?.trim() ?? '', status: status0, error: to ? '' : tx("Geen e-mailadres bekend bij de klant.") }
  if (existing) await db.update('email_outbox', id, fields)
  else await db.insert('email_outbox', [{ id, kind: 'getekende_afleverbon', delivery_id: deliveryId, subject: text.subject(d.number, co?.company_name ?? ''), body_text: text.body(c.name, d.number, co?.company_name ?? ''), created_at: new Date().toISOString(), sent_at: null, ...fields }])
  if (!to) return 'no_recipient'
  try {
    const { signedNotePdf } = await import('./signedNotePdf')
    const result = await db.sendEmail(id, await signedNotePdf(s, deliveryId))
    await db.update('email_outbox', id, { status: result, error: '', sent_at: result === 'sent' ? new Date().toISOString() : null })
    return result
  } catch (e) {
    await db.update('email_outbox', id, { status: 'failed', error: e instanceof Error ? e.message : String(e) })
    return 'failed'
  }
}

/** Leveringen van voor de proforma krijgen alsnog een nummer, zodat ze aangevinkt kunnen worden. */
export async function ensureProformas(db: Driver) {
  const s = await loadSnapshot(db)
  const billed = invoicedDeliveryLineIds(s)
  for (const d of s.deliveries.filter((x) => x.status === 'delivered' && !x.proforma_number)) {
    if (s.delivery_lines.some((l) => l.delivery_id === d.id && !billed.has(l.id))) {
      await db.update('deliveries', d.id, { proforma_number: await nextDocumentNumber(db, 'PF', 'prefix_proforma', yearOf(d.delivered_at ?? d.planned_date)) })
    }
  }
}

/** Pas hier ontstaan de facturen: één per aangevinkte proforma, oudste eerst, met verrekening van vooruitbetalingen. */
export async function invoiceProformas(db: Driver, input: { delivery_ids: string[]; invoice_date: string }) {
  if (!input.delivery_ids.length) fail(tx("Vink minimaal één proforma aan."))
  const s = await loadSnapshot(db)
  const chosen = s.deliveries.filter((d) => input.delivery_ids.includes(d.id)).sort((a, b) => a.number.localeCompare(b.number))
  const ids: string[] = []
  for (const d of chosen) ids.push(await createInvoice(db, { sales_order_id: d.sales_order_id, delivery_ids: [d.id], invoice_date: input.invoice_date, settle_deposit: true }))
  return ids
}

const latestInvoiceDate = (s: Snapshot) => s.invoices.reduce((m, i) => (i.invoice_date > m ? i.invoice_date : m), '')

// Facturatie -------------------------------------------------------------------

export async function createInvoice(db: Driver, input: { sales_order_id: string; delivery_ids: string[]; invoice_date: string; settle_deposit: boolean }) {
  const s = await loadSnapshot(db)
  if (!input.delivery_ids.length) fail(tx("Kies minimaal één levering om te factureren."))
  const last = latestInvoiceDate(s)
  if (last && input.invoice_date < last) fail(tx("De factuurdatum mag niet voor de laatste factuur liggen ({0}).", last.split('-').reverse().join('-')))
  const order = s.sales_orders.find((o) => o.id === input.sales_order_id) ?? (fail(tx("Verkooporder niet gevonden.")) as never)
  const customer = s.customers.find((c) => c.id === order.customer_id)!
  const billed = invoicedDeliveryLineIds(s)
  const dls = s.delivery_lines.filter((l) => input.delivery_ids.includes(l.delivery_id) && !billed.has(l.id))
  if (!dls.length) fail(tx("Deze leveringen zijn al gefactureerd."))

  const id = newId()
  const lines: InvoiceLine[] = dls.map((dl) => {
    const l = s.sales_order_lines.find((x) => x.id === dl.sales_order_line_id)!
    return {
      id: newId(), invoice_id: id, delivery_line_id: dl.id, article_number: s.products.find((p) => p.id === l.product_id)?.sku ?? '',
      description: l.options ? `${l.description} (${l.options})` : l.description,
      qty: dl.qty, unit_price: l.unit_price, discount_pct: l.discount_pct, vat_rate: l.vat_rate,
      line_total: lineTotal({ ...l, qty: dl.qty }),
    }
  })
  const b = vatBreakdown(lines.map((l) => ({ total: l.line_total, vat_rate: l.vat_rate })))
  const deposit = input.settle_deposit ? Math.min(depositAvailable(s, order.id), b.total) : 0

  const orderQty = orderLines(s, order.id).reduce((n, l) => n + l.qty, 0)
  const billedLines = s.delivery_lines.filter((l) => billed.has(l.id))
  const billedQty = billedLines
    .filter((l) => orderLines(s, order.id).some((x) => x.id === l.sales_order_line_id))
    .reduce((n, l) => n + l.qty, 0)
  const thisQty = dls.reduce((n, l) => n + l.qty, 0)
  const kind = billedQty + thisQty >= orderQty ? (billedQty === 0 ? 'volledig' : 'eindfactuur') : 'deelfactuur'

  const number = await nextDocumentNumber(db, 'F', 'prefix_invoice', yearOf(input.invoice_date))
  await db.insert('invoices', [{
    id, number, sales_order_id: order.id, customer_id: order.customer_id, kind, invoice_date: input.invoice_date,
    due_date: addDays(input.invoice_date, s.settings[0]?.payment_days ?? 14), base_amount: b.base, vat_amount: b.vat, total: b.total,
    deposit_settled: round2(deposit), language: customer.language,
  }])
  await db.insert('invoice_lines', lines)
  await db.insert('order_events', [event(order.id, 'factuur', `Factuur ${number} gemaakt.`)])
  return id
}

export async function payInvoice(db: Driver, input: { invoice_id: string; amount: number; method: Payment['method']; paid_at: string; reference: string }) {
  if (input.amount <= 0) fail(tx("Vul een bedrag in."))
  const s = await loadSnapshot(db)
  const inv = s.invoices.find((i) => i.id === input.invoice_id)!
  await db.insert('payments', [{ id: newId(), sales_order_id: inv.sales_order_id, kind: 'betaling', ...input }])
}

// Catalogi -----------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Leest een catalogus in uit een csv-export. Bestaande artikelen worden bijgewerkt op leverancier en artikelnummer. */
export async function importCatalog(db: Driver, csv: string) {
  const rows = parseCsv(csv)
  if (!rows.length) fail(tx("Het bestand bevat geen artikelen."))
  const missing = CATALOG_COLUMNS.filter((c) => !(c in rows[0]))
  if (missing.length) fail(tx("Het bestand mist de kolom {0}. Gebruik een export van supplier_catalog_items.", missing.join(', ')))
  const suppliers = await db.list('suppliers')
  const unknown = [...new Set(rows.map((r) => r.supplier_name.trim()))].filter((n) => !suppliers.some((x) => sameName(x.name, n)))
  if (unknown.length) fail(tx("Leverancier {0} staat niet onder Beheer. Voeg die eerst toe met precies deze naam.", unknown.join(', ')))
  const current = await db.list('supplier_catalog_items')
  const byKey = new Map(current.map((x) => [`${x.supplier_name.toLowerCase()}|${x.supplier_sku.toLowerCase()}`, x.id]))
  const usedIds = new Set(current.map((x) => x.id))
  let added = 0, updated = 0
  const out = new Map<string, SupplierCatalogItem>()
  for (const r of rows) {
    if (!r.supplier_sku?.trim() || !r.name?.trim()) continue
    const item = catalogItemFromCsv(r, suppliers.find((x) => sameName(x.name, r.supplier_name)))
    const key = `${item.supplier_name.toLowerCase()}|${item.supplier_sku.toLowerCase()}`
    let id = byKey.get(key)
    if (id) updated++
    else {
      id = UUID.test(r.id ?? '') && !usedIds.has(r.id) ? r.id : newId()
      added++
    }
    byKey.set(key, id); usedIds.add(id)
    out.set(id, { ...item, id })
  }
  if (!out.size) fail(tx("Het bestand bevat geen artikelen."))
  await db.upsert('supplier_catalog_items', [...out.values()])
  return { added, updated }
}

// Stamgegevens -----------------------------------------------------------------

export async function saveRecord<T extends TableName>(db: Driver, table: T, row: Snapshot[T][number] & { id?: string }) {
  if (row.id) {
    const { id, ...patch } = row
    await db.update(table, id, patch as never)
    return id
  }
  const id = newId()
  await db.insert(table, [{ ...row, id } as never])
  return id
}

/** Verkoop stuurt de inkoop: wat niet vrij op voorraad is, wordt een regel op bestelling. */
export function splitLinesForStock(s: Snapshot, lines: OrderLineInput[]): OrderLineInput[] {
  const used = new Map<string, number>()
  return lines.flatMap((l) => {
    if (l.source !== 'voorraad' || !l.warehouse_id) return [l]
    const k = stockKey(l.product_id, l.warehouse_id)
    if (l.take_now) { used.set(k, (used.get(k) ?? 0) + l.qty); return [l] }
    const free = Math.max(0, freeAt(s, l.product_id, l.warehouse_id) - (used.get(k) ?? 0))
    const fromStock = Math.min(free, l.qty)
    used.set(k, (used.get(k) ?? 0) + fromStock)
    if (fromStock === l.qty) return [l]
    const onOrder: OrderLineInput = { ...l, qty: l.qty - fromStock, source: 'bestelling', warehouse_id: null }
    return fromStock > 0 ? [{ ...l, qty: fromStock }, onOrder] : [onOrder]
  })
}

export function lineFromProduct(p: Product, overrides: Partial<OrderLineInput> = {}): OrderLineInput {
  return {
    product_id: p.id, description: p.name, options: '', qty: 1, unit_price: p.sale_price, discount_pct: 0,
    vat_rate: p.vat_rate, source: 'voorraad', warehouse_id: null, take_now: false, ...overrides,
  }
}

export const defaultMethod = (f: Fulfilment): Delivery['method'] =>
  f === 'meenemen' ? 'meenemen' : f === 'verzenden' ? 'vervoerder' : 'eigen_team'

export { todayISO }
export type { OrderType }
