// Kassa (POS): snelle verkoop in de winkel. De klant neemt alles direct mee en betaalt meteen.
import type { CatalogArticle, Customer, Product, Snapshot, Warehouse } from '../data/types'
import { freeAt, lineTotal, round2, stockKey, vatBreakdown } from './calc'

/** Vast artikelnummer voor een artikel met eigen omschrijving (diversen). Telt niet mee als voorraad. */
export const DUMMY_SKU = 'DIVERSEN'
/** Herkenning van de vaste klant voor kassaverkopen zonder klantgegevens. */
export const POS_CUSTOMER_NOTE = 'Vaste klant voor kassaverkopen zonder klantgegevens (Bella Flow).'

/** Grens voor een factura simplificada zonder klantgegevens (incl. IVA). Daarboven blijft het een simplificada, maar met klantgegevens. */
export const SIMPLIFIED_LIMIT = 1000

/** Welke klantgegevens ontbreken voor een factura simplificada boven de grens: naam, adres, woonplaats en NIE of paspoort. */
export function missingCustomerData(c: Pick<Customer, 'name' | 'company' | 'address' | 'city' | 'tax_id' | 'notes'>) {
  const out: string[] = []
  if (c.notes === POS_CUSTOMER_NOTE) return ['Naam', 'Adres', 'Woonplaats', 'NIE of paspoortnummer']
  if (!(c.name || c.company).trim()) out.push('Naam')
  if (!c.address.trim()) out.push('Adres')
  if (!c.city.trim()) out.push('Woonplaats')
  if (!c.tax_id.trim()) out.push('NIE of paspoortnummer')
  return out
}

export const isDummyProduct = (p: Pick<Product, 'sku'> | undefined | null) => p?.sku === DUMMY_SKU
export const isDummyCode = (code: string) => code.trim().toUpperCase() === DUMMY_SKU

/** Eén regel op de kassa: een catalogusartikel, een bestaand product of het dummy-artikel met eigen omschrijving. */
export interface PosLine {
  key: string
  article?: CatalogArticle
  product_id?: string
  dummy?: boolean
  /** Artikelnummer zoals getoond (eigen artikelnummer of DIVERSEN). */
  code: string
  description: string
  qty: number
  unit_price: number
  discount_pct: number
  vat_rate: number
}

/** Hetzelfde artikel nog eens scannen telt op bij de bestaande regel. Dummy-regels worden nooit samengevoegd. */
export function addPosLine(lines: PosLine[], line: PosLine): PosLine[] {
  if (line.dummy) return [...lines, line]
  const i = lines.findIndex((l) => !l.dummy && l.code === line.code)
  if (i < 0) return [...lines, line]
  return lines.map((l, j) => (j === i ? { ...l, qty: l.qty + line.qty } : l))
}

export function posTotals(lines: Pick<PosLine, 'qty' | 'unit_price' | 'discount_pct' | 'vat_rate'>[]) {
  const b = vatBreakdown(lines.map((l) => ({ total: lineTotal(l), vat_rate: l.vat_rate })))
  return { ...b, pieces: lines.reduce((n, l) => n + l.qty, 0), discount: round2(lines.reduce((n, l) => n + l.qty * l.unit_price, 0) - b.total) }
}

/** De winkel waar de kassa staat: de actieve winkel (Showroom Campoamor), anders het eerste actieve magazijn. */
export const posWarehouse = (warehouses: Warehouse[]) =>
  warehouses.find((w) => w.is_active && w.kind === 'winkel') ?? warehouses.find((w) => w.is_active) ?? null

/**
 * Wat de klant meeneemt maar volgens het systeem niet vrij in de winkel ligt: dat is een voorraadverschil,
 * want het artikel ligt er wel. Per product hoeveel er bijgeboekt moet worden. Dummy-artikelen tellen volledig
 * (die hebben nooit voorraad). Resolved = regels met hun product_id.
 */
export function posShortfalls(s: Snapshot, lines: { product_id: string; qty: number; dummy?: boolean }[], warehouseId: string) {
  const need = new Map<string, { qty: number; dummy: boolean }>()
  for (const l of lines) {
    const cur = need.get(l.product_id)
    need.set(l.product_id, { qty: (cur?.qty ?? 0) + l.qty, dummy: !!l.dummy || !!cur?.dummy })
  }
  const out: { product_id: string; qty: number; dummy: boolean; free: number }[] = []
  for (const [pid, n] of need) {
    const free = n.dummy ? 0 : Math.max(0, freeAt(s, pid, warehouseId))
    if (n.qty > free) out.push({ product_id: pid, qty: n.qty - free, dummy: n.dummy, free })
  }
  return out
}

/**
 * Voorraadverschil op een verkooporder (besluit Rick 11 november 2026): wat de klant meeneemt maar volgens het
 * systeem niet vrij ligt op het gekozen magazijn. Per product en magazijn hoeveel er bijgeboekt moet worden, zodat
 * de verkoop niet wordt opgehouden zolang de voorraad in Bella Flow nog niet klopt.
 */
export function takeNowShortfalls(s: Snapshot, lines: { product_id: string; qty: number; take_now: boolean; warehouse_id: string | null }[]) {
  const need = new Map<string, number>()
  for (const l of lines) if (l.take_now && l.warehouse_id && l.product_id) {
    const k = stockKey(l.product_id, l.warehouse_id)
    need.set(k, (need.get(k) ?? 0) + l.qty)
  }
  const out: { product_id: string; warehouse_id: string; qty: number; free: number }[] = []
  for (const [k, n] of need) {
    const [product_id, warehouse_id] = k.split('|')
    const free = Math.max(0, freeAt(s, product_id, warehouse_id))
    if (n > free) out.push({ product_id, warehouse_id, qty: n - free, free })
  }
  return out
}

export { stockKey }
