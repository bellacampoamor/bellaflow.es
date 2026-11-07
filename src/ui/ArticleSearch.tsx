// Artikel zoeken in de verkooporder: alle catalogi tegelijk, of alleen de gekozen catalogi.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { ArticleHit, CatalogArticle, Product } from '../data/types'
import { categoryName, priceWithSurcharge } from '../domain/articles'
import { onHandMap, reservedMap, stockKey } from '../domain/calc'
import { catalogArticleCounts, catalogArticleElements, catalogArticlesBySku, searchCatalogArticles } from '../domain/services'
import { useApp } from './app-context'
import { CatalogPhoto, Empty, eur, Modal, Pill } from './kit'
import { locale, tx } from '../i18n'

export type ArticlePick = { kind: 'product'; product: Product } | { kind: 'article'; article: CatalogArticle }

/** In welke catalogi gezocht wordt: standaard alle; de keuze blijft bewaard in deze browser. */
export interface SearchSources { off: string[] }
const KEY = 'bella-flow-zoeken-in'
export function useSearchSources() {
  const [v, setV] = useState<SearchSources>(() => {
    try { const x = JSON.parse(localStorage.getItem(KEY) ?? ''); if (x && Array.isArray(x.off)) return { off: x.off } } catch { /* standaard */ }
    return { off: [] }
  })
  const set = (next: SearchSources) => { setV(next); try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* alleen deze sessie */ } }
  return [v, set] as const
}

/** Korte naam op de knop: de afkorting van drie letters uit Beheer; zonder afkorting de naam. */
const short = (x: { name: string; code?: string | null }) => x.code?.trim() || x.name

/** Knoppen boven de productregels: in welke catalogi gezocht wordt. */
export function SearchSourceChips({ value, onChange }: { value: SearchSources; onChange: (v: SearchSources) => void }) {
  const { s, db } = useApp()
  const [counts, setCounts] = useState<{ supplier_id: string; n: number }[]>([])
  useEffect(() => { catalogArticleCounts(db).then(setCounts).catch(() => setCounts([])) }, [db])
  // Elke actieve leverancier krijgt een knop; zonder ingelezen catalogus staat die uit, met "geen catalogus".
  const withCatalog = s.suppliers.filter((x) => x.is_active).map((supplier) => ({ supplier_id: supplier.id, supplier, n: counts.find((c) => c.supplier_id === supplier.id)?.n ?? 0 }))
  const toggle = (id: string) => onChange({ ...value, off: value.off.includes(id) ? value.off.filter((x) => x !== id) : [...value.off, id] })
  const all = value.off.length === 0
  return (
    <div className="chips" role="group" aria-label={tx("Zoeken in")}>
      <span className="muted small" style={{ alignSelf: 'center' }}>{tx("Zoeken in")}:</span>
      <button type="button" className={`chip ${all ? 'on' : ''}`} aria-pressed={all} onClick={() => onChange({ off: [] })}>{tx("Alles")}</button>
      {withCatalog.map((c) => c.n === 0 ? (
        <button key={c.supplier_id} type="button" className="chip" disabled title={`${c.supplier.name}: ${tx("Nog geen catalogus ingelezen voor deze leverancier (Catalogi, Catalogus inlezen).")}`}>
          {short(c.supplier)}<span>{tx("geen catalogus")}</span>
        </button>
      ) : (
        <button key={c.supplier_id} type="button" className={`chip ${value.off.includes(c.supplier_id) ? '' : 'on'}`} aria-pressed={!value.off.includes(c.supplier_id)} onClick={() => toggle(c.supplier_id)} title={c.supplier.name}>
          {short(c.supplier)}<span>{c.n.toLocaleString(locale())}</span>
        </button>
      ))}
    </div>
  )
}

const money = (n: number | null, currency: string) => (n === null ? '–' : currency === 'EUR' ? eur(n) : `${n.toFixed(2)} ${currency}`)

/** Vrije voorraad van een product over alle locaties. */
function useFree() {
  const { s } = useApp()
  return useMemo(() => {
    const hand = onHandMap(s), res = reservedMap(s)
    return (pid: string) => s.warehouses.reduce((n, w) => n + (hand.get(stockKey(pid, w.id)) ?? 0) - (res.get(stockKey(pid, w.id)) ?? 0), 0)
  }, [s])
}

type Row = { key: string; pick: ArticlePick; hit?: ArticleHit; product?: Product }

/** Zoekveld voor één productregel: artikelen uit de catalogi, met eigen en leveranciersartikelnummer. */
export function ArticleSearch({ id, label, sources, onPick }: { id?: string; label: string; sources: SearchSources; onPick: (p: ArticlePick) => void }) {
  const { s, db } = useApp()
  const free = useFree()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(0)
  const [hits, setHits] = useState<ArticleHit[]>([])
  const [busy, setBusy] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const seq = useRef(0)

  const supplierIds = useMemo(() => s.suppliers.map((x) => x.id).filter((x) => !sources.off.includes(x)), [s.suppliers, sources.off])
  const byNumber = useMemo(() => new Map(s.products.filter((p) => p.catalog_article_number).map((p) => [p.catalog_article_number!, p])), [s.products])

  // Catalogi: de opslag zoekt, met een korte pauze na het typen zodat niet elke toets een zoekopdracht wordt.
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2 || supplierIds.length === 0) { setHits([]); setBusy(false); return }
    const n = ++seq.current
    setBusy(true)
    const timer = setTimeout(() => {
      searchCatalogArticles(db, { q: t, supplierIds: sources.off.length ? supplierIds : null, limit: 30 })
        .then((r) => { if (n === seq.current) setHits(r) })
        .catch(() => { if (n === seq.current) setHits([]) })
        .finally(() => { if (n === seq.current) setBusy(false) })
    }, 180)
    return () => clearTimeout(timer)
  }, [q, db, supplierIds, sources.off.length])

  // Alleen artikelen uit de catalogi: dat zijn de producten. Staat het artikel al als product vast, dan met verkoopprijs en voorraad.
  const rows: Row[] = [
    ...hits.map((a) => {
      const p = byNumber.get(a.article_number)
      return { key: `a${a.id}`, pick: (p ? { kind: 'product', product: p } : { kind: 'article', article: a }) as ArticlePick, hit: a, product: p }
    }),
  ]

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  useEffect(() => {
    if (!open) return
    const place = () => { const r = ref.current?.getBoundingClientRect(); if (r) setPos({ left: r.left, top: r.bottom + 3, width: Math.max(r.width, 460) }) }
    place()
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])
  const pick = (r: Row) => { onPick(r.pick); setQ(''); setOpen(false) }
  const supplierName = (id: string) => s.suppliers.find((x) => x.id === id)?.name ?? ''

  return (
    <div className="combo" ref={ref}>
      <input
        id={id} value={open ? q : label} placeholder={label || tx("Zoek op artikelnummer, artikelnummer leverancier, EAN of naam")} autoComplete="off" role="combobox" aria-expanded={open}
        onFocus={() => { setOpen(true); setHl(0) }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHl(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, rows.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)) }
          if (e.key === 'Enter') { e.preventDefault(); if (rows[hl]) pick(rows[hl]) }
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && pos && (
        <div className="combo-list article-list" role="listbox" style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: 420 }}>
          {q.trim().length < 2 ? <div className="muted small" style={{ padding: '8px 11px' }}>{tx("Typ minstens twee tekens. Zoekt in eigen artikelnummer, artikelnummer leverancier, EAN, naam en serie.")}</div>
            : rows.length === 0 ? <div className="muted small" style={{ padding: '8px 11px' }}>{busy ? tx("Zoeken…") : tx("Geen artikelen gevonden.")}</div>
            : rows.map((r, i) => {
              const a = r.hit, p = r.product
              return (
                <button key={r.key} type="button" role="option" aria-selected={i === hl} className={`article-row ${i === hl ? 'hl' : ''}`} onMouseEnter={() => setHl(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                  <CatalogPhoto url={a?.image_url} alt={a?.name ?? p?.name ?? ''} className="thumb" />
                  <span className="article-main">
                    <span className="article-nrs"><span className="strong">{a?.article_number ?? p?.sku}</span>{a && <span className="muted"> · {a.supplier_sku}</span>}</span>
                    <span>{a?.name ?? p?.name}</span>
                    <small>{a ? `${supplierName(a.supplier_id)} · ${categoryName(a.category_code)}${a.series ? ` · ${a.series}` : ''}` : ''}</small>
                  </span>
                  <span className="article-side">
                    <span className="strong">{p ? eur(p.sale_price) : money(priceWithSurcharge(a?.price ?? null, s.suppliers.find((x) => x.id === a?.supplier_id)), a?.currency ?? 'EUR')}</span>
                    {p && <small>{tx("{0} vrij", free(p.id))}</small>}
                    {a && a.element_count > 0 && <small>{tx("+{0} elementen", a.element_count)}</small>}
                    {p && a && <Pill tone="info">{tx("In assortiment")}</Pill>}
                  </span>
                </button>
              )
            })}
          {busy && rows.length > 0 && <div className="muted small" style={{ padding: '6px 11px' }}>{tx("Zoeken…")}</div>}
        </div>
      )}
    </div>
  )
}

/** De elementen van een artikel, om er direct een regel van te maken. */
export function ElementsModal({ article, onAdd, onClose }: { article: CatalogArticle; onAdd: (a: CatalogArticle) => void; onClose: () => void }) {
  const { db, s } = useApp()
  const [list, setList] = useState<ArticleHit[] | null>(null)
  const [added, setAdded] = useState<string[]>([])
  useEffect(() => { catalogArticleElements(db, article.id).then(setList).catch(() => setList([])) }, [db, article.id])
  const sup = s.suppliers.find((x) => x.id === article.supplier_id)?.name ?? ''
  return (
    <Modal wide title={tx("Elementen van {0}", article.name)} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>{tx("Sluiten")}</button>}>
      <p className="muted small" style={{ marginTop: 0 }}><span className="strong">{article.article_number}</span> · {article.supplier_sku} · {sup}</p>
      {list === null ? <Empty>{tx("Laden…")}</Empty> : list.length === 0 ? <Empty>{tx("Dit artikel heeft geen elementen.")}</Empty> : (
        <div className="table-wrap flush"><table>
          <thead><tr><th></th><th>{tx("Artikelnummer")}</th><th>{tx("Artikel")}</th><th className="num">{tx("Prijs")}</th><th></th></tr></thead>
          <tbody>{list.map((x) => (
            <tr key={x.id}>
              <td style={{ width: 64 }}><CatalogPhoto url={x.image_url} alt={x.name} className="thumb" /></td>
              <td style={{ whiteSpace: 'nowrap' }}><span className="strong">{x.article_number}</span><div className="muted small">{x.supplier_sku}</div></td>
              <td>{x.name}<div className="muted small">{categoryName(x.category_code)}</div></td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>{money(s.products.find((p) => p.catalog_article_number === x.article_number)?.sale_price ?? priceWithSurcharge(x.price, s.suppliers.find((y) => y.id === x.supplier_id)), x.currency)}</td>
              <td style={{ textAlign: 'right' }}><button type="button" className="btn sm" onClick={() => { onAdd(x); setAdded((v) => [...v, x.id]) }}><Plus size={14} />{added.includes(x.id) ? tx("Nog een") : tx("Toevoegen")}</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Modal>
  )
}

/** Eigen artikelnummers bij artikelnummers van de leverancier, voor een lijst of artikelkaart in Catalogi. */
export function useArticleNumbers(supplierId: string | undefined, skus: string[]) {
  const { db, s } = useApp()
  const [m, setM] = useState<Map<string, CatalogArticle>>(new Map())
  const key = skus.join('|')
  useEffect(() => {
    if (!supplierId || !skus.length) return
    let live = true
    catalogArticlesBySku(db, supplierId, skus).then((r) => { if (live) setM((cur) => new Map([...cur, ...r.map((a) => [a.supplier_sku.toLowerCase(), a] as const)])) }).catch(() => {})
    return () => { live = false }
  }, [db, supplierId, key]) // eslint-disable-line
  const article = (sku: string) => m.get(sku.trim().toLowerCase())
  /** Het product onder Beheer dat uit dit catalogusartikel komt. */
  const product = (sku: string) => { const a = article(sku); return a ? s.products.find((p) => p.catalog_article_number === a.article_number) : undefined }
  return { article, product }
}

/** Eigen artikelnummer eerst, daaronder dat van de leverancier. */
export function ArticleNumbers({ own, supplier, extra }: { own?: string; supplier: string; extra?: string }) {
  return (
    <>
      <span className="strong">{own ?? supplier}</span>
      {own && <div className="muted small">{supplier}</div>}
      {extra && extra !== supplier && <div className="muted small">{extra}</div>}
    </>
  )
}

/** De vastgelegde elementen van een artikel (catalog_article_elements). null zolang ze laden of als het artikel nog geen eigen nummer heeft. */
export function useStoredElements(article: CatalogArticle | undefined) {
  const { db } = useApp()
  const [list, setList] = useState<ArticleHit[] | null>(null)
  useEffect(() => {
    if (!article) return
    let live = true
    catalogArticleElements(db, article.id).then((r) => { if (live) setList(r) }).catch(() => {})
    return () => { live = false }
  }, [db, article?.id]) // eslint-disable-line
  return article ? list : null
}
