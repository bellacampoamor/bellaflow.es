// Dagafsluiting en kasopmaak van de kassa (opdracht Rick 8 november 2026).
// Per bedrijf (Bella en HDB apart) en per dag: geteld contant tegenover wat het systeem verwacht, met het verschil.
import type { CashClosing, Invoice, Payment, Snapshot } from '../data/types'
import { round2, vatBreakdown } from './calc'
import { issuerOf, type Issuer } from './issuers'

/** Coupures en munten in de kas, van groot naar klein. */
export const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01] as const
/** Biljetten zijn 5 euro en meer; de rest zijn munten. */
export const isNote = (d: number) => d >= 5

/** Telling per coupure: sleutel is de waarde als tekst ("50", "0.2"), waarde het aantal. */
export type CashCounts = Record<string, number>
export const denomKey = (d: number) => String(d)

export function countedTotal(counts: CashCounts) {
  return round2(DENOMINATIONS.reduce((n, d) => n + d * Math.max(0, Math.floor(counts[denomKey(d)] ?? 0)), 0))
}

const invoiceIssuer = (i: Pick<Invoice, 'issuer'>): Issuer => issuerOf(i)
const sumOf = (list: Payment[]) => round2(list.reduce((n, p) => n + p.amount, 0))

/**
 * Wat het systeem van een dag weet, voor één bedrijf: de eenvoudige facturen van de kassa met die factuurdatum,
 * en alle betalingen op die dag op eenvoudige facturen van dat bedrijf, per betaalwijze.
 */
export function kassaDay(s: Snapshot, issuer: Issuer, date: string) {
  const ofIssuer = s.invoices.filter((i) => i.simplified && invoiceIssuer(i) === issuer)
  const ids = new Set(ofIssuer.map((i) => i.id))
  const invoices = ofIssuer.filter((i) => i.invoice_date.slice(0, 10) === date).sort((a, b) => a.number.localeCompare(b.number))
  const dayIds = new Set(invoices.map((i) => i.id))
  const lines = s.invoice_lines.filter((l) => dayIds.has(l.invoice_id))
  const vat = vatBreakdown(lines.map((l) => ({ total: l.line_total, vat_rate: l.vat_rate })))
  const payments = s.payments.filter((p) => p.invoice_id && ids.has(p.invoice_id) && p.paid_at.slice(0, 10) === date)
  const by = (m: Payment['method']) => sumOf(payments.filter((p) => p.method === m))
  const paidOn = (id: string) => round2(s.payments.filter((p) => p.invoice_id === id).reduce((n, p) => n + p.amount, 0))
  const open = round2(invoices.reduce((n, i) => n + Math.max(0, round2(i.total - i.deposit_settled - paidOn(i.id))), 0))
  return {
    invoices,
    count: invoices.length,
    first: invoices[0]?.number ?? '',
    last: invoices[invoices.length - 1]?.number ?? '',
    rates: vat.rates,
    base: round2(invoices.reduce((n, i) => n + i.base_amount, 0)),
    vat: round2(invoices.reduce((n, i) => n + i.vat_amount, 0)),
    total: round2(invoices.reduce((n, i) => n + i.total, 0)),
    cash: by('contant'),
    card: by('pin'),
    other: round2(by('overboeking') + by('online')),
    open,
  }
}
export type KassaDay = ReturnType<typeof kassaDay>

export const closingsOf = (s: Snapshot, issuer: Issuer) =>
  (s.cash_closings ?? []).filter((c) => c.issuer === issuer).sort((a, b) => b.business_date.localeCompare(a.business_date))

export const closingOn = (s: Snapshot, issuer: Issuer, date: string) => closingsOf(s, issuer).find((c) => c.business_date === date)

/** Beginsaldo: wat bij de vorige afsluiting van dit bedrijf in de kas is achtergelaten (wisselgeld). Zonder vorige afsluiting 0. */
export function openingFloat(s: Snapshot, issuer: Issuer, date: string) {
  const prev = closingsOf(s, issuer).find((c) => c.business_date < date)
  return prev ? prev.kept_in_drawer : 0
}

/** De kasopmaak: verwacht contant = beginsaldo + contant ontvangen; verschil = geteld - verwacht. */
export function cashCount(input: { opening: number; cash: number; counted: number; deposited: number; card: number; cardTerminal: number | null }) {
  const expected = round2(input.opening + input.cash)
  return {
    expected,
    difference: round2(input.counted - expected),
    kept: round2(input.counted - input.deposited),
    cardDifference: input.cardTerminal === null ? null : round2(input.cardTerminal - input.card),
  }
}

/** Een opgeslagen afsluiting: komt het systeem nu nog overeen met wat er bij afsluiten stond (later geboekte kassaverkopen)? */
export function closingDrift(c: CashClosing, now: KassaDay) {
  return round2(now.cash - c.cash_sales) !== 0 || round2(now.card - c.card_sales) !== 0 || now.count !== c.invoice_count
}
