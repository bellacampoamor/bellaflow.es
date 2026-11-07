// Alles wat uit de gegevens afgeleid wordt: voorraad, orderstatus, bedragen. Geen opslag, geen UI.
import type {
  Delivery, DocumentLanguage, InboundShipment, Invoice, Language, SalesOrder, SalesOrderLine, Snapshot, Warehouse,
} from '../data/types'

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function todayISO(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return todayISO(d)
}

export const lineTotal = (l: { qty: number; unit_price: number; discount_pct: number }) =>
  round2(l.qty * l.unit_price * (1 - l.discount_pct / 100))

/** Prijzen zijn inclusief IVA; hieruit volgen grondslag en IVA per tarief. */
export function vatBreakdown(lines: { total: number; vat_rate: number }[]) {
  const byRate = new Map<number, number>()
  for (const l of lines) byRate.set(l.vat_rate, round2((byRate.get(l.vat_rate) ?? 0) + l.total))
  const rates = [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, total]) => {
    const base = round2(total / (1 + rate / 100))
    return { rate, total, base, vat: round2(total - base) }
  })
  return {
    rates,
    base: round2(rates.reduce((s, r) => s + r.base, 0)),
    vat: round2(rates.reduce((s, r) => s + r.vat, 0)),
    total: round2(rates.reduce((s, r) => s + r.total, 0)),
  }
}

// Voorraad ---------------------------------------------------------------------

export const stockKey = (productId: string, warehouseId: string) => `${productId}|${warehouseId}`

export function onHandMap(s: Snapshot) {
  const m = new Map<string, number>()
  for (const x of s.stock_movements) {
    const k = stockKey(x.product_id, x.warehouse_id)
    m.set(k, (m.get(k) ?? 0) + x.qty)
  }
  return m
}

export function shippedQty(s: Snapshot, lineId: string) {
  const delivered = new Set(s.deliveries.filter((d) => d.status === 'delivered').map((d) => d.id))
  return s.delivery_lines
    .filter((l) => l.sales_order_line_id === lineId && delivered.has(l.delivery_id))
    .reduce((n, l) => n + l.qty, 0)
}

export function plannedQty(s: Snapshot, lineId: string) {
  const active = new Set(s.deliveries.filter((d) => d.status !== 'cancelled').map((d) => d.id))
  return s.delivery_lines
    .filter((l) => l.sales_order_line_id === lineId && active.has(l.delivery_id))
    .reduce((n, l) => n + l.qty, 0)
}

export function reservedMap(s: Snapshot) {
  // Een proforma reserveert ook: wat in de winkel gescand is, kan niet nog eens verkocht worden.
  const open = new Set(s.sales_orders.filter((o) => o.status === 'open' || o.status === 'proforma').map((o) => o.id))
  const m = new Map<string, number>()
  for (const l of s.sales_order_lines) {
    if (!l.warehouse_id || !open.has(l.sales_order_id)) continue
    const rest = l.qty - shippedQty(s, l.id)
    if (rest <= 0) continue
    const k = stockKey(l.product_id, l.warehouse_id)
    m.set(k, (m.get(k) ?? 0) + rest)
  }
  return m
}

export function shipmentLineOpen(s: Snapshot, shipmentLineId: string) {
  const line = s.inbound_shipment_lines.find((l) => l.id === shipmentLineId)
  if (!line) return 0
  const got = s.goods_receipt_lines
    .filter((r) => r.shipment_line_id === shipmentLineId)
    .reduce((n, r) => n + r.qty_received, 0)
  return Math.max(0, line.qty - got)
}

export const shipmentIsOpen = (x: InboundShipment) => x.status === 'expected' || x.status === 'partial'

export function shipmentOpenQty(s: Snapshot, shipmentId: string) {
  return s.inbound_shipment_lines
    .filter((l) => l.shipment_id === shipmentId)
    .reduce((n, l) => n + shipmentLineOpen(s, l.id), 0)
}

/** Nog te ontvangen per product, over alle open zendingen. */
export function inboundByProduct(s: Snapshot) {
  const m = new Map<string, number>()
  const pol = new Map(s.purchase_order_lines.map((l) => [l.id, l]))
  const open = new Set(s.inbound_shipments.filter(shipmentIsOpen).map((x) => x.id))
  for (const l of s.inbound_shipment_lines) {
    if (!open.has(l.shipment_id)) continue
    const pid = pol.get(l.purchase_order_line_id)?.product_id
    if (pid) m.set(pid, (m.get(pid) ?? 0) + shipmentLineOpen(s, l.id))
  }
  return m
}

/** Klantorderregels op bestelling waarvoor nog geen inkoop is gemaakt. */
/** Hoeveel van een klantorderregel is ingekocht en al binnen, en via welke inkooporders. */
export function linePurchaseStatus(s: Snapshot, lineId: string) {
  const pols = s.purchase_order_lines.filter((l) => l.sales_order_line_id === lineId && s.purchase_orders.find((p) => p.id === l.purchase_order_id)?.status === 'open')
  const shipLines = s.inbound_shipment_lines.filter((l) => pols.some((p) => p.id === l.purchase_order_line_id))
  return {
    purchased: pols.reduce((n, l) => n + l.qty, 0),
    received: s.goods_receipt_lines.filter((r) => shipLines.some((l) => l.id === r.shipment_line_id)).reduce((n, r) => n + r.qty_received, 0),
    orders: s.purchase_orders.filter((p) => pols.some((l) => l.purchase_order_id === p.id)),
    shipments: s.inbound_shipments.filter((x) => shipLines.some((l) => l.shipment_id === x.id)),
  }
}

/** Klantorderregels op bestelling, met als aantal wat nog ingekocht moet worden. */
export function linesToPurchase(s: Snapshot) {
  const open = new Set(s.sales_orders.filter((o) => o.status === 'open').map((o) => o.id))
  return s.sales_order_lines
    .filter((l) => l.source === 'bestelling' && open.has(l.sales_order_id))
    .map((l) => ({ ...l, qty: l.qty - linePurchaseStatus(s, l.id).purchased }))
    .filter((l) => l.qty > 0)
}

/** Klantorders die op een zending wachten; nodig om te zien wie een verschuiving raakt. */
export function ordersAffectedByShipment(s: Snapshot, shipmentId: string): SalesOrder[] {
  const polIds = s.inbound_shipment_lines.filter((l) => l.shipment_id === shipmentId).map((l) => l.purchase_order_line_id)
  const solIds = s.purchase_order_lines.filter((l) => polIds.includes(l.id) && l.sales_order_line_id).map((l) => l.sales_order_line_id!)
  const orderIds = new Set(s.sales_order_lines.filter((l) => solIds.includes(l.id)).map((l) => l.sales_order_id))
  return s.sales_orders.filter((o) => orderIds.has(o.id))
}

// Orders -----------------------------------------------------------------------

export const orderLines = (s: Snapshot, id: string) => s.sales_order_lines.filter((l) => l.sales_order_id === id)
export const orderTotal = (s: Snapshot, id: string) => round2(orderLines(s, id).reduce((n, l) => n + lineTotal(l), 0))

export function invoicedDeliveryLineIds(s: Snapshot) {
  return new Set(s.invoice_lines.map((l) => l.delivery_line_id).filter(Boolean) as string[])
}

export type OrderStage =
  | 'proforma' | 'geannuleerd' | 'wacht_op_goederen' | 'te_plannen' | 'gepland' | 'deels_geleverd' | 'te_factureren' | 'gefactureerd'

export const STAGE_LABEL: Record<OrderStage, string> = {
  proforma: 'Proforma', geannuleerd: 'Geannuleerd', wacht_op_goederen: 'Wacht op goederen', te_plannen: 'Te plannen', gepland: 'Gepland',
  deels_geleverd: 'Deels geleverd', te_factureren: 'Te factureren', gefactureerd: 'Gefactureerd',
}

export function orderStage(s: Snapshot, o: SalesOrder): OrderStage {
  if (o.status === 'cancelled') return 'geannuleerd'
  if (o.status === 'proforma') return 'proforma'
  const lines = orderLines(s, o.id)
  const total = lines.reduce((n, l) => n + l.qty, 0)
  const shipped = lines.reduce((n, l) => n + shippedQty(s, l.id), 0)
  const planned = lines.reduce((n, l) => n + plannedQty(s, l.id), 0)
  if (total > 0 && shipped >= total) {
    return uninvoicedDeliveries(s, o.id).length ? 'te_factureren' : 'gefactureerd'
  }
  if (shipped > 0) return 'deels_geleverd'
  if (planned >= total) return 'gepland'
  // Wat er al is kan alvast als deellevering; alleen als er niets te plannen valt wacht de order echt.
  if (lines.some((l) => l.warehouse_id && plannedQty(s, l.id) < l.qty)) return 'te_plannen'
  return 'wacht_op_goederen'
}

export function uninvoicedDeliveries(s: Snapshot, orderId: string): Delivery[] {
  const billed = invoicedDeliveryLineIds(s)
  return s.deliveries.filter(
    (d) => d.sales_order_id === orderId && d.status === 'delivered' &&
      s.delivery_lines.some((l) => l.delivery_id === d.id && !billed.has(l.id)),
  )
}

export const deliveryIsOpen = (d: Delivery) => d.status === 'planned' || d.status === 'ready' || d.status === 'in_transit'

export function deliveryValue(s: Snapshot, deliveryId: string) {
  return round2(s.delivery_lines.filter((l) => l.delivery_id === deliveryId).reduce((n, dl) => {
    const l = s.sales_order_lines.find((x) => x.id === dl.sales_order_line_id) as SalesOrderLine
    return n + lineTotal({ ...l, qty: dl.qty })
  }, 0))
}

// Betalingen -------------------------------------------------------------------

export const depositPaid = (s: Snapshot, orderId: string) =>
  round2(s.payments.filter((p) => p.sales_order_id === orderId && p.kind === 'vooruitbetaling').reduce((n, p) => n + p.amount, 0))

export const depositSettled = (s: Snapshot, orderId: string) =>
  round2(s.invoices.filter((i) => i.sales_order_id === orderId).reduce((n, i) => n + i.deposit_settled, 0))

export const depositAvailable = (s: Snapshot, orderId: string) =>
  round2(depositPaid(s, orderId) - depositSettled(s, orderId))

export function invoiceBalance(s: Snapshot, inv: Invoice) {
  const paid = s.payments.filter((p) => p.invoice_id === inv.id).reduce((n, p) => n + p.amount, 0)
  return round2(inv.total - inv.deposit_settled - paid)
}

export type InvoiceState = 'betaald' | 'open' | 'te_laat'
export function invoiceState(s: Snapshot, inv: Invoice, today = todayISO()): InvoiceState {
  if (invoiceBalance(s, inv) <= 0) return 'betaald'
  return inv.due_date < today ? 'te_laat' : 'open'
}

/** Openstaand op de hele order, inclusief wat nog niet gefactureerd is. */
export function orderOutstanding(s: Snapshot, orderId: string) {
  const paid = s.payments.filter((p) => p.sales_order_id === orderId).reduce((n, p) => n + p.amount, 0)
  return round2(orderTotal(s, orderId) - paid)
}

// Tellers voor de procesbalk ---------------------------------------------------

export function flowCounts(s: Snapshot, today = todayISO()) {
  const openShipments = s.inbound_shipments.filter(shipmentIsOpen)
  const openOrders = s.sales_orders.filter((o) => o.status === 'open')
  return {
    inkoop: linesToPurchase(s).length,
    inkomend: openShipments.filter((x) => x.transport_id && x.expected_date < today).length,
    ontvangst: s.transports.filter((t) => t.status !== 'cancelled' && t.arrival_date <= addDays(today, 7) && openLinesOnTransport(s, t.id).length > 0).length,
    levering: s.deliveries.filter((d) => deliveryIsOpen(d) && d.planned_date <= today).length,
    facturatie: openOrders.reduce((n, o) => n + uninvoicedDeliveries(s, o.id).length, 0),
  }
}

// Transport ----------------------------------------------------------------------

export function shipmentLoad(s: Snapshot, shipmentId: string) {
  const out = { colli: 0, kg: 0, m3: 0, qty: 0 }
  for (const l of s.inbound_shipment_lines.filter((x) => x.shipment_id === shipmentId)) {
    const pol = s.purchase_order_lines.find((x) => x.id === l.purchase_order_line_id)
    const p = s.products.find((x) => x.id === pol?.product_id)
    if (!p) continue
    out.qty += l.qty; out.colli += l.qty * p.colli; out.kg += l.qty * p.weight_kg; out.m3 += l.qty * p.volume_m3
  }
  return out
}

export function transportLoad(s: Snapshot, transportId: string) {
  const out = { colli: 0, kg: 0, m3: 0, qty: 0 }
  for (const x of s.inbound_shipments.filter((y) => y.transport_id === transportId && y.status !== 'closed')) {
    const l = shipmentLoad(s, x.id)
    out.colli += l.colli; out.kg += l.kg; out.m3 += l.m3; out.qty += l.qty
  }
  return { ...out, m3: Math.round(out.m3 * 10) / 10 }
}


/** Vrije voorraad van een product over alle actieve locaties. */
export const freeTotal = (s: Snapshot, productId: string | null | undefined) =>
  productId ? s.warehouses.filter((w) => w.is_active).reduce((n, w) => n + Math.max(0, freeAt(s, productId, w.id)), 0) : 0

/** Waar een gescande regel vandaan komt: eerst de showroom, anders de locatie met de meeste vrije voorraad. Null is op bestelling. */
export function scanWarehouse(s: Snapshot, productId: string, qty: number) {
  const active = s.warehouses.filter((w) => w.is_active)
  const showroom = active.find((w) => w.kind === 'winkel' && freeAt(s, productId, w.id) >= qty)
  if (showroom) return showroom.id
  return [...active].sort((a, b) => freeAt(s, productId, b.id) - freeAt(s, productId, a.id)).find((w) => freeAt(s, productId, w.id) > 0)?.id ?? null
}

export const freeAt = (s: Snapshot, productId: string, warehouseId: string) =>
  (onHandMap(s).get(stockKey(productId, warehouseId)) ?? 0) - (reservedMap(s).get(stockKey(productId, warehouseId)) ?? 0)

/** Inkoopregels op een transport waar nog iets van binnen moet komen. */
export function openLinesOnTransport(s: Snapshot, transportId: string) {
  const shipments = new Set(s.inbound_shipments.filter((x) => x.transport_id === transportId && shipmentIsOpen(x)).map((x) => x.id))
  return s.inbound_shipment_lines.filter((l) => shipments.has(l.shipment_id) && shipmentLineOpen(s, l.id) > 0)
}

/** Taal van een afgedrukt document: de keuze onder Beheer, of anders de taal van de klant. */
export const documentLanguage = (setting: DocumentLanguage | undefined, customer: Language): Language =>
  !setting || setting === 'klant' ? customer : setting

export interface ArchiveRow {
  delivery: Delivery; order: SalesOrder; invoice: Invoice | null; complete: boolean
}

/** Alle afgeleverde leveringen, ook van deels geleverde verkooporders. Compleet betekent dat de hele verkooporder geleverd en gefactureerd is. */
export function archiveRows(s: Snapshot): ArchiveRow[] {
  const invoiceOfLine = new Map(s.invoice_lines.map((l) => [l.delivery_line_id, l.invoice_id]))
  return s.sales_orders.flatMap((order) => {
    if (order.status === 'cancelled') return []
    const stage = orderStage(s, order)
    return s.deliveries.filter((d) => d.sales_order_id === order.id && d.status === 'delivered').map((delivery) => {
      const line = s.delivery_lines.find((l) => l.delivery_id === delivery.id && invoiceOfLine.has(l.id))
      return { delivery, order, invoice: (line && s.invoices.find((i) => i.id === invoiceOfLine.get(line.id))) || null, complete: stage === 'gefactureerd' }
    })
  }).sort((a, b) => b.order.number.localeCompare(a.order.number) || a.delivery.number.localeCompare(b.delivery.number))
}

/** Artikelnummer van een product; leeg als het product niet bestaat. */
export const articleNo = (s: Snapshot, productId: string | null | undefined) => s.products.find((p) => p.id === productId)?.sku ?? ''

/** Voorlopig komt alle inkoop binnen op het magazijn waar de route start (Magazijn Campoamor). Verhuizen kan daarna via Voorraad. */
export const inboundWarehouse = (warehouses: Warehouse[]) => warehouses.find((w) => w.is_route_origin && w.is_active && w.receives_goods)

/** Waar een inkoopregel terechtkomt: nog open is altijd het vaste magazijn, ontvangen is waar hij is ingeboekt. */
export const shipmentDestination = (s: Snapshot, x: InboundShipment) =>
  (shipmentIsOpen(x) ? inboundWarehouse(s.warehouses) : s.warehouses.find((w) => w.id === x.warehouse_id))?.name ?? ''

// Rapportage -------------------------------------------------------------------

export type ReportPeriod = 'maand' | 'kwartaal' | 'jaar' | 'vrij'

/** Periode t/m vandaag. Laatste 3 maanden loopt vanaf dezelfde dag drie maanden terug. */
export function periodRange(period: ReportPeriod, today: string, from = '', to = '') {
  if (period === 'vrij') return { from, to }
  if (period === 'maand') return { from: `${today.slice(0, 7)}-01`, to: today }
  if (period === 'jaar') return { from: `${today.slice(0, 4)}-01-01`, to: today }
  const [y, m, d] = today.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m - 3, 0)).getUTCDate()
  return { from: new Date(Date.UTC(y, m - 4, Math.min(d, lastDay))).toISOString().slice(0, 10), to: today }
}

/** Facturen binnen de periode, op factuurnummer, met totalen. Lege grens betekent geen grens. */
export function invoiceReport(s: Snapshot, from: string, to: string) {
  const invoices = s.invoices
    .filter((i) => { const day = i.invoice_date.slice(0, 10); return (!from || day >= from) && (!to || day <= to) })
    .sort((a, b) => a.number.localeCompare(b.number))
  const rows = invoices.map((invoice) => {
    const customer = s.customers.find((c) => c.id === invoice.customer_id)
    return { invoice, order: s.sales_orders.find((o) => o.id === invoice.sales_order_id), customer: customer?.company || customer?.name || '' }
  })
  const sum = (pick: (i: Invoice) => number) => round2(invoices.reduce((n, i) => n + pick(i), 0))
  return { rows, base: sum((i) => i.base_amount), vat: sum((i) => i.vat_amount), total: sum((i) => i.total) }
}

// Factuur-QR -------------------------------------------------------------------

/**
 * Adres in de QR op de factuur (Orden HAC/1177/2024, art. 21). Zolang Bella Flow geen registros naar de AEAT stuurt,
 * is dit het adres voor niet-verifieerbare systemen. Productie alleen bij een echte database, anders de testomgeving.
 */
export function invoiceQrUrl(input: { nif: string; number: string; date: string; total: number }, production: boolean) {
  const [y, m, d] = input.date.slice(0, 10).split('-')
  const base = production ? 'https://www2.agenciatributaria.gob.es' : 'https://prewww2.aeat.es'
  const q = [`nif=${encodeURIComponent(input.nif.trim().toUpperCase())}`, `numserie=${encodeURIComponent(input.number)}`, `fecha=${d}-${m}-${y}`, `importe=${input.total.toFixed(2)}`]
  return `${base}/wlpl/TIKE-CONT/ValidarQRNoVerifactu?${q.join('&')}`
}

/** Een Spaans NIF of CIF is negen tekens; de tijdelijke tekst uit de voorbeeldgegevens telt niet. */
export const hasTaxId = (nif: string) => /^[A-Z0-9]{9}$/i.test(nif.trim())

// Chauffeursapp ----------------------------------------------------------------

/** De chauffeur ziet alleen wat is klaargezet, onderweg is of al is afgeleverd. */
export const visibleToDriver = (d: Delivery) => d.method === 'eigen_team' && (d.status === 'ready' || d.status === 'in_transit' || d.status === 'delivered')

export const driverStops = (s: Snapshot, day: string) => s.deliveries
  .filter((d) => d.planned_date === day && visibleToDriver(d))
  .sort((a, b) => (a.route_position ?? 999) - (b.route_position ?? 999) || a.number.localeCompare(b.number))
