// Creditfacturen en retouren (opdracht Rick 8 november 2026).
// Een factuur is onwijzigbaar. Een fout, een retour of een korting achteraf wordt daarom altijd een
// creditfactuur (factura rectificativa) met negatieve bedragen, die verwijst naar de oorspronkelijke factuur.
// Een creditfactuur van een eenvoudige factuur (kassa) is zelf ook eenvoudig en komt van hetzelfde bedrijf.
import type { Invoice, InvoiceLine, Snapshot } from '../data/types'
import { invoiceBalance, round2 } from './calc'
import { issuerOf, type Issuer } from './issuers'
import { DUMMY_SKU } from './pos'

export const isCredit = (inv: Pick<Invoice, 'kind' | 'credit_of'> | undefined | null) => !!inv && (inv.kind === 'creditfactuur' || !!inv.credit_of)

/** Creditfacturen die op een factuur gemaakt zijn, oudste eerst. */
export const creditsOf = (s: Snapshot, invoiceId: string) =>
  s.invoices.filter((i) => i.credit_of === invoiceId).sort((a, b) => a.number.localeCompare(b.number))

/** Nummerreeks van de creditfactuur: eigen teller en voorvoegsel, apart van de gewone en de eenvoudige facturen. */
export const CREDIT_SERIES = {
  gewoon: { series: 'FR', field: 'prefix_invoice_credit', fallback: 'FR' },
  bella: { series: 'FRS', field: 'prefix_invoice_credit_simplified', fallback: 'FRS-BELLA' },
  hdb: { series: 'FRSH', field: 'prefix_invoice_credit_simplified_hdb', fallback: 'FRS-HDB' },
} as const

export function creditSeries(original: Pick<Invoice, 'simplified' | 'issuer'>) {
  if (!original.simplified) return CREDIT_SERIES.gewoon
  return CREDIT_SERIES[issuerOf(original) as Issuer]
}

export interface CreditableLine {
  line: InvoiceLine
  /** Product van de regel (voor de retour in voorraad); null als het niet te herleiden is. */
  product_id: string | null
  /** Diversen (eigen omschrijving) heeft geen voorraad en kan dus niet terug in voorraad. */
  stockable: boolean
  credited: number
  remaining: number
}

/** Per regel van de oorspronkelijke factuur: hoeveel er al gecrediteerd is en hoeveel er nog kan. */
export function creditableLines(s: Snapshot, invoiceId: string): CreditableLine[] {
  const creditIds = new Set(creditsOf(s, invoiceId).map((i) => i.id))
  const creditLines = s.invoice_lines.filter((l) => creditIds.has(l.invoice_id))
  return s.invoice_lines.filter((l) => l.invoice_id === invoiceId).map((line) => {
    const credited = creditLines.filter((c) => c.credits_line_id === line.id).reduce((n, c) => n + Math.abs(c.qty), 0)
    const dl = line.delivery_line_id ? s.delivery_lines.find((d) => d.id === line.delivery_line_id) : undefined
    const sol = dl ? s.sales_order_lines.find((x) => x.id === dl.sales_order_line_id) : undefined
    const product = sol ? s.products.find((p) => p.id === sol.product_id) : s.products.find((p) => !!line.article_number && p.sku === line.article_number)
    return {
      line, product_id: product?.id ?? null, stockable: !!product && product.sku !== DUMMY_SKU,
      credited, remaining: Math.max(0, line.qty - credited),
    }
  })
}

/** Wat er van een factuur nog gecrediteerd kan worden (positief bedrag incl. IVA). */
export function creditableAmount(s: Snapshot, inv: Invoice) {
  const credited = creditsOf(s, inv.id).reduce((n, c) => n + Math.abs(c.total), 0)
  return round2(Math.max(0, inv.total - credited))
}

/** Een factuur kan gecrediteerd worden als het geen creditfactuur is en er nog iets over is. */
export const canCredit = (s: Snapshot, inv: Invoice) => !isCredit(inv) && creditableAmount(s, inv) > 0

/**
 * Verdeling van een creditbedrag: eerst verrekenen met wat nog openstaat op de oorspronkelijke factuur,
 * de rest wordt terugbetaald aan de klant (of staat open als terug te betalen).
 */
export function creditSettlement(s: Snapshot, original: Invoice, creditAmount: number) {
  const open = Math.max(0, invoiceBalance(s, original))
  const settle = round2(Math.min(open, creditAmount))
  return { settle, refund: round2(creditAmount - settle) }
}

/** Betaalwijze van de oorspronkelijke factuur, als voorstel voor de terugbetaling (kassa: contant of pin). */
export function originalMethod(s: Snapshot, invoiceId: string) {
  const p = s.payments.filter((x) => x.invoice_id === invoiceId && x.amount > 0 && x.method !== 'verrekening')
  return p.length ? p[p.length - 1].method : null
}
