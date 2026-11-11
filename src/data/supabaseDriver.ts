import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Driver } from './driver'
import type { ArticleHit, ArticleQuery, CatalogArticle, CatalogListItem, CatalogListQuery, CatalogArticleElement, EmailAttachment, Snapshot, TableName } from './types'

const PAGE = 1000
const ARTICLE_COLUMNS = 'id, article_number, supplier_id, supplier_sku, ean, name, category_code, series, price, currency, image_url, source, active, created_at'

export function createSupabase(url: string, key: string) {
  return createClient(url, key)
}

export class SupabaseDriver implements Driver {
  constructor(private sb: SupabaseClient) {}

  async list<T extends TableName>(table: T) {
    const out: unknown[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb.from(table).select('*').range(from, from + PAGE - 1)
      if (error) throw new Error(error.message)
      // numeric-kolommen komen als string of getal binnen; de app rekent met getallen
      out.push(...(data ?? []).map(toNumbers))
      if (!data || data.length < PAGE) break
    }
    return out as Snapshot[T]
  }
  async insert<T extends TableName>(table: T, rows: Snapshot[T][number][]) {
    if (!rows.length) return
    const { error } = await this.sb.from(table).insert(rows as never)
    if (error) throw new Error(error.message)
  }
  async upsert<T extends TableName>(table: T, rows: Snapshot[T][number][]) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await this.sb.from(table).upsert(rows.slice(i, i + 500) as never)
      if (error) throw new Error(error.message)
    }
  }
  async update<T extends TableName>(table: T, id: string, patch: Partial<Snapshot[T][number]>) {
    const { error } = await this.sb.from(table).update(patch as never).eq('id', id)
    if (error) throw new Error(error.message)
  }
  async remove(table: TableName, id: string) {
    const { error } = await this.sb.from(table).delete().eq('id', id)
    if (error) throw new Error(error.message)
  }
  async sendEmail(id: string, attachment: EmailAttachment) {
    const { error: fileError } = await this.sb.from('email_attachments').upsert({ email_id: id, file_name: attachment.name, content_base64: attachment.base64 })
    if (fileError) throw new Error(fileError.message)
    const { error } = await this.sb.functions.invoke('send-email', { body: { id } })
    if (error) throw new Error(error.message)
    return 'sent' as const
  }
  async pushShopifyOrders(ids: string[]) {
    const { error } = await this.sb.functions.invoke('hdb-shopify', { body: ids.length ? { ids } : { pending: true } })
    if (error) throw new Error(error.message)
    return 'sent' as const
  }
  async searchArticles(q: ArticleQuery) {
    if (!q.q.trim()) return []
    const { data, error } = await this.sb.rpc('search_catalog_articles', { p_q: q.q, p_suppliers: q.supplierIds ?? null, p_limit: q.limit ?? 30 })
    if (error) throw new Error(error.message)
    return (data ?? []).map(toNumbers) as ArticleHit[]
  }
  async listArticles(f: CatalogListQuery) {
    const words = (f.q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    let query = this.sb.from('catalog_articles').select(`${ARTICLE_COLUMNS}, supplier_stock, supplier_stock_at`, { count: 'exact' })
      .eq('supplier_id', f.supplierId).eq('active', true)
    // search_text is de kleine-letterversie van nummer, artikelnummer leverancier, EAN, naam en serie (zoals search_catalog_articles)
    for (const w of words) query = query.like('search_text', `%${w.replace(/[\\%_]/g, '\\$&')}%`)
    if (f.category) query = query.eq('category_code', f.category)
    const { data, count, error } = await query.order('name').order('article_number').range(f.offset, f.offset + f.limit - 1)
    if (error) throw new Error(error.message)
    const arts = ((data ?? []) as unknown as Record<string, unknown>[]).map(toNumbers) as unknown as Omit<CatalogListItem, 'element_count'>[]
    const counts = new Map<string, number>()
    if (arts.length) {
      const { data: sub, error: e2 } = await this.sb.from('catalog_article_elements').select('parent_id').in('parent_id', arts.map((a) => a.id))
      if (e2) throw new Error(e2.message)
      for (const r of (sub ?? []) as { parent_id: string }[]) counts.set(r.parent_id, (counts.get(r.parent_id) ?? 0) + 1)
    }
    const rows: CatalogListItem[] = arts.map((a) => ({ ...a, element_count: counts.get(a.id) ?? 0 }))
    let categories: { code: string; n: number }[] | undefined
    if (f.withCategories) {
      const m = new Map<string, number>()
      for (let from = 0; ; from += PAGE) {
        const { data: c, error: e3 } = await this.sb.from('catalog_articles').select('category_code').eq('supplier_id', f.supplierId).eq('active', true).order('id').range(from, from + PAGE - 1)
        if (e3) throw new Error(e3.message)
        for (const r of (c ?? []) as { category_code: string }[]) if (r.category_code) m.set(r.category_code, (m.get(r.category_code) ?? 0) + 1)
        if (!c || c.length < PAGE) break
      }
      categories = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, n]) => ({ code, n }))
    }
    return { rows, total: count ?? rows.length, categories }
  }
  async findArticles(f: { ids?: string[]; numbers?: string[]; supplierId?: string; skus?: string[] }) {
    const out: CatalogArticle[] = []
    const keys = f.ids ?? f.numbers ?? f.skus ?? []
    for (let i = 0; i < keys.length; i += 200) {
      let query = this.sb.from('catalog_articles').select(ARTICLE_COLUMNS)
      query = f.ids ? query.in('id', keys.slice(i, i + 200)) : f.numbers ? query.in('article_number', keys.slice(i, i + 200)) : query.eq('supplier_id', f.supplierId!).in('supplier_sku', keys.slice(i, i + 200))
      const { data, error } = await query
      if (error) throw new Error(error.message)
      out.push(...((data ?? []) as unknown as Record<string, unknown>[]).map(toNumbers) as unknown as CatalogArticle[])
    }
    return out
  }
  async articleElements(parentId: string) {
    const { data, error } = await this.sb.from('catalog_article_elements').select('position, element_id').eq('parent_id', parentId).order('position')
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { element_id: string }[]
    const arts = await this.findArticles({ ids: rows.map((r) => r.element_id) })
    const counts = new Map<string, number>()
    if (arts.length) {
      const { data: sub, error: e2 } = await this.sb.from('catalog_article_elements').select('parent_id').in('parent_id', arts.map((a) => a.id))
      if (e2) throw new Error(e2.message)
      for (const r of (sub ?? []) as { parent_id: string }[]) counts.set(r.parent_id, (counts.get(r.parent_id) ?? 0) + 1)
    }
    const byId = new Map(arts.map((a) => [a.id, a]))
    return rows.map((r) => byId.get(r.element_id)).filter((a): a is CatalogArticle => !!a).map((a) => ({ ...a, element_count: counts.get(a.id) ?? 0 }))
  }
  async articleParents(elementId: string) {
    const { data, error } = await this.sb.from('catalog_article_elements').select('parent_id').eq('element_id', elementId)
    if (error) throw new Error(error.message)
    return this.findArticles({ ids: ((data ?? []) as { parent_id: string }[]).map((r) => r.parent_id) })
  }
  async articleCounts() {
    const out: { supplier_id: string; n: number }[] = []
    const { data, error } = await this.sb.from('suppliers').select('id')
    if (error) throw new Error(error.message)
    for (const { id } of (data ?? []) as { id: string }[]) {
      const { count, error: e2 } = await this.sb.from('catalog_articles').select('id', { count: 'exact', head: true }).eq('supplier_id', id).eq('active', true)
      if (e2) throw new Error(e2.message)
      if (count) out.push({ supplier_id: id, n: count })
    }
    return out
  }
  async articleIndex() {
    const page = async <T,>(table: string, cols: string, order: string) => {
      const rows: T[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await this.sb.from(table).select(cols).order(order).range(from, from + PAGE - 1)
        if (error) throw new Error(error.message)
        rows.push(...((data ?? []) as unknown as Record<string, unknown>[]).map(toNumbers) as unknown as T[])
        if (!data || data.length < PAGE) break
      }
      return rows
    }
    const [articles, links] = await Promise.all([
      page<CatalogArticle>('catalog_articles', ARTICLE_COLUMNS, 'article_number'),
      page<CatalogArticleElement>('catalog_article_elements', 'parent_id, element_id, position', 'parent_id'),
    ])
    return { articles, links }
  }
  async saveArticles(articles: CatalogArticle[], links: CatalogArticleElement[]) {
    for (let i = 0; i < articles.length; i += 500) {
      const { error } = await this.sb.from('catalog_articles').upsert(articles.slice(i, i + 500) as never)
      if (error) throw new Error(error.message)
    }
    for (let i = 0; i < links.length; i += 1000) {
      const { error } = await this.sb.from('catalog_article_elements').upsert(links.slice(i, i + 1000) as never, { onConflict: 'parent_id,element_id', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    }
  }
  async reserveArticleNumbers(count: number) {
    const { data, error } = await this.sb.rpc('reserve_article_numbers', { p_count: count })
    if (error) throw new Error(error.message)
    return Number(data)
  }
  async nextNumber(series: string, year: number) {
    const { data, error } = await this.sb.rpc('next_number', { p_series: series, p_year: year })
    if (error) throw new Error(error.message)
    return data as string
  }
}

const NUMERIC = new Set([
  'weight_kg', 'purchase_price', 'sale_price', 'vat_rate', 'unit_price', 'discount_pct', 'unit_cost',
  'volume_m3', 'capacity_m3', 'latitude', 'longitude', 'delivery_latitude', 'delivery_longitude', 'base_amount', 'vat_amount', 'total', 'deposit_settled', 'line_total', 'amount', 'price_regular', 'price_final', 'price', 'price_surcharge_pct',
])
function toNumbers(row: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...row }
  for (const k of Object.keys(out)) if (NUMERIC.has(k) && out[k] !== null) out[k] = Number(out[k])
  return out
}
