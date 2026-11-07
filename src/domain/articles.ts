// Eigen artikelnummers voor alle catalogusartikelen van alle leveranciers, inclusief elementen (subartikelen).
// Opbouw LLL-CCC-0000000000: afkorting leverancier, afkorting categorie, tiencijferig volgnummer dat uniek is over alle leveranciers.
// Een toegekend nummer wijzigt nooit. Dit bestand bevat alleen rekenwerk; opslaan loopt via de Driver.
import type { ArticleHit, ArticleQuery, CatalogArticle, CatalogArticleElement, Snapshot, Supplier } from '../data/types'
import { sameName } from './catalog'
import { showroomCategories, showroomParts } from './showroom'

/**
 * Eigen productcategorieën. De volgorde telt: de eerste regel die past wint, dus een loungekussen is een kussen
 * en een beschermhoes voor een loungeset is een hoes. Gelijk aan article_categories in de migratie.
 */
export const ARTICLE_CATEGORIES: { code: string; name: string; match: RegExp }[] = [
  { code: 'HOE', name: 'Hoezen en onderhoud', match: /hoes|hoezen|onderhoud|reinig/i },
  { code: 'KUS', name: 'Kussens', match: /kussen/i },
  { code: 'PAR', name: "Parasols en gazebo's", match: /parasol|gazebo|schaduwdoek|paviljoen/i },
  { code: 'VER', name: 'Verlichting', match: /lamp|verlichting|lantaarn|\bled\b/i },
  { code: 'LIG', name: 'Ligbedden', match: /ligbed|lounger|daybed/i },
  { code: 'POF', name: 'Voetenbanken en poefs', match: /voetenbank|poef|hocker|footstool/i },
  { code: 'LOU', name: 'Loungesets en loungemeubels', match: /lounge|hoekbank|hoekelement|tussendel|middenelement|chaise/i },
  { code: 'TSE', name: 'Tuinsets', match: /tuinset|diningset|dining set|balkonset|barset|bistroset/i },
  { code: 'STO', name: 'Stoelen', match: /stoel|fauteuil|kruk|chair/i },
  { code: 'TAF', name: 'Tafels', match: /tafel|table/i },
  { code: 'BNK', name: 'Banken', match: /bank|bench|sofa/i },
  { code: 'ACC', name: 'Accessoires', match: /accessoire|plaid|vloerkleed|bloempot|plantenbak/i },
]
export const OTHER_CATEGORY = { code: 'OVR', name: 'Overig' }
export const categoryName = (code: string) => (ARTICLE_CATEGORIES.find((c) => c.code === code) ?? OTHER_CATEGORY).name

const ruleFor = (text: string) => ARTICLE_CATEGORIES.find((c) => c.match.test(text))?.code ?? null

/** Categorie van een nieuw artikel: eerst de categorieën van de leverancier, dan de naam, dan die van het artikel waar het element van is. */
export function categoryFor(supplierCategories: string[], name: string, parentCode: string | null = null) {
  for (const c of supplierCategories) { const code = ruleFor(c); if (code) return code }
  return ruleFor(name) ?? parentCode ?? OTHER_CATEGORY.code
}

/** Verkoopprijs uit de prijs van de leverancier met de toeslag van die leverancier, afgerond op centen. */
export function priceWithSurcharge(price: number | null, supplier: Pick<Supplier, 'price_surcharge_pct'> | undefined) {
  if (price === null) return null
  const pct = Number(supplier?.price_surcharge_pct ?? 0)
  return Math.round(price * (1 + (Number.isFinite(pct) ? pct : 0) / 100) * 100) / 100
}

export const ARTICLE_NUMBER = /^[A-Z]{3}-[A-Z]{3}-\d{10}$/
export function formatArticleNumber(supplierCode: string, categoryCode: string, n: number) {
  if (!/^[A-Z]{3}$/.test(supplierCode)) throw new Error(`Ongeldige afkorting leverancier: ${supplierCode}`)
  if (!/^[A-Z]{3}$/.test(categoryCode)) throw new Error(`Ongeldige afkorting categorie: ${categoryCode}`)
  if (!Number.isInteger(n) || n < 1 || n > 9_999_999_999) throw new Error(`Volgnummer buiten bereik: ${n}`)
  return `${supplierCode}-${categoryCode}-${String(n).padStart(10, '0')}`
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const NOISE = /^(bv|nv|ua|sl|sa|slu|gmbh|ltd|inc|llc|international|holding|group|groep|de|het|the|cooperatieve|cooperatie|inkoopvereniging|vereniging)$/i

/** Voorstel voor de afkorting: de beginletters van drie woorden (Life Outdoor Living → LOL), anders de eerste drie letters (Ha-Co → HAC). */
export function suggestSupplierCode(name: string, taken: Iterable<string> = []) {
  const used = new Set([...taken].map((x) => x.toUpperCase()))
  const words = fold(name).replace(/\b([a-z])\.(?=[a-z]\.)/gi, '$1').split(/[^A-Za-z]+/).filter((w) => w.length > 1 && !NOISE.test(w.replace(/\./g, '')))
  const letters = (words.length ? words : fold(name).split(/[^A-Za-z]+/)).join('').toUpperCase().padEnd(3, 'X')
  const candidates = [
    ...(words.length >= 3 ? [words.slice(0, 3).map((w) => w[0]).join('').toUpperCase()] : []),
    letters.slice(0, 3),
  ]
  for (let i = 1; i < letters.length; i++) for (let j = i + 1; j < letters.length; j++) candidates.push(letters[0] + letters[i] + letters[j])
  for (let i = 0; i < 26 * 26; i++) candidates.push(letters[0] + String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)))
  return candidates.find((c) => /^[A-Z]{3}$/.test(c) && !used.has(c))!
}
export const validSupplierCode = (code: string | null | undefined) => !!code && /^[A-Z]{3}$/.test(code)

// Bronnen ---------------------------------------------------------------------------------------------

/** Eén artikel zoals het uit een catalogus van de leverancier komt. */
export interface ArticleSource {
  supplier_id: string; supplier_sku: string; ean: string; name: string; series: string; categories: string[]
  price: number | null; currency: string; image_url: string; source: 'showroom' | 'webshop'; active: boolean
}
export interface SourceLink { supplier_id: string; parent_sku: string; element_sku: string; position: number }

const skuKey = (supplierId: string, sku: string) => `${supplierId}|${sku.trim().toLowerCase()}`

/**
 * Alle artikelen en koppelingen uit de showroom van de leveranciers. Koppelingen: de elementen van de productpagina
 * (of, zonder productpagina, de delen uit de naam).
 */
export function articleSources(s: Pick<Snapshot, 'suppliers' | 'supplier_showroom_items' | 'supplier_showroom_details'>) {
  const supplierOf = (name: string, id?: string | null) => s.suppliers.find((x) => x.id === id) ?? s.suppliers.find((x) => sameName(x.name, name))
  const unknown = new Set<string>()
  const out = new Map<string, ArticleSource>()
  const links: SourceLink[] = []

  const { parts } = showroomParts(s.supplier_showroom_items, s.supplier_showroom_details)
  for (const x of s.supplier_showroom_items) {
    const sup = supplierOf(x.supplier_name)
    if (!sup) { unknown.add(x.supplier_name); continue }
    out.set(skuKey(sup.id, x.supplier_sku), {
      supplier_id: sup.id, supplier_sku: x.supplier_sku.trim(), ean: x.ean, name: x.name, series: x.series, categories: showroomCategories(x),
      price: x.price, currency: x.currency, image_url: x.image_url, source: 'showroom', active: x.active !== false,
    })
    ;(parts.get(x.id) ?? []).forEach((c, i) => links.push({ supplier_id: sup.id, parent_sku: x.supplier_sku, element_sku: c.supplier_sku, position: i + 1 }))
  }
  return { sources: [...out.values()], links, unknownSuppliers: [...unknown] }
}

export type NewArticle = Omit<CatalogArticle, 'id' | 'article_number' | 'created_at'> & { supplier_code: string }

/**
 * Wat er moet gebeuren om de artikelen bij te werken. Bestaande artikelen houden id, nummer en categorie; alleen
 * naam, prijs, foto en dergelijke volgen de leverancier. Verdwijnt een artikel uit een ingelezen catalogus, dan wordt
 * het inactief, nooit verwijderd. Koppelingen worden alleen toegevoegd, zodat een element altijd bij zijn artikel blijft.
 */
export function planArticleSync(
  sources: ArticleSource[], links: SourceLink[],
  existing: { articles: CatalogArticle[]; links: CatalogArticleElement[] },
  supplierCode: (supplierId: string) => string,
) {
  const byKey = new Map(existing.articles.map((a) => [skuKey(a.supplier_id, a.supplier_sku), a]))
  const srcByKey = new Map(sources.map((x) => [skuKey(x.supplier_id, x.supplier_sku), x]))

  // Categorie per artikel; een element zonder eigen categorie of herkenbare naam volgt het artikel waar het bij hoort.
  const parentsOf = new Map<string, string[]>()
  for (const l of links) {
    const k = skuKey(l.supplier_id, l.element_sku)
    parentsOf.set(k, [...(parentsOf.get(k) ?? []), skuKey(l.supplier_id, l.parent_sku)])
  }
  const codes = new Map<string, string>()
  const codeOf = (k: string, seen = new Set<string>()): string => {
    const known = byKey.get(k)?.category_code ?? codes.get(k)
    if (known) return known
    const src = srcByKey.get(k)
    if (!src) return OTHER_CATEGORY.code
    const own = categoryFor(src.categories, src.name, null)
    let code = own
    if (own === OTHER_CATEGORY.code && !seen.has(k)) {
      seen.add(k)
      const parent = (parentsOf.get(k) ?? []).map((p) => codeOf(p, seen)).find((c) => c !== OTHER_CATEGORY.code)
      code = parent ?? own
    }
    codes.set(k, code)
    return code
  }

  const updates: CatalogArticle[] = []
  const fresh: NewArticle[] = []
  for (const [k, x] of srcByKey) {
    const cur = byKey.get(k)
    const fields = { ean: x.ean, name: x.name, series: x.series, price: x.price, currency: x.currency, image_url: x.image_url, source: x.source, active: x.active }
    if (!cur) { fresh.push({ supplier_id: x.supplier_id, supplier_sku: x.supplier_sku, category_code: codeOf(k), ...fields, supplier_code: supplierCode(x.supplier_id) }); continue }
    if ((Object.keys(fields) as (keyof typeof fields)[]).some((f) => cur[f] !== fields[f])) updates.push({ ...cur, ...fields })
  }
  // Alleen leveranciers waarvan nu een catalogus is ingelezen; anders zou een lege bron alles uitzetten.
  const loaded = new Set(sources.map((x) => x.supplier_id))
  for (const a of existing.articles) if (a.active && loaded.has(a.supplier_id) && !srcByKey.has(skuKey(a.supplier_id, a.supplier_sku))) updates.push({ ...a, active: false })

  // Vaste volgorde: per leverancier, op artikelnummer van de leverancier.
  fresh.sort((a, b) => a.supplier_code.localeCompare(b.supplier_code) || a.supplier_sku.localeCompare(b.supplier_sku))
  return { updates, fresh, links }
}

/** Maakt de nieuwe artikelen met volgnummers vanaf first en zet de koppelingen om naar id's. Bestaande koppelingen blijven, nieuwe komen erbij. */
export function finishArticleSync(
  plan: ReturnType<typeof planArticleSync>, existing: { articles: CatalogArticle[]; links: CatalogArticleElement[] },
  first: number, newId: () => string, now: string,
) {
  const created: CatalogArticle[] = plan.fresh.map(({ supplier_code, ...x }, i) => ({
    ...x, id: newId(), article_number: formatArticleNumber(supplier_code, x.category_code, first + i), created_at: now,
  }))
  const idOf = new Map([...existing.articles, ...created].map((a) => [skuKey(a.supplier_id, a.supplier_sku), a.id]))
  const have = new Set(existing.links.map((l) => `${l.parent_id}|${l.element_id}`))
  const added: CatalogArticleElement[] = []
  for (const l of plan.links) {
    const parent_id = idOf.get(skuKey(l.supplier_id, l.parent_sku)), element_id = idOf.get(skuKey(l.supplier_id, l.element_sku))
    if (!parent_id || !element_id || parent_id === element_id) continue
    const k = `${parent_id}|${element_id}`
    if (have.has(k)) continue
    have.add(k); added.push({ parent_id, element_id, position: l.position })
  }
  return { created, links: added }
}

/** Afkortingen voor leveranciers die er nog geen hebben. Bestaande blijven staan. */
export function missingSupplierCodes(suppliers: Supplier[], ids: Iterable<string>) {
  const taken = new Set(suppliers.map((x) => x.code).filter((c): c is string => validSupplierCode(c)))
  const out: { id: string; code: string }[] = []
  for (const id of new Set(ids)) {
    const sup = suppliers.find((x) => x.id === id)
    if (!sup || validSupplierCode(sup.code)) continue
    const code = suggestSupplierCode(sup.name, taken)
    taken.add(code); out.push({ id, code })
  }
  return out
}

// Zoeken in het geheugen (browserversie en tests). De database doet hetzelfde met search_catalog_articles. ---------

const hayOf = (a: CatalogArticle) => `${a.article_number} ${a.supplier_sku} ${a.ean} ${a.name} ${a.series}`.toLowerCase()

/** Artikelen en koppelingen in het geheugen, met een vooraf opgebouwde zoektekst per artikel. */
export class ArticleStore {
  articles: CatalogArticle[] = []
  links: CatalogArticleElement[] = []
  private hay: string[] = []
  private byId = new Map<string, number>()
  private bySku = new Map<string, number>()
  private numbers = new Set<string>()
  private children = new Map<string, CatalogArticleElement[]>()
  private parents = new Map<string, string[]>()
  counter = 0

  save(articles: CatalogArticle[], links: CatalogArticleElement[]) {
    for (const a of structuredClone(articles)) {
      const i = this.byId.get(a.id)
      if (i === undefined) {
        if (this.bySku.has(skuKey(a.supplier_id, a.supplier_sku))) throw new Error(`Artikel ${a.supplier_sku} bestaat al bij deze leverancier.`)
        if (this.numbers.has(a.article_number)) throw new Error(`Artikelnummer ${a.article_number} bestaat al.`)
        this.numbers.add(a.article_number)
        this.byId.set(a.id, this.articles.length); this.bySku.set(skuKey(a.supplier_id, a.supplier_sku), this.articles.length)
        this.articles.push(a); this.hay.push(hayOf(a))
      } else {
        const cur = this.articles[i]
        if (cur.article_number !== a.article_number || cur.supplier_id !== a.supplier_id || cur.supplier_sku !== a.supplier_sku) throw new Error('Een artikelnummer wijzigt niet.')
        this.articles[i] = a; this.hay[i] = hayOf(a)
      }
    }
    const have = new Set(this.links.map((l) => `${l.parent_id}|${l.element_id}`))
    for (const l of links) {
      if (have.has(`${l.parent_id}|${l.element_id}`) || !this.byId.has(l.parent_id) || !this.byId.has(l.element_id)) continue
      have.add(`${l.parent_id}|${l.element_id}`)
      this.links.push({ ...l })
      const kids = this.children.get(l.parent_id) ?? []
      kids.push({ ...l }); kids.sort((a, b) => a.position - b.position)
      this.children.set(l.parent_id, kids)
      const ps = this.parents.get(l.element_id) ?? []
      ps.push(l.parent_id); this.parents.set(l.element_id, ps)
    }
  }
  private hit = (a: CatalogArticle): ArticleHit => ({ ...structuredClone(a), element_count: this.children.get(a.id)?.length ?? 0 })

  search(f: ArticleQuery): ArticleHit[] {
    const t = f.q.trim().toLowerCase()
    const words = t.split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const only = f.supplierIds ? new Set(f.supplierIds) : null
    const limit = Math.min(Math.max(f.limit ?? 30, 1), 100)
    const found: { a: CatalogArticle; rank: number }[] = []
    for (let i = 0; i < this.articles.length; i++) {
      const a = this.articles[i]
      if (!a.active || (only && !only.has(a.supplier_id))) continue
      const h = this.hay[i]
      if (!words.every((w) => h.includes(w))) continue
      const num = a.article_number.toLowerCase(), sku = a.supplier_sku.toLowerCase()
      const rank = num === t || sku === t || a.ean === t ? 0 : sku.startsWith(t) || num.startsWith(t) ? 1 : a.name.toLowerCase().startsWith(t) ? 2 : 3
      found.push({ a, rank })
    }
    return found.sort((x, y) => x.rank - y.rank || x.a.name.localeCompare(y.a.name) || x.a.article_number.localeCompare(y.a.article_number))
      .slice(0, limit).map((x) => this.hit(x.a))
  }
  find(f: { ids?: string[]; numbers?: string[]; supplierId?: string; skus?: string[] }) {
    if (f.numbers) { const want = new Set(f.numbers); return this.articles.filter((a) => want.has(a.article_number)).map((a) => structuredClone(a)) }
    if (f.ids) return f.ids.map((id) => this.byId.get(id)).filter((i): i is number => i !== undefined).map((i) => structuredClone(this.articles[i]))
    if (f.supplierId && f.skus) return f.skus.map((sku) => this.bySku.get(skuKey(f.supplierId!, sku))).filter((i): i is number => i !== undefined).map((i) => structuredClone(this.articles[i]))
    return []
  }
  elements(parentId: string) {
    return (this.children.get(parentId) ?? []).map((l) => this.articles[this.byId.get(l.element_id)!]).map(this.hit)
  }
  parentsOf(elementId: string) {
    return (this.parents.get(elementId) ?? []).map((id) => structuredClone(this.articles[this.byId.get(id)!]))
  }
  counts() {
    const m = new Map<string, number>()
    for (const a of this.articles) if (a.active) m.set(a.supplier_id, (m.get(a.supplier_id) ?? 0) + 1)
    return [...m.entries()].map(([supplier_id, n]) => ({ supplier_id, n }))
  }
  reserve(count: number) {
    if (count < 1) throw new Error('Aantal moet minstens 1 zijn.')
    const first = this.counter + 1
    this.counter += count
    return first
  }
}
