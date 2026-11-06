// Showroom van de leverancier: de dealercatalogus op variantniveau. Inlezen, filteren en onderdelen koppelen. Geen opslag, geen UI.
import type { Product, Snapshot, Supplier, SupplierShowroomItem } from '../data/types'
import { sameName } from './catalog'

export const SHOWROOM_COLUMNS = ['supplier_name', 'supplier_sku', 'name'] as const

const num = (v: string | undefined) => {
  const s = String(v ?? '').trim()
  if (!s) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const isoDate = (v: string | undefined) => {
  const s = String(v ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** Zet een csv-rij uit de showroom-export om. Het id volgt later uit wat er al is. */
export function showroomItemFromCsv(r: Record<string, string>): Omit<SupplierShowroomItem, 'id'> {
  return {
    supplier_name: r.supplier_name.trim(), supplier_sku: r.supplier_sku.trim(), name: r.name.trim(), ean: (r.ean ?? '').trim(),
    series: (r.series ?? '').trim(), categories: (r.categories ?? '').trim(), price: num(r.price), currency: r.currency || 'EUR',
    available_date: isoDate(r.available_date), available_text: (r.available_text ?? '').trim(), image_url: (r.image_url ?? '').trim(),
    product_url: (r.product_url ?? '').trim(), scraped_at: (r.scraped_at ?? '').trim() || new Date().toISOString(),
  }
}

export const showroomCategories = (x: SupplierShowroomItem) => x.categories.split('|').map((c) => c.trim()).filter(Boolean)

const PART = /\s+deel\s+(\d+)\s+van\s+(\d+)\b.*$/i
/** "Proxima vloerlamp ... met LED deel 2 van 3 voet" is deel 2 van "Proxima vloerlamp ... met LED". */
export function partOf(name: string) {
  const m = PART.exec(name)
  return m ? { base: name.slice(0, m.index).trim(), n: Number(m[1]), of: Number(m[2]) } : null
}

/**
 * Onderdelen per hoofdartikel: een artikel "X deel 1 van 3 ..." hoort bij het artikel met precies de naam X,
 * bij dezelfde leverancier. Een onderdeel zonder zo'n hoofdartikel blijft een gewoon artikel.
 */
export function showroomParts(items: SupplierShowroomItem[]) {
  const byName = new Map<string, SupplierShowroomItem>()
  for (const x of items) if (!partOf(x.name)) byName.set(`${x.supplier_name.toLowerCase()}|${x.name.toLowerCase()}`, x)
  const parts = new Map<string, SupplierShowroomItem[]>()
  const parentOf = new Map<string, SupplierShowroomItem>()
  for (const x of items) {
    const p = partOf(x.name)
    if (!p) continue
    const parent = byName.get(`${x.supplier_name.toLowerCase()}|${p.base.toLowerCase()}`)
    if (!parent) continue
    parentOf.set(x.id, parent)
    parts.set(parent.id, [...(parts.get(parent.id) ?? []), x])
  }
  for (const list of parts.values()) list.sort((a, b) => (partOf(a.name)?.n ?? 0) - (partOf(b.name)?.n ?? 0) || a.supplier_sku.localeCompare(b.supplier_sku))
  return { parts, parentOf }
}

export interface ShowroomFilter { q?: string; category?: string; series?: string }

/** De showroom van één leverancier zonder onderdelen die bij een hoofdartikel horen, gesorteerd op serie en naam. */
export function showroomOf(s: Snapshot, sup: Supplier, f: ShowroomFilter = {}, parentOf = showroomParts(s.supplier_showroom_items).parentOf) {
  const words = (f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  return s.supplier_showroom_items
    .filter((x) => sameName(x.supplier_name, sup.name) && !parentOf.has(x.id))
    .filter((x) => !f.category || showroomCategories(x).includes(f.category))
    .filter((x) => !f.series || x.series === f.series)
    .filter((x) => { const hay = `${x.name} ${x.supplier_sku} ${x.ean} ${x.series}`.toLowerCase(); return words.every((w) => hay.includes(w)) })
    .sort((a, b) => Number(!a.series) - Number(!b.series) || a.series.localeCompare(b.series) || a.name.localeCompare(b.name) || a.supplier_sku.localeCompare(b.supplier_sku))
}

/** Waarden met aantallen, voor de filters. */
export function countBy(items: SupplierShowroomItem[], key: (x: SupplierShowroomItem) => string[]) {
  const m = new Map<string, number>()
  for (const x of items) for (const k of key(x)) if (k) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, n]) => ({ name, n }))
}

/** Het eigen product onder Beheer met hetzelfde artikelnummer of dezelfde EAN, als dat er is. */
export const productForShowroom = (s: Snapshot, x: SupplierShowroomItem): Product | undefined =>
  s.products.find((p) => sameName(p.sku, x.supplier_sku) || (!!x.ean && sameName(p.sku, x.ean)))
