// Showroom van de leverancier: de dealercatalogus op variantniveau. Inlezen, filteren en onderdelen koppelen. Geen opslag, geen UI.
import type { Product, ShowroomSpec, Snapshot, Supplier, SupplierShowroomDetail, SupplierShowroomItem } from '../data/types'
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
    ...(r.active !== undefined && r.active !== '' ? { active: r.active === 'true' } : {}),
    ...(r.listed !== undefined && r.listed !== '' ? { listed: r.listed === 'true' } : {}),
    ...(r.properties ? { properties: r.properties.split('|').map((x) => x.trim()).filter(Boolean) } : {}),
    ...(r.parent_sku?.trim() ? { parent_sku: r.parent_sku.trim() } : {}),
  }
}

export const DETAIL_COLUMNS = ['supplier_name', 'supplier_sku', 'specifications', 'elements'] as const

const jsonList = <T>(v: string | undefined): T[] => {
  if (!v?.trim()) return []
  try { const x = JSON.parse(v); return Array.isArray(x) ? x as T[] : [] } catch { return [] }
}

/** Zet een csv-rij uit de detailexport om (specificaties en elementen als JSON). */
export function showroomDetailFromCsv(r: Record<string, string>): Omit<SupplierShowroomDetail, 'id'> {
  return {
    supplier_name: r.supplier_name.trim(), supplier_sku: r.supplier_sku.trim(),
    specifications: jsonList<ShowroomSpec>(r.specifications).filter((x) => x && typeof x.label === 'string').map((x) => ({ label: x.label.trim(), value: String(x.value ?? '').trim() })),
    elements: jsonList<string>(r.elements).map((x) => String(x).trim()).filter(Boolean),
    scraped_at: (r.scraped_at ?? '').trim() || new Date().toISOString(),
  }
}

export const showroomCategories = (x: SupplierShowroomItem) => x.categories.split('|').map((c) => c.trim()).filter(Boolean)

const PART = /\s+deel\s+(\d+)\s+van\s+(\d+)\b.*$/i
/** "Proxima vloerlamp ... met LED deel 2 van 3 voet" is deel 2 van "Proxima vloerlamp ... met LED". */
export function partOf(name: string) {
  const m = PART.exec(name)
  return m ? { base: name.slice(0, m.index).trim(), n: Number(m[1]), of: Number(m[2]) } : null
}

const key = (supplier: string, sku: string) => `${supplier.toLowerCase()}|${sku.toLowerCase()}`

/**
 * Elementen per artikel. Bron 1: de lijst "Elementen" op de productpagina van de showroom (supplier_showroom_details).
 * Bron 2, alleen zonder details: onderdelen uit de naam, "X deel 1 van 3 ..." hoort bij het artikel met precies de naam X.
 * hidden: artikelen die element zijn van een ander artikel; die staan niet in de lijst, alleen op de artikelkaart.
 */
export function showroomParts(items: SupplierShowroomItem[], details: SupplierShowroomDetail[] = []) {
  const bySku = new Map(items.map((x) => [key(x.supplier_name, x.supplier_sku), x]))
  const detailOf = new Map(details.map((d) => [key(d.supplier_name, d.supplier_sku), d]))
  const parts = new Map<string, SupplierShowroomItem[]>()
  const parentOf = new Map<string, SupplierShowroomItem>()
  const add = (parent: SupplierShowroomItem, child: SupplierShowroomItem) => {
    if (child.id === parent.id) return
    const list = parts.get(parent.id) ?? []
    if (!list.some((x) => x.id === child.id)) list.push(child)
    parts.set(parent.id, list)
    if (!parentOf.has(child.id)) parentOf.set(child.id, parent)
  }
  const detailIds = new Set<string>()
  for (const x of items) {
    const d = detailOf.get(key(x.supplier_name, x.supplier_sku))
    if (d) detailIds.add(x.id)
    for (const sku of d?.elements ?? []) { const c = bySku.get(key(x.supplier_name, sku)); if (c) add(x, c) }
  }
  const byName = new Map<string, SupplierShowroomItem>()
  for (const x of items) if (!partOf(x.name)) byName.set(key(x.supplier_name, x.name), x)
  const nameParts: SupplierShowroomItem[] = []
  for (const x of items) {
    const p = partOf(x.name)
    const parent = p && byName.get(key(x.supplier_name, p.base))
    if (!parent || detailOf.has(key(parent.supplier_name, parent.supplier_sku))) continue
    add(parent, x); nameParts.push(x)
  }
  // Elementen uit de showroom houden de volgorde van de showroom; onderdelen uit de naam gaan op volgorde van deel.
  for (const [id, list] of parts) if (!detailIds.has(id)) list.sort((a, b) => (partOf(a.name)?.n ?? 0) - (partOf(b.name)?.n ?? 0))
  // Een artikel dat zelf elementen heeft, blijft altijd in de lijst, ook als het element is van een ander artikel.
  for (const id of [...parentOf.keys()]) if (parts.has(id)) parentOf.delete(id)
  return { parts, parentOf, detailOf: (x: SupplierShowroomItem) => detailOf.get(key(x.supplier_name, x.supplier_sku)) }
}

export interface ShowroomFilter { q?: string; category?: string; series?: string }

/** De showroom van één leverancier zonder elementen van andere artikelen, gesorteerd op serie en naam. Zoeken vindt ook elementen. */
export function showroomOf(s: Snapshot, sup: Supplier, f: ShowroomFilter = {}, parentOf = showroomParts(s.supplier_showroom_items, s.supplier_showroom_details).parentOf) {
  const words = (f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  return s.supplier_showroom_items
    .filter((x) => sameName(x.supplier_name, sup.name) && x.active !== false && (words.length > 0 || !parentOf.has(x.id)))
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
