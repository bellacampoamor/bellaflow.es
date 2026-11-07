// De weg van een verkooporder door de verkoop-flow, van links naar rechts:
// Proforma (scan in de winkel) → Verkooporder → Voorraad of inkoop → Planning levering → Afleveren → Factureren.
// Per fase de stand, en voor de hele verkooporder of er iets te doen is (opvolgen), of dat hij wacht of klaar is.
import type { SalesOrder, Snapshot } from '../data/types'
import { invoiceBalance, isDomesticShipment, linePurchaseStatus, orderLines, plannedQty, shippedQty, todayISO, uninvoicedDeliveries } from './calc'

const purchaseListHref = '#inkoop-lijst-opvolgen-proforma'

export const PHASES = ['proforma', 'verkooporder', 'goederen', 'planning', 'afleveren', 'factureren'] as const
export type PhaseKey = typeof PHASES[number]

export const PHASE_LABEL: Record<PhaseKey, string> = {
  proforma: 'Proforma', verkooporder: 'Verkooporder', goederen: 'Voorraad of inkoop',
  planning: 'Planning levering', afleveren: 'Afleveren', factureren: 'Factureren',
}
export const PHASE_HINT: Record<PhaseKey, string> = {
  proforma: 'Gescand in de winkel',
  verkooporder: 'Klant bevestigd',
  goederen: 'Op voorraad of ingekocht en ontvangen',
  planning: 'Bezorgdag gekozen',
  afleveren: 'Afleverbon getekend',
  factureren: 'Proforma gefactureerd',
}

/**
 * done: afgerond. actie: wij moeten iets doen. laat: te laat, eerst doen. wacht: loopt, er hoeft nu niets.
 * open: komt nog, eerst moet een eerdere fase verder. skip: geldt niet voor deze verkooporder.
 */
export type PhaseState = 'done' | 'actie' | 'laat' | 'wacht' | 'open' | 'skip'
export interface Phase { key: PhaseKey; state: PhaseState; label: string; args?: (string | number)[]; href?: string; partial?: boolean }

/** Opvolgen = te laat of actie nodig. Loopt = wacht op iets buiten ons. Afgerond = alles gefactureerd. */
export type FollowUp = 'te_laat' | 'actie' | 'wacht' | 'afgerond' | 'geannuleerd'

export interface OrderFlow {
  phases: Phase[]
  follow: FollowUp
  /** De fase die nu de aandacht vraagt (of waarop gewacht wordt). Leeg bij afgerond of geannuleerd. */
  next: Phase | null
}

const RANK: Record<PhaseState, number> = { laat: 4, actie: 3, wacht: 2, open: 1, done: 0, skip: 0 }
const worst = <T extends { state: PhaseState }>(xs: T[]) => xs.reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a))

export function orderFlow(s: Snapshot, o: SalesOrder, today = todayISO()): OrderFlow {
  const id = o.id
  if (o.status === 'cancelled') {
    return { phases: PHASES.map((key) => ({ key, state: 'skip', label: '' })), follow: 'geannuleerd', next: null }
  }

  // 1. Proforma: alleen als de verkooporder in de winkel is gescand.
  const scanned = o.status === 'proforma' || s.order_events.some((e) => e.sales_order_id === id && e.kind === 'bevestigd' && e.message.startsWith('Proforma '))
  const proforma: Phase = o.status === 'proforma'
    ? { key: 'proforma', state: 'actie', label: 'Klant invullen en bevestigen', href: `#orders-wijzig-${id}` }
    : scanned ? { key: 'proforma', state: 'done', label: 'Gescand' } : { key: 'proforma', state: 'skip', label: 'Direct ingevoerd' }

  if (o.status === 'proforma') {
    const rest = (['verkooporder', 'goederen', 'planning', 'afleveren', 'factureren'] as const).map((key): Phase => ({ key, state: 'open', label: '' }))
    return { phases: [proforma, ...rest], follow: 'actie', next: proforma }
  }

  const verkooporder: Phase = { key: 'verkooporder', state: 'done', label: 'Bevestigd' }
  const lines = orderLines(s, id)
  const qty = lines.reduce((n, l) => n + l.qty, 0)
  const shipped = lines.reduce((n, l) => n + shippedQty(s, l.id), 0)
  const deliveries = s.deliveries.filter((d) => d.sales_order_id === id && d.status !== 'cancelled')
  const allTakenNow = lines.length > 0 && lines.every((l) => l.take_now)

  // 3. Voorraad of inkoop. Een regel op bestelling is binnen zodra hij een magazijn heeft (ontvangst).
  const onOrder = lines.filter((l) => l.source === 'bestelling' && shippedQty(s, l.id) < l.qty)
  const waiting = onOrder.filter((l) => !l.warehouse_id)
  let goederen: Phase
  if (allTakenNow) goederen = { key: 'goederen', state: 'done', label: 'Meegenomen' }
  else if (!lines.some((l) => l.source === 'bestelling')) goederen = { key: 'goederen', state: 'done', label: 'Uit voorraad' }
  else if (!waiting.length) goederen = { key: 'goederen', state: 'done', label: 'Ontvangen' }
  else {
    const perLine = waiting.map((l): Phase => {
      const st = linePurchaseStatus(s, l.id)
      if (st.purchased < l.qty) {
        // Direct naar de proforma-inkooporder van deze verkooporder, met het omzetten al open.
        const pf = s.purchase_orders.find((p) => p.status === 'proforma' && s.purchase_order_lines.some((x) => x.purchase_order_id === p.id && x.sales_order_line_id === l.id))
        return { key: 'goederen', state: 'actie', label: 'Inkooporder maken', href: pf ? `#inkoop-omzetten-${pf.id}` : purchaseListHref }
      }
      const open = st.shipments.filter((x) => x.status === 'expected' || x.status === 'partial')
      // Leverancier in Spanje: geen NL en geen transport, de leverancier levert bij ons af en we boeken in.
      const domestic = open.find((x) => isDomesticShipment(s, x))
      if (domestic) {
        const href = `#ontvangst-io-${domestic.purchase_order_id}`
        if (domestic.original_date < today) return { key: 'goederen', state: 'laat', label: 'Nog niet geleverd door leverancier, verwacht {0}', args: [domestic.original_date], href }
        if (domestic.original_date === today || domestic.status === 'partial') return { key: 'goederen', state: 'actie', label: 'Inboeken', href }
        return { key: 'goederen', state: 'wacht', label: 'Levering door leverancier in Spanje, verwacht {0}', args: [domestic.original_date], href }
      }
      const notInNl = open.find((x) => !x.transport_id && !x.nl_received_at)
      if (notInNl) {
        const late = notInNl.original_date < today
        return { key: 'goederen', state: late ? 'laat' : 'wacht', label: late ? 'Nog niet in NL, verwacht {0}' : 'Bij leverancier, verwacht in NL {0}', args: [notInNl.original_date], href: `#inkomend-nl-${notInNl.id}` }
      }
      const ready = open.find((x) => !x.transport_id)
      if (!open.length || ready) return { key: 'goederen', state: 'actie', label: 'Op transport zetten', href: ready ? `#inkomend-klaar-${ready.id}` : '#inkomend' }
      const first = [...open].sort((a, b) => a.expected_date.localeCompare(b.expected_date))[0]
      if (first.expected_date < today) return { key: 'goederen', state: 'laat', label: 'Ontvangst te laat, verwacht {0}', args: [first.expected_date], href: `#ontvangst-${first.transport_id}` }
      return { key: 'goederen', state: 'wacht', label: 'Onderweg uit Nederland, verwacht {0}', args: [first.expected_date], href: '#inkomend' }
    })
    goederen = { ...worst(perLine), partial: waiting.length < onOrder.length || lines.some((l) => l.source === 'voorraad') }
  }

  // 4. Planning levering: alles wat binnen is en nog niet is ingepland, kan worden gepland.
  const unplannedHere = lines.some((l) => l.warehouse_id && plannedQty(s, l.id) < l.qty)
  const allPlanned = lines.every((l) => plannedQty(s, l.id) >= l.qty)
  const openDeliveries = deliveries.filter((d) => d.status !== 'delivered').sort((a, b) => a.planned_date.localeCompare(b.planned_date))
  let planning: Phase
  if (allTakenNow) planning = { key: 'planning', state: 'skip', label: 'Klant nam mee' }
  else if (allPlanned) planning = { key: 'planning', state: 'done', label: openDeliveries.length ? 'Gepland {0}' : 'Ingepland', args: openDeliveries.length ? [openDeliveries[0].planned_date] : undefined }
  else if (unplannedHere) {
    const late = !!o.promised_date && o.promised_date < today
    planning = { key: 'planning', state: late ? 'laat' : 'actie', label: late ? 'Levering plannen, beloofd {0}' : 'Levering plannen', args: late ? [o.promised_date!] : undefined, href: `#orders-${id}`, partial: lines.some((l) => plannedQty(s, l.id) > 0) }
  } else planning = { key: 'planning', state: 'open', label: 'Wacht op goederen', partial: lines.some((l) => plannedQty(s, l.id) > 0) }

  // 5. Afleveren: klaarzetten, onderweg, getekend.
  let afleveren: Phase
  const partialShip = shipped > 0 && shipped < qty
  if (qty > 0 && shipped >= qty) {
    const last = deliveries.filter((d) => d.delivered_at).map((d) => d.delivered_at!).sort().pop()
    afleveren = allTakenNow ? { key: 'afleveren', state: 'done', label: 'Meegenomen' } : { key: 'afleveren', state: 'done', label: last ? 'Geleverd {0}' : 'Geleverd', args: last ? [last] : undefined }
  } else if (openDeliveries.length) {
    const d = openDeliveries[0]
    if (d.planned_date < today) afleveren = { key: 'afleveren', state: 'laat', label: 'Te laat, gepland {0}', args: [d.planned_date], href: `#levering-naar-${d.id}` }
    else if (d.status === 'planned' && d.planned_date <= today) afleveren = { key: 'afleveren', state: 'actie', label: 'Klaarzetten', href: `#levering-naar-${d.id}` }
    else if (d.status === 'in_transit') afleveren = { key: 'afleveren', state: 'wacht', label: 'Onderweg naar de klant', href: `#levering-naar-${d.id}` }
    else if (d.status === 'ready') afleveren = { key: 'afleveren', state: 'wacht', label: 'Klaargezet voor {0}', args: [d.planned_date], href: `#levering-naar-${d.id}` }
    else afleveren = { key: 'afleveren', state: 'wacht', label: 'Bezorging {0}', args: [d.planned_date], href: `#levering-naar-${d.id}` }
    afleveren.partial = partialShip
  } else afleveren = { key: 'afleveren', state: 'open', label: partialShip ? '{0} van {1} geleverd' : '', args: partialShip ? [shipped, qty] : undefined, partial: partialShip }

  // 6. Factureren: elke afgemelde levering staat als proforma (PF) klaar; deelleveringen worden direct gefactureerd.
  const toBill = uninvoicedDeliveries(s, id)
  const invoices = s.invoices.filter((i) => i.sales_order_id === id)
  const overdue = invoices.find((i) => invoiceBalance(s, i) > 0 && i.due_date < today)
  let factureren: Phase
  if (toBill.length) factureren = { key: 'factureren', state: 'actie', label: toBill.length === 1 ? 'Factureren {0}' : 'Factureren, {0} proforma\'s', args: [toBill.length === 1 ? toBill[0].proforma_number ?? '' : toBill.length], href: `#facturatie-naar-${toBill[0].id}`, partial: shipped < qty }
  else if (overdue) factureren = { key: 'factureren', state: 'laat', label: 'Factuur {0} vervallen', args: [overdue.number], href: `#facturatie-${overdue.id}` }
  else if (qty > 0 && shipped >= qty) {
    const open = invoices.some((i) => invoiceBalance(s, i) > 0)
    factureren = { key: 'factureren', state: 'done', label: open ? 'Gefactureerd, betaling open' : invoices.length === 1 ? invoices[0].number : 'Gefactureerd' }
  } else factureren = { key: 'factureren', state: 'open', label: invoices.length ? '{0} deelfactuur' : '', args: invoices.length ? [invoices.length] : undefined, partial: invoices.length > 0 }

  const phases = [proforma, verkooporder, goederen, planning, afleveren, factureren]
  const w = worst(phases)
  const follow: FollowUp = w.state === 'laat' ? 'te_laat' : w.state === 'actie' ? 'actie' : w.state === 'wacht' || w.state === 'open' ? 'wacht' : 'afgerond'
  // De meest dringende fase, en bij gelijke urgentie de meest linkse: die moet eerst.
  const next = follow === 'afgerond' ? null : phases.find((p) => p.state === w.state) ?? null
  return { phases, follow, next }
}

/** Huidige fase: de eerste die nog niet af is. Bij afgerond de laatste. */
export const currentPhase = (f: OrderFlow): PhaseKey =>
  (f.phases.find((p) => p.state !== 'done' && p.state !== 'skip') ?? f.phases[f.phases.length - 1]).key

const FOLLOW_RANK: Record<FollowUp, number> = { te_laat: 0, actie: 1, wacht: 2, afgerond: 3, geannuleerd: 4 }
export const followRank = (f: FollowUp) => FOLLOW_RANK[f]

export const needsFollowUp = (f: OrderFlow) => f.follow === 'te_laat' || f.follow === 'actie'

/** Aantal verkooporders (ook proforma's) waar iemand iets moet doen */
export const followUpCount = (s: Snapshot, today = todayISO()) =>
  s.sales_orders.filter((o) => o.status !== 'cancelled' && needsFollowUp(orderFlow(s, o, today))).length

// Lijst Verkooporders --------------------------------------------------------------

export type OrdersTab = 'opvolgen' | 'loopt' | 'afgerond' | 'alle'
export const ORDERS_TABS: OrdersTab[] = ['opvolgen', 'loopt', 'afgerond', 'alle']

export const inOrdersTab = (tab: OrdersTab, follow: FollowUp) =>
  tab === 'alle' || (tab === 'opvolgen' ? follow === 'te_laat' || follow === 'actie' : tab === 'loopt' ? follow === 'wacht' : follow === 'afgerond')

/** Een verkooporder hoort bij een fase als daar iets gebeurt: actie, te laat of wachten. */
export const activeIn = (f: OrderFlow, k: PhaseKey) => {
  const st = f.phases.find((p) => p.key === k)?.state
  return st === 'actie' || st === 'laat' || st === 'wacht'
}

/** Vaste link naar de lijst Verkooporders op een tabblad en eventueel een fase, bijvoorbeeld #orders-lijst-opvolgen-planning. */
export const ordersHref = (tab: OrdersTab, phase?: PhaseKey) => `#orders-lijst-${tab}${phase ? `-${phase}` : ''}`

/** Leest het deel na "orders-" terug; onbekend geeft het standaardtabblad. */
export function parseOrdersParam(param: string): { tab: OrdersTab; phase: PhaseKey | null } {
  const [, tab, phase] = param.match(/^lijst-([a-z]+)(?:-([a-z]+))?$/) ?? []
  return {
    tab: ORDERS_TABS.includes(tab as OrdersTab) ? tab as OrdersTab : 'opvolgen',
    phase: PHASES.includes(phase as PhaseKey) ? phase as PhaseKey : null,
  }
}
