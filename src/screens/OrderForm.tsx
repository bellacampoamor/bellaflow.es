import { useEffect, useMemo, useState } from 'react'
import { CreditCard, Layers, Plus, Trash2 } from 'lucide-react'
import type { CatalogArticle, Customer, Fulfilment, Payment } from '../data/types'
import { inboundByProduct, lineTotal, onHandMap, plannedQty, reservedMap, round2, stockKey, todayISO, vatBreakdown } from '../domain/calc'
import { catalogArticlesByNumber, confirmProforma, createOrder, lineFromProduct, saveProforma, saveRecord, splitLinesForStock, updateOrder, type OrderHeader, type OrderLineInput } from '../domain/services'
import { priceWithSurcharge } from '../domain/articles'
import { ArticleSearch, ElementsModal, SearchSourceChips, useSearchSources, type ArticlePick } from '../ui/ArticleSearch'
import { loadSnapshot } from '../data/driver'
import { go, useApp } from '../ui/app-context'
import { AreaField, Check, Combo, Empty, eur, Field, Head, Modal, NumberField, SelectField, TextField } from '../ui/kit'
import { tx } from '../i18n'

/** Een regel kan een catalogusartikel zijn dat nog geen product onder Beheer heeft; dat product ontstaat bij opslaan. */
type Line = OrderLineInput & { key: number }
let k = 1

const emptyCustomer: Omit<Customer, 'id'> = { kind: 'particulier', name: '', company: '', tax_id: '', email: '', phone: '', language: 'es', address: '', postal_code: '', city: '', province: 'Alicante', country: 'España', notes: '' }

export function CustomerFields({ c, set }: { c: Omit<Customer, 'id'>; set: (p: Partial<Customer>) => void }) {
  return (
    <div className="form-grid">
      <SelectField label={tx("Soort klant")} value={c.kind} onChange={(v) => set({ kind: v })} options={[{ value: 'particulier', label: tx("Particulier") }, { value: 'zakelijk', label: tx("Zakelijk") }]} />
      <TextField className="span-2" label={tx("Naam")} value={c.name} onChange={(v) => set({ name: v })} />
      <SelectField label={tx("Factuurtaal")} value={c.language} onChange={(v) => set({ language: v })} options={[{ value: 'es', label: tx("Spaans") }, { value: 'nl', label: tx("Nederlands") }, { value: 'en', label: tx("Engels") }]} />
      {c.kind === 'zakelijk' && <TextField className="span-2" label={tx("Bedrijfsnaam")} value={c.company} onChange={(v) => set({ company: v })} />}
      <TextField label={c.kind === 'zakelijk' ? tx("CIF") : tx("NIF / NIE")} value={c.tax_id} onChange={(v) => set({ tax_id: v })} />
      <TextField label={tx("Telefoon")} type="tel" value={c.phone} onChange={(v) => set({ phone: v })} />
      <TextField label={tx("E-mail")} type="email" value={c.email} onChange={(v) => set({ email: v })} />
      <TextField className="span-2" label={tx("Adres")} value={c.address} onChange={(v) => set({ address: v })} />
      <TextField label={tx("Postcode")} value={c.postal_code} onChange={(v) => set({ postal_code: v })} />
      <TextField label={tx("Plaats")} value={c.city} onChange={(v) => set({ city: v })} />
      <TextField label={tx("Provincie")} value={c.province} onChange={(v) => set({ province: v })} />
      <TextField label={tx("Land")} value={c.country} onChange={(v) => set({ country: v })} />
    </div>
  )
}

export function OrderForm({ id }: { id?: string }) {
  const { s, db, run, toast } = useApp()
  const [sources, setSources] = useSearchSources()
  const [elementsFor, setElementsFor] = useState<CatalogArticle | null>(null)
  // Catalogusartikelen achter de producten op de regels, voor het artikelnummer van de leverancier en de elementen.
  const [arts, setArts] = useState<Map<string, CatalogArticle>>(new Map())
  const today = todayISO()
  const existing = id ? s.sales_orders.find((o) => o.id === id) : undefined
  // Een proforma uit de winkel wordt hier afgerond: klant erbij, afhandeling per regel en eventueel een vooruitbetaling.
  const isProforma = existing?.status === 'proforma'
  const fresh = !existing || isProforma

  const [h, setH] = useState<OrderHeader>(() => existing ? (({ id: _i, number: _n, status: _s, ...rest }) => ({ ...rest, customer_id: rest.customer_id ?? '', ...(isProforma ? { fulfilment: 'bezorgen' as const } : {}) }))(existing) : {
    customer_id: '', order_date: today, channel: 'winkel', salesperson_id: '', customer_reference: '', order_type: 'bestelling', fulfilment: 'bezorgen',
    requested_date: null, promised_date: null, delivery_name: '', delivery_phone: '', delivery_address: '', delivery_postal_code: '', delivery_city: '', delivery_latitude: null, delivery_longitude: null,
    floor: '', has_elevator: false, needs_assembly: false, remove_old_furniture: false, delivery_notes: '', notes: '',
  })
  const [lines, setLines] = useState<Line[]>(() => existing ? s.sales_order_lines.filter((l) => l.sales_order_id === id).map((l) => ({ ...l, key: k++ })) : [])
  const [deposit, setDeposit] = useState(0)
  const [depositMethod, setDepositMethod] = useState<Payment['method']>('pin')
  const [depositRef, setDepositRef] = useState('')
  const [newCust, setNewCust] = useState<Omit<Customer, 'id'> | null>(null)

  const sellers = s.salespeople.filter((x) => x.is_active || x.id === h.salesperson_id)
  const set = (p: Partial<OrderHeader>) => setH((v) => ({ ...v, ...p }))
  const stock = onHandMap(s), reserved = reservedMap(s), inbound = inboundByProduct(s)
  const warehouses = s.warehouses.filter((w) => w.is_active)
  const custOptions = useMemo(() => s.customers.map((c) => ({ value: c.id, label: c.company || c.name, sub: [c.company ? c.name : '', c.city, c.phone].filter(Boolean).join(', '), search: `${c.email} ${c.tax_id}` })), [s.customers])
  const productOf = (pid: string) => s.products.find((p) => p.id === pid)
  const lineArticle = (l: Line) => l.article ?? arts.get(productOf(l.product_id)?.catalog_article_number ?? '')
  const numbers = lines.map((l) => productOf(l.product_id)?.catalog_article_number).filter((x): x is string => !!x && !arts.has(x))
  useEffect(() => {
    if (!numbers.length) return
    catalogArticlesByNumber(db, numbers).then((r) => setArts((m) => new Map([...m, ...r.map((a) => [a.article_number, a] as const)]))).catch(() => {})
  }, [db, numbers.join('|')]) // eslint-disable-line

  const freeAt = (pid: string, wid: string) => (stock.get(stockKey(pid, wid)) ?? 0) - (reserved.get(stockKey(pid, wid)) ?? 0)
  // Bij wijzigen telt wat deze regel zelf al reserveert niet mee als bezet.
  const freeFor = (l: Line, wid: string) => {
    const own = l.id && l.warehouse_id === wid ? (existing ? s.sales_order_lines.find((x) => x.id === l.id)?.qty ?? 0 : 0) : 0
    return freeAt(l.product_id, wid) + own
  }
  const bestWarehouse = (pid: string, qty: number) => {
    const sorted = [...warehouses].sort((a, b) => freeAt(pid, b.id) - freeAt(pid, a.id))
    return sorted.find((w) => freeAt(pid, w.id) >= qty)?.id ?? null
  }
  const pickCustomer = (cid: string) => {
    const c = s.customers.find((x) => x.id === cid)!
    set({ customer_id: cid, delivery_name: c.company || c.name, delivery_phone: c.phone, delivery_address: c.address, delivery_postal_code: c.postal_code, delivery_city: c.city })
  }
  const addLine = () => setLines((v) => [...v, { ...lineFromProduct({ id: '', name: '', sale_price: 0, vat_rate: 21 } as never), key: k++ }])
  const patch = (key: number, p: Partial<Line>) => setLines((v) => v.map((l) => l.key === key ? { ...l, ...p } : l))
  const pickProduct = (key: number, pid: string) => {
    const p = s.products.find((x) => x.id === pid)!
    const cur = lines.find((l) => l.key === key)!
    const wid = bestWarehouse(pid, cur.qty)
    const onOrder = !wid
    patch(key, { product_id: pid, article: undefined, description: p.name, unit_price: p.sale_price, vat_rate: p.vat_rate, source: onOrder ? 'bestelling' : 'voorraad', take_now: false, warehouse_id: onOrder ? null : wid })
  }
  // Een catalogusartikel zonder product onder Beheer staat nergens op voorraad en gaat dus op bestelling.
  const pickArticle = (key: number, pick: ArticlePick) => {
    if (pick.kind === 'product') return pickProduct(key, pick.product.id)
    const a = pick.article
    // De toeslag van de leverancier zit onzichtbaar in de prijs.
    patch(key, { product_id: '', article: a, description: a.name, unit_price: priceWithSurcharge(a.price, s.suppliers.find((x) => x.id === a.supplier_id)) ?? 0, vat_rate: 21, source: 'bestelling', take_now: false, warehouse_id: null })
  }
  const addArticleLine = (a: CatalogArticle) => {
    const p = s.products.find((x) => x.catalog_article_number === a.article_number)
    const wid = p ? bestWarehouse(p.id, 1) : null
    const line: Line = p
      ? { ...lineFromProduct(p, { source: wid ? 'voorraad' : 'bestelling', warehouse_id: wid }), key: k++ }
      : { ...lineFromProduct({ id: '', name: a.name, sale_price: priceWithSurcharge(a.price, s.suppliers.find((x) => x.id === a.supplier_id)) ?? 0, vat_rate: 21 } as never, { source: 'bestelling' }), article: a, key: k++ }
    setLines((v) => [...v, line])
  }

  const setHandling = (l: Line, v: 'meenemen' | 'voorraad' | 'bestelling') => {
    if (v === 'bestelling') return patch(l.key, { source: 'bestelling', take_now: false, warehouse_id: null })
    const showroom = warehouses.find((w) => w.kind === 'winkel' && freeAt(l.product_id, w.id) >= l.qty)
    const wid = l.warehouse_id ?? (v === 'meenemen' ? showroom?.id : null) ?? bestWarehouse(l.product_id, l.qty) ?? warehouses[0]?.id ?? null
    patch(l.key, { source: 'voorraad', take_now: v === 'meenemen', warehouse_id: wid })
  }
  const setFulfilment = (f: Fulfilment) => set({ fulfilment: f })

  const breakdown = vatBreakdown(lines.map((l) => ({ total: lineTotal(l), vat_rate: l.vat_rate })))
  const fullDiscount = round2(lines.reduce((n, l) => n + l.qty * l.unit_price, 0) - breakdown.total)
  const margin = round2(lines.reduce((n, l) => {
    const p = s.products.find((x) => x.id === l.product_id)
    return n + lineTotal(l) / (1 + l.vat_rate / 100) - (p?.purchase_price ?? 0) * l.qty
  }, 0))

  const save = async () => {
    if (lines.some((l) => !l.product_id && !l.article)) return toast(tx("Kies bij elke regel een product of verwijder de regel."), true)
    const payload = lines.map(({ key: _k, ...l }) => (id ? l : (({ id: _i, ...r }) => r)(l as Line & { id?: string })) as OrderLineInput)
    if (isProforma) {
      const ok = await run((db) => confirmProforma(db, id!, { header: h, lines: payload, deposit: deposit > 0 ? { amount: deposit, method: depositMethod, reference: depositRef } : undefined }), tx("Proforma bevestigd, de verkooporder heeft nu zijn VO-nummer"))
      if (ok) go(`orders-${id}`)
      return
    }
    if (existing) {
      if (await run((db) => updateOrder(db, id!, { header: h, lines: payload }), tx("Verkooporder opgeslagen"))) go(`orders-${id}`)
      return
    }
    let newId = ''
    const ok = await run(async (db) => {
      const finalLines = splitLinesForStock(await loadSnapshot(db), payload)
      newId = await createOrder(db, { header: h, lines: finalLines, deposit: deposit > 0 ? { amount: deposit, method: depositMethod, reference: depositRef } : undefined })
    }, allTaken ? tx("Verkooporder geregistreerd en meegegeven") : someTaken ? tx("Verkooporder aangemaakt, meegenomen artikelen afgeboekt") : tx("Verkooporder aangemaakt"))
    if (ok) go(`orders-${newId}`)
  }
  const keepProforma = async () => {
    if (lines.some((l) => !l.product_id && !l.article)) return toast(tx("Kies bij elke regel een product of verwijder de regel."), true)
    const payload = lines.map(({ key: _k, ...l }) => l as OrderLineInput)
    if (await run((db) => saveProforma(db, id!, { header: h, lines: payload }), tx("Proforma bewaard"))) go(`orders-${id}`)
  }
  const saveCustomer = async () => {
    if (!newCust?.name.trim()) return toast(tx("Vul de naam van de klant in."), true)
    let cid = ''
    const ok = await run(async (db) => { cid = await saveRecord(db, 'customers', newCust as Customer) }, tx("Klant toegevoegd"))
    if (ok) {
      set({ customer_id: cid, delivery_name: newCust.company || newCust.name, delivery_phone: newCust.phone, delivery_address: newCust.address, delivery_postal_code: newCust.postal_code, delivery_city: newCust.city })
      setNewCust(null)
    }
  }

  const allTaken = lines.length > 0 && lines.every((l) => l.take_now)
  const someTaken = lines.some((l) => l.take_now)
  const needsAddress = !allTaken && h.fulfilment !== 'meenemen'
  const customer = s.customers.find((c) => c.id === h.customer_id)

  return (
    <>
      <Head title={isProforma ? tx("Proforma {0} afronden", existing!.number) : existing ? tx("{0} wijzigen", existing.number) : tx("Nieuwe verkooporder")} back={existing ? { href: `#orders-${id}`, label: existing.number } : { href: '#orders', label: tx("Verkooporders") }} />
      {isProforma && <div className="note proforma" style={{ marginBottom: 16 }}><div><strong>{tx("Proforma")}</strong><div>{tx("Vul samen met de klant de klantgegevens in, kies per regel de afhandeling en bevestig. Pas bij bevestigen krijgt de verkooporder zijn VO-nummer.")}</div></div></div>}
      <div className="cols">
        <div className="stack">
          <section className="panel acc acc-klant">
            <h2>{tx("Klant")}</h2>
            <div className="form-grid">
              <Field className="span-2" label={tx("Klant")}>{(fid) => <Combo id={fid} value={h.customer_id} options={custOptions} placeholder={tx("Zoek op naam, telefoon of e-mail")} onChange={pickCustomer} />}</Field>
              <div className="field" style={{ justifyContent: 'flex-end' }}><button className="btn" type="button" onClick={() => setNewCust({ ...emptyCustomer })}><Plus size={16} />{tx("Nieuwe klant")}</button></div>
              {customer && <div className="span-all small muted">{[customer.phone, customer.email, customer.address, customer.postal_code, customer.city].filter(Boolean).join(', ')}</div>}
              <SelectField label={tx("Verkocht via")} value={h.channel} onChange={(v) => set({ channel: v })} options={[{ value: 'winkel', label: tx("Winkel") }, { value: 'online', label: tx("Online") }, { value: 'telefoon', label: tx("Telefoon of e-mail") }, { value: 'beurs', label: tx("Beurs") }]} />
              <SelectField label={tx("Verkoper (verplicht)")} value={h.salesperson_id} placeholder={tx("Kies een verkoper")} hint={sellers.length ? undefined : tx("Voeg eerst verkopers toe onder Beheer.")} onChange={(v) => set({ salesperson_id: v })} options={sellers.map((x) => ({ value: x.id, label: x.name }))} />
              <TextField label={tx("Verkoopdatum")} type="date" value={h.order_date} onChange={(v) => set({ order_date: v })} />
              <TextField label={tx("Referentie klant")} value={h.customer_reference} onChange={(v) => set({ customer_reference: v })} />
            </div>
          </section>

          <section className="panel acc acc-producten">
            <div className="panel-head"><h2>{tx("Producten")}</h2><button className="btn sm" type="button" onClick={addLine}><Plus size={14} />{tx("Product toevoegen")}</button></div>
            <div style={{ marginBottom: 12 }}><SearchSourceChips value={sources} onChange={setSources} /></div>
            {lines.length === 0 && <Empty>{tx("Voeg het eerste product toe.")}</Empty>}
            <div className="stack">
              {lines.map((l) => {
                const locked = l.id ? plannedQty(s, l.id) : 0
                const free = l.warehouse_id && l.product_id ? freeFor(l, l.warehouse_id) : 0
                const short = l.source === 'voorraad' && l.product_id && l.warehouse_id && l.qty > free
                const others = l.product_id ? warehouses.filter((w) => w.id !== l.warehouse_id && freeAt(l.product_id, w.id) > 0) : []
                return (
                  <div key={l.key} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 14 }}>
                    {(l.product_id || l.article) && (() => {
                      const art = lineArticle(l)
                      return (
                        <div className="small" style={{ marginBottom: 4, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                          <span style={{ minWidth: 0 }}>
                            <span className="muted">{tx("Artikelnummer")}: </span><span className="strong">{art?.article_number ?? productOf(l.product_id)?.sku}</span>
                            {art && <><span className="muted"> · {tx("Artikelnummer leverancier")}: </span>{art.supplier_sku}<span className="muted"> · {s.suppliers.find((x) => x.id === art.supplier_id)?.name}</span></>}
                            {l.article && !l.product_id && <span className="muted"> · {tx("Nieuw product, wordt bij opslaan vastgelegd")}</span>}
                          </span>
                          {art && <button type="button" className="btn sm" onClick={() => setElementsFor(art)}><Layers size={14} />{tx("Elementen")}{l.article && 'element_count' in l.article ? ` (${(l.article as { element_count: number }).element_count})` : ''}</button>}
                        </div>
                      )
                    })()}
                    <div className="form-grid">
                      <Field className="span-2" label={tx("Product")}>{(fid) => <ArticleSearch id={fid} label={l.description || productOf(l.product_id)?.name || ''} sources={sources} onPick={(p) => pickArticle(l.key, p)} />}</Field>
                      <TextField label={tx("Uitvoering")} value={l.options} onChange={(v) => patch(l.key, { options: v })} placeholder={tx("Stof, kleur, afwerking")} />
                      <NumberField label={tx("Aantal")} value={l.qty} min={Math.max(1, locked)} step="1" hint={locked ? tx("{0} staat op een levering", locked) : undefined} onChange={(v) => patch(l.key, { qty: v })} />
                      <NumberField label={tx("Prijs incl. IVA")} value={l.unit_price} step="0.01" min={0} onChange={(v) => patch(l.key, { unit_price: v })} />
                      <NumberField label={tx("Korting %")} value={l.discount_pct} step="0.5" min={0} onChange={(v) => patch(l.key, { discount_pct: v })} />
                      <SelectField className="span-2" label={tx("Afhandeling")} value={l.take_now ? 'meenemen' : l.source} onChange={(v) => setHandling(l, v as 'meenemen' | 'voorraad' | 'bestelling')} options={[
                        ...(!fresh && !l.take_now ? [] : [{ value: 'meenemen', label: tx("Klant neemt direct mee") }]),
                        ...(l.take_now && !fresh ? [] : [{ value: 'voorraad', label: tx("Uit voorraad, later leveren") }, { value: 'bestelling', label: tx("Op bestelling") }]),
                      ]} />
                      {l.source === 'voorraad' && (
                        <SelectField className="span-2" label={tx("Uit magazijn")} value={l.warehouse_id} onChange={(v) => patch(l.key, { warehouse_id: v })} options={warehouses.map((w) => ({ value: w.id, label: tx("{0} ({1} vrij)", w.name, l.product_id ? freeFor(l, w.id) : 0) }))} />
                      )}
                    </div>
                    <div className="panel-head" style={{ margin: '8px 0 0' }}>
                      <div className="small">
                        {short && !l.take_now && fresh && <span className="strong">{tx("Bij opslaan: {0} uit voorraad, {1} op bestelling", Math.max(0, free), l.qty - Math.max(0, free))}{others.length ? tx(". Wel op {0}", others.map((w) => `${w.name} (${freeAt(l.product_id, w.id)})`).join(', ')) : ''}. </span>}
                        {short && (l.take_now || !fresh) && <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{tx("Maar")} {free} {tx("vrij op dit magazijn")}{others.length ? tx(". Wel op {0}", others.map((w) => `${w.name} (${freeAt(l.product_id, w.id)})`).join(', ')) : ''}. </span>}
                        {l.source === 'bestelling' && l.product_id && <span className="muted">{tx("Komt op de lijst \"Nog in te kopen\"")}{inbound.get(l.product_id) ? tx(". Al {0} ingekocht", inbound.get(l.product_id)) : ''}. </span>}
                      </div>
                      <div className="actions">
                        <span className="num strong">{eur(lineTotal(l))}</span>
                        <button className="btn icon" type="button" disabled={locked > 0} aria-label={tx("Regel verwijderen")} onClick={() => setLines((v) => v.filter((x) => x.key !== l.key))}><Trash2 size={16} /></button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {allTaken ? <section className="panel acc acc-levering"><h2>{tx("Levering")}</h2><p className="muted" style={{ margin: 0 }}>{tx("De klant neemt alles direct mee. Er is geen levering nodig.")}</p></section> : <section className="panel acc acc-levering">
            <h2>{tx("Levering")}</h2>
            <div className="form-grid">
              <SelectField className="span-2" label={tx("Afleverwijze")} value={h.fulfilment} onChange={setFulfilment} options={[
                { value: 'meenemen' as const, label: tx("Klant haalt later op") },
                { value: 'bezorgen', label: tx("Bezorgen door eigen team") }, { value: 'verzenden', label: tx("Verzenden met vervoerder") },
              ]} />
              {<>
                <TextField label={tx("Gewenste leverdatum")} type="date" value={h.requested_date} onChange={(v) => set({ requested_date: v || null })} />
                <TextField label={tx("Beloofde leverdatum")} type="date" value={h.promised_date} onChange={(v) => set({ promised_date: v || null })} />
              </>}
              {needsAddress && <>
                <TextField className="span-2" label={tx("Afleveren bij")} value={h.delivery_name} onChange={(v) => set({ delivery_name: v })} />
                <TextField label={tx("Telefoon bij levering")} type="tel" value={h.delivery_phone} onChange={(v) => set({ delivery_phone: v })} />
                <TextField className="span-2" label={tx("Afleveradres")} value={h.delivery_address} onChange={(v) => set({ delivery_address: v })} />
                <TextField label={tx("Postcode")} value={h.delivery_postal_code} onChange={(v) => set({ delivery_postal_code: v })} />
                <TextField label={tx("Plaats")} value={h.delivery_city} onChange={(v) => set({ delivery_city: v })} />
                <TextField label={tx("Verdieping")} value={h.floor} onChange={(v) => set({ floor: v })} placeholder={tx("Begane grond, 2e, ...")} />
                <div className="span-all actions" style={{ gap: '4px 22px' }}>
                  <Check label={tx("Lift aanwezig")} checked={h.has_elevator} onChange={(v) => set({ has_elevator: v })} />
                  <Check label={tx("Montage gewenst")} checked={h.needs_assembly} onChange={(v) => set({ needs_assembly: v })} />
                  <Check label={tx("Oude meubels meenemen")} checked={h.remove_old_furniture} onChange={(v) => set({ remove_old_furniture: v })} />
                </div>
                <AreaField className="span-all" label={tx("Instructies voor de bezorgers")} value={h.delivery_notes} onChange={(v) => set({ delivery_notes: v })} />
              </>}
            </div>
          </section>}
          <section className="panel acc acc-notitie"><h2>{tx("Notitie")}</h2><AreaField label={tx("Interne notitie")} value={h.notes} onChange={(v) => set({ notes: v })} /></section>
        </div>

        <div className="stack" style={{ position: 'sticky', top: 96 }}>
          <section className="panel">
            <h2>{tx("Totaal")}</h2>
            <div className="totals" style={{ maxWidth: 'none' }}>
              {fullDiscount > 0 && <div><span>{tx("Korting")}</span><span>−{eur(fullDiscount)}</span></div>}
              <div><span>{tx("Excl. IVA")}</span><span>{eur(breakdown.base)}</span></div>
              {breakdown.rates.map((r) => <div key={r.rate}><span>{tx("IVA")} {r.rate}%</span><span>{eur(r.vat)}</span></div>)}
              <div className="grand"><span>{tx("Totaal")}</span><span>{eur(breakdown.total)}</span></div>
              {lines.length > 0 && <div className="muted small"><span>{tx("Marge excl. IVA")}</span><span>{eur(margin)}</span></div>}
            </div>
          </section>
          {fresh && (
            <section className="panel">
              <h2><CreditCard size={16} style={{ verticalAlign: -2, marginRight: 6 }} />{tx("Vooruitbetaling")}</h2>
              <div className="stack" style={{ gap: 10 }}>
                <div className="actions">
                  <button type="button" className="btn sm" onClick={() => setDeposit(round2(breakdown.total * .3))}>30%</button>
                  <button type="button" className="btn sm" onClick={() => setDeposit(round2(breakdown.total * .5))}>50%</button>
                  <button type="button" className="btn sm" onClick={() => setDeposit(breakdown.total)}>{tx("Alles")}</button>
                </div>
                <NumberField label={tx("Bedrag")} value={deposit} step="0.01" min={0} onChange={setDeposit} />
                <SelectField label={tx("Betaalwijze")} value={depositMethod} onChange={setDepositMethod} options={[{ value: 'pin', label: tx("Pin") }, { value: 'contant', label: tx("Contant") }, { value: 'overboeking', label: tx("Overboeking") }, { value: 'online', label: tx("Online") }]} />
                <TextField label={tx("Betaalreferentie")} value={depositRef} onChange={setDepositRef} />
                {deposit > 0 && <div className="small muted">{tx("Nog te betalen:")} {eur(round2(breakdown.total - deposit))}{tx(". Wordt verrekend op de factuur.")}</div>}
              </div>
            </section>
          )}
          {isProforma && <button className="btn" type="button" onClick={keepProforma}>{tx("Bewaren als proforma")}</button>}
          <button className="btn primary" type="button" onClick={save}>{isProforma ? tx("Bevestigen als verkooporder") : existing ? tx("Wijzigingen opslaan") : allTaken ? tx("Verkooporder afronden en meegeven") : tx("Verkooporder aanmaken")}</button>
          <a className="btn" href={existing ? `#orders-${id}` : '#orders'}>{tx("Annuleren")}</a>
        </div>
      </div>

      {elementsFor && <ElementsModal article={elementsFor} onAdd={addArticleLine} onClose={() => setElementsFor(null)} />}
      {newCust && (
        <Modal wide title={tx("Nieuwe klant")} onClose={() => setNewCust(null)} footer={<>
          <button className="btn" onClick={() => setNewCust(null)}>{tx("Annuleren")}</button>
          <button className="btn primary" onClick={saveCustomer}>{tx("Klant toevoegen")}</button>
        </>}>
          <CustomerFields c={newCust} set={(p) => setNewCust((v) => ({ ...v!, ...p }))} />
        </Modal>
      )}
    </>
  )
}
