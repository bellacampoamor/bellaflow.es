// Alles wat uit de gegevens afgeleid wordt: voorraad, orderstatus, bedragen. Geen opslag, geen UI.
import type {
  Delivery, InboundShipment, Invoice, SalesOrder, SalesOrderLine, Snapshot,
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
  const open = new Set(s.sales_orders.filter((o) => o.status === 'open').map((o) => o.id))
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
export function linesToPurchase(s: Snapshot) {
  const linked = new Set(
    s.purchase_order_lines.filter((l) => {
      const po = s.purchase_orders.find((p) => p.id === l.purchase_order_id)
      return l.sales_order_line_id && po?.status === 'open'
    }).map((l) => l.sales_order_line_id),
  )
  const open = new Set(s.sales_orders.filter((o) => o.status === 'open').map((o) => o.id))
  return s.sales_order_lines.filter(
    (l) => l.source === 'bestelling' && !l.warehouse_id && open.has(l.sales_order_id) && !linked.has(l.id),
  )
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
  | 'geannuleerd' | 'wacht_op_goederen' | 'te_plannen' | 'gepland' | 'deels_geleverd' | 'te_factureren' | 'gefactureerd'

export const STAGE_LABEL: Record<OrderStage, string> = {
  geannuleerd: 'Geannuleerd', wacht_op_goederen: 'Wacht op goederen', te_plannen: 'Te plannen', gepland: 'Gepland',
  deels_geleverd: 'Deels geleverd', te_factureren: 'Te factureren', gefactureerd: 'Gefactureerd',
}

export function orderStage(s: Snapshot, o: SalesOrder): OrderStage {
  if (o.status === 'cancelled') return 'geannuleerd'
  const lines = orderLines(s, o.id)
  const total = lines.reduce((n, l) => n + l.qty, 0)
  const shipped = lines.reduce((n, l) => n + shippedQty(s, l.id), 0)
  const planned = lines.reduce((n, l) => n + plannedQty(s, l.id), 0)
  if (total > 0 && shipped >= total) {
    return uninvoicedDeliveries(s, o.id).length ? 'te_factureren' : 'gefactureerd'
  }
  if (shipped > 0) return 'deels_geleverd'
  if (planned >= total) return 'gepland'
  if (lines.some((l) => !l.warehouse_id && plannedQty(s, l.id) < l.qty)) return 'wacht_op_goederen'
  return 'te_plannen'
}

export function uninvoicedDeliveries(s: Snapshot, orderId: string): Delivery[] {
  const billed = invoicedDeliveryLineIds(s)
  return s.deliveries.filter(
    (d) => d.sales_order_id === orderId && d.status === 'delivered' &&
      s.delivery_lines.some((l) => l.delivery_id === d.id && !billed.has(l.id)),
  )
}

/** Deel van een order: dekt niet de hele order, of de order heeft meerdere leveringen. */
export function isPartialDelivery(s: Snapshot, d: Delivery) {
  const others = s.deliveries.some((x) => x.sales_order_id === d.sales_order_id && x.id !== d.id && x.status !== 'cancelled')
  const qty = s.delivery_lines.filter((l) => l.delivery_id === d.id).reduce((n, l) => n + l.qty, 0)
  return others || qty < orderLines(s, d.sales_order_id).reduce((n, l) => n + l.qty, 0)
}

/** Deelleveringen worden altijd direct gefactureerd; hele leveringen volgen de instelling. */
export const invoicesOnDelivery = (s: Snapshot, d: Delivery) =>
  isPartialDelivery(s, d) || s.settings[0]?.invoice_mode === 'auto'

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
    inkomend: openShipments.filter((x) => x.expected_date < today).length,
    ontvangst: openShipments.filter((x) => x.expected_date <= addDays(today, 7)).length,
    orders: openOrders.filter((o) => orderStage(s, o) === 'te_plannen').length,
    levering: s.deliveries.filter((d) => (d.status === 'planned' || d.status === 'in_transit') && d.planned_date <= today).length,
    facturatie: openOrders.reduce((n, o) => n + uninvoicedDeliveries(s, o.id).length, 0),
  }
}
