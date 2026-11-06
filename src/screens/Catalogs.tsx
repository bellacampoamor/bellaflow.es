import { useMemo, useRef, useState } from 'react'
import { ImageOff, Upload } from 'lucide-react'
import type { SupplierCatalogItem } from '../data/types'
import { onHandMap, reservedMap, stockKey } from '../domain/calc'
import { belongsTo, catalogCategories, catalogOf, elementCounts, elementsOf, imageSrc, seriesCode, mainCategory, plainText, productForItem, safeHtml, STOCK_STATUS, subCategory } from '../domain/catalog'
import { importCatalog } from '../domain/services'
import { useApp } from '../ui/app-context'
import { Empty, eur, fmtDate, Head, Modal, Pill } from '../ui/kit'
import { tx } from '../i18n'

const stockLabel = (status: string) => ({ IN_STOCK: tx("Op voorraad"), OUT_OF_STOCK: tx("Niet op voorraad"), BACKORDER: tx("Nabestelling"), PREORDER: tx("Voorverkoop") }[status] ?? status)
const money = (n: number, currency: string) => (currency === 'EUR' ? eur(n) : `${n.toFixed(2)} ${currency}`)

/** Foto van de leverancier, op een witte ondergrond. Zonder foto of als hij niet laadt: een leeg vlak. */
function Photo({ url, alt, className }: { url?: string; alt: string; className: string }) {
  const [broken, setBroken] = useState(false)
  const src = url ? imageSrc(url, import.meta.env.BASE_URL) : ''
  return (
    <div className={`cat-photo ${className}`}>
      {src && !broken ? <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <ImageOff size={className === 'thumb' ? 18 : 40} aria-label={tx("Geen foto")} />}
    </div>
  )
}

/** Adviesprijs: gelijk aan de prijs in de showroom van de leverancier. De webshopprijs is de actieprijs op de consumentenwebshop. */
function Price({ item }: { item: SupplierCatalogItem }) {
  return <>{money(item.price_regular || item.price_final, item.currency)}</>
}

export function Catalogs({ supplierId }: { supplierId: string }) {
  const { s, run, toast } = useApp()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const supplier = s.suppliers.find((x) => x.id === supplierId)
  const all = useMemo(() => (supplier ? catalogOf(s, supplier.id) : []), [s, supplier])
  const items = useMemo(() => (supplier ? catalogOf(s, supplier.id, { q, category }) : []), [s, supplier, q, category])
  const categories = catalogCategories(all)
  const open = s.supplier_catalog_items.find((x) => x.id === openId)
  const countOf = useMemo(() => elementCounts(s.supplier_catalog_items), [s])

  const pick = (id: string) => { setQ(''); setCategory(''); location.hash = `catalogi-${id}` }
  const onFile = async (f: File | undefined) => {
    if (!f) return
    const text = await f.text()
    let result: { added: number; updated: number } | undefined
    const ok = await run(async (db) => { result = await importCatalog(db, text) })
    if (ok && result) toast(tx("Catalogus ingelezen: {0} nieuw, {1} bijgewerkt.", result.added, result.updated))
    if (file.current) file.current.value = ''
  }

  return (
    <>
      <Head title={tx("Catalogi")} sub={tx("De artikellijst van elke leverancier, zoals de leverancier die aanbiedt. Klik op een artikel voor de artikelkaart.")}>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        <button className="btn" onClick={() => file.current?.click()}><Upload size={16} />{tx("Catalogus inlezen (CSV)")}</button>
      </Head>

      <div className="cat-suppliers" role="tablist" aria-label={tx("Leverancier")}>
        {s.suppliers.filter((x) => x.is_active).map((x) => {
          const n = s.supplier_catalog_items.filter((i) => belongsTo(i, x) && i.active).length
          return (
            <button key={x.id} role="tab" aria-selected={x.id === supplierId} className={`cat-supplier ${x.id === supplierId ? 'on' : ''}`} onClick={() => pick(x.id)}>
              <span className="strong">{x.name}</span>
              <small>{n ? tx("{0} artikelen", n) : tx("Nog geen catalogus")}</small>
            </button>
          )
        })}
      </div>

      {!supplier ? <section className="panel"><Empty>{tx("Kies eerst een leverancier.")}</Empty></section> : (
        <section className="panel">
          <div className="panel-head">
            <h2>{supplier.name}</h2>
            <div className="actions">
              <select style={{ width: 'auto', maxWidth: 280 }} aria-label={tx("Categorie")} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">{tx("Alle categorieën")} ({all.length})</option>
                {categories.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.n})</option>)}
              </select>
              <input style={{ width: 260 }} aria-label={tx("Artikel zoeken")} placeholder={tx("Zoek op naam of artikelnummer")} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {all.length === 0 ? <Empty>{tx("Voor deze leverancier is nog geen catalogus ingelezen. Gebruik Catalogus inlezen (CSV).")}</Empty>
            : items.length === 0 ? <Empty>{tx("Geen artikelen gevonden.")}</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th></th><th>{tx("Artikelnummer")}</th><th>{tx("Artikel")}</th><th>{tx("Categorie")}</th><th>{tx("Voorraad webshop")}</th><th className="num">{tx("Adviesprijs")}</th><th></th></tr></thead>
              <tbody>{items.map((x) => {
                const own = productForItem(s, x)
                return (
                  <tr key={x.id} className="click" onClick={() => setOpenId(x.id)}>
                    <td style={{ width: 64 }}><Photo url={x.image_urls[0]?.url} alt={x.name} className="thumb" /></td>
                    <td className="strong" style={{ whiteSpace: 'nowrap' }}>{x.supplier_sku}</td>
                    <td><span className="strong">{x.name}</span>{x.short_description_html && <div className="muted small cat-short">{plainText(x.short_description_html)}</div>}</td>
                    <td>{mainCategory(x) || '–'}{subCategory(x) && <div className="muted small">{subCategory(x)}</div>}</td>
                    <td>{x.stock_status ? <Pill tone={STOCK_STATUS[x.stock_status] ?? ''}>{stockLabel(x.stock_status)}</Pill> : '–'}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}><Price item={x} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{countOf(x) > 0 && <span className="muted small">{tx("+{0} elementen", countOf(x))}</span>} {own && <Pill tone="info">{tx("In assortiment")}</Pill>}</td>
                  </tr>
                )
              })}</tbody>
            </table></div>
          )}
          {items.length > 0 && <p className="muted small" style={{ margin: '12px 0 0' }}>{tx("{0} van {1} artikelen", items.length, all.length)}. {tx("Adviesprijs is de prijs in de showroom van de leverancier. Voorraad en webshopprijs komen van de consumentenwebshop.")}</p>}
        </section>
      )}

      {open && <ArticleCard key={open.id} item={open} onOpen={setOpenId} onClose={() => setOpenId(null)} />}
    </>
  )
}

function ArticleCard({ item, onOpen, onClose }: { item: SupplierCatalogItem; onOpen: (id: string) => void; onClose: () => void }) {
  const { s } = useApp()
  const elements = useMemo(() => elementsOf(s, item), [s, item])
  const series = seriesCode(item.supplier_sku)
  const [photo, setPhoto] = useState(0)
  const images = item.image_urls
  const own = productForItem(s, item)
  const free = useMemo(() => {
    if (!own) return 0
    const hand = onHandMap(s), res = reservedMap(s)
    return s.warehouses.reduce((n, w) => n + (hand.get(stockKey(own.id, w.id)) ?? 0) - (res.get(stockKey(own.id, w.id)) ?? 0), 0)
  }, [s, own])
  const type = item.attributes.type === 'ConfigurableProduct' ? tx("Met keuzemogelijkheden") : item.attributes.type === 'SimpleProduct' ? tx("Enkel artikel") : ''
  const reduced = item.price_regular > item.price_final && item.price_final > 0

  return (
    <Modal wide title={item.name} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>{tx("Sluiten")}</button>}>
      <div className="cat-card">
        <div className="cat-gallery">
          <Photo key={images[photo]?.url ?? 'geen'} url={images[photo]?.url} alt={images[photo]?.label || item.name} className="large" />
          {images.length > 1 && <div className="cat-thumbs">
            {images.map((im, i) => (
              <button key={im.url} type="button" className={i === photo ? 'on' : ''} aria-label={tx("Foto {0} van {1}", i + 1, images.length)} onClick={() => setPhoto(i)}>
                <Photo url={im.url} alt="" className="thumb" />
              </button>
            ))}
          </div>}
          {images.length === 0 && <p className="muted small" style={{ margin: 0 }}>{tx("De leverancier heeft voor dit artikel geen foto aangeleverd.")}</p>}
        </div>
        <div className="cat-facts">
          <dl className="cat-dl">
            <dt>{tx("Artikelnummer")}</dt><dd className="strong">{item.supplier_sku}</dd>
            <dt>{tx("Leverancier")}</dt><dd>{item.supplier_name}</dd>
            <dt>{tx("Categorie")}</dt><dd>{item.categories.length ? item.categories.map((c) => c.name).join(' › ') : '–'}</dd>
            {type && <><dt>{tx("Soort")}</dt><dd>{type}</dd></>}
            <dt>{tx("Voorraad webshop")}</dt><dd>{item.stock_status ? <Pill tone={STOCK_STATUS[item.stock_status] ?? ''}>{stockLabel(item.stock_status)}</Pill> : '–'}</dd>
            <dt>{tx("Adviesprijs")}</dt><dd className="strong">{money(item.price_regular, item.currency)}</dd>
            {reduced && <><dt>{tx("Webshopprijs")}</dt><dd>{money(item.price_final, item.currency)}</dd></>}
            {!item.active && <><dt>{tx("Status")}</dt><dd><Pill tone="warn">{tx("Niet meer actief bij de leverancier")}</Pill></dd></>}
          </dl>
          {own ? (
            <div className="note">
              <span className="strong">{tx("In assortiment")}</span>: {own.name}, {tx("verkoopprijs")} {eur(own.sale_price)}, {tx("{0} vrij op voorraad", free)}.
            </div>
          ) : <p className="muted small" style={{ margin: 0 }}>{tx("Niet in het eigen assortiment onder Beheer.")}</p>}
          {item.short_description_html && <p className="cat-lead" dangerouslySetInnerHTML={{ __html: safeHtml(item.short_description_html) }} />}
        </div>
      </div>
      {item.description_html && <div className="cat-description" dangerouslySetInnerHTML={{ __html: safeHtml(item.description_html) }} />}
      {series && (
        <section className="cat-elements">
          <h3>{tx("Elementen")}{elements.length > 0 && <span className="muted small"> ({elements.length})</span>}</h3>
          <p className="muted small" style={{ margin: 0 }}>{elements.length
            ? tx("Artikelen uit dezelfde serie ({0}) die erbij besteld kunnen worden, volgens het artikelnummer van de leverancier.", series)
            : tx("Geen andere artikelen in serie {0}.", series)}</p>
          <div className="table-wrap flush"><table>
            <thead><tr><th></th><th>{tx("Artikelnummer")}</th><th>{tx("Artikel")}</th><th>{tx("Categorie")}</th><th className="num">{tx("Adviesprijs")}</th></tr></thead>
            <tbody>
              {elements.map((x) => (
                <tr key={x.id} className="click" onClick={() => onOpen(x.id)}><td><Photo url={x.image_urls[0]?.url} alt={x.name} className="thumb" /></td><td className="strong" style={{ whiteSpace: 'nowrap' }}>{x.supplier_sku}</td><td>{x.name}</td><td>{subCategory(x) || mainCategory(x) || '–'}</td><td className="num" style={{ whiteSpace: 'nowrap' }}><Price item={x} /></td></tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        {item.source_updated_at && <>{tx("Gewijzigd bij de leverancier op {0}", fmtDate(item.source_updated_at))}. </>}
        {item.last_synced_at && tx("Opgehaald op {0}", fmtDate(item.last_synced_at))}
      </p>
    </Modal>
  )
}
