// De weg van een inkooporder door de inkoop-flow, van links naar rechts (besluit Rick 7 november 2026):
// Proforma → Inkooporder → Ontvangen in NL → Transport → Ontvangst in Spanje → Aflevering aan de klant.
// Per fase de stand, en voor de hele inkooporder of er iets te doen is. Zelfde oordelen als de verkoop-flow.
import type { InboundShipment, PurchaseOrder, Snapshot } from '../data/types'
import { isSpanishSupplier, shipmentDestination, shipmentIsOpen, shippedQty, todayISO } from './calc'
import type { FollowUp, PhaseState } from './orderFlow'

export const PURCHASE_PHASES = ['proforma', 'inkooporder', 'nl', 'transport', 'ontvangst', 'aflevering'] as const
export type PurchasePhaseKey = typeof PURCHASE_PHASES[number]

export const PURCHASE_PHASE_LABEL: Record<PurchasePhaseKey, string> = {
  proforma: 'Proforma', inkooporder: 'Inkooporder', nl: 'Ontvangen in NL', transport: 'Transport', ontvangst: 'Ontvangst in Spanje', aflevering: 'Aflevering',
}
export const PURCHASE_PHASE_HINT: Record<PurchasePhaseKey, string> = {
  proforma: 'Uit een verkooporder', inkooporder: 'Besteld bij de leverancier', nl: 'Klaar bij leverancier of verzamelpunt',
  transport: 'Op een vrachtwagen naar Spanje', ontvangst: 'Ingeboekt op een locatie', aflevering: 'Geleverd aan de klant',
}

export interface PurchasePhase { key: PurchasePhaseKey; state: PhaseState; label: string; args?: (string | number)[]; href?: string; partial?: boolean }
export interface PurchaseFlow { phases: PurchasePhase[]; follow: FollowUp; next: PurchasePhase | null }

const RANK: Record<PhaseState, number> = { laat: 4, actie: 3, wacht: 2, open: 1, done: 0, skip: 0 }
const worst = <T extends { state: PhaseState }>(xs: T[]) => xs.reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a))
/** Fase over alle regels: de zwaarste stand telt; "deels" als niet alle regels dezelfde stand hebben. */
function combine(key: PurchasePhaseKey, rows: PurchasePhase[]): PurchasePhase {
  if (!rows.length) return { key, state: 'open', label: '' }
  const w = worst(rows)
  return { ...w, key, partial: rows.some((r) => r.state !== w.state) }
}

export function purchaseFlow(s: Snapshot, po: PurchaseOrder, today = todayISO()): PurchaseFlow {
  if (po.status === 'cancelled') return { phases: PURCHASE_PHASES.map((key) => ({ key, state: 'skip', label: '' })), follow: 'geannuleerd', next: null }
  const forSale = po.label === 'verkoop'
  if (po.status === 'proforma') {
    const first: PurchasePhase = { key: 'proforma', state: 'actie', label: 'Omzetten naar inkooporder', href: `#inkoop-omzetten-${po.id}` }
    return { phases: [first, ...PURCHASE_PHASES.slice(1).map((key): PurchasePhase => ({ key, state: 'open', label: '' }))], follow: 'actie', next: first }
  }
  const proforma: PurchasePhase = forSale ? { key: 'proforma', state: 'done', label: 'Omgezet' } : { key: 'proforma', state: 'skip', label: 'Rechtstreeks' }
  const inkooporder: PurchasePhase = { key: 'inkooporder', state: 'done', label: 'Besteld {0}', args: [po.order_date] }

  const rows = s.inbound_shipments.filter((x) => x.purchase_order_id === po.id)
  const live = rows.filter((x) => x.status !== 'closed')
  // Leverancier in Spanje: geen Ontvangen in NL en geen transport; de leverancier brengt het met eigen vervoer en we boeken in.
  const domestic = isSpanishSupplier(s.suppliers.find((y) => y.id === po.supplier_id))
  const nl = domestic ? { key: 'nl' as const, state: 'skip' as const, label: 'Leverancier in Spanje' } : combine('nl', live.map((x) => nlPhase(x, today)))
  const transport = domestic ? { key: 'transport' as const, state: 'skip' as const, label: 'Eigen vervoer leverancier' } : combine('transport', live.map((x) => transportPhase(s, x)))
  const ontvangst = combine('ontvangst', live.map((x) => domestic ? domesticReceiptPhase(s, x, today) : receiptPhase(s, x, today)))
  const aflevering: PurchasePhase = forSale ? combine('aflevering', live.map((x) => deliveryPhase(s, x))) : { key: 'aflevering', state: 'skip', label: 'Op voorraad' }
  if (!live.length) for (const p of domestic ? [ontvangst] : [nl, transport, ontvangst]) Object.assign(p, { state: 'done', label: 'Afgesloten' })

  const phases = [proforma, inkooporder, nl, transport, ontvangst, aflevering]
  const w = worst(phases)
  const follow: FollowUp = w.state === 'laat' ? 'te_laat' : w.state === 'actie' ? 'actie' : w.state === 'wacht' || w.state === 'open' ? 'wacht' : 'afgerond'
  return { phases, follow, next: follow === 'afgerond' ? null : phases.find((p) => p.state === w.state) ?? null }
}

/** Ontvangen in NL: pas dan kan de regel op een transport. Verwacht op de besteldatum plus de levertijd van de leverancier. */
function nlPhase(x: InboundShipment, today: string): PurchasePhase {
  // Op een transport of al ontvangen betekent dat hij in NL klaarstond (ook voor gegevens van vóór dit veld).
  if (x.nl_received_at || x.transport_id || !shipmentIsOpen(x)) return { key: 'nl', state: 'done', label: x.nl_received_at ? 'In NL {0}' : 'In NL', args: x.nl_received_at ? [x.nl_received_at] : undefined }
  const late = x.original_date < today
  return { key: 'nl', state: late ? 'laat' : 'wacht', label: late ? 'Nog niet in NL, verwacht {0}' : 'Bij leverancier, verwacht {0}', args: [x.original_date], href: `#inkomend-nl-${x.id}` }
}

function transportPhase(s: Snapshot, x: InboundShipment): PurchasePhase {
  const t = s.transports.find((r) => r.id === x.transport_id)
  if (t) return { key: 'transport', state: 'done', label: '{0}, vertrek {1}', args: [t.number, t.departure_date] }
  if (!shipmentIsOpen(x)) return { key: 'transport', state: 'done', label: 'Ontvangen' }
  if (x.nl_received_at) return { key: 'transport', state: 'actie', label: 'Op transport zetten', href: `#inkomend-klaar-${x.id}` }
  return { key: 'transport', state: 'open', label: '' }
}

function receiptPhase(s: Snapshot, x: InboundShipment, today: string): PurchasePhase {
  if (x.status === 'received') return { key: 'ontvangst', state: 'done', label: 'Op {0}', args: [shipmentDestination(s, x)] }
  const t = s.transports.find((r) => r.id === x.transport_id)
  if (!t) return { key: 'ontvangst', state: 'open', label: '' }
  const href = `#ontvangst-${t.id}`
  if (x.status === 'partial') return { key: 'ontvangst', state: 'actie', label: 'Deels ontvangen, rest inboeken of afsluiten', href }
  if (t.arrival_date < today) return { key: 'ontvangst', state: 'laat', label: 'Te laat, aankomst {0}', args: [t.arrival_date], href }
  if (t.arrival_date === today || t.status === 'arrived') return { key: 'ontvangst', state: 'actie', label: 'Inboeken', href }
  return { key: 'ontvangst', state: 'wacht', label: t.status === 'departed' ? 'Onderweg, aankomst {0}' : 'Aankomst {0}', args: [t.arrival_date], href }
}

/** Ontvangst zonder transport (leverancier in Spanje): wachten tot de verwachte datum, dan inboeken; daarna te laat. */
function domesticReceiptPhase(s: Snapshot, x: InboundShipment, today: string): PurchasePhase {
  if (x.status === 'received') return { key: 'ontvangst', state: 'done', label: 'Op {0}', args: [shipmentDestination(s, x)] }
  const href = `#ontvangst-io-${x.purchase_order_id}`
  if (x.status === 'partial') return { key: 'ontvangst', state: 'actie', label: 'Deels ontvangen, rest inboeken of afsluiten', href }
  if (x.original_date < today) return { key: 'ontvangst', state: 'laat', label: 'Nog niet geleverd, verwacht {0}', args: [x.original_date], href }
  if (x.original_date === today) return { key: 'ontvangst', state: 'actie', label: 'Inboeken', href }
  return { key: 'ontvangst', state: 'wacht', label: 'Levering door leverancier, verwacht {0}', args: [x.original_date], href }
}

/** Aflevering: na ontvangst gaat de verkooporder verder in de verkoop-flow (planning, afleveren, factureren). */
function deliveryPhase(s: Snapshot, x: InboundShipment): PurchasePhase {
  const pols = s.inbound_shipment_lines.filter((l) => l.shipment_id === x.id).map((l) => s.purchase_order_lines.find((p) => p.id === l.purchase_order_line_id))
  const sols = pols.map((p) => s.sales_order_lines.find((l) => l.id === p?.sales_order_line_id)).filter(Boolean) as Snapshot['sales_order_lines']
  if (!sols.length) return { key: 'aflevering', state: 'skip', label: 'Op voorraad' }
  const so = s.sales_orders.find((o) => o.id === sols[0].sales_order_id)
  if (!so || so.status === 'cancelled') return { key: 'aflevering', state: 'skip', label: 'Verkooporder geannuleerd' }
  if (sols.every((l) => shippedQty(s, l.id) >= l.qty)) return { key: 'aflevering', state: 'done', label: 'Geleverd, {0}', args: [so.number] }
  if (x.status !== 'received') return { key: 'aflevering', state: 'open', label: '{0}', args: [so.number] }
  return { key: 'aflevering', state: 'wacht', label: 'Verder in verkooporder {0}', args: [so.number], href: `#orders-${so.id}` }
}

export const purchaseFollowUpCount = (s: Snapshot, today = todayISO()) =>
  s.purchase_orders.filter((p) => p.status !== 'cancelled').filter((p) => { const f = purchaseFlow(s, p, today).follow; return f === 'te_laat' || f === 'actie' }).length

/** Een inkooporder hoort bij een fase als daar actie, te laat of wachten is. */
export const purchaseActiveIn = (f: PurchaseFlow, k: PurchasePhaseKey) => {
  const st = f.phases.find((p) => p.key === k)?.state
  return st === 'actie' || st === 'laat' || st === 'wacht'
}

export type PurchaseTab = 'opvolgen' | 'loopt' | 'afgerond' | 'alle'
export const PURCHASE_TABS: PurchaseTab[] = ['opvolgen', 'loopt', 'afgerond', 'alle']
export const purchasesHref = (tab: PurchaseTab, phase?: PurchasePhaseKey) => `#inkoop-lijst-${tab}${phase ? `-${phase}` : ''}`
export function parsePurchasesParam(param: string): { tab: PurchaseTab; phase: PurchasePhaseKey | null } {
  if (param === 'proforma') return { tab: 'opvolgen', phase: 'proforma' }
  const [, tab, phase] = param.match(/^lijst-([a-z]+)(?:-([a-z]+))?$/) ?? []
  return {
    tab: PURCHASE_TABS.includes(tab as PurchaseTab) ? tab as PurchaseTab : 'opvolgen',
    phase: PURCHASE_PHASES.includes(phase as PurchasePhaseKey) ? phase as PurchasePhaseKey : null,
  }
}

// Rapportage: welke verkooporders kunnen worden afgeleverd -------------------------------------

export type DeliverableState = 'volledig' | 'deels' | 'nog_niet'
export interface DeliverableRow {
  orderId: string
  state: DeliverableState
  /** Nog te plannen en binnen (op een locatie), nog te plannen maar niet binnen, en al gepland maar nog niet geleverd. */
  ready: { lineId: string; qty: number; warehouseId: string; viaTransport: string | null }[]
  waiting: { lineId: string; qty: number; expected: string | null; transport: string | null }[]
  planned: number
}

/**
 * Match openstaande verkooporders met ontvangen inkoop: wat ligt er al voor de klant en kan worden gepland?
 * Volledig: alles wat nog gepland moet worden is binnen. Deels: een deel is binnen. Nog niet: niets is binnen.
 */
export function deliverableReport(s: Snapshot): DeliverableRow[] {
  const rows: DeliverableRow[] = []
  for (const o of s.sales_orders.filter((x) => x.status === 'open')) {
    const lines = s.sales_order_lines.filter((l) => l.sales_order_id === o.id)
    const ready: DeliverableRow['ready'] = []
    const waiting: DeliverableRow['waiting'] = []
    let planned = 0
    for (const l of lines) {
      const active = new Set(s.deliveries.filter((d) => d.status !== 'cancelled').map((d) => d.id))
      const plannedQty = s.delivery_lines.filter((dl) => dl.sales_order_line_id === l.id && active.has(dl.delivery_id)).reduce((n, dl) => n + dl.qty, 0)
      planned += Math.max(0, plannedQty - shippedQty(s, l.id))
      const rest = l.qty - plannedQty
      if (rest <= 0) continue
      const pol = s.purchase_order_lines.find((p) => p.sales_order_line_id === l.id && s.purchase_orders.find((po) => po.id === p.purchase_order_id)?.status === 'open')
      const sl = pol && s.inbound_shipment_lines.find((x) => x.purchase_order_line_id === pol.id)
      const x = sl && s.inbound_shipments.find((y) => y.id === sl.shipment_id)
      const t = x && s.transports.find((r) => r.id === x.transport_id)
      if (l.warehouse_id) ready.push({ lineId: l.id, qty: rest, warehouseId: l.warehouse_id, viaTransport: l.source === 'bestelling' ? t?.number ?? null : null })
      else waiting.push({ lineId: l.id, qty: rest, expected: t ? x!.expected_date : null, transport: t?.number ?? null })
    }
    if (!ready.length && !waiting.length) continue
    rows.push({ orderId: o.id, state: !waiting.length ? 'volledig' : ready.length ? 'deels' : 'nog_niet', ready, waiting, planned })
  }
  const rank: Record<DeliverableState, number> = { volledig: 0, deels: 1, nog_niet: 2 }
  const num = (id: string) => s.sales_orders.find((o) => o.id === id)?.number ?? ''
  return rows.sort((a, b) => rank[a.state] - rank[b.state] || num(a.orderId).localeCompare(num(b.orderId)))
}
