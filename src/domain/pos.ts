// Kassa (POS): snelle verkoop in de winkel. De klant neemt alles direct mee en betaalt meteen.
import type { CatalogArticle, Product, Snapshot, Warehouse } from '../data/types'
import { freeAt, lineTotal, round2, stockKey, vatBreakdown } from './calc'

/** Vast artikelnummer voor een artikel met eigen omschrijving (diversen). Telt niet mee als voorraad. */
export const DUMMY_SKU = 'DIVERSEN'
/** Herkenning van de vaste klant voor kassaverkopen zonder klantgegevens. */
export const POS_CUSTOMER_NOTE = 'Vaste klant voor kassaverkopen zonder klantgegevens (Bella Flow).'

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

export { stockKey }
