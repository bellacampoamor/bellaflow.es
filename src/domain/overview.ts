import type { Delivery, Snapshot } from '../data/types'
import {
  addDays, deliveryIsOpen, deliveryValue, depositAvailable, freeTotal, invoiceBalance, openLinesOnTransport, orderStage,
  round2, todayISO, transportLoad, uninvoicedDeliveries,
} from './calc'
import { activeIn, orderFlow, ordersHref } from './orderFlow'

/** Eén actie op het Overzicht: een aantal, met waar je het afhandelt. */
export interface OverviewAction {
  key: string
  flow: 'sell' | 'ship' | 'bill' | 'buy'
  n: number
  label: string
  href: string
  urgent: boolean
}

export interface DeliveryDay { date: string; late: boolean; deliveries: Delivery[]; ready: number }

/** Alles wat het Overzicht toont, berekend uit de snapshot. Volgorde: wat te laat is eerst. */
export function overview(s: Snapshot, today = todayISO()) {
  const openOrders = s.sales_orders.filter((o) => o.status === 'open')
  const stage = new Map(openOrders.map((o) => [o.id, orderStage(s, o)]))
  const order = (id: string) => s.sales_orders.find((o) => o.id === id)

  // Verkoop
  const salesProformas = s.sales_orders.filter((o) => o.status === 'proforma')
  // Zelfde indeling als de lijst Verkooporders: een verkooporder hoort bij een fase als daar actie, te laat of wachten is.
  const flows = new Map(openOrders.map((o) => [o.id, orderFlow(s, o, today)]))
  const byRequested = (a: { requested_date: string | null }, b: { requested_date: string | null }) => (a.requested_date ?? '9999').localeCompare(b.requested_date ?? '9999')
  const toPlan = openOrders.filter((o) => ['actie', 'laat'].includes(flows.get(o.id)!.phases.find((p) => p.key === 'planning')!.state)).sort(byRequested)
  const waiting = openOrders.filter((o) => activeIn(flows.get(o.id)!, 'goederen')).sort(byRequested)

  // Levering: open leveringen per dag, alles van vóór vandaag samen als "te laat".
  const open = s.deliveries.filter(deliveryIsOpen)
  const late = open.filter((d) => d.planned_date < today)
  const coming = open.filter((d) => d.planned_date >= today && d.planned_date <= addDays(today, 6))
  const byPos = (a: Delivery, b: Delivery) => (a.route_position ?? 999) - (b.route_position ?? 999) || a.number.localeCompare(b.number)
  const days: DeliveryDay[] = []
  if (late.length) days.push({ date: late.map((d) => d.planned_date).sort()[0], late: true, deliveries: [...late].sort((a, b) => a.planned_date.localeCompare(b.planned_date) || byPos(a, b)), ready: late.filter((d) => d.status !== 'planned').length })
  for (const date of [...new Set(coming.map((d) => d.planned_date))].sort()) {
    const ds = coming.filter((d) => d.planned_date === date).sort(byPos)
    days.push({ date, late: false, deliveries: ds, ready: ds.filter((d) => d.status !== 'planned').length })
  }
  const todayDeliveries = open.filter((d) => d.planned_date === today)
  const laterCount = open.filter((d) => d.planned_date > addDays(today, 6)).length

  // Facturatie
  const toBill = openOrders.flatMap((o) => uninvoicedDeliveries(s, o.id))
    .map((d) => ({ d, value: deliveryValue(s, d.id) }))
    .sort((a, b) => (a.d.delivered_at ?? '').localeCompare(b.d.delivered_at ?? ''))
  const openInvoices = s.invoices.map((i) => ({ i, balance: invoiceBalance(s, i) })).filter((x) => x.balance > 0)
    .sort((a, b) => a.i.due_date.localeCompare(b.i.due_date))
  const overdue = openInvoices.filter((x) => x.i.due_date < today)

  // Inkoop
  const purchaseProformas = s.purchase_orders.filter((p) => p.status === 'proforma')
  const proformaBySupplier = [...new Set(purchaseProformas.map((p) => p.supplier_id))].map((supplierId) => {
    const ids = new Set(purchaseProformas.filter((p) => p.supplier_id === supplierId).map((p) => p.id))
    const lines = s.purchase_order_lines.filter((l) => ids.has(l.purchase_order_id))
    return {
      supplierId, proformas: ids.size, qty: lines.reduce((n, l) => n + l.qty, 0),
      value: round2(lines.reduce((n, l) => n + l.qty * l.unit_cost, 0)),
    }
  }).sort((a, b) => b.proformas - a.proformas)
  const transports = s.transports
    .filter((t) => t.status !== 'cancelled' && t.arrival_date <= addDays(today, 14) && openLinesOnTransport(s, t.id).length > 0)
    .sort((a, b) => a.arrival_date.localeCompare(b.arrival_date))
    .map((t) => {
      const lines = openLinesOnTransport(s, t.id)
      const sold = lines.filter((l) => s.purchase_order_lines.find((p) => p.id === l.purchase_order_line_id)?.sales_order_line_id).length
      return { t, lines: lines.length, qty: lines.reduce((n, l) => n + l.qty, 0), sold, load: transportLoad(s, t.id) }
    })
  const lowStock = s.products.filter((p) => p.is_active && p.min_stock > 0 && freeTotal(s, p.id) < p.min_stock)

  // Geld
  const monthStart = `${today.slice(0, 7)}-01`
  const monthInvoices = s.invoices.filter((i) => i.invoice_date >= monthStart && i.invoice_date <= today)
  const money = {
    revenueMonth: round2(monthInvoices.reduce((n, i) => n + i.total, 0)),
    invoicesMonth: monthInvoices.length,
    toBill: round2(toBill.reduce((n, x) => n + x.value, 0)),
    receivable: round2(openInvoices.reduce((n, x) => n + x.balance, 0)),
    overdue: round2(overdue.reduce((n, x) => n + x.balance, 0)),
    deposits: round2(openOrders.reduce((n, o) => n + depositAvailable(s, o.id), 0)),
  }

  const actions: OverviewAction[] = [
    { key: 'lev-laat', flow: 'ship', n: late.length, label: 'Leveringen te laat', href: '#levering', urgent: true },
    { key: 'fac-laat', flow: 'bill', n: overdue.length, label: 'Facturen vervallen', href: '#facturatie', urgent: true },
    { key: 'tr-laat', flow: 'buy', n: transports.filter((x) => x.t.arrival_date < today).length, label: 'Transporten te laat', href: '#ontvangst', urgent: true },
    { key: 'lev-vandaag', flow: 'ship', n: todayDeliveries.filter((d) => d.status === 'planned').length, label: 'Vandaag nog klaar te zetten', href: '#levering', urgent: false },
    { key: 'tr-vandaag', flow: 'buy', n: transports.filter((x) => x.t.arrival_date === today).length, label: 'Transporten vandaag', href: '#ontvangst', urgent: false },
    { key: 'pro', flow: 'sell', n: salesProformas.length, label: 'Proforma-verkooporders', href: ordersHref('opvolgen', 'proforma'), urgent: false },
    { key: 'plannen', flow: 'sell', n: toPlan.length, label: 'Verkooporders te plannen', href: ordersHref('opvolgen', 'planning'), urgent: false },
    { key: 'pf', flow: 'bill', n: toBill.length, label: 'Proforma\'s te factureren', href: '#facturatie', urgent: false },
    { key: 'pio', flow: 'buy', n: purchaseProformas.length, label: 'Proforma-inkooporders om te zetten', href: '#inkoop-lijst-opvolgen-proforma', urgent: false },
  ].filter((a) => a.n > 0) as OverviewAction[]

  const links = { proformas: ordersHref('opvolgen', 'proforma'), toPlan: ordersHref('opvolgen', 'planning'), waiting: ordersHref('alle', 'goederen'), all: ordersHref('alle') }
  return {
    today, actions, money, order, links,
    sales: { proformas: salesProformas, toPlan, waiting, running: openOrders.filter((o) => stage.get(o.id) !== 'gefactureerd').length },
    delivery: { days, late: late.length, today: todayDeliveries.length, later: laterCount },
    billing: { toBill, openInvoices, overdue: overdue.length },
    purchase: { proformaBySupplier, transports, lowStock },
  }
}
export type OverviewData = ReturnType<typeof overview>
