// Catalogi: artikellijsten per leverancier. Inlezen uit een csv-export, filteren en veilig tonen. Geen opslag, geen UI.
import type { CatalogCategory, CatalogImage, Product, Snapshot, Supplier, SupplierCatalogItem } from '../data/types'

/** Leest csv volgens RFC 4180: velden tussen aanhalingstekens mogen komma's, regeleinden en dubbele "" bevatten. */
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((v) => v !== '')) rows.push(row)
  const [head = [], ...body] = rows
  const keys = head.map((h) => h.trim())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])))
}

const json = <T>(v: string | undefined, empty: T): T => {
  if (!v?.trim()) return empty
  try { return JSON.parse(v) as T } catch { return empty }
}
const num = (v: string | undefined) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const orNull = (v: string | undefined) => (v?.trim() ? v.trim() : null)
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export const CATALOG_COLUMNS = ['supplier_name', 'supplier_sku', 'name'] as const

/** Zet een csv-rij om naar een catalogusartikel. Het id volgt later uit wat er al is. */
export function catalogItemFromCsv(r: Record<string, string>, supplier: Supplier | undefined): Omit<SupplierCatalogItem, 'id'> {
  return {
    supplier_id: supplier?.id ?? null, supplier_name: r.supplier_name.trim(), supplier_sku: r.supplier_sku.trim(), name: r.name.trim(),
    url_key: r.url_key ?? '', description_html: r.description_html ?? '', short_description_html: r.short_description_html ?? '',
    stock_status: r.stock_status ?? '', price_regular: num(r.price_regular), price_final: num(r.price_final), currency: r.currency || 'EUR',
    categories: json<CatalogCategory[]>(r.categories, []), image_urls: json<CatalogImage[]>(r.image_urls, []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    attributes: json<Record<string, unknown>>(r.attributes, {}), source_hash: r.source_hash ?? '', source_updated_at: orNull(r.source_updated_at),
    active: r.active === undefined || r.active === '' ? true : r.active === 'true', last_seen_run: r.last_seen_run ? num(r.last_seen_run) : null,
    last_synced_at: orNull(r.last_synced_at),
  }
}

/** Een artikel hoort bij de leverancier via supplier_id, of bij een sync zonder koppeling via de naam. */
export const belongsTo = (x: SupplierCatalogItem, sup: Supplier) => x.supplier_id === sup.id || (!x.supplier_id && sameName(x.supplier_name, sup.name))

export const mainCategory = (x: SupplierCatalogItem) => x.categories[0]?.name ?? ''
/** De meest specifieke categorie, bijvoorbeeld Dining tuinsets onder Tuinsets. */
export const subCategory = (x: SupplierCatalogItem) => x.categories.length > 1 ? x.categories[x.categories.length - 1].name : ''

export interface CatalogFilter { q?: string; category?: string; withInactive?: boolean; withElements?: boolean }

/** De artikellijst van één leverancier, zonder elementen, gesorteerd op categorie en naam. Artikelen zonder categorie staan achteraan. */
export function catalogOf(s: Snapshot, supplierId: string, f: CatalogFilter = {}) {
  const sup = s.suppliers.find((x) => x.id === supplierId)
  if (!sup) return []
  const words = (f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const isElement = elementFilter(s.supplier_catalog_items)
  return s.supplier_catalog_items
    .filter((x) => belongsTo(x, sup) && (f.withInactive || x.active) && (f.withElements || !isElement(x)))
    .filter((x) => !f.category || x.categories.some((c) => c.name === f.category))
    .filter((x) => { const hay = `${x.name} ${x.supplier_sku} ${x.categories.map((c) => c.name).join(' ')}`.toLowerCase(); return words.every((w) => hay.includes(w)) })
    .sort((a, b) => Number(!mainCategory(a)) - Number(!mainCategory(b)) || mainCategory(a).localeCompare(mainCategory(b)) || a.name.localeCompare(b.name) || a.supplier_sku.localeCompare(b.supplier_sku))
}

/** Hoofdcategorieën met aantal artikelen, voor het filter. */
export function catalogCategories(items: SupplierCatalogItem[]) {
  const m = new Map<string, number>()
  for (const x of items) { const c = mainCategory(x); if (c) m.set(c, (m.get(c) ?? 0) + 1) }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, n]) => ({ name, n }))
}

/** Het eigen product onder Beheer met hetzelfde artikelnummer bij dezelfde leverancier, als dat er is. */
export const productForItem = (s: Snapshot, x: SupplierCatalogItem): Product | undefined =>
  s.products.find((p) => sameName(p.sku, x.supplier_sku) && (!x.supplier_id || p.supplier_id === x.supplier_id))

const ALLOWED = new Set(['strong', 'b', 'em', 'i', 'u', 'br', 'p', 'ul', 'ol', 'li', 'h3', 'h4'])
/** Leveranciers-html met alleen opmaak: geen scripts, links, stijlen of attributen. */
export function safeHtml(html: string) {
  return html
    .replace(/<(script|style|iframe|object)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?([a-z0-9]+)\b[^>]*>/gi, (tag, name: string) => {
      const n = name.toLowerCase()
      if (!ALLOWED.has(n)) return ''
      if (n === 'br') return '<br>'
      return tag.startsWith('</') ? `</${n}>` : `<${n}>`
    })
    .replace(/<(?![a-z/])/gi, '&lt;')
}
export const plainText = (html: string) => safeHtml(html).replace(/<br>/g, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

/** Afbeeldingen alleen via http(s) of uit de eigen map; nooit javascript: of andere schema's. */
export function imageSrc(url: string, base = '/') {
  if (/^https?:\/\//i.test(url)) return url
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return ''
  return `${base}${url.replace(/^\//, '')}`
}

export const STOCK_STATUS: Record<string, 'good' | 'bad' | 'warn'> = { IN_STOCK: 'good', OUT_OF_STOCK: 'bad', BACKORDER: 'warn', PREORDER: 'warn' }

/**
 * Seriecode uit het artikelnummer van de leverancier: CONFIG-TIM-OPST1 en CONFIG-TIM-TUS horen bij serie TIM,
 * PRX-BBR-LMP-FLO bij PRX. Artikelnummers die met cijfers beginnen (24-1641-889) hebben geen serie.
 */
export function seriesCode(sku: string) {
  const rest = sku.replace(/^CONFIG-/i, '')
  const m = /^([A-Za-z]{2,4})-/.exec(rest)
  return m ? m[1].toUpperCase() : null
}

/**
 * Een set of opstelling volgens de categorie van de leverancier (Tuinsets, Loungeset tuin, Barset buiten, ...).
 * Hoezen en tussendelen vóór een set zijn zelf geen set.
 */
export const isSetArticle = (x: SupplierCatalogItem) =>
  x.categories.some((c) => /set/i.test(c.name)) && !x.categories.some((c) => /hoe(s|zen)|tussendel/i.test(c.name))

const seriesKey = (x: SupplierCatalogItem) => { const c = seriesCode(x.supplier_sku); return c ? `${x.supplier_name.toLowerCase()}|${c}` : null }

/** Series met minstens één actieve set. Alleen daarin zijn de losse artikelen elementen. */
function seriesWithSets(items: SupplierCatalogItem[]) {
  const out = new Set<string>()
  for (const x of items) { const k = seriesKey(x); if (k && x.active && isSetArticle(x)) out.add(k) }
  return out
}

/**
 * Element: los artikel uit een serie waarin de leverancier ook sets of opstellingen aanbiedt.
 * Het staat niet in de lijst, maar onderaan de artikelkaart van elke set uit die serie.
 */
export function elementFilter(items: SupplierCatalogItem[]) {
  const withSets = seriesWithSets(items)
  return (x: SupplierCatalogItem) => { const k = seriesKey(x); return !!k && withSets.has(k) && !isSetArticle(x) }
}

/** Elementen van een set: de losse actieve artikelen uit dezelfde serie, die erbij besteld kunnen worden. */
export function elementsOf(s: Snapshot, item: SupplierCatalogItem) {
  const key = seriesKey(item)
  if (!key || !isSetArticle(item)) return []
  return s.supplier_catalog_items
    .filter((x) => x.id !== item.id && x.active && !isSetArticle(x) && seriesKey(x) === key)
    .sort((a, b) => mainCategory(a).localeCompare(mainCategory(b)) || a.name.localeCompare(b.name) || a.supplier_sku.localeCompare(b.supplier_sku))
}

/** Aantal elementen per set in één keer, voor de lijst. */
export function elementCounts(items: SupplierCatalogItem[]) {
  const loose = new Map<string, number>()
  for (const x of items) { const k = seriesKey(x); if (k && x.active && !isSetArticle(x)) loose.set(k, (loose.get(k) ?? 0) + 1) }
  return (x: SupplierCatalogItem) => { const k = seriesKey(x); return k && isSetArticle(x) ? loose.get(k) ?? 0 : 0 }
}
