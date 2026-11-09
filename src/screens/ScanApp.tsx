import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, ArrowLeft, Check as CheckIcon, Minus, Plus, ScanLine, Trash2, UserRound } from 'lucide-react'
import type { CatalogArticle } from '../data/types'
import { freeTotal, todayISO } from '../domain/calc'
import { labelBasePrice } from '../domain/labels'
import { addToBasket, inBasket, removeFromBasket, stockShortage, type BasketRow } from '../domain/scan'
import { createProformaOrder, findArticleByCode } from '../domain/services'
import { BarcodeScanner } from '../ui/BarcodeScanner'
import { armBeep, beepError } from '../ui/beep'
import { useApp } from '../ui/app-context'
import { eur, Modal, NumInput } from '../ui/kit'
import { tx } from '../i18n'

const USER_KEY = 'bella-flow-scan-user'
const BASKET_KEY = 'bella-flow-scan-basket'
const read = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback } catch { return fallback } }
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* alleen deze sessie */ } }

type View = 'scan' | 'qty' | 'list' | 'done'
interface Found { article: CatalogArticle; price: number | null; free: number; already: number }

/**
 * Scan-app op scan.bellaflow.es. De medewerker kiest zichzelf, scant het etiket en geeft het aantal op.
 * Het mandje wordt een verkooporder met de status Proforma, zonder klant en gekoppeld aan de medewerker.
 */
export function ScanApp() {
  const { db, s, run } = useApp()
  const people = s.salespeople.filter((p) => p.is_active)
  const [user, setUser] = useState<string>(() => read(USER_KEY, ''))
  const me = people.find((p) => p.id === user)
  const pickUser = (id: string) => { setUser(id); write(USER_KEY, id) }

  const [rows, setRows] = useState<BasketRow[]>(() => read(BASKET_KEY, []))
  useEffect(() => write(BASKET_KEY, rows), [rows])
  const [view, setView] = useState<View>(() => (read<BasketRow[]>(BASKET_KEY, []).length ? 'list' : 'scan'))
  const [found, setFound] = useState<Found | null>(null)
  const [qty, setQty] = useState(1)
  const [warn, setWarn] = useState<{ free: number; short: number } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState('')
  const [done, setDone] = useState<{ id: string; number: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<BasketRow | null>(null)

  useEffect(() => armBeep(), [])

  const pieces = rows.reduce((n, r) => n + r.qty, 0)
  const total = rows.reduce((n, r) => n + (r.price ?? 0) * r.qty, 0)

  async function lookup(code: string) {
    if (busy || view !== 'scan') return
    setBusy(true); setMessage('')
    try {
      const a = await findArticleByCode(db, code)
      if (!a) { beepError(); setMessage(tx("{0} niet gevonden. Scan opnieuw of typ het artikelnummer.", code)); return }
      const product = s.products.find((p) => p.catalog_article_number === a.article_number)
      setFound({ article: a, price: labelBasePrice(a, s.products, s.suppliers), free: freeTotal(s, product?.id), already: inBasket(rows, a.article_number) })
      setQty(1)
      setView('qty')
    } catch (e) {
      setMessage(tx("Zoeken lukte niet: {0}", e instanceof Error ? e.message : String(e)))
    } finally { setBusy(false) }
  }

  const add = (noStock: boolean) => {
    if (!found) return
    setRows((r) => addToBasket(r, { article: found.article, qty, price: found.price, noStock }))
    setFound(null); setWarn(null); setView('list')
  }
  const tryAdd = () => {
    if (!found || qty < 1) return
    const shortage = stockShortage(found.free, found.already, qty)
    if (shortage) setWarn(shortage); else add(false)
  }

  async function finish() {
    if (!me || !rows.length) return
    let result: { id: string; number: string } | null = null
    const ok = await run(async (d) => { result = await createProformaOrder(d, { salesperson_id: me.id, date: todayISO(), lines: rows.map((r) => ({ article: r.article, qty: r.qty })) }) })
    if (ok && result) { setDone(result); setRows([]); setView('done') }
  }

  const submitManual = (e: FormEvent) => {
    e.preventDefault()
    const code = manual.trim()
    if (!code) return
    setManual('')
    void lookup(code)
  }

  return (
    <div className="scan">
      <header className="lab-top">
        <img className="lab-logo" src={`${import.meta.env.BASE_URL}assets/brand/bellaflow-logo-small.png`} alt="Bella Flow" />
        {people.length > 0 && <label className="lab-user">
          <span>{tx("Medewerker")}</span>
          <select value={user} onChange={(e) => pickUser(e.target.value)} aria-label={tx("Medewerker")}>
            <option value="">{tx("Kies…")}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>}
      </header>

      {!me ? (
        <main className="scan-body">
          <h1 className="scan-h">{tx("Wie ben je?")}</h1>
          <p className="muted">{tx("Kies jezelf. De gescande verkooporder komt op jouw naam.")}</p>
          {people.length === 0 && <div className="note warn">{tx("Er zijn nog geen medewerkers. Voeg ze toe onder Instellingen in Bella Flow.")}</div>}
          <div className="scan-people">
            {people.map((p) => <button key={p.id} className="scan-person" onClick={() => pickUser(p.id)}><UserRound size={22} />{p.name}</button>)}
          </div>
        </main>
      ) : view === 'done' && done ? (
        <main className="scan-body">
          <div className="scan-done"><CheckIcon size={36} /></div>
          <h1 className="scan-h">{tx("Proforma {0} aangemaakt", done.number)}</h1>
          <p>{tx("De artikelen zijn gereserveerd op naam van {0}. De klantgegevens en de betaling worden in Bella Flow op de proforma ingevuld; pas dan krijgt de verkooporder zijn VO-nummer.", me.name)}</p>
          <button className="btn primary scan-big" onClick={() => { setDone(null); setView('scan') }}><ScanLine size={18} />{tx("Nieuwe klant scannen")}</button>
        </main>
      ) : view === 'scan' ? (
        <main className="scan-body">
          <div className="scan-bar">
            <h1 className="scan-h">{tx("Scan het etiket")}</h1>
            {rows.length > 0 && <button className="btn sm" onClick={() => setView('list')}>{tx("Gescand ({0})", pieces)}</button>}
          </div>
          <BarcodeScanner onCode={lookup} paused={busy} />
          {busy && <div className="note">{tx("Even zoeken…")}</div>}
          {message && <div className="note bad">{message}</div>}
          <form className="lab-input" onSubmit={submitManual}>
            <input value={manual} onChange={(e) => setManual(e.target.value)} inputMode="text" autoCapitalize="characters" placeholder={tx("Of typ artikelnummer of EAN")} aria-label={tx("Artikelnummer of EAN")} />
            <button className="btn" disabled={!manual.trim() || busy}>{tx("Zoek")}</button>
          </form>
        </main>
      ) : view === 'qty' && found ? (
        <main className="scan-body">
          <button className="linklike scan-back" onClick={() => { setFound(null); setView('scan') }}><ArrowLeft size={16} />{tx("Opnieuw scannen")}</button>
          <section className="lab-card">
            <div className="lab-code small">{found.article.article_number}</div>
            <div className="scan-name">{found.article.name}</div>
            <div className="small muted">{[found.article.supplier_sku, s.suppliers.find((x) => x.id === found.article.supplier_id)?.name].filter(Boolean).join(' · ')}</div>
            <div className="scan-facts">
              <div><span className="muted small">{tx("Prijs")}</span><strong>{found.price === null ? '–' : eur(found.price)}</strong></div>
              <div><span className="muted small">{tx("Vrij op voorraad")}</span><strong className={found.free - found.already > 0 ? '' : 'bad-text'}>{Math.max(0, found.free - found.already)}</strong></div>
              {found.already > 0 && <div><span className="muted small">{tx("Al gescand")}</span><strong>{found.already}</strong></div>}
            </div>
          </section>
          <div className="scan-qty" role="group" aria-label={tx("Aantal")}>
            <button className="btn icon" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label={tx("Minder")}><Minus size={20} /></button>
            <NumInput step="1" min={1} max={999} value={qty} onValue={(n) => setQty(Math.max(1, Math.min(999, Math.floor(n || 1))))} aria-label={tx("Aantal")} />
            <button className="btn icon" onClick={() => setQty((q) => Math.min(999, q + 1))} aria-label={tx("Meer")}><Plus size={20} /></button>
          </div>
          <button className="btn primary scan-big" onClick={tryAdd}>{tx("Toevoegen")}</button>
        </main>
      ) : (
        <main className="scan-body">
          <button className="btn primary scan-big" onClick={() => { setMessage(''); setView('scan') }}><ScanLine size={20} />{tx("Volgend product scannen")}</button>
          <div className="scan-bar">
            <h2 className="scan-h">{tx("Gescand")}</h2>
            <span className="muted small">{tx("{0} stuks", pieces)} · {eur(total)}</span>
          </div>
          {rows.length === 0 && <div className="note">{tx("Nog niets gescand.")}</div>}
          <ul className="scan-list">
            {rows.map((r) => (
              <li key={r.article.article_number}>
                <div className="scan-li-main">
                  <div className="strong">{r.qty} × {r.article.name}</div>
                  <div className="small muted">{r.article.article_number} · {r.price === null ? '–' : eur(r.price * r.qty)}</div>
                  {r.noStock && <div className="small warn-text"><AlertTriangle size={13} /> {tx("Niet (genoeg) op voorraad, gaat deels op bestelling")}</div>}
                </div>
                <button className="btn icon" onClick={() => setConfirmRemove(r)} aria-label={tx("{0} verwijderen", r.article.name)}><Trash2 size={18} /></button>
              </li>
            ))}
          </ul>
          {rows.length > 0 && <button className="btn primary scan-big" onClick={finish}>{tx("Proforma aanmaken")}</button>}
          {rows.length > 0 && <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>{tx("Wordt een verkooporder met de status Proforma, zonder klant, op naam van {0}.", me.name)}</p>}
        </main>
      )}

      {warn && found && (
        <Modal center title={warn.free === 0 ? tx("Geen voorraad") : tx("Niet genoeg voorraad")} onClose={() => setWarn(null)} footer={<>
          <button className="btn" onClick={() => setWarn(null)}>{tx("Annuleren")}</button>
          <button className="btn primary" onClick={() => add(true)}>{tx("Accepteren en doorgaan")}</button>
        </>}>
          <p style={{ margin: 0 }}>
            {warn.free === 0
              ? tx("{0} is niet vrij op voorraad. Accepteer je, dan gaat het op bestelling.", found.article.name)
              : tx("Van {0} zijn er nog {1} vrij. De overige {2} gaan op bestelling.", found.article.name, warn.free, warn.short)}
          </p>
        </Modal>
      )}
      {confirmRemove && (
        <Modal center title={tx("Verwijderen?")} onClose={() => setConfirmRemove(null)} footer={<>
          <button className="btn" onClick={() => setConfirmRemove(null)}>{tx("Annuleren")}</button>
          <button className="btn danger" onClick={() => { setRows((r) => removeFromBasket(r, confirmRemove.article.article_number)); setConfirmRemove(null) }}>{tx("Verwijderen")}</button>
        </>}>
          <p style={{ margin: 0 }}>{tx("{0} × {1} uit de lijst halen?", confirmRemove.qty, confirmRemove.article.name)}</p>
        </Modal>
      )}
    </div>
  )
}
