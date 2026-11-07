import { useMemo, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { ShowroomSpec, Supplier, SupplierShowroomItem } from '../data/types'
import { onHandMap, reservedMap, stockKey, todayISO } from '../domain/calc'
import { countBy, partOf, productForShowroom, showroomCategories, showroomOf, showroomParts } from '../domain/showroom'
import { useApp } from '../ui/app-context'
import { ArticleNumbers, useArticleNumbers, useStoredElements } from '../ui/ArticleSearch'
import { categoryName } from '../domain/articles'
import { requiredProperties, variantsOf } from '../domain/properties'
import { CatalogPhoto as Photo, Empty, eur, fmtDate, Modal, Pager, Pill } from '../ui/kit'
import { tx } from '../i18n'

const PAGE_SIZE = 50
const price = (x: SupplierShowroomItem) => (x.price === null ? '–' : x.currency === 'EUR' ? eur(x.price) : `${x.price.toFixed(2)} ${x.currency}`)

/** Beschikbaar in het magazijn van de leverancier: vandaag of eerder is beschikbaar, later is een datum, anders geen datum. */
function Available({ x }: { x: SupplierShowroomItem }) {
  // Zonder tekst is de beschikbaarheid niet opgehaald (zoals bij elementen die niet los in de showroom staan).
  if (!x.available_date) return <span className="muted small">{x.available_text || '–'}</span>
  if (x.available_date <= todayISO()) return <Pill tone="good">{tx("Beschikbaar")}</Pill>
  return <Pill tone="info">{tx("Vanaf {0}", fmtDate(x.available_date))}</Pill>
}

export function ShowroomList({ supplier }: { supplier: Supplier }) {
  const { s } = useApp()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [series, setSeries] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)
  const listTop = useRef<HTMLElement>(null)
  const { parts, parentOf, detailOf } = useMemo(() => showroomParts(s.supplier_showroom_items, s.supplier_showroom_details), [s])
  const all = useMemo(() => showroomOf(s, supplier, {}, parentOf), [s, supplier, parentOf])
  const items = useMemo(() => showroomOf(s, supplier, { q, category, series }, parentOf), [s, supplier, q, category, series, parentOf])
  const seriesList = useMemo(() => countBy(all, (x) => [x.series]), [all])
  const categoryList = useMemo(() => countBy(all, showroomCategories), [all])
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const shown = items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const goPage = (p: number) => { setPage(p); listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const open = s.supplier_showroom_items.find((x) => x.id === openId)
  const nrs = useArticleNumbers(supplier.id, shown.map((x) => x.supplier_sku))
  const showSeries = (name: string) => { setSeries(name); setCategory(''); setQ(''); setPage(1); setOpenId(null); listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  return (
    <section className="panel cat-list" ref={listTop}>
      <div className="panel-head">
        <h2>{supplier.name}</h2>
        <div className="actions">
          <select style={{ width: 'auto', maxWidth: 220 }} aria-label={tx("Serie")} value={series} onChange={(e) => { setSeries(e.target.value); setPage(1) }}>
            <option value="">{tx("Alle series")} ({seriesList.length})</option>
            {seriesList.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.n})</option>)}
          </select>
          <select style={{ width: 'auto', maxWidth: 240 }} aria-label={tx("Categorie")} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }}>
            <option value="">{tx("Alle categorieën")}</option>
            {categoryList.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.n})</option>)}
          </select>
          <input style={{ width: 240 }} aria-label={tx("Artikel zoeken")} placeholder={tx("Zoek op naam, artikelnummer of EAN")} value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        </div>
      </div>
      {all.length === 0 ? <Empty>{tx("Voor deze leverancier is nog geen showroom ingelezen. Gebruik Catalogus inlezen (CSV).")}</Empty>
        : items.length === 0 ? <Empty>{tx("Geen artikelen gevonden.")}</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th></th><th>{tx("Artikelnummer")}</th><th>{tx("Artikel")}</th><th>{tx("Serie")}</th><th>{tx("Beschikbaar in magazijn")}</th><th className="num">{tx("Prijs")}</th><th></th></tr></thead>
          <tbody>{shown.map((x) => {
            const own = productForShowroom(s, x) ?? nrs.product(x.supplier_sku)
            const n = parts.get(x.id)?.length ?? 0
            return (
              <tr key={x.id} className="click" onClick={() => setOpenId(x.id)}>
                <td style={{ width: 64 }}><Photo url={x.image_url} alt={x.name} className="thumb" /></td>
                <td style={{ whiteSpace: 'nowrap' }}><ArticleNumbers own={nrs.article(x.supplier_sku)?.article_number} supplier={x.supplier_sku} extra={x.ean} /></td>
                <td><span className="strong">{x.name}</span>{showroomCategories(x).length > 0 && <div className="muted small">{showroomCategories(x).join(', ')}</div>}</td>
                <td>{x.series || '–'}</td>
                <td><Available x={x} /></td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{price(x)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{n > 0 && <span className="muted small">{tx("+{0} elementen", n)}</span>} {own && <Pill tone="info">{tx("In assortiment")}</Pill>}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      )}
      {items.length > 0 && <Pager page={current} size={PAGE_SIZE} total={items.length} onPage={goPage} />}
      {items.length > 0 && <p className="muted small" style={{ margin: '8px 0 0' }}>{tx("Gegevens uit de showroom van de leverancier, opgehaald op {0}.", fmtDate(all[0]?.scraped_at))}</p>}
      {open && <ShowroomCard key={open.id} supplierId={supplier.id} item={open} parts={parts.get(open.id) ?? []} parent={parentOf.get(open.id)} specs={detailOf(open)?.specifications ?? []} fromShowroom={!!detailOf(open)} onOpen={setOpenId} onSeries={showSeries} onClose={() => setOpenId(null)} />}
    </section>
  )
}

function ShowroomCard({ supplierId, item, parts, parent, specs, fromShowroom, onOpen, onSeries, onClose }: { supplierId: string; item: SupplierShowroomItem; parts: SupplierShowroomItem[]; parent?: SupplierShowroomItem; specs: ShowroomSpec[]; fromShowroom: boolean; onOpen: (id: string) => void; onSeries: (name: string) => void; onClose: () => void }) {
  const { s } = useApp()
  const nrs = useArticleNumbers(supplierId, [item.supplier_sku, ...parts.map((x) => x.supplier_sku)])
  const art = nrs.article(item.supplier_sku)
  const own = productForShowroom(s, item) ?? nrs.product(item.supplier_sku)
  // Elementen volgen de vastgelegde koppeling; die blijft bestaan, ook als de leverancier zijn lijst later wijzigt.
  const stored = useStoredElements(art)
  const rows = stored && stored.length ? stored.map((a) => ({ a, x: s.supplier_showroom_items.find((y) => y.supplier_name === item.supplier_name && y.supplier_sku === a.supplier_sku) }))
    : parts.map((x) => ({ a: nrs.article(x.supplier_sku), x }))
  const free = useMemo(() => {
    if (!own) return 0
    const hand = onHandMap(s), res = reservedMap(s)
    return s.warehouses.reduce((n, w) => n + (hand.get(stockKey(own.id, w.id)) ?? 0) - (res.get(stockKey(own.id, w.id)) ?? 0), 0)
  }, [s, own])
  const part = partOf(item.name)
  const props = requiredProperties(item)
  const variants = useMemo(() => variantsOf(s.supplier_showroom_items, item), [s, item])
  const safeUrl = /^https:\/\//i.test(item.product_url) ? item.product_url : ''
  return (
    <Modal wide title={item.name} onClose={onClose} footer={<>
      {safeUrl && <a className="btn" href={safeUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />{tx("Bekijk in de showroom")}</a>}
      <button className="btn primary" onClick={onClose}>{tx("Sluiten")}</button>
    </>}>
      <div className="cat-card">
        <div className="cat-gallery">
          <Photo url={item.image_url} alt={item.name} className="large" />
          {!item.image_url && <p className="muted small" style={{ margin: 0 }}>{tx("De leverancier heeft voor dit artikel geen foto aangeleverd.")}</p>}
        </div>
        <div className="cat-facts">
          <dl className="cat-dl">
            <dt>{tx("Artikelnummer")}</dt><dd className="strong">{art?.article_number ?? '–'}</dd>
            <dt>{tx("Artikelnummer leverancier")}</dt><dd>{item.supplier_sku}</dd>
            <dt>{tx("EAN")}</dt><dd>{item.ean || '–'}</dd>
            <dt>{tx("Leverancier")}</dt><dd>{item.supplier_name}</dd>
            <dt>{tx("Serie")}</dt><dd>{item.series ? <button type="button" className="linklike" onClick={() => onSeries(item.series)}>{item.series}</button> : '–'}</dd>
            <dt>{tx("Categorie")}</dt><dd>{art ? categoryName(art.category_code) : '–'}{showroomCategories(item).length > 0 && <div className="muted small">{tx("Leverancier")}: {showroomCategories(item).join(', ')}</div>}</dd>
            <dt>{tx("Beschikbaar in magazijn")}</dt><dd><Available x={item} /></dd>
            <dt>{tx("Prijs")}</dt><dd className="strong">{price(item)}</dd>
            {part && <><dt>{tx("Onderdeel")}</dt><dd>{tx("Deel {0} van {1}", part.n, part.of)}</dd></>}
            {parent && <><dt>{tx("Element van")}</dt><dd><button type="button" className="linklike" onClick={() => onOpen(parent.id)}>{parent.name}</button></dd></>}
            {props.length > 0 && <><dt>{tx("Bij bestellen invullen")}</dt><dd>{props.join(', ')}</dd></>}
          </dl>
          {own ? (
            <div className="note"><span className="strong">{tx("In assortiment")}</span>: {own.name}, {tx("verkoopprijs")} {eur(own.sale_price)}, {tx("{0} vrij op voorraad", free)}.</div>
          ) : <p className="muted small" style={{ margin: 0 }}>{tx("Nog niet verkocht: wordt een product zodra het op een verkooporder komt.")}</p>}
        </div>
      </div>
      {specs.length > 0 && (
        <section className="cat-elements">
          <h3>{tx("Product specificaties")}</h3>
          <dl className="cat-dl cat-specs">{specs.map((x, i) => <div key={i}><dt>{x.label}</dt><dd>{x.value || '–'}</dd></div>)}</dl>
        </section>
      )}
      {variants.length > 0 && (
        <section className="cat-elements">
          <h3>{tx("Andere uitvoeringen")} <span className="muted small">({variants.length})</span></h3>
          <div className="table-wrap flush"><table>
            <thead><tr><th>{tx("Artikelnummer leverancier")}</th><th>{tx("Artikel")}</th><th className="num">{tx("Prijs")}</th></tr></thead>
            <tbody>{variants.map((x) => (
              <tr key={x.id} className="click" onClick={() => onOpen(x.id)}>
                <td style={{ whiteSpace: 'nowrap' }}>{x.supplier_sku}</td>
                <td>{x.name}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{price(x)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
      {rows.length > 0 && (
        <section className="cat-elements">
          <h3>{tx("Elementen")} <span className="muted small">({rows.length})</span></h3>
          <p className="muted small" style={{ margin: 0 }}>{fromShowroom
            ? tx("Artikelen die erbij besteld kunnen worden, zoals de showroom ze onder Elementen toont.")
            : tx("De onderdelen die samen dit artikel vormen, volgens de naam in de showroom (deel 1 van {0}, ...).", parts[0] ? partOf(parts[0].name)?.of ?? parts.length : parts.length)}</p>
          <div className="table-wrap flush"><table>
            <thead><tr><th></th><th>{tx("Artikelnummer")}</th><th>{tx("Artikel")}</th><th>{tx("Beschikbaar in magazijn")}</th><th className="num">{tx("Prijs")}</th></tr></thead>
            <tbody>{rows.map(({ a, x }) => (
              <tr key={a?.id ?? x?.id} className={x ? 'click' : ''} onClick={() => x && onOpen(x.id)}>
                <td style={{ width: 64 }}><Photo url={x?.image_url ?? a?.image_url} alt={x?.name ?? a?.name ?? ''} className="thumb" /></td>
                <td style={{ whiteSpace: 'nowrap' }}><ArticleNumbers own={a?.article_number} supplier={x?.supplier_sku ?? a?.supplier_sku ?? ''} /></td>
                <td>{x?.name ?? a?.name}{!x && <div className="muted small">{tx("Niet meer in de showroom van de leverancier")}</div>}</td>
                <td>{x ? <Available x={x} /> : '–'}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{x ? price(x) : a?.price != null ? eur(a.price) : '–'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
      <p className="muted small" style={{ margin: 0 }}>{tx("Opgehaald op {0}", fmtDate(item.scraped_at))}</p>
    </Modal>
  )
}
