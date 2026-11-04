// Alle handelingen in het proces. Elke functie controleert eerst en schrijft daarna,
// zodat een geweigerde actie niets half achterlaat.
import { loadSnapshot, newId, type Driver } from '../data/driver'
import type {
  Delivery, Fulfilment, InboundShipment, InvoiceLine, OrderType, Payment, Product, SalesOrder,
  SalesOrderLine, Snapshot, StockMovement, TableName,
} from '../data/types'
import {
  addDays, depositAvailable, invoicedDeliveryLineIds, lineTotal, onHandMap, orderLines, plannedQty, round2,
  shipmentLineOpen, shippedQty, stockKey, todayISO, vatBreakdown,
} from './calc'

export class FlowError extends Error {}
const fail = (m: string): never => { throw new FlowError(m) }
const yearOf = (iso: string) => Number(iso.slice(0, 4))
const event = (sales_order_id: string, kind: string, message: string, extra: Partial<{ old_date: string | null; new_date: string | null; customer_notified: boolean }> = {}) => ({
  id: newId(), sales_order_id, kind, message, old_date: null, new_date: null, customer_notified: false,
  created_at: new Date().toISOString(), ...extra,
})

// Inkoop -----------------------------------------------------------------------

export interface PurchaseInput {
  supplier_id: string; order_date: string; supplier_reference: string; notes: string
  lines: { product_id: string; qty: number; unit_cost: number; sales_order_line_id: string | null }[]
  shipments: { expected_date: string; warehouse_id: string; carrier: string; pct: number }[]
}

/** Verdeelt elke regel over de zendingen volgens percentage; afronding telt altijd op tot het totaal. */
export function splitQty(qty: number, pcts: number[]) {
  const sum = pcts.reduce((a, b) => a + b, 0)
  let cumPct = 0, done = 0
  return pcts.map((p, i) => {
    cumPct += p
    const upto = i === pcts.length - 1 ? qty : Math.ceil((qty * cumPct) / sum)
    const n = upto - done
    done = upto
    return n
  })
}

export async function createPurchaseOrder(db: Driver, input: PurchaseInput) {
  if (!input.supplier_id) fail('Kies een leverancier.')
  if (!input.lines.length || input.lines.some((l) => !l.product_id || l.qty <= 0)) fail('Voeg minimaal één regel toe met product en aantal.')
  if (!input.shipments.length) fail('Plan minimaal één zending.')
  if (input.shipments.some((x) => !x.expected_date || !x.warehouse_id)) fail('Vul per zending een datum en een magazijn in.')
  if (Math.round(input.shipments.reduce((n, x) => n + x.pct, 0)) !== 100) fail('De percentages van de zendingen moeten samen 100% zijn.')

  const id = newId()
  const number = await db.nextNumber('IO', yearOf(input.order_date))
  await db.insert('purchase_orders', [{ id, number, supplier_id: input.supplier_id, order_date: input.order_date, supplier_reference: input.supplier_reference, notes: input.notes, status: 'open' }])
  const lines = input.lines.map((l) => ({ id: newId(), purchase_order_id: id, ...l }))
  await db.insert('purchase_order_lines', lines)

  const pcts = input.shipments.map((x) => x.pct)
  const perLine = lines.map((l) => splitQty(l.qty, pcts))
  let seq = 0
  for (let i = 0; i < input.shipments.length; i++) {
    const x = input.shipments[i]
    const shipLines = lines.map((l, li) => ({ pol: l.id, qty: perLine[li][i] })).filter((r) => r.qty > 0)
    if (!shipLines.length) continue
    seq += 1
    const sid = newId()
    await db.insert('inbound_shipments', [{ id: sid, purchase_order_id: id, sequence: seq, expected_date: x.expected_date, original_date: x.expected_date, warehouse_id: x.warehouse_id, carrier: x.carrier, status: 'expected', notes: '' }])
    await db.insert('inbound_shipment_lines', shipLines.map((r) => ({ id: newId(), shipment_id: sid, purchase_order_line_id: r.pol, qty: r.qty })))
  }
  return id
}

export async function rescheduleShipment(db: Driver, shipmentId: string, newDate: string, reason: string) {
  if (!newDate) fail('Vul de nieuwe datum in.')
  const s = await loadSnapshot(db)
  const x = s.inbound_shipments.find((r) => r.id === shipmentId) ?? fail('Zending niet gevonden.')
  await db.update('inbound_shipments', shipmentId, { expected_date: newDate, notes: reason || (x as InboundShipment).notes })
}

export async function closeShipment(db: Driver, shipmentId: string, reason: string) {
  await db.update('inbound_shipments', shipmentId, { status: 'closed', notes: reason })
}

export async function cancelPurchaseOrder(db: Driver, id: string) {
  const s = await loadSnapshot(db)
  const shipments = s.inbound_shipments.filter((x) => x.purchase_order_id === id)
  if (s.goods_receipts.some((r) => shipments.some((x) => x.id === r.shipment_id))) fail('Deze inkooporder heeft al ontvangsten. Sluit de openstaande zendingen af.')
  await db.update('purchase_orders', id, { status: 'cancelled' })
  for (const x of shipments) await db.update('inbound_shipments', x.id, { status: 'closed' })
}

// Goederenontvangst ------------------------------------------------------------

export interface ReceiptRow { shipment_line_id: string; warehouse_id: string; qty_received: number; qty_damaged: number; location_bin: string }
export interface ReceiptInput { shipment_id: string; received_date: string; delivery_note: string; received_by: string; notes: string; rows: ReceiptRow[] }

export async function receiveGoods(db: Driver, input: ReceiptInput) {
  const s = await loadSnapshot(db)
  const rows = input.rows.filter((r) => r.qty_received > 0 || r.qty_damaged > 0)
  if (!rows.length) fail('Vul bij minimaal één regel een ontvangen aantal in.')
  if (rows.some((r) => !r.warehouse_id)) fail('Kies per regel het magazijn waar de goederen binnenkomen.')
  const perLine = new Map<string, number>()
  for (const r of rows) perLine.set(r.shipment_line_id, (perLine.get(r.shipment_line_id) ?? 0) + r.qty_received)
  for (const [lineId, n] of perLine) {
    const open = shipmentLineOpen(s, lineId)
    if (n > open) fail(`Er staat nog ${open} open op deze regel, maar er is ${n} ingevuld. Corrigeer het aantal of verdeel de rest over een andere zending.`)
  }
  const polOf = (slId: string) => {
    const sl = s.inbound_shipment_lines.find((l) => l.id === slId)!
    return s.purchase_order_lines.find((l) => l.id === sl.purchase_order_line_id)!
  }
  const id = newId()
  const number = await db.nextNumber('OV', yearOf(input.received_date))
  await db.insert('goods_receipts', [{ id, number, shipment_id: input.shipment_id, received_date: input.received_date, delivery_note: input.delivery_note, received_by: input.received_by, notes: input.notes }])
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
  const shipLines = after.inbound_shipment_lines.filter((l) => l.shipment_id === input.shipment_id)
  const allIn = shipLines.every((l) => shipmentLineOpen(after, l.id) === 0)
  await db.update('inbound_shipments', input.shipment_id, { status: allIn ? 'received' : 'partial' })
  return id
}

// Voorraad ---------------------------------------------------------------------

export async function transferStock(db: Driver, input: { product_id: string; from_id: string; to_id: string; qty: number; note: string; date: string }) {
  if (input.from_id === input.to_id) fail('Kies twee verschillende magazijnen.')
  if (input.qty <= 0) fail('Vul een aantal in.')
  const s = await loadSnapshot(db)
  const have = onHandMap(s).get(stockKey(input.product_id, input.from_id)) ?? 0
  if (input.qty > have) fail(`Er liggen maar ${have} stuks in het gekozen magazijn.`)
  const common = { product_id: input.product_id, kind: 'overboeking' as const, ref_id: '', note: input.note, moved_at: input.date }
  await db.insert('stock_movements', [
    { id: newId(), warehouse_id: input.from_id, qty: -input.qty, ...common },
    { id: newId(), warehouse_id: input.to_id, qty: input.qty, ...common },
  ])
}

export async function correctStock(db: Driver, input: { product_id: string; warehouse_id: string; qty: number; note: string; date: string }) {
  if (!input.qty) fail('Vul een afwijking in, bijvoorbeeld -1 of 2.')
  if (!input.note.trim()) fail('Noteer de reden van de correctie.')
  await db.insert('stock_movements', [{ id: newId(), product_id: input.product_id, warehouse_id: input.warehouse_id, qty: input.qty, kind: 'correctie', ref_id: '', note: input.note, moved_at: input.date }])
}

// Verkooporders ----------------------------------------------------------------

export type OrderHeader = Omit<SalesOrder, 'id' | 'number' | 'status'>
export type OrderLineInput = Omit<SalesOrderLine, 'id' | 'sales_order_id'> & { id?: string }
export interface OrderInput {
  header: OrderHeader; lines: OrderLineInput[]
  deposit?: { amount: number; method: Payment['method']; reference: string }
}

function validateOrder(s: Snapshot, input: OrderInput) {
  const h = input.header
  if (!h.customer_id) fail('Kies of maak een klant.')
  if (!input.lines.length) fail('Voeg minimaal één product toe.')
  for (const l of input.lines) {
    if (!l.product_id || l.qty <= 0) fail('Elke regel heeft een product en een aantal nodig.')
    if (l.source === 'voorraad' && !l.warehouse_id) fail(`Kies bij ${l.description} uit welk magazijn het komt.`)
  }
  if (h.order_type === 'direct' && input.lines.some((l) => l.source === 'bestelling')) fail('Directe levering kan alleen uit voorraad. Kies "Bestelling" voor producten die nog binnen moeten komen.')
  if (h.fulfilment !== 'meenemen' && !h.delivery_address.trim()) fail('Vul het afleveradres in.')
  if (input.deposit && input.deposit.amount < 0) fail('Een vooruitbetaling kan niet negatief zijn.')
  const total = round2(input.lines.reduce((n, l) => n + lineTotal(l), 0))
  if (input.deposit && input.deposit.amount > total) fail('De vooruitbetaling is hoger dan het ordertotaal.')
  if (h.order_type === 'direct') {
    const need = new Map<string, number>()
    for (const l of input.lines) {
      const k = stockKey(l.product_id, l.warehouse_id!)
      need.set(k, (need.get(k) ?? 0) + l.qty)
    }
    const stock = onHandMap(s)
    for (const [k, n] of need) {
      const have = stock.get(k) ?? 0
      if (n > have) {
        const p = s.products.find((x) => x.id === k.split('|')[0])
        fail(`${p?.name}: ${n} nodig, ${have} aanwezig in dit magazijn. Kies een ander magazijn of maak er een bestelling van.`)
      }
    }
  }
}

export async function createOrder(db: Driver, input: OrderInput, opts: { autoDeliverDate?: string } = {}) {
  const s = await loadSnapshot(db)
  validateOrder(s, input)
  const id = newId()
  const number = await db.nextNumber('VO', yearOf(input.header.order_date))
  await db.insert('sales_orders', [{ ...input.header, id, number, status: 'open' }])
  const lines = input.lines.map((l) => ({ ...l, id: newId(), sales_order_id: id }))
  await db.insert('sales_order_lines', lines)
  await db.insert('order_events', [event(id, 'aangemaakt', `Order ${number} aangemaakt.`)])
  if (input.deposit?.amount) {
    await db.insert('payments', [{ id: newId(), sales_order_id: id, invoice_id: null, kind: 'vooruitbetaling', method: input.deposit.method, amount: input.deposit.amount, paid_at: input.header.order_date, reference: input.deposit.reference }])
  }
  // Optie A met meenemen: de klant loopt er meteen mee de winkel uit.
  if (input.header.order_type === 'direct' && input.header.fulfilment === 'meenemen') {
    const date = opts.autoDeliverDate ?? input.header.order_date
    const did = await createDelivery(db, { sales_order_id: id, method: 'meenemen', planned_date: date, time_slot: '', carrier: '', notes: '', lines: lines.map((l) => ({ sales_order_line_id: l.id, qty: l.qty })) })
    await markDelivered(db, did, { date, signed_by: input.header.delivery_name || '' })
  }
  return id
}

export async function updateOrder(db: Driver, id: string, input: OrderInput) {
  const s = await loadSnapshot(db)
  validateOrder({ ...s, sales_order_lines: s.sales_order_lines.filter((l) => l.sales_order_id !== id) }, { ...input, header: { ...input.header, order_type: 'bestelling' } })
  const order = s.sales_orders.find((o) => o.id === id) ?? fail('Order niet gevonden.')
  const existing = orderLines(s, id)
  const kept = new Set(input.lines.map((l) => l.id).filter(Boolean))
  for (const old of existing) {
    const planned = plannedQty(s, old.id)
    if (!kept.has(old.id) && planned > 0) fail(`${old.description} staat al op een levering en kan niet worden verwijderd.`)
    const next = input.lines.find((l) => l.id === old.id)
    if (next && next.qty < planned) fail(`${old.description}: er staan al ${planned} stuks op een levering. Annuleer die levering eerst.`)
  }
  const changes: string[] = []
  for (const old of existing) {
    if (!kept.has(old.id)) {
      if (s.purchase_order_lines.some((l) => l.sales_order_line_id === old.id)) fail(`${old.description} is al ingekocht voor deze order en kan niet worden verwijderd.`)
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
  await db.update('sales_orders', id, input.header)
  await db.insert('order_events', [event((order as SalesOrder).id, 'gewijzigd', changes.length ? `Order gewijzigd: ${changes.join(', ')}.` : 'Ordergegevens gewijzigd.')])
}

export async function rescheduleOrder(db: Driver, orderId: string, input: { new_date: string; reason: string; customer_notified: boolean }) {
  if (!input.new_date) fail('Vul de nieuwe leverdatum in.')
  const s = await loadSnapshot(db)
  const order = s.sales_orders.find((o) => o.id === orderId) ?? fail('Order niet gevonden.')
  const old = (order as SalesOrder).promised_date
  await db.update('sales_orders', orderId, { promised_date: input.new_date })
  await db.insert('order_events', [event(orderId, 'leverdatum', input.reason ? `Leverdatum verschoven: ${input.reason}` : 'Leverdatum verschoven.', { old_date: old, new_date: input.new_date, customer_notified: input.customer_notified })])
  // Geplande leveringen schuiven mee; onderweg of geleverd blijft staan.
  for (const d of s.deliveries.filter((x) => x.sales_order_id === orderId && x.status === 'planned')) {
    await db.update('deliveries', d.id, { planned_date: input.new_date })
  }
}

export async function cancelOrder(db: Driver, id: string, reason: string) {
  const s = await loadSnapshot(db)
  if (orderLines(s, id).some((l) => shippedQty(s, l.id) > 0)) fail('Er is al geleverd op deze order. Annuleren kan niet meer.')
  for (const d of s.deliveries.filter((x) => x.sales_order_id === id && x.status !== 'cancelled')) await db.update('deliveries', d.id, { status: 'cancelled' })
  await db.update('sales_orders', id, { status: 'cancelled' })
  await db.insert('order_events', [event(id, 'geannuleerd', reason ? `Order geannuleerd: ${reason}` : 'Order geannuleerd.')])
}

export async function setLineWarehouse(db: Driver, lineId: string, warehouseId: string) {
  const s = await loadSnapshot(db)
  if (plannedQty(s, lineId) > 0) fail('Deze regel staat al op een levering. Annuleer die eerst om het magazijn te wijzigen.')
  await db.update('sales_order_lines', lineId, { warehouse_id: warehouseId })
}

export async function addOrderPayment(db: Driver, input: { sales_order_id: string; amount: number; method: Payment['method']; paid_at: string; reference: string }) {
  if (input.amount <= 0) fail('Vul een bedrag in.')
  await db.insert('payments', [{ id: newId(), invoice_id: null, kind: 'vooruitbetaling', ...input }])
}

// Levering aan klant -----------------------------------------------------------

export interface DeliveryInput {
  sales_order_id: string; method: Delivery['method']; planned_date: string; time_slot: string; carrier: string; notes: string
  lines: { sales_order_line_id: string; qty: number }[]
}

export async function createDelivery(db: Driver, input: DeliveryInput) {
  const s = await loadSnapshot(db)
  const rows = input.lines.filter((l) => l.qty > 0)
  if (!rows.length) fail('Vul bij minimaal één regel een aantal in.')
  if (!input.planned_date) fail('Kies een leverdatum.')
  const lines = rows.map((r) => {
    const line = s.sales_order_lines.find((l) => l.id === r.sales_order_line_id)!
    if (!line.warehouse_id) fail(`${line.description} is nog niet binnen en kan nog niet worden gepland.`)
    const open = line.qty - plannedQty(s, line.id)
    if (r.qty > open) fail(`${line.description}: er staat nog ${open} open om te plannen.`)
    return { id: newId(), sales_order_line_id: line.id, warehouse_id: line.warehouse_id as string, qty: r.qty }
  })
  const id = newId()
  const sequence = s.deliveries.filter((d) => d.sales_order_id === input.sales_order_id).length + 1
  const number = await db.nextNumber('LV', yearOf(input.planned_date))
  await db.insert('deliveries', [{ id, number, sales_order_id: input.sales_order_id, sequence, method: input.method, planned_date: input.planned_date, time_slot: input.time_slot, carrier: input.carrier, status: 'planned', delivered_at: null, signed_by: '', notes: input.notes }])
  await db.insert('delivery_lines', lines.map((l) => ({ ...l, delivery_id: id })))
  return id
}

export async function setDeliveryInTransit(db: Driver, id: string) {
  await db.update('deliveries', id, { status: 'in_transit' })
}

export async function rescheduleDelivery(db: Driver, id: string, input: { new_date: string; reason: string; customer_notified: boolean }) {
  if (!input.new_date) fail('Vul de nieuwe datum in.')
  const s = await loadSnapshot(db)
  const d = s.deliveries.find((x) => x.id === id)!
  await db.update('deliveries', id, { planned_date: input.new_date })
  await db.insert('order_events', [event(d.sales_order_id, 'leverdatum', `${d.number} verschoven${input.reason ? `: ${input.reason}` : '.'}`, { old_date: d.planned_date, new_date: input.new_date, customer_notified: input.customer_notified })])
}

export async function cancelDelivery(db: Driver, id: string) {
  const s = await loadSnapshot(db)
  const d = s.deliveries.find((x) => x.id === id)!
  if (d.status === 'delivered') fail('Een afgeronde levering kan niet worden geannuleerd.')
  await db.update('deliveries', id, { status: 'cancelled' })
  await db.insert('order_events', [event(d.sales_order_id, 'levering', `${d.number} geannuleerd. De artikelen kunnen opnieuw worden gepland.`)])
}

export async function markDelivered(db: Driver, id: string, input: { date: string; signed_by: string }) {
  const s = await loadSnapshot(db)
  const d = s.deliveries.find((x) => x.id === id) ?? (fail('Levering niet gevonden.') as never)
  if (d.status === 'delivered') fail('Deze levering is al afgerond.')
  const lines = s.delivery_lines.filter((l) => l.delivery_id === id)
  const stock = onHandMap(s)
  const need = new Map<string, number>()
  const productOf = (lineId: string) => s.sales_order_lines.find((l) => l.id === lineId)!
  for (const l of lines) {
    const k = stockKey(productOf(l.sales_order_line_id).product_id, l.warehouse_id)
    need.set(k, (need.get(k) ?? 0) + l.qty)
  }
  for (const [k, n] of need) {
    const have = stock.get(k) ?? 0
    if (n > have) {
      const [pid, wid] = k.split('|')
      fail(`${s.products.find((p) => p.id === pid)?.name}: ${n} nodig, ${have} aanwezig op ${s.warehouses.find((w) => w.id === wid)?.name}. Boek eerst voorraad over of ontvang de goederen.`)
    }
  }
  await db.insert('stock_movements', lines.map((l) => ({
    id: newId(), product_id: productOf(l.sales_order_line_id).product_id, warehouse_id: l.warehouse_id, qty: -l.qty,
    kind: 'levering' as const, ref_id: d.number, note: '', moved_at: input.date,
  })))
  await db.update('deliveries', id, { status: 'delivered', delivered_at: input.date, signed_by: input.signed_by })
  await db.insert('order_events', [event(d.sales_order_id, 'levering', `${d.number} geleverd.`)])
  if (s.settings[0]?.invoice_mode === 'auto') {
    await createInvoice(db, { sales_order_id: d.sales_order_id, delivery_ids: [id], invoice_date: laterOf(input.date, latestInvoiceDate(s)), settle_deposit: true })
  }
}

const latestInvoiceDate = (s: Snapshot) => s.invoices.reduce((m, i) => (i.invoice_date > m ? i.invoice_date : m), '')
const laterOf = (a: string, b: string) => (a > b ? a : b)

// Facturatie -------------------------------------------------------------------

export async function createInvoice(db: Driver, input: { sales_order_id: string; delivery_ids: string[]; invoice_date: string; settle_deposit: boolean }) {
  const s = await loadSnapshot(db)
  if (!input.delivery_ids.length) fail('Kies minimaal één levering om te factureren.')
  const last = latestInvoiceDate(s)
  if (last && input.invoice_date < last) fail(`De factuurdatum mag niet voor de laatste factuur liggen (${last.split('-').reverse().join('-')}).`)
  const order = s.sales_orders.find((o) => o.id === input.sales_order_id) ?? (fail('Order niet gevonden.') as never)
  const customer = s.customers.find((c) => c.id === order.customer_id)!
  const billed = invoicedDeliveryLineIds(s)
  const dls = s.delivery_lines.filter((l) => input.delivery_ids.includes(l.delivery_id) && !billed.has(l.id))
  if (!dls.length) fail('Deze leveringen zijn al gefactureerd.')

  const id = newId()
  const lines: InvoiceLine[] = dls.map((dl) => {
    const l = s.sales_order_lines.find((x) => x.id === dl.sales_order_line_id)!
    return {
      id: newId(), invoice_id: id, delivery_line_id: dl.id,
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

  const number = await db.nextNumber('F', yearOf(input.invoice_date))
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
  if (input.amount <= 0) fail('Vul een bedrag in.')
  const s = await loadSnapshot(db)
  const inv = s.invoices.find((i) => i.id === input.invoice_id)!
  await db.insert('payments', [{ id: newId(), sales_order_id: inv.sales_order_id, kind: 'betaling', ...input }])
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

export function lineFromProduct(p: Product, overrides: Partial<OrderLineInput> = {}): OrderLineInput {
  return {
    product_id: p.id, description: p.name, options: '', qty: 1, unit_price: p.sale_price, discount_pct: 0,
    vat_rate: p.vat_rate, source: 'voorraad', warehouse_id: null, ...overrides,
  }
}

export const defaultMethod = (f: Fulfilment): Delivery['method'] =>
  f === 'meenemen' ? 'meenemen' : f === 'verzenden' ? 'vervoerder' : 'eigen_team'

export { todayISO }
export type { OrderType }
