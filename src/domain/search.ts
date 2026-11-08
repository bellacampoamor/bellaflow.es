// Eén zoekveld voor alles (opdracht Rick 8 november 2026): verkooporders, inkooporders, klanten, facturen,
// afleverbonnen en transporten uit de gegevens zelf; artikelen uit de catalogi zoekt de opslag (Driver.searchArticles).
import type { Snapshot } from '../data/types'
import { POS_CUSTOMER_NOTE } from './pos'

export type HitKind = 'verkooporder' | 'inkooporder' | 'klant' | 'factuur' | 'levering' | 'transport' | 'artikel'

export interface SearchHit {
  kind: HitKind
  id: string
  /** Hoofdtekst: het nummer of de naam. */
  title: string
  /** Tweede regel: klant, leverancier, datum, plaats. */
  sub: string
  /** Waar een klik naartoe gaat (hash zonder #). */
  href: string
  /** Hoger is beter: exact nummer boven begin van een woord boven ergens in de tekst. */
  score: number
}

/** Kleine letters, zonder accenten en zonder spaties aan de randen: "Almoradí" vindt ook "almoradi". */
export const fold = (v: string | null | undefined) => (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Score van één veld: exact 100, begint ermee 60, een woord begint ermee 40, staat erin 20, anders 0. */
export function fieldScore(value: string | null | undefined, q: string) {
  const v = fold(value)
  if (!v || !q) return 0
  if (v === q) return 100
  if (v.startsWith(q)) return 60
  if (v.split(/[\s,.()/-]+/).some((w) => w.startsWith(q))) return 40
  if (v.includes(q)) return 20
  // Nummers zonder streepjes typen: "vo20260016" vindt VO-2026-0016.
  if (v.replace(/[\s-]/g, '').includes(q.replace(/[\s-]/g, ''))) return 15
  return 0
}

/** Beste score over de velden, het eerste veld (het nummer) telt het zwaarst. Alle woorden van de zoekvraag moeten ergens voorkomen. */
function scoreOf(fields: (string | null | undefined)[], q: string) {
  const words = q.split(/\s+/).filter(Boolean)
  let total = 0
  for (const w of words) {
    const best = Math.max(...fields.map((f, i) => fieldScore(f, w) * (i === 0 ? 1.2 : 1)))
    if (best === 0) return 0
    total += best
  }
  // De hele zoekvraag als geheel in het nummer telt extra.
  return total + (words.length > 1 ? fieldScore(fields[0], q) : 0)
}

/** Datum zoals overal in Bella Flow: 08-11-2026. */
const dmy = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('-') : '')

const ORDER: HitKind[] = ['verkooporder', 'factuur', 'klant', 'inkooporder', 'levering', 'transport', 'artikel']

/** Zoekt in alles behalve de catalogi. Minimaal twee tekens. Per soort maximaal `perKind` resultaten, beste eerst. */
export function globalSearch(s: Snapshot, raw: string, perKind = 6): SearchHit[] {
  const q = fold(raw)
  if (q.length < 2) return []
  const customer = (id: string | null) => s.customers.find((c) => c.id === id)
  const custName = (id: string | null) => { const c = customer(id); return c ? (c.notes === POS_CUSTOMER_NOTE ? 'Kassaverkoop' : c.company || c.name) : '' }
  const supplier = (id: string) => s.suppliers.find((x) => x.id === id)?.name ?? ''
  const hits: SearchHit[] = []
  const add = (kind: HitKind, id: string, title: string, sub: string, href: string, fields: (string | null | undefined)[]) => {
    const score = scoreOf(fields, q)
    if (score > 0) hits.push({ kind, id, title, sub, href, score })
  }
  for (const o of s.sales_orders) {
    const c = customer(o.customer_id)
    add('verkooporder', o.id, o.number, [custName(o.customer_id), o.delivery_city || c?.city, dmy(o.order_date)].filter(Boolean).join(' · '), `orders-${o.id}`,
      [o.number, c?.name, c?.company, o.customer_reference, o.delivery_name, o.delivery_city, c?.phone])
  }
  for (const i of s.invoices) {
    add('factuur', i.id, i.number, [custName(i.customer_id), dmy(i.invoice_date)].filter(Boolean).join(' · '), `facturatie-${i.id}`,
      [i.number, customer(i.customer_id)?.name, customer(i.customer_id)?.company])
  }
  for (const c of s.customers) {
    if (c.notes === POS_CUSTOMER_NOTE) continue
    add('klant', c.id, c.company || c.name, [c.company ? c.name : '', c.city, c.phone, c.email].filter(Boolean).join(' · '), `instellingen-klant-${c.id}`,
      [c.name, c.company, c.email, c.phone, c.tax_id, c.city])
  }
  for (const p of s.purchase_orders) {
    add('inkooporder', p.id, p.number, [supplier(p.supplier_id), dmy(p.order_date)].filter(Boolean).join(' · '), `inkoop-${p.id}`,
      [p.number, supplier(p.supplier_id), p.supplier_reference])
  }
  for (const d of s.deliveries) {
    const o = s.sales_orders.find((x) => x.id === d.sales_order_id)
    add('levering', d.id, d.number, [o?.number, custName(o?.customer_id ?? null), dmy(d.planned_date)].filter(Boolean).join(' · '), `levering-${d.id}`,
      [d.number, d.proforma_number])
  }
  for (const t of s.transports) {
    add('transport', t.id, t.number, [t.carrier, dmy(t.arrival_date)].filter(Boolean).join(' · '), `ontvangst-${t.id}`, [t.number, t.reference, t.carrier])
  }
  const out: SearchHit[] = []
  for (const kind of ORDER) {
    out.push(...hits.filter((h) => h.kind === kind).sort((a, b) => b.score - a.score || b.title.localeCompare(a.title)).slice(0, perKind))
  }
  return out
}

/** Volgorde van de groepen: de soort met de beste treffer eerst, daarna de vaste volgorde. */
export function groupHits(hits: SearchHit[]) {
  const groups = ORDER.map((kind) => ({ kind, hits: hits.filter((h) => h.kind === kind) })).filter((g) => g.hits.length)
  const best = (g: { hits: SearchHit[] }) => Math.max(...g.hits.map((h) => h.score))
  return groups.sort((a, b) => best(b) - best(a) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
}
