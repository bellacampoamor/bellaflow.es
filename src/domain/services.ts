import { tx } from '../i18n'
// Alle handelingen in het proces. Elke functie controleert eerst en schrijft daarna,
// zodat een geweigerde actie niets half achterlaat.
import { loadSnapshot, newId, type Driver } from '../data/driver'
import type {
  EmailStatus, Language,
  Delivery, Fulfilment, InboundShipment, InvoiceLine, OrderType, Payment, Product, PurchaseLabel, SalesOrder, Settings,
  SalesOrderLine, Salesperson, Snapshot, StockMovement, CatalogArticle, Supplier, ArticleQuery, SupplierShowroomDetail, SupplierShowroomItem, TableName,
} from '../data/types'
import { parseCsv, sameName } from './catalog'
import { articleNumberFromScan } from './scan'
import { INVOICE_MAIL, SALES_ORDER_MAIL } from './noteText'
import { mailsAutomatically } from './mailSettings'
import { isStaffRole } from './staff'
import { ISSUER_SERIES, issuerOf, type Issuer } from './issuers'
import { creditableAmount, creditableLines, creditSeries, creditSettlement, isCredit } from './credit'
import { cashCount, closingOn, closingsOf, countedTotal, DENOMINATIONS, denomKey, kassaDay, openingFloat, type CashCounts } from './cashClosing'
import { DUMMY_SKU, missingCustomerData, POS_CUSTOMER_NOTE, posShortfalls, posTotals, posWarehouse, SIMPLIFIED_LIMIT, type PosLine } from './pos'
import { isSendable, PURCHASE_MAIL, purchaseJsonFileName, purchaseOrdersJson, toBase64 } from './purchaseExport'
import { articleSources, categoryName, priceWithSurcharge, finishArticleSync, missingSupplierCodes, planArticleSync } from './articles'
import { DETAIL_COLUMNS, SHOWROOM_COLUMNS, showroomDetailFromCsv, showroomItemFromCsv } from './showroom'
import {
  addDays, depositAvailable, freeAt, invoiceBalance, linesToPurchase, invoicedDeliveryLineIds, lineTotal, onHandMap, orderLines, plannedQty, round2,
  shipmentLineOpen, shippedQty, stockKey, todayISO, vatBreakdown,
  inboundWarehouse, scanWarehouse, shipmentIsOpen, defaultReceiptWarehouse, isDomesticShipment,
} from './calc'

export class FlowError extends Error {}
const fail = (m: string): never => { throw new FlowError(m) }
const yearOf = (iso: string) => Number(iso.slice(0, 4))
const event = (sales_order_id: string, kind: string, message: string, extra: Partial<{ old_date: string | null; new_date: string | null; customer_notified: boolean }> = {}) => ({
  id: newId(), sales_order_id, kind, message, old_date: null, new_date: null, customer_notified: false,
  created_at: new Date().toISOString(), ...extra,
})

// Nummering ----------------------------------------------------------------------

export type PrefixField = 'prefix_sales_order' | 'prefix_purchase' | 'prefix_receipt' | 'prefix_delivery' | 'prefix_invoice' | 'prefix_transport' | 'prefix_proforma' | 'prefix_invoice_simplified' | 'prefix_invoice_simplified_hdb'
  | 'prefix_invoice_credit' | 'prefix_invoice_credit_simplified' | 'prefix_invoice_credit_simplified_hdb'
export const PREFIX_FIELDS: PrefixField[] = ['prefix_sales_order', 'prefix_purchase', 'prefix_receipt', 'prefix_delivery', 'prefix_invoice', 'prefix_transport', 'prefix_proforma', 'prefix_invoice_simplified', 'prefix_invoice_simplified_hdb', 'prefix_invoice_credit', 'prefix_invoice_credit_simplified', 'prefix_invoice_credit_simplified_hdb']

/** De teller hoort bij de soort document, dus een ander voorvoegsel laat de nummers gewoon doorlopen. */
async function nextDocumentNumber(db: Driver, series: string, field: PrefixField, year: number, fallback = series) {
  const seq = (await db.nextNumber(series, year)).split('-').pop()
  const prefix = (await db.list('settings'))[0]?.[field] || fallback
  return `${prefix}-${year}-${seq}`
}

export async function saveSettings(db: Driver, patch: Partial<Settings>) {
  for (const field of PREFIX_FIELDS) {
    // Letters en cijfers, met streepjes ertussen (FS-BELLA, FS-HDB), maximaal 12 tekens.
    const v = patch[field] as string | undefined
    if (v !== undefined && !(v.length <= 12 && /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(v))) fail(tx("Een voorvoegsel bestaat uit maximaal 12 letters of cijfers, zonder spaties; een streepje mag ertussen (zoals FS-BELLA)."))
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
  const transports = await db.list('transports')
  const supplier = (await db.list('suppliers')).find((x) => x.id === input.supplier_id)
  // Regels voor een klant maken het altijd een verkoop-inkoop; anders volgt het label de keuze of de bestemming.
  const given = warehouses.find((w) => w.id === input.warehouse_id)
  const label: PurchaseLabel = input.lines.some((l) => l.sales_order_line_id) ? 'verkoop' : input.label ?? (given?.kind === 'winkel' ? 'showroom' : 'magazijn')
  // Voorgestelde locatie bij ontvangst: de showroom voor label Showroom, anders het magazijn waar de route start. Bij inboeken te wijzigen.
  const warehouseId = input.warehouse_id ?? defaultReceiptWarehouse(warehouses, label)?.id
  if (!warehouseId) fail(tx("Stel onder Instellingen een actief magazijn in waar de route start."))
  // Regels voor een verkooporder: nooit meer inkopen dan nog nodig is, en alleen bij de leverancier van het artikel.
  const snap = await loadSnapshot(db)
  const open = linesToPurchase(snap)
  const asked = new Map<string, number>()
  for (const l of input.lines.filter((x) => x.sales_order_line_id)) asked.set(l.sales_order_line_id!, (asked.get(l.sales_order_line_id!) ?? 0) + l.qty)
  for (const [lineId, qty] of asked) {
    const need = open.find((x) => x.id === lineId)
    if (!need) fail(tx("Een regel van een verkooporder is al ingekocht. Ververs het overzicht."))
    if (qty > need!.qty) fail(tx("{0}: {1} gevraagd, maar nog {2} in te kopen voor deze verkooporder.", need!.description, qty, need!.qty))
    const own = snap.products.find((p) => p.id === need!.product_id)?.supplier_id
    if (own && own !== input.supplier_id) fail(tx("{0} hoort bij een andere leverancier.", need!.description))
  }
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
    await db.insert('inbound_shipments', [{ id: sid, purchase_order_id: id, sequence, expected_date: expected, original_date: expected, warehouse_id: (warehouse_id ?? warehouseId)!, carrier: transport?.carrier ?? '', status: 'expected', notes: '', transport_id: transport?.id ?? null, nl_received_at: transport ? input.order_date : null }])
    await db.insert('inbound_shipment_lines', [{ id: newId(), shipment_id: sid, purchase_order_line_id: polId, qty: line.qty }])
  }
  // Wat nu definitief is ingekocht, verdwijnt van de proforma.
  if (asked.size) await syncPurchaseProformas(db)
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

// Proforma-inkooporders -----------------------------------------------------------
// Wat een verkooporder op bestelling zet, komt vanzelf op een proforma-inkooporder: één per verkooporder en leverancier,
// met een tijdelijk nummer (PIO-). Pas bij omzetten ontstaat de definitieve inkooporder met een IO-nummer.
// Een proforma volgt de verkooporder: wijzigt of vervalt de behoefte, dan wijzigt of vervalt de proforma mee.

/** Brengt de proforma-inkooporders in lijn met wat de verkooporders nog nodig hebben. */
export async function syncPurchaseProformas(db: Driver) {
  const s = await loadSnapshot(db)
  const need = new Map<string, { line: SalesOrderLine; qty: number; supplier_id: string }>()
  for (const l of linesToPurchase(s)) {
    // Zonder leverancier op het artikel kan er geen proforma komen; de regel blijft zichtbaar als Inkoop zonder leverancier.
    const supplier_id = s.products.find((p) => p.id === l.product_id)?.supplier_id
    if (supplier_id) need.set(l.id, { line: l, qty: l.qty, supplier_id })
  }
  const proformas = s.purchase_orders.filter((p) => p.status === 'proforma')
  const handled = new Set<string>()
  for (const pol of s.purchase_order_lines.filter((l) => proformas.some((p) => p.id === l.purchase_order_id))) {
    const n = pol.sales_order_line_id ? need.get(pol.sales_order_line_id) : undefined
    const po = proformas.find((p) => p.id === pol.purchase_order_id)!
    if (!n || n.supplier_id !== po.supplier_id || handled.has(pol.sales_order_line_id!)) { await db.remove('purchase_order_lines', pol.id); continue }
    handled.add(pol.sales_order_line_id!)
    if (pol.qty !== n.qty || pol.product_id !== n.line.product_id) await db.update('purchase_order_lines', pol.id, { qty: n.qty, product_id: n.line.product_id })
  }
  const kept = (await db.list('purchase_order_lines'))
  for (const n of need.values()) {
    if (handled.has(n.line.id)) continue
    const order = s.sales_orders.find((o) => o.id === n.line.sales_order_id)!
    let po = proformas.find((p) => p.supplier_id === n.supplier_id && kept.some((l) => l.purchase_order_id === p.id && s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)?.sales_order_id === order.id))
    if (!po) {
      po = { id: newId(), number: await db.nextNumber('PIO', yearOf(order.order_date)), supplier_id: n.supplier_id, order_date: order.order_date, supplier_reference: '', notes: '', status: 'proforma', label: 'verkoop' }
      await db.insert('purchase_orders', [po])
      proformas.push(po)
    }
    const row = { id: newId(), purchase_order_id: po.id, product_id: n.line.product_id, qty: n.qty, unit_cost: s.products.find((p) => p.id === n.line.product_id)?.purchase_price ?? 0, sales_order_line_id: n.line.id }
    await db.insert('purchase_order_lines', [row])
    kept.push(row)
  }
  // Een lege proforma heeft geen betekenis meer.
  const left = await db.list('purchase_order_lines')
  for (const p of proformas) if (!left.some((l) => l.purchase_order_id === p.id)) await db.remove('purchase_orders', p.id)
}

/**
 * Zet proforma-inkooporders om naar definitieve inkooporders (besluit Rick 7 november 2026: per verkooporder, niet gebundeld).
 * Elke proforma (één verkooporder, één leverancier) wordt één inkooporder met een IO-nummer.
 */
export async function convertPurchaseProformas(db: Driver, input: { ids: string[]; order_date: string; supplier_reference?: string }) {
  if (!input.ids.length) fail(tx("Selecteer minimaal één proforma-inkooporder."))
  if (!input.order_date) fail(tx("Vul de besteldatum in."))
  await syncPurchaseProformas(db)
  const s = await loadSnapshot(db)
  const chosen = input.ids.map((id) => s.purchase_orders.find((p) => p.id === id && p.status === 'proforma') ?? fail(tx("Een van de proforma's bestaat niet meer of is al omgezet. Ververs het overzicht.")))
  const ids: string[] = []
  for (const p of chosen) {
    const lines = s.purchase_order_lines.filter((l) => l.purchase_order_id === p.id)
    await db.remove('purchase_orders', p.id)
    for (const l of lines) await db.remove('purchase_order_lines', l.id)
    ids.push(await createPurchaseOrder(db, {
      supplier_id: p.supplier_id, order_date: input.order_date, supplier_reference: input.supplier_reference ?? '', notes: '', label: 'verkoop',
      lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_cost: l.unit_cost, sales_order_line_id: l.sales_order_line_id })),
    }))
  }
  return ids
}

/** Registreert dat inkoopregels in Nederland klaarstaan (null maakt het ongedaan, zolang de regel niet op een transport staat). */
export async function markReceivedInNl(db: Driver, shipmentIds: string[], date: string | null) {
  if (!shipmentIds.length) fail(tx("Selecteer minimaal één inkoopregel."))
  const s = await loadSnapshot(db)
  for (const id of shipmentIds) {
    const x = s.inbound_shipments.find((r) => r.id === id) ?? (fail(tx("Inkoopregel niet gevonden.")) as never)
    if (!shipmentIsOpen(x)) fail(tx("Deze regel is al ontvangen in Spanje."))
    if (!date && x.transport_id) fail(tx("Deze regel staat al op een transport. Koppel hem eerst los."))
    const po = s.purchase_orders.find((p) => p.id === x.purchase_order_id)
    if (date && po && date < po.order_date) fail(tx("De datum in Nederland kan niet voor de besteldatum liggen."))
    if (isDomesticShipment(s, x)) fail(tx("Deze inkoop is bij een leverancier in Spanje en komt niet via Nederland."))
  }
  for (const id of shipmentIds) await db.update('inbound_shipments', id, { nl_received_at: date })
}

export async function closeShipment(db: Driver, shipmentId: string, reason: string) {
  await db.update('inbound_shipments', shipmentId, { status: 'closed', notes: reason })
  await closeTransportIfDone(db, (await db.list('inbound_shipments')).find((x) => x.id === shipmentId)?.transport_id ?? null)
}

export async function cancelPurchaseOrder(db: Driver, id: string) {
  const s = await loadSnapshot(db)
  if (s.purchase_orders.find((p) => p.id === id)?.status === 'proforma') fail(tx("Een proforma-inkooporder volgt de verkooporder. Pas de verkooporder aan om hem te laten vervallen."))
  const shipments = s.inbound_shipments.filter((x) => x.purchase_order_id === id)
  if (s.goods_receipt_lines.some((r) => s.inbound_shipment_lines.some((l) => l.id === r.shipment_line_id && shipments.some((x) => x.id === l.shipment_id)))) fail(tx("Deze inkooporder heeft al ontvangsten en kan niet worden geannuleerd."))
  await db.update('purchase_orders', id, { status: 'cancelled' })
  for (const x of shipments) await db.update('inbound_shipments', x.id, { status: 'closed' })
  // Wat de verkooporders nog nodig hebben, komt terug op een proforma-inkooporder.
  await syncPurchaseProformas(db)
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
    if (t && isDomesticShipment(s, x)) fail(tx("Inkoop bij een leverancier in Spanje gaat niet op een transport uit Nederland."))
    if (t && !x.nl_received_at) fail(tx("Een regel kan pas op een transport als hij in Nederland is ontvangen."))
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
  // Zonder keuze komt het binnen op de voorgestelde locatie van de inkoopregel.
  const planned = (slId: string) => s.inbound_shipments.find((x) => x.id === s.inbound_shipment_lines.find((l) => l.id === slId)?.shipment_id)?.warehouse_id
  const rows = input.rows.filter((r) => r.qty_received > 0 || r.qty_damaged > 0).map((r) => ({ ...r, warehouse_id: r.warehouse_id || planned(r.shipment_line_id) || inboundWarehouse(s.warehouses)?.id as string }))
  if (rows.some((r) => !s.warehouses.some((w) => w.id === r.warehouse_id && w.is_active))) fail(tx("Kies bij elke regel een actieve locatie."))
  if (!rows.length) fail(tx("Vul bij minimaal één regel een ontvangen aantal in."))
  if (rows.some((r) => !r.warehouse_id)) fail(tx("Stel onder Instellingen een actief magazijn in waar de route start."))
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
/** Een regel met article is een catalogusartikel dat nog geen product onder Instellingen heeft; dat product ontstaat pas als de verkooporder klopt. */
export type OrderLineInput = Omit<SalesOrderLine, 'id' | 'sales_order_id'> & { id?: string; article?: CatalogArticle }

const withPlaceholders = (input: OrderInput): OrderInput => ({ ...input, lines: input.lines.map((l) => (!l.product_id && l.article ? { ...l, product_id: `artikel:${l.article.article_number}` } : l)) })
/** Maakt de producten voor gekozen catalogusartikelen, nadat de verkooporder is gecontroleerd. */
async function resolveArticleLines(db: Driver, input: OrderInput): Promise<OrderInput> {
  const lines: OrderLineInput[] = []
  for (const { article, ...l } of input.lines) lines.push(article && !l.product_id ? { ...l, product_id: await productForArticle(db, article) } : l)
  return { ...input, lines }
}
export interface OrderInput {
  header: OrderHeader; lines: OrderLineInput[]
  deposit?: { amount: number; method: Payment['method']; reference: string }
}

function validateOrder(s: Snapshot, input: OrderInput, opts: { checkTakeNow: boolean; requireCustomer?: boolean } = { checkTakeNow: true }) {
  const h = input.header
  if (opts.requireCustomer !== false && !h.customer_id) fail(tx("Kies of maak een klant."))
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

export async function createOrder(db: Driver, raw: OrderInput, opts: NewOrderOptions = {}) {
  const s = await loadSnapshot(db)
  validateOrder(s, withPlaceholders(raw))
  checkInvoiceEmail(opts)
  const input = await resolveArticleLines(db, raw)
  const id = newId()
  const number = await nextDocumentNumber(db, 'VO', 'prefix_sales_order', yearOf(input.header.order_date))
  const allTaken = input.lines.every((l) => l.take_now)
  await db.insert('sales_orders', [{ ...input.header, order_type: allTaken ? 'direct' : 'bestelling', fulfilment: allTaken ? 'meenemen' : input.header.fulfilment, id, number, status: 'open' }])
  const lines = input.lines.map((l) => ({ ...l, id: newId(), sales_order_id: id }))
  await db.insert('sales_order_lines', lines)
  await db.insert('order_events', [event(id, 'aangemaakt', `Verkooporder ${number} aangemaakt.`)])
  await finishNewOrder(db, id, input, lines, opts)
  await syncPurchaseProformas(db)
  await autoMailSalesOrder(db, id, opts.invoiceNow === true && allTaken)
  return id
}

/**
 * Opties bij een nieuwe of bevestigde verkooporder.
 * invoiceNow: afrekenen aan de kassa (POS). Neemt de klant alles direct mee, dan ontstaat meteen de factuur (datum vandaag)
 * in plaats van alleen een proforma. invoiceEmail: daar gaat de factuur als pdf naartoe; leeg = niet mailen.
 */
export interface NewOrderOptions { autoDeliverDate?: string; invoiceNow?: boolean; invoiceEmail?: string; invoiceDate?: string; simplified?: boolean; issuer?: Issuer }

function checkInvoiceEmail(opts: NewOrderOptions) {
  if (opts.invoiceEmail?.trim() && !isEmail(opts.invoiceEmail)) fail(tx("Vul een geldig e-mailadres in voor de factuur."))
}

/** Vooruitbetaling en wat de klant direct meeneemt, bij een nieuwe of net bevestigde verkooporder. */
async function finishNewOrder(db: Driver, id: string, input: OrderInput, lines: SalesOrderLine[], opts: NewOrderOptions) {
  if (input.deposit?.amount) {
    await db.insert('payments', [{ id: newId(), sales_order_id: id, invoice_id: null, kind: 'vooruitbetaling', method: input.deposit.method, amount: input.deposit.amount, paid_at: input.header.order_date, reference: input.deposit.reference }])
  }
  // Wat de klant direct meeneemt, gaat meteen de deur uit. De rest volgt als deellevering.
  const taken = lines.filter((l) => l.take_now)
  if (taken.length) {
    const date = opts.autoDeliverDate ?? input.header.order_date
    const did = await createDelivery(db, { sales_order_id: id, method: 'meenemen', planned_date: date, carrier: '', notes: '', lines: taken.map((l) => ({ sales_order_line_id: l.id, qty: l.qty })) })
    await markDelivered(db, did, { date, signed_by: input.header.delivery_name || '' })
    // Afrekenen aan de kassa: alles gaat mee, dus meteen factureren en eventueel mailen.
    if (opts.invoiceNow && taken.length === lines.length) {
      const [invoiceId] = await invoiceProformas(db, { delivery_ids: [did], invoice_date: opts.invoiceDate ?? todayISO(), simplified: opts.simplified, issuer: opts.issuer })
      const to = opts.invoiceEmail?.trim() ?? ''
      // Mailen per document onder Instellingen: staat het uit, dan gaat de factuur niet automatisch de deur uit.
      const co = (await db.list('settings'))[0]
      if (to && mailsAutomatically(co, opts.simplified ? 'mail_invoice_simplified' : 'mail_invoice')) {
        const order = (await db.list('sales_orders')).find((o) => o.id === id)
        const customer = order?.customer_id ? (await db.list('customers')).find((c) => c.id === order.customer_id) : undefined
        // Het adres wordt bij de klant bewaard als die er nog geen had.
        if (customer && !customer.email?.trim()) await db.update('customers', customer.id, { email: to })
        await mailInvoice(db, invoiceId, to)
      }
    }
  }
}

// Kassa (POS) --------------------------------------------------------------------
// Snelle verkoop in de winkel: scannen, afrekenen, de klant neemt alles mee en betaalt meteen.
// Ligt een artikel er wel maar zegt het systeem dat er niets vrij is, dan is dat een voorraadverschil:
// het verschil wordt als correctie op de winkel geboekt, zodat de verkoop gewoon doorgaat.

export interface PosInput {
  salesperson_id: string
  /** Leeg: de vaste klant voor kassaverkopen zonder klantgegevens. */
  customer_id: string | null
  date: string
  lines: PosLine[]
  payment: { method: Payment['method']; reference: string }
  /** Daar gaat de factuur als pdf naartoe; leeg = niet mailen. */
  invoiceEmail?: string
  /** Welk bedrijf de eenvoudige factuur uitgeeft: Bella (standaard) of HDB. */
  issuer?: Issuer
}

/** Het dummy-artikel (DIVERSEN) voor een artikel met eigen omschrijving; bestaat het nog niet, dan wordt het aangemaakt. */
export async function ensureDummyProduct(db: Driver) {
  const found = (await db.list('products')).find((p) => p.sku === DUMMY_SKU)
  if (found) return found.id
  const id = newId()
  await db.insert('products', [{
    id, sku: DUMMY_SKU, name: 'Diversen (eigen omschrijving)', collection: '', category: 'Overig', material: '', color: '', dimensions: '',
    weight_kg: 0, colli: 1, purchase_price: 0, sale_price: 0, vat_rate: 21, supplier_id: null, min_stock: 0, is_active: true, volume_m3: 0, catalog_article_number: null,
  }])
  return id
}

/** De vaste klant voor kassaverkopen zonder klantgegevens. Bestaat hij nog niet, dan wordt hij aangemaakt. */
export async function ensurePosCustomer(db: Driver) {
  const found = (await db.list('customers')).find((c) => c.notes === POS_CUSTOMER_NOTE)
  if (found) return found.id
  const id = newId()
  await db.insert('customers', [{ id, kind: 'particulier', name: 'Kassaverkoop', company: '', tax_id: '', email: '', phone: '', language: 'es', address: '', postal_code: '', city: '', province: '', country: 'España', notes: POS_CUSTOMER_NOTE }])
  return id
}

/** Afrekenen aan de kassa: verkooporder, direct afgeleverd, factuur van vandaag en de betaling erop. Geeft verkooporder en factuur terug. */
export async function posCheckout(db: Driver, input: PosInput) {
  if (!input.salesperson_id) fail(tx("Kies eerst de medewerker."))
  if (!input.lines.length) fail(tx("Scan of voeg minimaal één artikel toe."))
  for (const l of input.lines) {
    if (l.qty <= 0 || !Number.isInteger(l.qty)) fail(tx("Vul bij {0} een aantal in.", l.description || l.code))
    if (l.unit_price < 0) fail(tx("Een prijs kan niet negatief zijn."))
    if (l.discount_pct < 0 || l.discount_pct > 100) fail(tx("Korting ligt tussen 0 en 100%."))
    if (l.dummy && !l.description.trim()) fail(tx("Vul bij het artikel {0} een omschrijving in.", DUMMY_SKU))
    if (!l.dummy && !l.article && !l.product_id) fail(tx("Elke regel heeft een artikel nodig."))
  }
  checkInvoiceEmail(input)
  const s0 = await loadSnapshot(db)
  const shop = posWarehouse(s0.warehouses) ?? (fail(tx("Er is geen actieve winkel of magazijn onder Instellingen.")) as never)
  const chosen = input.customer_id ? s0.customers.find((c) => c.id === input.customer_id) ?? (fail(tx("Klant niet gevonden.")) as never) : null
  // Factura simplificada: boven de grens zijn naam, adres, woonplaats en NIE of paspoort van de klant verplicht.
  if (posTotals(input.lines).total > SIMPLIFIED_LIMIT) {
    if (!chosen) fail(tx("Boven {0} zijn de gegevens van de klant verplicht: naam, adres, woonplaats en NIE of paspoortnummer.", '€ 1.000'))
    const missing = missingCustomerData(chosen!)
    if (missing.length) fail(tx("Boven {0} vul bij de klant nog in: {1}.", '€ 1.000', missing.map((m) => tx(m)).join(', ')))
  }

  // Producten vastleggen: catalogusartikelen worden product, het dummy-artikel bestaat altijd.
  const resolved: (OrderLineInput & { dummy: boolean })[] = []
  for (const l of input.lines) {
    const product_id = l.dummy ? await ensureDummyProduct(db) : l.product_id || await productForArticle(db, l.article!)
    resolved.push({ product_id, description: l.description.trim(), options: '', qty: l.qty, unit_price: round2(l.unit_price), discount_pct: l.discount_pct, vat_rate: l.vat_rate, source: 'voorraad', warehouse_id: shop.id, take_now: true, dummy: !!l.dummy })
  }
  const customer_id = input.customer_id || await ensurePosCustomer(db)
  const s = await loadSnapshot(db)
  const customer = s.customers.find((c) => c.id === customer_id)!

  // Voorraadverschil: wat de klant meeneemt maar niet vrij in de winkel staat, eerst bijboeken.
  const shortfalls = posShortfalls(s, resolved, shop.id)
  const corrections = shortfalls.map((x) => ({
    id: newId(), product_id: x.product_id, warehouse_id: shop.id, qty: x.qty, kind: 'correctie' as const, ref_id: '', moved_at: input.date,
    note: x.dummy ? 'Kassa: diversen, geen voorraad' : `Kassa: voorraadverschil, ${x.free} vrij, ${x.free + x.qty} verkocht`,
  }))
  if (corrections.length) await db.insert('stock_movements', corrections)

  const header: OrderHeader = {
    customer_id, order_date: input.date, channel: 'winkel', salesperson_id: input.salesperson_id, customer_reference: '', order_type: 'direct', fulfilment: 'meenemen',
    requested_date: null, promised_date: null, delivery_name: customer.company || customer.name, delivery_phone: customer.phone, delivery_address: customer.address,
    delivery_postal_code: customer.postal_code, delivery_city: customer.city, delivery_latitude: null, delivery_longitude: null, floor: '', has_elevator: false,
    needs_assembly: false, remove_old_furniture: false, delivery_notes: '', notes: input.issuer === 'hdb' ? 'Kassaverkoop HDB' : 'Kassaverkoop',
  }
  let orderId = ''
  try {
    orderId = await createOrder(db, { header, lines: resolved.map(({ dummy: _d, ...l }) => l) }, { invoiceNow: true, invoiceDate: input.date, invoiceEmail: input.invoiceEmail, simplified: true, issuer: input.issuer ?? 'bella' })
  } catch (e) {
    for (const c of corrections) await db.remove('stock_movements', c.id)
    throw e
  }
  const s2 = await loadSnapshot(db)
  const order = s2.sales_orders.find((o) => o.id === orderId)!
  const invoice = s2.invoices.find((i) => i.sales_order_id === orderId) ?? (fail(tx("De factuur is niet gemaakt.")) as never)
  for (const c of corrections) await db.update('stock_movements', c.id, { ref_id: order.number })
  if (shortfalls.some((x) => !x.dummy)) {
    const list = shortfalls.filter((x) => !x.dummy).map((x) => `${s2.products.find((p) => p.id === x.product_id)?.name} +${x.qty}`).join(', ')
    await db.insert('order_events', [event(orderId, 'voorraad', `Voorraadverschil op ${shop.name} bijgeboekt: ${list}.`)])
  }
  const open = round2(invoice.total - invoice.deposit_settled)
  if (open > 0) await payInvoice(db, { invoice_id: invoice.id, amount: open, method: input.payment.method, paid_at: input.date, reference: input.payment.reference })
  return { orderId, orderNumber: order.number, invoiceId: invoice.id, invoiceNumber: invoice.number, corrections: shortfalls }
}

// Proforma (scan.bellaflow.es) -------------------------------------------------
// Een medewerker scant in de winkel artikelen. Dat wordt een verkooporder met de status Proforma: zonder klant,
// met een tijdelijk nummer (PRO-). Pas als de medewerker de klant invult en bevestigt, krijgt hij het VO-nummer.

export interface ScanLine { article: CatalogArticle; qty: number }

export async function createProformaOrder(db: Driver, input: { salesperson_id: string; date: string; lines: ScanLine[] }) {
  if (!input.salesperson_id) fail(tx("Kies eerst wie je bent."))
  const people = await db.list('salespeople')
  if (!people.some((p) => p.id === input.salesperson_id)) fail(tx("Deze medewerker bestaat niet meer. Kies opnieuw wie je bent."))
  const rows = input.lines.filter((l) => l.qty > 0)
  if (!rows.length) fail(tx("Scan minimaal één artikel."))
  // Twee keer hetzelfde artikel gescand is één regel.
  const merged = new Map<string, ScanLine>()
  for (const l of rows) {
    const m = merged.get(l.article.article_number)
    merged.set(l.article.article_number, m ? { ...m, qty: m.qty + l.qty } : l)
  }
  const pids: { pid: string; qty: number }[] = []
  for (const l of merged.values()) pids.push({ pid: await productForArticle(db, l.article), qty: l.qty })
  const s = await loadSnapshot(db)
  const lines = splitLinesForStock(s, pids.map(({ pid, qty }) => {
    const p = s.products.find((x) => x.id === pid)!
    const wid = scanWarehouse(s, pid, qty)
    return lineFromProduct(p, { qty, source: wid ? 'voorraad' : 'bestelling', warehouse_id: wid })
  }))
  const id = newId()
  const number = await db.nextNumber('PRO', yearOf(input.date))
  await db.insert('sales_orders', [{
    id, number, status: 'proforma', customer_id: null, order_date: input.date, channel: 'winkel', salesperson_id: input.salesperson_id, customer_reference: '',
    order_type: 'bestelling', fulfilment: 'meenemen', requested_date: null, promised_date: null, delivery_name: '', delivery_phone: '', delivery_address: '',
    delivery_postal_code: '', delivery_city: '', delivery_latitude: null, delivery_longitude: null, floor: '', has_elevator: false, needs_assembly: false,
    remove_old_furniture: false, delivery_notes: '', notes: '',
  }])
  await db.insert('sales_order_lines', lines.map((l) => ({ ...l, id: newId(), sales_order_id: id })))
  const seller = people.find((p) => p.id === input.salesperson_id)!.name
  await db.insert('order_events', [event(id, 'aangemaakt', `Proforma ${number} gescand door ${seller}.`)])
  return { id, number }
}

/** Snapshot zonder de regels van deze verkooporder, zodat zijn eigen reservering niet als bezet telt. */
const withoutOwnLines = (s: Snapshot, id: string): Snapshot => ({ ...s, sales_order_lines: s.sales_order_lines.filter((l) => l.sales_order_id !== id) })

async function replaceLines(db: Driver, s: Snapshot, id: string, lines: OrderLineInput[]) {
  for (const old of orderLines(s, id)) await db.remove('sales_order_lines', old.id)
  const rows = lines.map(({ id: _old, article: _a, ...l }) => ({ ...l, id: newId(), sales_order_id: id }))
  await db.insert('sales_order_lines', rows)
  return rows
}

const proformaOf = (s: Snapshot, id: string) => {
  const o = s.sales_orders.find((x) => x.id === id) ?? fail(tx("Verkooporder niet gevonden."))
  if (o.status !== 'proforma') fail(tx("Deze verkooporder is geen proforma meer."))
  return o
}

/** Bewaart een proforma zonder te bevestigen. Een klant is nog niet nodig; het nummer blijft PRO-. */
export async function saveProforma(db: Driver, id: string, raw: OrderInput) {
  const s = await loadSnapshot(db)
  proformaOf(s, id)
  validateOrder(withoutOwnLines(s, id), withPlaceholders(raw), { checkTakeNow: false, requireCustomer: false })
  const input = await resolveArticleLines(db, raw)
  await replaceLines(db, s, id, input.lines)
  const { customer_id, ...header } = input.header
  await db.update('sales_orders', id, { ...header, customer_id: customer_id || null, delivery_latitude: null, delivery_longitude: null })
  await db.insert('order_events', [event(id, 'gewijzigd', 'Proforma bijgewerkt.')])
}

/**
 * Rondt een proforma af: met klant, gecontroleerd als een nieuwe verkooporder. Pas nu krijgt hij het VO-nummer
 * en de status open; daarna volgen inkoop, levering en facturatie zoals bij elke verkooporder.
 */
export async function confirmProforma(db: Driver, id: string, raw: OrderInput, opts: NewOrderOptions = {}) {
  const s = await loadSnapshot(db)
  const order = proformaOf(s, id)
  checkInvoiceEmail(opts)
  const free = withoutOwnLines(s, id)
  validateOrder(free, withPlaceholders(raw))
  const input = await resolveArticleLines(db, raw)
  const rows = await replaceLines(db, s, id, splitLinesForStock(await loadSnapshot(db).then((x) => withoutOwnLines(x, id)), input.lines))
  const number = await nextDocumentNumber(db, 'VO', 'prefix_sales_order', yearOf(input.header.order_date))
  const allTaken = rows.every((l) => l.take_now)
  await db.update('sales_orders', id, {
    ...input.header, number, status: 'open', delivery_latitude: null, delivery_longitude: null,
    order_type: allTaken ? 'direct' : 'bestelling', fulfilment: allTaken ? 'meenemen' : input.header.fulfilment,
  })
  await db.insert('order_events', [event(id, 'bevestigd', `Proforma ${order.number} bevestigd als verkooporder ${number}.`)])
  await finishNewOrder(db, id, input, rows, opts)
  await syncPurchaseProformas(db)
  await autoMailSalesOrder(db, id, opts.invoiceNow === true && allTaken)
  return number
}

export async function updateOrder(db: Driver, id: string, raw: OrderInput) {
  const s = await loadSnapshot(db)
  validateOrder({ ...s, sales_order_lines: s.sales_order_lines.filter((l) => l.sales_order_id !== id) }, withPlaceholders(raw), { checkTakeNow: false })
  const order = s.sales_orders.find((o) => o.id === id) ?? fail(tx("Verkooporder niet gevonden."))
  const input = await resolveArticleLines(db, raw)
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
      const pols = s.purchase_order_lines.filter((l) => l.sales_order_line_id === old.id)
      const statusOf = (poId: string) => s.purchase_orders.find((p) => p.id === poId)?.status
      if (pols.some((l) => statusOf(l.purchase_order_id) === 'open')) fail(tx("{0} is al ingekocht voor deze verkooporder en kan niet worden verwijderd.", old.description))
      // Staat de regel alleen op een proforma-inkooporder, dan vervalt hij daar mee.
      for (const l of pols.filter((x) => statusOf(x.purchase_order_id) === 'proforma')) await db.remove('purchase_order_lines', l.id)
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
  await syncPurchaseProformas(db)
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
  await syncPurchaseProformas(db)
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
  // Mailen per document onder Instellingen: staat de getekende bon uit, dan wordt er niets gemaild.
  if (!mailsAutomatically((await db.list('settings'))[0], 'mail_signed_note')) return 'off' as const
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
  const existing = s.email_outbox.find((m) => m.kind === 'getekende_afleverbon' && m.delivery_id === deliveryId)
  const id = existing?.id ?? newId()
  const status0: EmailStatus = to ? 'pending' : 'no_recipient'
  const fields = { to_email: to, bcc_email: co?.shop_email?.trim() ?? '', status: status0, error: to ? '' : tx("Geen e-mailadres bekend bij de klant.") }
  if (existing) await db.update('email_outbox', id, fields)
  else await db.insert('email_outbox', [{ id, kind: 'getekende_afleverbon', delivery_id: deliveryId, invoice_id: null, subject: text.subject(d.number, co?.company_name ?? ''), body_text: text.body(c.name, d.number, co?.company_name ?? ''), created_at: new Date().toISOString(), sent_at: null, ...fields }])
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

/** Mailt een factuur als pdf (zelfde document als afgedrukt) met een bcc naar de winkel. Opnieuw mailen werkt dezelfde regel in de wachtrij bij. */
export async function mailInvoice(db: Driver, invoiceId: string, toEmail?: string): Promise<EmailStatus> {
  const s = await loadSnapshot(db)
  const inv = s.invoices.find((x) => x.id === invoiceId) ?? (fail(tx("Factuur niet gevonden.")) as never)
  const c = s.customers.find((x) => x.id === inv.customer_id)!
  const co = s.settings[0]
  const raw = (toEmail ?? c.email ?? '').trim()
  if (raw && !isEmail(raw)) fail(tx("Vul een geldig e-mailadres in voor de factuur."))
  const to = raw
  const text = INVOICE_MAIL[c.language]
  const existing = s.email_outbox.find((m) => m.kind === 'factuur' && m.invoice_id === invoiceId)
  const id = existing?.id ?? newId()
  const status0: EmailStatus = to ? 'pending' : 'no_recipient'
  const fields = { to_email: to, bcc_email: co?.shop_email?.trim() ?? '', status: status0, error: to ? '' : tx("Geen e-mailadres bekend bij de klant.") }
  if (existing) await db.update('email_outbox', id, fields)
  else await db.insert('email_outbox', [{ id, kind: 'factuur', delivery_id: null, invoice_id: invoiceId, subject: text.subject(inv.number, co?.company_name ?? ''), body_text: text.body(c.name, inv.number, co?.company_name ?? ''), created_at: new Date().toISOString(), sent_at: null, ...fields }])
  if (!to) return 'no_recipient'
  try {
    const { invoicePdf } = await import('./invoicePdf')
    const result = await db.sendEmail(id, await invoicePdf(s, invoiceId))
    await db.update('email_outbox', id, { status: result, error: '', sent_at: result === 'sent' ? new Date().toISOString() : null })
    if (result === 'sent') await db.insert('order_events', [event(inv.sales_order_id, 'mail', `Factuur ${inv.number} gemaild naar ${to}.`)])
    return result
  } catch (e) {
    await db.update('email_outbox', id, { status: 'failed', error: e instanceof Error ? e.message : String(e) })
    return 'failed'
  }
}

/**
 * Mailt de verkooporder automatisch na aanmaken of bevestigen, als dat onder Instellingen aan staat en de klant
 * een e-mailadres heeft. Niet bij afrekenen aan de kassa: dan krijgt de klant de factuur.
 */
async function autoMailSalesOrder(db: Driver, orderId: string, checkout: boolean) {
  if (checkout) return
  const s = await loadSnapshot(db)
  if (!mailsAutomatically(s.settings[0], 'mail_sales_order')) return
  const o = s.sales_orders.find((x) => x.id === orderId)
  const c = o && s.customers.find((x) => x.id === o.customer_id)
  if (!c || !isEmail(c.email ?? '')) return
  await mailSalesOrder(db, orderId)
}

/** Mailt de verkooporder als pdf (met prijzen) met een bcc naar de winkel. Opnieuw mailen werkt dezelfde regel in de wachtrij bij. */
export async function mailSalesOrder(db: Driver, orderId: string, toEmail?: string): Promise<EmailStatus> {
  const s = await loadSnapshot(db)
  const o = s.sales_orders.find((x) => x.id === orderId) ?? (fail(tx("Verkooporder niet gevonden.")) as never)
  if (o.status === 'proforma') fail(tx("Een proforma wordt niet gemaild. Bevestig eerst de verkooporder."))
  const c = s.customers.find((x) => x.id === o.customer_id) ?? (fail(tx("Deze verkooporder heeft nog geen klant.")) as never)
  const co = s.settings[0]
  const to = (toEmail ?? c.email ?? '').trim()
  if (to && !isEmail(to)) fail(tx("Vul een geldig e-mailadres in voor de verkooporder."))
  const text = SALES_ORDER_MAIL[c.language]
  const existing = s.email_outbox.find((m) => m.kind === 'verkooporder' && m.sales_order_id === orderId)
  const id = existing?.id ?? newId()
  const status0: EmailStatus = to ? 'pending' : 'no_recipient'
  const fields = { to_email: to, bcc_email: co?.shop_email?.trim() ?? '', status: status0, error: to ? '' : tx("Geen e-mailadres bekend bij de klant.") }
  if (existing) await db.update('email_outbox', id, fields)
  else await db.insert('email_outbox', [{ id, kind: 'verkooporder', delivery_id: null, invoice_id: null, sales_order_id: orderId, subject: text.subject(o.number, co?.company_name ?? ''), body_text: text.body(c.name, o.number, co?.company_name ?? ''), created_at: new Date().toISOString(), sent_at: null, ...fields }])
  if (!to) return 'no_recipient'
  try {
    const { salesOrderPdf } = await import('./salesOrderPdf')
    const result = await db.sendEmail(id, await salesOrderPdf(s, orderId))
    await db.update('email_outbox', id, { status: result, error: '', sent_at: result === 'sent' ? new Date().toISOString() : null })
    if (result === 'sent') await db.insert('order_events', [event(orderId, 'mail', `Verkooporder ${o.number} gemaild naar ${to}.`)])
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
export async function invoiceProformas(db: Driver, input: { delivery_ids: string[]; invoice_date: string; simplified?: boolean; issuer?: Issuer }) {
  if (!input.delivery_ids.length) fail(tx("Vink minimaal één proforma aan."))
  const s = await loadSnapshot(db)
  const chosen = s.deliveries.filter((d) => input.delivery_ids.includes(d.id)).sort((a, b) => a.number.localeCompare(b.number))
  const ids: string[] = []
  for (const d of chosen) ids.push(await createInvoice(db, { sales_order_id: d.sales_order_id, delivery_ids: [d.id], invoice_date: input.invoice_date, settle_deposit: true, simplified: input.simplified, issuer: input.issuer }))
  return ids
}

const latestInvoiceDate = (s: Snapshot) => s.invoices.reduce((m, i) => (i.invoice_date > m ? i.invoice_date : m), '')

// Facturatie -------------------------------------------------------------------

export async function createInvoice(db: Driver, input: { sales_order_id: string; delivery_ids: string[]; invoice_date: string; settle_deposit: boolean; simplified?: boolean; issuer?: Issuer }) {
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

  // Eenvoudige factuur (kassa): eigen nummerreeks per bedrijf (Bella FS-BELLA, HDB FS-HDB).
  const issuer: Issuer = input.simplified && input.issuer === 'hdb' ? 'hdb' : 'bella'
  const fs = ISSUER_SERIES[issuer]
  const number = input.simplified
    ? await nextDocumentNumber(db, fs.series, fs.field, yearOf(input.invoice_date), fs.fallback)
    : await nextDocumentNumber(db, 'F', 'prefix_invoice', yearOf(input.invoice_date))
  await db.insert('invoices', [{
    id, number, sales_order_id: order.id, customer_id: customer.id, kind, invoice_date: input.invoice_date,
    due_date: addDays(input.invoice_date, s.settings[0]?.payment_days ?? 14), base_amount: b.base, vat_amount: b.vat, total: b.total,
    deposit_settled: round2(deposit), language: customer.language, ...(input.simplified ? { simplified: true, issuer } : {}),
  }])
  await db.insert('invoice_lines', lines)
  await db.insert('order_events', [event(order.id, 'factuur', `Factuur ${number} gemaakt.`)])
  return id
}

export async function payInvoice(db: Driver, input: { invoice_id: string; amount: number; method: Payment['method']; paid_at: string; reference: string }) {
  if (input.amount <= 0) fail(tx("Vul een bedrag in."))
  const s = await loadSnapshot(db)
  const inv = s.invoices.find((i) => i.id === input.invoice_id)!
  if (isCredit(inv)) fail(tx("Op een creditfactuur registreer je een terugbetaling, geen betaling."))
  await db.insert('payments', [{ id: newId(), sales_order_id: inv.sales_order_id, kind: 'betaling', ...input }])
}

// Creditfacturen en retouren -----------------------------------------------------
// Een factuur wijzigt nooit. Een retour, een fout of een korting achteraf wordt een creditfactuur
// (factura rectificativa) met negatieve bedragen en een verwijzing naar de oorspronkelijke factuur.

export interface CreditLineInput {
  /** Regel van de oorspronkelijke factuur. */
  invoice_line_id: string
  /** Aantal dat gecrediteerd wordt (positief, hele stuks). */
  qty: number
  /** Retour: het artikel komt terug in deze locatie. Leeg = geen retour (bijvoorbeeld een fout in de factuur). */
  return_warehouse_id: string | null
}
export interface CreditInput {
  invoice_id: string
  date: string
  reason: string
  lines: CreditLineInput[]
  /** Een bedrag zonder artikel, zoals een korting achteraf of een vergoeding voor schade (incl. IVA, positief). */
  extra?: { description: string; amount: number; vat_rate: number } | null
  /** Hoe het geld terug gaat dat niet met de oorspronkelijke factuur wordt verrekend. 'later' = staat open als terug te betalen. */
  refund: { method: Exclude<Payment['method'], 'verrekening'> | 'later'; reference: string }
}

/**
 * Maakt de creditfactuur: eigen nummerreeks, negatieve regels, eerst verrekend met wat op de oorspronkelijke
 * factuur nog openstaat, de rest terugbetaald. Retourregels komen terug in voorraad (mutatie Retour).
 */
export async function createCreditInvoice(db: Driver, input: CreditInput) {
  const s = await loadSnapshot(db)
  const original = s.invoices.find((i) => i.id === input.invoice_id) ?? (fail(tx("Factuur niet gevonden.")) as never)
  if (isCredit(original)) fail(tx("Een creditfactuur kan zelf niet gecrediteerd worden."))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) fail(tx("Kies een datum."))
  if (input.date < original.invoice_date.slice(0, 10)) fail(tx("De creditfactuur kan niet voor de factuur zelf liggen."))
  const last = latestInvoiceDate(s)
  if (last && input.date < last) fail(tx("De factuurdatum mag niet voor de laatste factuur liggen ({0}).", last.split('-').reverse().join('-')))
  const reason = input.reason.trim()
  if (!reason) fail(tx("Vul de reden van de creditfactuur in."))

  const avail = new Map(creditableLines(s, original.id).map((c) => [c.line.id, c]))
  const warehouses = new Set(s.warehouses.filter((w) => w.is_active).map((w) => w.id))
  const chosen = input.lines.filter((l) => l.qty !== 0)
  for (const l of chosen) {
    const c = avail.get(l.invoice_line_id) ?? (fail(tx("Deze regel hoort niet bij de factuur.")) as never)
    if (l.qty < 0 || !Number.isInteger(l.qty)) fail(tx("Vul bij {0} een heel aantal in.", c.line.description))
    if (l.qty > c.remaining) fail(tx("Bij {0} kan nog maar {1} gecrediteerd worden.", c.line.description, c.remaining))
    if (l.return_warehouse_id) {
      if (!c.stockable || !c.product_id) fail(tx("{0} heeft geen voorraad en kan niet retour in voorraad.", c.line.description))
      if (!warehouses.has(l.return_warehouse_id)) fail(tx("Kies een locatie voor de retour."))
    }
  }
  const extra = input.extra && round2(input.extra.amount) !== 0 ? input.extra : null
  if (extra) {
    if (extra.amount < 0) fail(tx("Het bedrag van de correctie kan niet negatief zijn."))
    if (!extra.description.trim()) fail(tx("Vul een omschrijving in bij het bedrag."))
    if (![0, 4, 10, 21].includes(extra.vat_rate)) fail(tx("Kies een IVA-tarief."))
  }
  if (!chosen.length && !extra) fail(tx("Kies minimaal één regel of vul een bedrag in om te crediteren."))

  const id = newId()
  const lines: InvoiceLine[] = chosen.map((l) => {
    const o = avail.get(l.invoice_line_id)!.line
    return {
      id: newId(), invoice_id: id, delivery_line_id: null, credits_line_id: o.id, article_number: o.article_number, description: o.description,
      qty: -l.qty, unit_price: o.unit_price, discount_pct: o.discount_pct, vat_rate: o.vat_rate,
      line_total: lineTotal({ qty: -l.qty, unit_price: o.unit_price, discount_pct: o.discount_pct }),
    }
  })
  if (extra) lines.push({ id: newId(), invoice_id: id, delivery_line_id: null, credits_line_id: null, article_number: '', description: extra.description.trim(), qty: -1, unit_price: round2(extra.amount), discount_pct: 0, vat_rate: extra.vat_rate, line_total: -round2(extra.amount) })
  const b = vatBreakdown(lines.map((l) => ({ total: l.line_total, vat_rate: l.vat_rate })))
  const amount = round2(-b.total)
  const room = creditableAmount(s, original)
  if (amount > room + 0.005) fail(tx("Er kan van deze factuur nog maar {0} gecrediteerd worden.", room.toFixed(2).replace('.', ',')))

  const series = creditSeries(original)
  const number = await nextDocumentNumber(db, series.series, series.field, yearOf(input.date), series.fallback)
  const { settle, refund } = creditSettlement(s, original, amount)
  await db.insert('invoices', [{
    id, number, sales_order_id: original.sales_order_id, customer_id: original.customer_id, kind: 'creditfactuur', invoice_date: input.date, due_date: input.date,
    base_amount: b.base, vat_amount: b.vat, total: b.total, deposit_settled: 0, language: original.language,
    ...(original.simplified ? { simplified: true, issuer: issuerOf(original) } : {}), credit_of: original.id, credit_reason: reason,
  }])
  await db.insert('invoice_lines', lines)

  // Verrekenen: wat nog openstond op de factuur gaat af, op beide facturen als verrekening.
  const pays: Payment[] = []
  const base = { sales_order_id: original.sales_order_id, kind: 'betaling' as const, paid_at: input.date }
  if (settle > 0) {
    pays.push({ id: newId(), ...base, invoice_id: original.id, method: 'verrekening', amount: settle, reference: number })
    pays.push({ id: newId(), ...base, invoice_id: id, method: 'verrekening', amount: -settle, reference: original.number })
  }
  if (refund > 0 && input.refund.method !== 'later') pays.push({ id: newId(), ...base, invoice_id: id, method: input.refund.method, amount: -refund, reference: input.refund.reference.trim() })
  if (pays.length) await db.insert('payments', pays)

  // Retour: het artikel komt terug in de gekozen locatie.
  const moves: StockMovement[] = chosen.filter((l) => l.return_warehouse_id).map((l) => ({
    id: newId(), product_id: avail.get(l.invoice_line_id)!.product_id!, warehouse_id: l.return_warehouse_id!, qty: l.qty, kind: 'retour',
    ref_id: number, note: `Retour ${number} (${original.number})`, moved_at: input.date,
  }))
  if (moves.length) await db.insert('stock_movements', moves)
  const back = moves.length ? `, ${moves.reduce((n, m) => n + m.qty, 0)} st. retour in voorraad` : ''
  await db.insert('order_events', [event(original.sales_order_id, 'factuur', `Creditfactuur ${number} gemaakt op factuur ${original.number}${back}. Reden: ${reason}`)])
  return id
}

/** Een creditfactuur die nog open staat (terug te betalen) alsnog terugbetalen. */
export async function refundCredit(db: Driver, input: { invoice_id: string; amount: number; method: Exclude<Payment['method'], 'verrekening'>; paid_at: string; reference: string }) {
  const s = await loadSnapshot(db)
  const inv = s.invoices.find((i) => i.id === input.invoice_id) ?? (fail(tx("Factuur niet gevonden.")) as never)
  if (!isCredit(inv)) fail(tx("Alleen een creditfactuur kan worden terugbetaald."))
  const owed = round2(-invoiceBalance(s, inv))
  if (input.amount <= 0) fail(tx("Vul een bedrag in."))
  if (input.amount > owed + 0.005) fail(tx("Er staat nog maar {0} terug te betalen.", owed.toFixed(2).replace('.', ',')))
  await db.insert('payments', [{ id: newId(), sales_order_id: inv.sales_order_id, invoice_id: inv.id, kind: 'betaling', method: input.method, amount: -round2(input.amount), paid_at: input.paid_at, reference: input.reference }])
}

/** Factuur zoeken op nummer (kassa: retour van een eenvoudige factuur). Hoofdletters en spaties maken niet uit. */
export function findInvoiceByNumber(s: Snapshot, raw: string) {
  const q = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!q) return null
  return s.invoices.find((i) => i.number.toUpperCase() === q) ?? null
}

// Catalogi -----------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Leest de showroom-export (supplier_showroom_items.csv) in. Bestaande artikelen worden bijgewerkt op leverancier en artikelnummer. */
export async function importShowroom(db: Driver, csv: string) {
  const rows = parseCsv(csv)
  if (!rows.length) fail(tx("Het bestand bevat geen artikelen."))
  const missing = SHOWROOM_COLUMNS.filter((c) => !(c in rows[0]))
  if (missing.length) fail(tx("Het bestand mist de kolom {0}. Gebruik een export van supplier_showroom_items.", missing.join(', ')))
  const suppliers = await db.list('suppliers')
  const unknown = [...new Set(rows.map((r) => r.supplier_name.trim()))].filter((n) => !suppliers.some((x) => sameName(x.name, n)))
  if (unknown.length) fail(tx("Leverancier {0} staat niet onder Instellingen. Voeg die eerst toe met precies deze naam.", unknown.join(', ')))
  const current = await db.list('supplier_showroom_items')
  const key = (name: string, sku: string) => `${name.toLowerCase()}|${sku.toLowerCase()}`
  const byKey = new Map(current.map((x) => [key(x.supplier_name, x.supplier_sku), x.id]))
  let added = 0, updated = 0
  const out = new Map<string, SupplierShowroomItem>()
  for (const r of rows) {
    if (!r.supplier_sku?.trim() || !r.name?.trim()) continue
    const item = showroomItemFromCsv(r)
    const k = key(item.supplier_name, item.supplier_sku)
    let id = byKey.get(k)
    if (id) updated++
    else { id = newId(); added++ }
    byKey.set(k, id)
    out.set(id, { ...item, id })
  }
  if (!out.size) fail(tx("Het bestand bevat geen artikelen."))
  await db.upsert('supplier_showroom_items', [...out.values()])
  return { added, updated }
}

/** Leest de details van de showroom in (supplier_showroom_details.csv): specificaties en elementen per artikel. */
export async function importShowroomDetails(db: Driver, csv: string) {
  const rows = parseCsv(csv)
  if (!rows.length) fail(tx("Het bestand bevat geen artikelen."))
  const missing = DETAIL_COLUMNS.filter((c) => !(c in rows[0]))
  if (missing.length) fail(tx("Het bestand mist de kolom {0}. Gebruik een export van supplier_showroom_details.", missing.join(', ')))
  const current = await db.list('supplier_showroom_details')
  const key = (name: string, sku: string) => `${name.toLowerCase()}|${sku.toLowerCase()}`
  const byKey = new Map(current.map((x) => [key(x.supplier_name, x.supplier_sku), x.id]))
  let added = 0, updated = 0
  const out = new Map<string, SupplierShowroomDetail>()
  for (const r of rows) {
    if (!r.supplier_sku?.trim()) continue
    const item = showroomDetailFromCsv(r)
    const k = key(item.supplier_name, item.supplier_sku)
    let id = byKey.get(k)
    if (id) updated++
    else { id = newId(); added++ }
    byKey.set(k, id)
    out.set(id, { ...item, id })
  }
  await db.upsert('supplier_showroom_details', [...out.values()])
  return { added, updated }
}

/** Kiest aan de kopregel welke export het is: de showroom of de details van de showroom. */
export async function importSupplierFile(db: Driver, csv: string) {
  const head = csv.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0]
  const result = /(^|,)specifications(,|$)/.test(head) ? { kind: 'details' as const, ...(await importShowroomDetails(db, csv)) }
    : /(^|,)available_text(,|$)|(^|,)ean(,|$)/.test(head) ? { kind: 'showroom' as const, ...(await importShowroom(db, csv)) }
    : fail(tx("Dit bestand is geen export van de showroom (supplier_showroom_items of supplier_showroom_details)."))
  return { ...result, articles: await syncCatalogArticles(db) }
}

// Eigen artikelnummers -------------------------------------------------------------

/**
 * Werkt de artikelen met eigen artikelnummer bij uit alle ingelezen catalogi. Nieuwe artikelen en elementen krijgen een
 * nummer, bestaande houden het hunne. Een leverancier zonder afkorting krijgt er een voorgesteld (aan te passen onder Instellingen).
 */
export async function syncCatalogArticles(db: Driver, now = new Date().toISOString()) {
  const s = await loadSnapshot(db)
  const { sources, links, unknownSuppliers } = articleSources(s)
  const codes = missingSupplierCodes(s.suppliers, sources.map((x) => x.supplier_id))
  for (const c of codes) await db.update('suppliers', c.id, { code: c.code })
  const codeOf = new Map<string, string>([...s.suppliers.map((x) => [x.id, x.code ?? ''] as [string, string]), ...codes.map((c) => [c.id, c.code] as [string, string])])
  const existing = await db.articleIndex()
  const plan = planArticleSync(sources, links, existing, (id) => codeOf.get(id)!)
  const first = plan.fresh.length ? await db.reserveArticleNumbers(plan.fresh.length) : 0
  const done = finishArticleSync(plan, existing, first, newId, now)
  await db.saveArticles([...plan.updates, ...done.created], done.links)
  return { added: done.created.length, updated: plan.updates.length, links: done.links.length, codes, unknownSuppliers }
}

/** Afkorting van de leverancier: drie hoofdletters, uniek. Wijzigen geldt alleen voor nieuwe artikelen. */
export async function saveSupplier(db: Driver, row: Supplier | Omit<Supplier, 'id'>) {
  const code = (row.code ?? '').trim().toUpperCase() || null
  if (code && !/^[A-Z]{3}$/.test(code)) fail(tx("De afkorting van de leverancier bestaat uit precies drie letters, bijvoorbeeld LOL."))
  const others = (await db.list('suppliers')).filter((x) => !('id' in row) || x.id !== row.id)
  if (code && others.some((x) => (x.code ?? '').toUpperCase() === code)) fail(tx("De afkorting {0} is al in gebruik bij een andere leverancier.", code))
  return saveRecord(db, 'suppliers', { ...row, code } as Supplier)
}

/** Toeslag per leverancier op de prijs van de leverancier (transport en distributie naar Spanje). */
export async function saveSupplierSurcharge(db: Driver, supplierId: string, pct: number) {
  if (!Number.isFinite(pct) || pct < 0 || pct > 500) fail(tx("De toeslag ligt tussen 0 en 500%."))
  await db.update('suppliers', supplierId, { price_surcharge_pct: Math.round(pct * 100) / 100 })
}

// Schermen lezen catalogusartikelen via deze functies; de opslag zoekt zelf.
export const searchCatalogArticles = (db: Driver, q: ArticleQuery) => db.searchArticles(q)
/** Zoekt één artikel op wat een scanner of medewerker invoert: eigen artikelnummer, artikelnummer leverancier of EAN. */
export async function findArticleByCode(db: Driver, raw: string): Promise<CatalogArticle | null> {
  const code = raw.trim()
  if (!code) return null
  const own = articleNumberFromScan(code)
  if (own) return (await db.findArticles({ numbers: [own] }))[0] ?? null
  const c = code.toLowerCase()
  const hits = await db.searchArticles({ q: code, limit: 20 })
  return hits.find((a) => a.supplier_sku.toLowerCase() === c || a.ean === code || a.article_number.toLowerCase() === c) ?? null
}
export const catalogArticlesBySku = (db: Driver, supplierId: string, skus: string[]) => (skus.length ? db.findArticles({ supplierId, skus }) : Promise.resolve([]))
export const catalogArticlesByNumber = (db: Driver, numbers: string[]) => (numbers.length ? db.findArticles({ numbers }) : Promise.resolve([]))
export const catalogArticleElements = (db: Driver, parentId: string) => db.articleElements(parentId)
export const catalogArticleParents = (db: Driver, elementId: string) => db.articleParents(elementId)
export const catalogArticleCounts = (db: Driver) => db.articleCounts()

/**
 * Het product onder Instellingen voor een catalogusartikel. Bestaat het nog niet, dan wordt het aangemaakt met het eigen
 * artikelnummer, de leverancier en de prijs van de leverancier als voorstel voor de verkoopprijs.
 */
export async function productForArticle(db: Driver, a: CatalogArticle) {
  const found = (await db.list('products')).find((p) => p.catalog_article_number === a.article_number)
  if (found) return found.id
  const supplier = (await db.list('suppliers')).find((x) => x.id === a.supplier_id)
  const id = newId()
  await db.insert('products', [{
    id, sku: a.article_number, name: a.name, collection: a.series, category: categoryName(a.category_code), material: '', color: '', dimensions: '',
    weight_kg: 0, colli: 1, purchase_price: 0, sale_price: priceWithSurcharge(a.price, supplier) ?? 0, vat_rate: 21, supplier_id: a.supplier_id, min_stock: 0, is_active: true,
    volume_m3: 0, catalog_article_number: a.article_number,
  }])
  return id
}

// Stamgegevens -----------------------------------------------------------------

/** Medewerker opslaan (Instellingen > Medewerkers): naam en een geldige rol zijn verplicht. */
export async function saveStaff(db: Driver, row: Omit<Salesperson, 'id'> & { id?: string }) {
  const name = row.name.trim()
  if (!name) fail(tx("Vul de naam in."))
  if (!isStaffRole(row.role)) fail(tx("Kies een rol: Verkoper, Administratie of Beheerder."))
  return saveRecord(db, 'salespeople', { ...row, name, email: row.email.trim(), phone: row.phone.trim() } as Salesperson)
}

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

// Inkooporders versturen ---------------------------------------------------------
// Per dag één JSON-bestand per leverancier, per mail. Elke verzending komt in het log van de inkooporder.

/** De JSON-bestanden voor deze inkooporders, één per leverancier. Gebruikt voor downloaden en versturen. */
export async function purchaseJsonFiles(db: Driver, date: string, ids: string[], s0?: Snapshot) {
  const s = s0 ?? await loadSnapshot(db)
  const pos = ids.map((id) => s.purchase_orders.find((p) => p.id === id) ?? fail(tx("Inkooporder niet gevonden.")))
  for (const po of pos) if (!isSendable(po)) fail(tx("{0} is geen definitieve inkooporder en kan niet worden verstuurd.", po.number))
  const skus = [...new Set(pos.flatMap((po) => s.purchase_order_lines.filter((l) => l.purchase_order_id === po.id).map((l) => s.products.find((p) => p.id === l.product_id)?.sku ?? '')).filter(Boolean))]
  const articles = new Map((skus.length ? await db.findArticles({ numbers: skus }) : []).map((a) => [a.article_number, a]))
  const bySupplier = new Map<string, string[]>()
  for (const po of pos) bySupplier.set(po.supplier_id, [...(bySupplier.get(po.supplier_id) ?? []), po.id])
  return [...bySupplier].map(([supplierId, poIds]) => {
    const sup = s.suppliers.find((x) => x.id === supplierId)
    return { supplierId, ids: poIds, fileName: purchaseJsonFileName(sup, date), json: JSON.stringify(purchaseOrdersJson(s, poIds, date, articles), null, 2) }
  })
}

/**
 * Verstuurt de inkooporders van een dag: per leverancier één mail met het JSON-bestand, met een bcc naar de winkel.
 * `to` geeft per leverancier het adres (standaard het e-mailadres van de leverancier). Elke poging wordt per inkooporder gelogd,
 * ook als het mislukt of er geen adres is, zodat op de inkooporder te zien is wat er gebeurd is.
 */
export async function sendPurchaseOrders(db: Driver, input: { date: string; ids: string[]; to?: Record<string, string> }) {
  if (!input.ids.length) fail(tx("Selecteer eerst een inkooporder."))
  const s = await loadSnapshot(db)
  const files = await purchaseJsonFiles(db, input.date, input.ids, s)
  for (const f of files) {
    const raw = (input.to?.[f.supplierId] ?? s.suppliers.find((x) => x.id === f.supplierId)?.email ?? '').trim()
    if (raw && !isEmail(raw)) fail(tx("Vul een geldig e-mailadres in voor {0}.", s.suppliers.find((x) => x.id === f.supplierId)?.name ?? ''))
  }
  const co = s.settings[0]
  const language = co?.language_purchase_order ?? 'nl'
  const text = PURCHASE_MAIL[language]
  const results: { supplierId: string; ids: string[]; to: string; status: EmailStatus }[] = []
  for (const f of files) {
    const sup = s.suppliers.find((x) => x.id === f.supplierId)
    const to = (input.to?.[f.supplierId] ?? sup?.email ?? '').trim()
    const numbers = f.ids.map((id) => s.purchase_orders.find((p) => p.id === id)!.number)
    const emailId = newId()
    const now = new Date().toISOString()
    await db.insert('email_outbox', [{
      id: emailId, kind: 'inkooporders', delivery_id: null, invoice_id: null, to_email: to, bcc_email: co?.shop_email?.trim() ?? '',
      subject: text.subject(input.date.split('-').reverse().join('-'), co?.company_name ?? ''), body_text: text.body(sup?.contact_name || sup?.name || '', numbers.map((n) => `- ${n}`).join('\n'), co?.company_name ?? ''),
      status: to ? 'pending' : 'no_recipient', error: to ? '' : tx("Geen e-mailadres bekend bij de leverancier."), created_at: now, sent_at: null,
    }])
    await db.insert('purchase_order_dispatches', f.ids.map((purchase_order_id) => ({ id: newId(), purchase_order_id, email_id: emailId, channel: 'json_mail' as const, dispatch_date: input.date, file_name: f.fileName, to_email: to, created_at: now })))
    let status: EmailStatus = 'no_recipient'
    if (to) {
      try {
        status = await db.sendEmail(emailId, { name: f.fileName, base64: toBase64(f.json) })
        await db.update('email_outbox', emailId, { status, error: '', sent_at: status === 'sent' ? new Date().toISOString() : null })
      } catch (e) {
        status = 'failed'
        await db.update('email_outbox', emailId, { status, error: e instanceof Error ? e.message : String(e) })
      }
    }
    results.push({ supplierId: f.supplierId, ids: f.ids, to, status })
  }
  return results
}

// Dagafsluiting en kasopmaak ------------------------------------------------------

export interface CashCloseInput {
  issuer: Issuer; date: string; salesperson_id: string; counts: CashCounts
  /** Naar de bank of de kluis; de rest blijft als wisselgeld in de kas. */
  deposited: number
  /** Pintotaal volgens de pinautomaat; null = niet ingevuld. */
  card_terminal: number | null
  note: string
  /** Vandaag, voor de controle op een dag in de toekomst (tests). */
  today?: string
}

/**
 * Sluit de kassadag af voor één bedrijf: legt vast wat het systeem van die dag weet, de telling per coupure,
 * het verschil, wat is afgestort en wat als wisselgeld in de kas blijft. Daarna niet meer te wijzigen.
 */
export async function closeCashDay(db: Driver, input: CashCloseInput) {
  const s = await loadSnapshot(db)
  const today = input.today ?? todayISO()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) fail(tx("Kies een dag."))
  if (input.date > today) fail(tx("Een dag in de toekomst kun je niet afsluiten."))
  const staff = s.salespeople.find((p) => p.id === input.salesperson_id && p.is_active)
  if (!staff) fail(tx("Kies wie de kas heeft opgemaakt."))
  if (closingOn(s, input.issuer, input.date)) fail(tx("Deze dag is voor dit bedrijf al afgesloten."))
  const later = closingsOf(s, input.issuer).find((c) => c.business_date > input.date)
  if (later) fail(tx("Er is al een latere dag afgesloten ({0}). Een eerdere dag kan daarna niet meer worden afgesloten.", later.business_date))
  const counts: CashCounts = {}
  for (const d of DENOMINATIONS) {
    const n = input.counts[denomKey(d)] ?? 0
    if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) fail(tx("Vul per coupure een heel aantal van 0 of meer in."))
    if (n > 0) counts[denomKey(d)] = n
  }
  const counted = countedTotal(counts)
  const deposited = round2(input.deposited || 0)
  if (deposited < 0) fail(tx("Het afgestorte bedrag kan niet negatief zijn."))
  if (deposited > counted) fail(tx("Je kunt niet meer afstorten dan er geteld is."))
  if (input.card_terminal !== null && (!Number.isFinite(input.card_terminal) || input.card_terminal < 0)) fail(tx("Het pintotaal kan niet negatief zijn."))
  const day = kassaDay(s, input.issuer, input.date)
  const opening = openingFloat(s, input.issuer, input.date)
  const calc = cashCount({ opening, cash: day.cash, counted, deposited, card: day.card, cardTerminal: input.card_terminal === null ? null : round2(input.card_terminal) })
  const note = input.note.trim()
  if ((calc.difference !== 0 || (calc.cardDifference ?? 0) !== 0) && !note) fail(tx("Er is een verschil. Licht het toe voordat je afsluit."))
  const id = newId()
  await db.insert('cash_closings', [{
    id, issuer: input.issuer, business_date: input.date, salesperson_id: staff!.id, opening_float: opening,
    cash_sales: day.cash, card_sales: day.card, other_sales: day.other,
    invoice_count: day.count, first_invoice: day.first, last_invoice: day.last, base_amount: day.base, vat_amount: day.vat, total: day.total,
    counts, expected_cash: calc.expected, counted_cash: counted, difference: calc.difference,
    card_terminal: input.card_terminal === null ? null : round2(input.card_terminal),
    deposited, kept_in_drawer: calc.kept, note, created_at: new Date().toISOString(),
  }])
  return id
}
