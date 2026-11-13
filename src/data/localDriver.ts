import type { Driver } from './driver'
import { tx } from '../i18n'
import { ArticleStore } from '../domain/articles'
import { TABLES, type ArticleQuery, type CatalogArticle, type CatalogListQuery, type CatalogArticleElement, type EmailAttachment, type Snapshot, type TableName } from './types'

const KEY = 'bella-flow-v1'
/** Catalogi zijn groot en komen uit de bestanden van de leverancier. Ze blijven in het geheugen en gaan niet in de browseropslag. */
const VOLATILE: TableName[] = ['supplier_showroom_items', 'supplier_showroom_details']

export function emptySnapshot(): Snapshot {
  return Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Snapshot
}

/** Bewaart alles in de browser. Als opslag geblokkeerd is, blijft het in het geheugen werken. */
export class LocalDriver implements Driver {
  data: Snapshot
  /** Catalogusartikelen met eigen artikelnummer, alleen in het geheugen; ze worden bij elke start opnieuw opgebouwd uit de catalogi. */
  articles = new ArticleStore()
  constructor(private persist = true) {
    this.data = emptySnapshot()
    if (persist) {
      try {
        const raw = localStorage.getItem(KEY)
        if (raw) this.data = { ...this.data, ...JSON.parse(raw) }
        for (const v of VOLATILE) this.data[v] = [] as never
      } catch { /* geheugen volstaat */ }
    }
  }
  private keepVolatile(next: Snapshot) {
    for (const v of VOLATILE) next[v] = this.data[v] as never
    return next
  }
  /** Een ander tabblad kan intussen hebben opgeslagen. Altijd eerst de laatste stand lezen, anders overschrijft dit tabblad die. */
  private sync() {
    if (!this.persist) return
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) this.data = this.keepVolatile({ ...emptySnapshot(), ...JSON.parse(raw) })
    } catch { /* geheugen volstaat */ }
  }
  private serialize() {
    const out: Record<string, unknown> = { ...this.data }
    for (const v of VOLATILE) delete out[v]
    return JSON.stringify(out)
  }
  get isEmpty() { return this.data.settings.length === 0 }
  private save() {
    if (!this.persist) return
    try { localStorage.setItem(KEY, this.serialize()) } catch { /* geheugen volstaat */ }
  }
  clear() { this.data = emptySnapshot(); this.articles = new ArticleStore(); this.save() }
  async searchArticles(q: ArticleQuery) { return this.articles.search(q) }
  async listArticles(f: CatalogListQuery) { return this.articles.list(f) }
  async findArticles(f: { ids?: string[]; numbers?: string[]; supplierId?: string; skus?: string[]; skuPrefix?: string; limit?: number }) { return this.articles.find(f) }
  async articleElements(parentId: string) { return this.articles.elements(parentId) }
  async articleParents(elementId: string) { return this.articles.parentsOf(elementId) }
  // De browserversie kent geen verzamelartikelen met varianten (alleen de koppeling met HA-CO in de database).
  async articleVariants(_parentId: string) { return [] }
  async articleCounts() { return this.articles.counts() }
  async articleIndex() { return { articles: structuredClone(this.articles.articles), links: structuredClone(this.articles.links) } }
  async saveArticles(articles: CatalogArticle[], links: CatalogArticleElement[]) { this.articles.save(articles, links) }
  async reserveArticleNumbers(count: number) { return this.articles.reserve(count) }
  async wipeTestData(by: string, customers: boolean) {
    this.sync()
    if (this.data.settings.some((s) => s.live_since)) throw new Error(tx("Bella Flow is live: testgegevens wissen kan niet meer."))
    const out: Record<string, number> = {}
    const count: [TableName, string][] = [['hdb_shopify_orders', 'shopify'], ['email_outbox', 'mails'], ['payments', 'betalingen'], ['invoices', 'facturen'], ['deliveries', 'leveringen'], ['goods_receipts', 'ontvangsten'], ['purchase_orders', 'inkooporders'], ['transports', 'transporten'], ['sales_orders', 'verkooporders'], ['cash_closings', 'dagafsluitingen'], ['stock_movements', 'mutaties'], ['products', 'producten']]
    for (const [t, k] of count) out[k] = this.data[t].length
    const wipe: TableName[] = ['hdb_shopify_orders', 'email_outbox', 'payments', 'invoice_lines', 'invoices', 'delivery_lines', 'deliveries', 'goods_receipt_lines', 'goods_receipts', 'inbound_shipment_lines', 'inbound_shipments', 'purchase_order_dispatches', 'purchase_order_lines', 'purchase_orders', 'transports', 'sales_order_lines', 'order_events', 'sales_orders', 'cash_closings', 'stock_movements', 'products', 'year_closings', 'number_series']
    for (const t of wipe) this.data[t] = [] as never
    if (customers) {
      const keep = this.data.customers.filter((c) => c.notes === 'Vaste klant voor kassaverkopen zonder klantgegevens (Bella Flow).')
      out.klanten = this.data.customers.length - keep.length
      this.data.customers = keep
    }
    for (const s of this.data.settings) Object.assign(s, { fiscal_year: new Date().getFullYear(), test_wiped_at: new Date().toISOString(), test_wiped_by: by })
    this.save()
    return out
  }
  async list<T extends TableName>(table: T) {
    this.sync();
    return structuredClone(this.data[table]) as Snapshot[T]
  }
  async insert<T extends TableName>(table: T, rows: Snapshot[T][number][]) {
    this.sync();
    (this.data[table] as unknown[]).push(...structuredClone(rows)); this.save()
  }
  async upsert<T extends TableName>(table: T, rows: Snapshot[T][number][]) {
    this.sync()
    const list = this.data[table] as { id: string }[]
    const at = new Map(list.map((r, i) => [r.id, i]))
    const before = list.slice()
    for (const row of structuredClone(rows) as { id: string }[]) {
      const i = at.get(row.id)
      if (i === undefined) { at.set(row.id, list.length); list.push(row) } else list[i] = row
    }
    if (!this.persist || VOLATILE.includes(table)) return
    // Een grote catalogus kan de browseropslag vullen. Dan niets half bewaren, anders verdwijnt het bij de volgende keer lezen.
    try { localStorage.setItem(KEY, this.serialize()) } catch {
      list.splice(0, list.length, ...before)
      throw new Error(tx("De opslag van deze browser is vol. Met de database is er geen grens."))
    }
  }
  async update<T extends TableName>(table: T, id: string, patch: Partial<Snapshot[T][number]>) {
    this.sync();
    const row = (this.data[table] as { id: string }[]).find((r) => r.id === id)
    if (!row) throw new Error(`Record ${id} niet gevonden in ${table}`)
    Object.assign(row, patch); this.save()
  }
  async remove(table: TableName, id: string) {
    this.sync();
    const rows = this.data[table] as { id: string }[]
    const i = rows.findIndex((r) => r.id === id)
    if (i >= 0) rows.splice(i, 1)
    this.save()
  }
  // Voorbeeldgegevens in de browser: er gaat nooit echte mail de deur uit.
  async sendEmail(_id: string, _attachment: EmailAttachment): Promise<'sent' | 'demo'> { return 'demo' }
  // En er gaat nooit iets naar de echte Shopify van HDB.
  async pushShopifyOrders(_ids: string[]): Promise<'sent' | 'demo'> { return 'demo' }
  async nextNumber(series: string, year: number) {
    this.sync();
    const id = `${series}-${year}`
    let row = this.data.number_series.find((r) => r.id === id)
    if (!row) { row = { id, last_number: 0 }; this.data.number_series.push(row) }
    row.last_number += 1; this.save()
    return `${id}-${String(row.last_number).padStart(4, '0')}`
  }
}
