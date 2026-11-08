import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, Banknote, Check as CheckIcon, CreditCard, Minus, PenLine, Plus, Printer, ScanLine, Trash2, Undo2, UserPlus } from 'lucide-react'
import type { Customer, Payment } from '../data/types'
import { freeAt, lineTotal, todayISO } from '../domain/calc'
import { labelBasePrice } from '../domain/labels'
import { addPosLine, DUMMY_SKU, isDummyCode, missingCustomerData, POS_CUSTOMER_NOTE, posTotals, posWarehouse, SIMPLIFIED_LIMIT, type PosLine } from '../domain/pos'
import { findArticleByCode, findInvoiceByNumber, posCheckout, saveRecord } from '../domain/services'
import { canCredit, isCredit } from '../domain/credit'
import { loadSnapshot } from '../data/driver'
import { ArticleSearch, type ArticlePick } from '../ui/ArticleSearch'
import { go, useApp } from '../ui/app-context'
import { Check, Combo, Empty, eur, Field, Head, Modal, NumInput, TextField } from '../ui/kit'
import { issuerInfo } from '../domain/issuers'
import { CustomerFields } from './OrderForm'
import { tx } from '../i18n'
import { mailsAutomatically } from '../domain/mailSettings'

const USER_KEY = 'bella-flow-pos-user'
const CART_KEY = 'bella-flow-pos-cart'
const ALL_SOURCES = { off: [] as string[] }
const read = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback } catch { return fallback } }
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* alleen deze sessie */ } }
let seq = 1
const newKey = () => `${Date.now()}-${seq++}`

const emptyCustomer: Omit<Customer, 'id'> = { kind: 'particulier', name: '', company: '', tax_id: '', email: '', phone: '', language: 'es', address: '', postal_code: '', city: '', province: 'Alicante', country: 'España', notes: '' }
const editable = (el: Element | null) => !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable)

/**
 * Een bluetooth- of USB-handscanner typt de code razendsnel en sluit af met Enter. Staat de cursor niet in een
 * invoerveld, dan vangen we die toetsen hier op, zodat scannen altijd werkt, ook na een klik ergens op het scherm.
 */
function useScannerKeys(onScan: (code: string) => void) {
  const ref = useRef(onScan)
  ref.current = onScan
  useEffect(() => {
    let buf = '', last = 0
    const onKey = (e: KeyboardEvent) => {
      if (editable(document.activeElement) || e.ctrlKey || e.metaKey || e.altKey) return
      const now = performance.now()
      if (now - last > 80) buf = ''
      last = now
      if (e.key === 'Enter') {
        if (buf.length >= 3) { e.preventDefault(); ref.current(buf) }
        buf = ''
      } else if (e.key.length === 1) buf += e.key
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * Kassa (POS): een zeer eenvoudig scherm voor een verkoop in de winkel. Scannen met de handscanner, eventueel een
 * artikel met eigen omschrijving (DIVERSEN), afrekenen met pin of contant. Er ontstaat meteen een verkooporder,
 * afgeleverd, gefactureerd en betaald. Staat een artikel niet vrij op voorraad, dan wordt het verschil bijgeboekt.
 */
export function Pos() {
  const { s, db, run, toast } = useApp()
  const people = s.salespeople.filter((p) => p.is_active)
  const [user, setUser] = useState<string>(() => read(USER_KEY, ''))
  const me = people.find((p) => p.id === user)
  const [returning, setReturning] = useState(false)
  const pickUser = (id: string) => { setUser(id); write(USER_KEY, id) }

  const [lines, setLines] = useState<PosLine[]>(() => read(CART_KEY, []))
  useEffect(() => write(CART_KEY, lines), [lines])
  const [customerId, setCustomerId] = useState('')
  const [method, setMethod] = useState<Payment['method']>('pin')
  const [reference, setReference] = useState('')
  const [received, setReceived] = useState(0)
  const [mail, setMail] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [newCust, setNewCust] = useState<(Omit<Customer, 'id'> & { id?: string }) | null>(null)
  const [done, setDone] = useState<{ issuer: string; orderNumber: string; invoiceId: string; invoiceNumber: string; change: number; note: string; corrected: number } | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  // Welk bedrijf de eenvoudige factuur uitgeeft: Bella (standaard) of HDB (Handmade Bali Treasures SL). Na elke verkoop weer Bella.
  const [hdb, setHdb] = useState(false)
  const scanRef = useRef<HTMLInputElement>(null)

  const shop = posWarehouse(s.warehouses)
  const bella = issuerInfo(s.settings[0], 'bella'), hdbInfo = issuerInfo(s.settings[0], 'hdb')
  const issuer = hdb ? hdbInfo : bella
  const productOf = (id?: string) => (id ? s.products.find((p) => p.id === id) : undefined)
  const customers = useMemo(() => s.customers.filter((c) => c.notes !== POS_CUSTOMER_NOTE), [s.customers])
  const custOptions = useMemo(() => customers.map((c) => ({ value: c.id, label: c.company || c.name, sub: [c.company ? c.name : '', c.city, c.phone].filter(Boolean).join(', '), search: `${c.email} ${c.tax_id}` })), [customers])
  const customer = customers.find((c) => c.id === customerId)
  const mailOn = mailsAutomatically(s.settings[0], 'mail_invoice_simplified')
  const mailTo = mailOn ? (mail ?? customer?.email ?? '').trim() : ''
  const totals = posTotals(lines)
  // Factura simplificada: boven de grens zijn naam, adres, woonplaats en NIE of paspoort verplicht.
  const over = totals.total > SIMPLIFIED_LIMIT
  const missing = over ? (customer ? missingCustomerData(customer) : ['Klant']) : []
  const change = method === 'contant' && received > totals.total ? Math.round((received - totals.total) * 100) / 100 : 0

  const refocus = () => setTimeout(() => scanRef.current?.focus(), 0)
  useEffect(() => { if (me && !done) refocus() }, [me, done])

  // Vrij in de winkel per regel, rekening houdend met eerdere regels van hetzelfde product.
  const freeInShop = (l: PosLine) => {
    if (l.dummy || !shop) return null
    const pid = l.product_id ?? s.products.find((p) => p.catalog_article_number === l.code)?.id
    return pid ? Math.max(0, freeAt(s, pid, shop.id)) : 0
  }

  const addDummy = () => {
    const key = newKey()
    setLines((v) => addPosLine(v, { key, dummy: true, code: DUMMY_SKU, description: '', qty: 1, unit_price: 0, discount_pct: 0, vat_rate: 21 }))
    setFocusKey(key)
    setDone(null)
  }
  useEffect(() => {
    if (!focusKey) return
    const el = document.getElementById(`pos-desc-${focusKey}`) as HTMLInputElement | null
    el?.focus()
    setFocusKey(null)
  }, [focusKey, lines])

  const addPick = (p: ArticlePick) => {
    setDone(null); setMessage('')
    if (p.kind === 'product') {
      const pr = p.product
      if (pr.sku === DUMMY_SKU) return addDummy()
      setLines((v) => addPosLine(v, { key: newKey(), product_id: pr.id, code: pr.catalog_article_number || pr.sku, description: pr.name, qty: 1, unit_price: pr.sale_price, discount_pct: 0, vat_rate: pr.vat_rate }))
    } else {
      const a = p.article
      const pr = s.products.find((x) => x.catalog_article_number === a.article_number)
      setLines((v) => addPosLine(v, { key: newKey(), article: a, product_id: pr?.id, code: a.article_number, description: pr?.name ?? a.name, qty: 1, unit_price: labelBasePrice(a, s.products, s.suppliers) ?? 0, discount_pct: 0, vat_rate: pr?.vat_rate ?? 21 }))
    }
    refocus()
  }

  async function lookup(raw: string) {
    const c = raw.trim()
    if (!c || busy) return
    setMessage('')
    if (isDummyCode(c)) return addDummy()
    setBusy(true)
    try {
      const a = await findArticleByCode(db, c)
      if (a) addPick({ kind: 'article', article: a })
      else {
        const pr = s.products.find((p) => p.sku.toLowerCase() === c.toLowerCase())
        if (pr) addPick({ kind: 'product', product: pr })
        else setMessage(tx("{0} niet gevonden. Scan opnieuw, zoek op naam of gebruik Diversen.", c))
      }
    } catch (e) {
      setMessage(tx("Zoeken lukte niet: {0}", e instanceof Error ? e.message : String(e)))
    } finally { setBusy(false); refocus() }
  }
  useScannerKeys((c) => { if (me) void lookup(c) })

  const submitCode = (e: FormEvent) => {
    e.preventDefault()
    const c = code
    setCode('')
    void lookup(c)
  }
  const patch = (key: string, p: Partial<PosLine>) => setLines((v) => v.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const remove = (key: string) => { setLines((v) => v.filter((l) => l.key !== key)); refocus() }

  async function checkout() {
    if (!me) return toast(tx("Kies eerst de medewerker."), true)
    const noPrice = lines.find((l) => l.unit_price <= 0)
    if (noPrice) return toast(tx("Vul bij {0} een prijs in.", noPrice.description || noPrice.code), true)
    const noDesc = lines.find((l) => l.dummy && !l.description.trim())
    if (noDesc) return toast(tx("Vul bij het artikel {0} een omschrijving in.", DUMMY_SKU), true)
    if (missing.length) return toast(tx("Boven {0} zijn de gegevens van de klant verplicht: naam, adres, woonplaats en NIE of paspoortnummer.", eur(SIMPLIFIED_LIMIT)), true)
    if (method === 'contant' && received > 0 && received < totals.total) return toast(tx("Ontvangen is minder dan het totaal."), true)
    let result: Awaited<ReturnType<typeof posCheckout>> | null = null
    let note = ''
    const ok = await run(async (d) => {
      result = await posCheckout(d, { salesperson_id: me.id, customer_id: customerId || null, date: todayISO(), lines, payment: { method, reference }, invoiceEmail: mailTo, issuer: hdb ? 'hdb' : 'bella' })
      const snap = await loadSnapshot(d)
      const m = snap.email_outbox.find((x) => x.kind === 'factuur' && x.invoice_id === result!.invoiceId)
      note = !m ? '' : m.status === 'sent' ? tx("Gemaild naar {0}.", m.to_email) : m.status === 'demo' ? tx("Testversie: de mail naar {0} is niet echt verstuurd.", m.to_email) : tx("Mailen is mislukt: {0}", m.error)
    })
    if (!ok || !result) return
    const r = result as Awaited<ReturnType<typeof posCheckout>>
    setDone({ issuer: issuer.name, orderNumber: r.orderNumber, invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber, change, note, corrected: r.corrections.filter((x) => !x.dummy).length })
    setLines([]); setCustomerId(''); setReference(''); setReceived(0); setMail(null); setMethod('pin'); setMessage(''); setHdb(false)
  }

  const saveCustomer = async () => {
    if (!newCust?.name.trim()) return toast(tx("Vul de naam van de klant in."), true)
    let cid = ''
    if (await run(async (d) => { cid = await saveRecord(d, 'customers', newCust as Customer) }, newCust.id ? tx("Klant opgeslagen") : tx("Klant toegevoegd"))) { setCustomerId(cid); setNewCust(null) }
  }

  if (!me) return (
    <>
      <Head title={tx("Kassa")} sub={tx("Snelle verkoop in de winkel: scannen, afrekenen en meegeven.")} />
      <section className="panel pos-who">
        <h2>{tx("Wie staat er achter de kassa?")}</h2>
        {people.length === 0 && <div className="note warn">{tx("Er zijn nog geen medewerkers. Voeg ze toe onder Instellingen.")}</div>}
        <div className="scan-people">{people.map((p) => <button key={p.id} className="scan-person" onClick={() => pickUser(p.id)}>{p.name}</button>)}</div>
      </section>
    </>
  )

  return (
    <>
      <Head title={tx("Kassa")} sub={shop ? tx("Verkoop vanuit {0}. De klant neemt alles mee en betaalt direct.", shop.name) : undefined}>
        <label className="pos-user">
          <span className="small muted">{tx("Medewerker")}</span>
          <select value={user} onChange={(e) => pickUser(e.target.value)} aria-label={tx("Medewerker")}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button className="btn" onClick={() => setReturning(true)} title={tx("Retour of correctie op een eerdere kassabon: maakt een creditfactuur")}><Undo2 size={16} />{tx("Retour")}</button>
      </Head>
      {returning && <ReturnPicker onClose={() => setReturning(false)} />}
      <div className="pos">
        <div className="stack">
          <section className="panel pos-scan">
            <form onSubmit={submitCode} className="pos-scan-row">
              <ScanLine size={22} aria-hidden />
              <input ref={scanRef} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false}
                placeholder={tx("Scan het etiket of typ artikelnummer of EAN")} aria-label={tx("Artikelnummer of EAN")} />
              <button className="btn" disabled={!code.trim() || busy}>{tx("Toevoegen")}</button>
            </form>
            <div className="pos-scan-row2">
              <div className="pos-search"><ArticleSearch label="" sources={ALL_SOURCES} onPick={addPick} /></div>
              <button className="btn" type="button" onClick={addDummy} title={tx("Artikel met eigen omschrijving, artikelnummer {0}", DUMMY_SKU)}><PenLine size={16} />{tx("Diversen")}</button>
            </div>
            {busy && <div className="note">{tx("Even zoeken…")}</div>}
            {message && <div className="note bad">{message}</div>}
          </section>

          {done && (
            <section className="panel pos-done">
              <div className="pos-done-icon"><CheckIcon size={28} /></div>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0 }}>{tx("Afgerekend: factura simplificada {0}", done.invoiceNumber)}</h2>
                <div className="small muted">{tx("Factuur van {0}.", done.issuer)} {tx("Verkooporder {0}, afgeleverd en betaald.", done.orderNumber)} {done.note}</div>
                {done.change > 0 && <div className="pos-change">{tx("Wisselgeld")}: {eur(done.change)}</div>}
                {done.corrected > 0 && <div className="small warn-text"><AlertTriangle size={13} /> {tx("Voorraadverschil bijgeboekt voor {0} artikel(en); zie Voorraad, mutaties.", done.corrected)}</div>}
              </div>
              <div className="actions">
                <a className="btn" href={`#facturatie-print-${done.invoiceId}`}><Printer size={16} />{tx("Factuur afdrukken")}</a>
                <button className="btn primary" onClick={() => { setDone(null); refocus() }}>{tx("Nieuwe verkoop")}</button>
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h2>{tx("Artikelen")}</h2>{lines.length > 0 && <button className="linklike small" onClick={() => { setLines([]); refocus() }}>{tx("Alles wissen")}</button>}</div>
            {lines.length === 0 ? <Empty>{tx("Scan het eerste artikel.")}</Empty> : (
              <ul className="pos-lines">
                {lines.map((l) => {
                  const free = freeInShop(l)
                  const short = free !== null && l.qty > free
                  return (
                    <li key={l.key}>
                      <div className="pos-li-main">
                        <div className="small muted">{l.code}</div>
                        {l.dummy
                          ? <input id={`pos-desc-${l.key}`} className="pos-desc" value={l.description} placeholder={tx("Omschrijving (verplicht)")} aria-label={tx("Omschrijving")} onChange={(e) => patch(l.key, { description: e.target.value })} />
                          : <div className="strong">{l.description}</div>}
                        {short && <div className="small warn-text"><AlertTriangle size={13} /> {tx("{0} vrij in de winkel; het verschil wordt bij afrekenen bijgeboekt.", free)}</div>}
                        {l.unit_price <= 0 && <div className="small bad-text">{tx("Vul een prijs in.")}</div>}
                      </div>
                      <div className="pos-qty" role="group" aria-label={tx("Aantal")}>
                        <button className="btn icon" onClick={() => patch(l.key, { qty: Math.max(1, l.qty - 1) })} aria-label={tx("Minder")}><Minus size={16} /></button>
                        <NumInput className="qty" step="1" min={1} max={999} value={l.qty} onValue={(n) => patch(l.key, { qty: Math.max(1, Math.min(999, Math.floor(n || 1))) })} aria-label={tx("Aantal")} />
                        <button className="btn icon" onClick={() => patch(l.key, { qty: Math.min(999, l.qty + 1) })} aria-label={tx("Meer")}><Plus size={16} /></button>
                      </div>
                      <label className="pos-num"><span className="small muted">{tx("Prijs incl. IVA")}</span><NumInput className="price" step="0.01" min={0} value={l.unit_price} onValue={(n) => patch(l.key, { unit_price: n })} /></label>
                      <label className="pos-num pos-disc"><span className="small muted">{tx("Korting %")}</span><NumInput className="qty" step="0.5" min={0} max={100} value={l.discount_pct} onValue={(n) => patch(l.key, { discount_pct: n })} /></label>
                      {l.dummy && <label className="pos-num pos-disc"><span className="small muted">{tx("IVA")}</span><select value={l.vat_rate} onChange={(e) => patch(l.key, { vat_rate: Number(e.target.value) })}>{[21, 10, 4, 0].map((r) => <option key={r} value={r}>{r}%</option>)}</select></label>}
                      <div className="pos-li-total num strong">{eur(lineTotal(l))}</div>
                      <button className="btn icon" onClick={() => remove(l.key)} aria-label={tx("{0} verwijderen", l.description || l.code)}><Trash2 size={16} /></button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="stack pos-side">
          <section className={`panel pos-issuer${hdb ? ' hdb' : ''}`}>
            <div className="small muted">{tx("Factuur van")}</div>
            <div className="strong">{issuer.name}</div>
            <Check label={tx("Factuur van HDB ({0})", hdbInfo.name)} checked={hdb} onChange={setHdb} />
          </section>
          <section className="panel">
            <div className="pos-total"><span>{tx("Totaal")}</span><strong>{eur(totals.total)}</strong></div>
            <div className="totals" style={{ maxWidth: 'none' }}>
              <div><span>{tx("{0} stuks", totals.pieces)}</span><span /></div>
              {totals.discount > 0 && <div><span>{tx("Korting")}</span><span>−{eur(totals.discount)}</span></div>}
              <div><span>{tx("Excl. IVA")}</span><span>{eur(totals.base)}</span></div>
              {totals.rates.map((r) => <div key={r.rate}><span>{tx("IVA")} {r.rate}%</span><span>{eur(r.vat)}</span></div>)}
            </div>
          </section>
          <section className="panel stack" style={{ gap: 12 }}>
            <div className="pos-pay" role="group" aria-label={tx("Betaalwijze")}>
              <button className={method === 'pin' ? 'btn on' : 'btn'} onClick={() => setMethod('pin')}><CreditCard size={18} />{tx("Pin")}</button>
              <button className={method === 'contant' ? 'btn on' : 'btn'} onClick={() => setMethod('contant')}><Banknote size={18} />{tx("Contant")}</button>
            </div>
            {method === 'contant' && <>
              <Field label={tx("Ontvangen")}>{(id) => <NumInput id={id} step="0.01" min={0} value={received} onValue={setReceived} />}</Field>
              {received > 0 && <div className="pos-change">{received >= totals.total ? `${tx("Wisselgeld")}: ${eur(change)}` : tx("Nog {0} te ontvangen", eur(totals.total - received))}</div>}
            </>}
            {method === 'pin' && <TextField label={tx("Betaalreferentie")} value={reference} onChange={setReference} placeholder={tx("Optioneel, bijv. bonnummer pinautomaat")} />}
          </section>
          <section className="panel stack" style={{ gap: 10 }}>
            <Field label={tx("Klant")} hint={customer ? undefined : tx("Leeg: kassaverkoop zonder klantgegevens (tot {0}).", eur(SIMPLIFIED_LIMIT))}>{(id) => <Combo id={id} value={customerId} options={custOptions} placeholder={tx("Zonder klantgegevens")} onChange={setCustomerId} />}</Field>
            <div className="actions">
              <button className="btn sm" type="button" onClick={() => setNewCust({ ...emptyCustomer })}><UserPlus size={14} />{tx("Nieuwe klant")}</button>
              {customerId && <button className="linklike small" type="button" onClick={() => { setCustomerId(''); setMail(null) }}>{tx("Zonder klantgegevens")}</button>}
            </div>
            {over && <div className={missing.length ? 'note warn' : 'note'}>
              <div>
                {tx("Boven {0} zijn de gegevens van de klant verplicht: naam, adres, woonplaats en NIE of paspoortnummer.", eur(SIMPLIFIED_LIMIT))}
                {customer && missing.length > 0 && <div className="strong">{tx("Nog in te vullen: {0}.", missing.map((m) => tx(m)).join(', '))}</div>}
                {customer && missing.length > 0 && <button className="btn sm" type="button" style={{ marginTop: 6 }} onClick={() => setNewCust({ ...customer })}>{tx("Gegevens aanvullen")}</button>}
              </div>
            </div>}
            {mailOn
              ? <TextField label={tx("Factuur mailen naar")} type="email" value={mail ?? customer?.email ?? ''} onChange={setMail} placeholder={tx("naam@voorbeeld.es")} hint={tx("Leeg laten: niet mailen.")} />
              : <p className="small muted" style={{ margin: 0 }}>{tx("Mailen van de eenvoudige factuur staat uit onder Instellingen.")}</p>}
          </section>
          <button className="btn primary pos-go" disabled={!lines.length} onClick={checkout}>{tx("Afrekenen {0}", eur(totals.total))}</button>
          <p className="small muted" style={{ margin: 0 }}>{tx("Maakt de verkooporder, de factura simplificada van vandaag en de betaling, in één keer.")}</p>
          <button className="linklike small" style={{ alignSelf: 'flex-start' }} onClick={() => go('orders-nieuw')}>{tx("Bezorgen of bestellen? Maak een gewone verkooporder.")}</button>
        </div>
      </div>

      {newCust && (
        <Modal wide title={newCust.id ? tx("Klantgegevens aanvullen") : tx("Nieuwe klant")} onClose={() => setNewCust(null)} footer={<>
          <button className="btn" onClick={() => setNewCust(null)}>{tx("Annuleren")}</button>
          <button className="btn primary" onClick={saveCustomer}>{tx("Klant opslaan")}</button>
        </>}>
          <CustomerFields c={newCust} set={(p) => setNewCust((v) => ({ ...v!, ...p }))} />
        </Modal>
      )}
    </>
  )
}

/** Retour aan de kassa: zoek de eenvoudige factuur (scan of typ het nummer, of kies een recente) en maak de creditfactuur. */
function ReturnPicker({ onClose }: { onClose: () => void }) {
  const { s } = useApp()
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const recent = s.invoices.filter((i) => i.simplified && !isCredit(i)).sort((a, b) => b.number.localeCompare(a.number)).slice(0, 8)
  const open = (id: string) => go(`facturatie-crediteren-${id}`)
  const find = (e: FormEvent) => {
    e.preventDefault()
    const inv = findInvoiceByNumber(s, number)
    if (!inv) return setError(tx("Factuur {0} niet gevonden.", number.trim()))
    if (isCredit(inv)) return setError(tx("Dit is zelf een creditfactuur."))
    if (!canCredit(s, inv)) return setError(tx("Deze factuur is al volledig gecrediteerd."))
    open(inv.id)
  }
  const customer = (id: string) => { const c = s.customers.find((x) => x.id === id); return c && c.notes !== POS_CUSTOMER_NOTE ? c.company || c.name : tx("Kassaverkoop") }
  return (
    <Modal title={tx("Retour of correctie")} onClose={onClose} footer={<button className="btn" onClick={onClose}>{tx("Annuleren")}</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>{tx("Een kassabon kan niet worden gewijzigd. Een retour wordt een creditfactuur op de oorspronkelijke factuur, van hetzelfde bedrijf.")}</p>
      <form onSubmit={find} className="pos-scan-row">
        <ScanLine size={20} aria-hidden />
        <input autoFocus value={number} onChange={(e) => { setNumber(e.target.value); setError('') }} placeholder={tx("Scan of typ het factuurnummer")} aria-label={tx("Factuurnummer")} autoCapitalize="characters" spellCheck={false} />
        <button className="btn primary" disabled={!number.trim()}>{tx("Zoeken")}</button>
      </form>
      {error && <div className="note bad">{error}</div>}
      {recent.length > 0 && <>
        <h3 style={{ margin: '14px 0 6px' }}>{tx("Recente kassabonnen")}</h3>
        <div className="table-wrap flush"><table>
          <tbody>{recent.map((i) => (
            <tr key={i.id} className={canCredit(s, i) ? 'click' : 'muted'} onClick={() => canCredit(s, i) && open(i.id)}>
              <td className="strong">{i.number}{i.issuer === 'hdb' && ' · HDB'}</td><td>{i.invoice_date.slice(0, 10).split('-').reverse().join('-')}</td><td>{customer(i.customer_id)}</td>
              <td className="num">{eur(i.total)}</td><td className="small muted">{canCredit(s, i) ? '' : tx("Volledig gecrediteerd")}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </>}
    </Modal>
  )
}
