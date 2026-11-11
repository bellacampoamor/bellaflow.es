import { useEffect, useRef, useState } from 'react'
import type { ArticleHit, CatalogListItem, Supplier } from '../data/types'
import { articlePhotos, categoryName } from '../domain/articles'
import { catalogArticleElements, catalogArticlePage } from '../domain/services'
import { useApp } from '../ui/app-context'
import { ArticleNumbers } from '../ui/ArticleSearch'
import { takeCatalogQuery, useNavUi } from '../ui/nav'
import { CatalogPhoto as Photo, Empty, eur, fmtDate, Modal, Pager, Pill } from '../ui/kit'
import { tx } from '../i18n'

const PAGE_SIZE = 50
const price = (x: { price: number | null; currency: string }) => (x.price === null ? '–' : x.currency === 'EUR' || !x.currency ? eur(x.price) : `${x.price.toFixed(2)} ${x.currency}`)

/** Voorraad die de leverancier opgeeft. Ontbreekt die, dan een streepje. */
function Stock({ x }: { x: CatalogListItem }) {
  if (x.supplier_stock === null || x.supplier_stock === undefined) return <span className="muted small">–</span>
  return x.supplier_stock > 0 ? <Pill tone="good">{tx("{0} op voorraad", x.supplier_stock)}</Pill> : <Pill tone="warn">{tx("Niet op voorraad")}</Pill>
}

/**
 * Catalogus van een leverancier die via een koppeling binnenkomt (HA-CO via n8n, HomeDecoBali via de API).
 * De artikelen staan met eigen artikelnummer in de database; de opslag zoekt en bladert zelf.
 */
export function ArticleCatalogList({ supplier }: { supplier: Supplier }) {
  const { db, s } = useApp()
  const k = `cat-${supplier.id}`
  const [q, setQ] = useNavUi(`${k}-zoek`, takeCatalogQuery(supplier.id))
  const [category, setCategory] = useNavUi(`${k}-categorie`, '')
  const [page, setPage] = useNavUi(`${k}-pagina`, 1)
  const [rows, setRows] = useState<CatalogListItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<{ code: string; n: number }[]>([])
  const [all, setAll] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<CatalogListItem | null>(null)
  const listTop = useRef<HTMLElement>(null)

  // Categorieën en totaal één keer per leverancier
  useEffect(() => {
    let live = true
    catalogArticlePage(db, { supplierId: supplier.id, offset: 0, limit: 1, withCategories: true })
      .then((r) => { if (live) { setCategories(r.categories ?? []); setAll(r.total) } }).catch(() => {})
    return () => { live = false }
  }, [db, supplier.id])

  // De pagina zelf; even wachten met zoeken tot er niet meer getypt wordt
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      catalogArticlePage(db, { supplierId: supplier.id, q, category, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE })
        .then((r) => { if (live) { setRows(r.rows); setTotal(r.total); setError('') } })
        .catch((e: unknown) => { if (live) { setRows([]); setError(e instanceof Error ? e.message : String(e)) } })
    }, q ? 250 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [db, supplier.id, q, category, page])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const goPage = (p: number) => { setPage(Math.min(Math.max(p, 1), pages)); listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const product = (x: CatalogListItem) => s.products.find((p) => p.catalog_article_number === x.article_number)

  return (
    <section className="panel cat-list" ref={listTop}>
      <div className="panel-head">
        <h2>{supplier.name}</h2>
        <div className="actions">
          <select style={{ width: 'auto', maxWidth: 240 }} aria-label={tx("Categorie")} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }}>
            <option value="">{tx("Alle categorieën")}</option>
            {categories.map((c) => <option key={c.code} value={c.code}>{categoryName(c.code)} ({c.n})</option>)}
          </select>
          <input style={{ width: 240 }} aria-label={tx("Artikel zoeken")} placeholder={tx("Zoek op naam, artikelnummer of EAN")} value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        </div>
      </div>
      {error ? <Empty>{tx("De catalogus kon niet worden geladen: {0}", error)}</Empty>
        : rows === null ? <Empty>{tx("Catalogus laden...")}</Empty>
        : all === 0 ? <Empty>{tx("Voor deze leverancier staan nog geen artikelen in de database.")}</Empty>
        : rows.length === 0 ? <Empty>{tx("Geen artikelen gevonden.")}</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th></th><th>{tx("Artikelnummer")}</th><th>{tx("Artikel")}</th><th>{tx("Voorraad leverancier")}</th><th className="num">{tx("Prijs")}</th><th></th></tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.id} className="click" onClick={() => setOpen(x)}>
              <td style={{ width: 64 }}><Photo url={x.image_url} alt={x.name} className="thumb" /></td>
              <td style={{ whiteSpace: 'nowrap' }}><ArticleNumbers own={x.article_number} supplier={x.supplier_sku} extra={x.ean} /></td>
              <td><span className="strong">{x.name}</span><div className="muted small">{categoryName(x.category_code)}{x.series ? ` · ${x.series}` : ''}</div></td>
              <td><Stock x={x} /></td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>{price(x)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{x.element_count > 0 && <span className="muted small">{tx("+{0} elementen", x.element_count)}</span>} {product(x) && <Pill tone="info">{tx("In assortiment")}</Pill>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {!error && total > 0 && <Pager page={Math.min(page, pages)} size={PAGE_SIZE} total={total} onPage={goPage} />}
      {open && <ArticleCard key={open.id} item={open} supplier={supplier} onClose={() => setOpen(null)} />}
    </section>
  )
}

function ArticleCard({ item, supplier, onClose }: { item: CatalogListItem; supplier: Supplier; onClose: () => void }) {
  const { db, s } = useApp()
  const [elements, setElements] = useState<ArticleHit[]>([])
  useEffect(() => {
    if (!item.element_count) return
    let live = true
    catalogArticleElements(db, item.id).then((r) => { if (live) setElements(r) }).catch(() => {})
    return () => { live = false }
  }, [db, item.id, item.element_count])
  const own = s.products.find((p) => p.catalog_article_number === item.article_number)
  const photos = articlePhotos(item)
  const [shown, setShown] = useState(0)
  const current = photos[Math.min(shown, Math.max(photos.length - 1, 0))] ?? ''
  return (
    <Modal wide title={item.name} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>{tx("Sluiten")}</button>}>
      <div className="cat-card">
        <div className="cat-gallery">
          <Photo key={current} url={current} alt={item.name} className="large" />
          {photos.length > 1 && (
            <div className="cat-thumbs" aria-label={tx("Foto {0} van {1}", Math.min(shown, photos.length - 1) + 1, photos.length)}>
              {photos.map((u, i) => (
                <button key={u} type="button" className={i === Math.min(shown, photos.length - 1) ? 'on' : ''} onClick={() => setShown(i)}
                  title={tx("Foto {0} van {1}", i + 1, photos.length)}>
                  <Photo url={u} alt={tx("Foto {0} van {1}", i + 1, photos.length)} className="thumb" />
                </button>
              ))}
            </div>
          )}
          {!photos.length && <p className="muted small" style={{ margin: 0 }}>{tx("De leverancier heeft voor dit artikel geen foto aangeleverd.")}</p>}
        </div>
        <div className="cat-facts">
          <dl className="cat-dl">
            <dt>{tx("Artikelnummer")}</dt><dd className="strong">{item.article_number}</dd>
            <dt>{tx("Artikelnummer leverancier")}</dt><dd>{item.supplier_sku}</dd>
            <dt>{tx("EAN")}</dt><dd>{item.ean || '–'}</dd>
            <dt>{tx("Leverancier")}</dt><dd>{supplier.name}</dd>
            {item.series && <><dt>{tx("Serie")}</dt><dd>{item.series}</dd></>}
            <dt>{tx("Categorie")}</dt><dd>{categoryName(item.category_code)}</dd>
            <dt>{tx("Voorraad leverancier")}</dt><dd><Stock x={item} />{item.supplier_stock_at && <div className="muted small">{tx("Opgehaald op {0}", fmtDate(item.supplier_stock_at))}</div>}</dd>
            <dt>{tx("Prijs")}</dt><dd className="strong">{price(item)}</dd>
          </dl>
          {own ? <div className="note"><span className="strong">{tx("In assortiment")}</span>: {own.name}, {tx("verkoopprijs")} {eur(own.sale_price)}.</div>
            : <p className="muted small" style={{ margin: 0 }}>{tx("Nog niet verkocht: wordt een product zodra het op een verkooporder komt.")}</p>}
        </div>
      </div>
      {elements.length > 0 && (
        <section className="cat-elements">
          <h3>{tx("Elementen")} <span className="muted small">({elements.length})</span></h3>
          <div className="table-wrap flush"><table>
            <thead><tr><th></th><th>{tx("Artikelnummer")}</th><th>{tx("Artikel")}</th><th className="num">{tx("Prijs")}</th></tr></thead>
            <tbody>{elements.map((a) => (
              <tr key={a.id}>
                <td style={{ width: 64 }}><Photo url={a.image_url} alt={a.name} className="thumb" /></td>
                <td style={{ whiteSpace: 'nowrap' }}><ArticleNumbers own={a.article_number} supplier={a.supplier_sku} /></td>
                <td>{a.name}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{price(a)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </Modal>
  )
}
