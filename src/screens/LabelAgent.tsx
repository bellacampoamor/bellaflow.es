import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Printer, Send, Settings2, Usb, X } from 'lucide-react'
import type { CatalogArticle } from '../data/types'
import {
  adjustPrice, labelBasePrice, MAX_LABEL_ROWS, parseLabelCommand, ruleIsEmpty, shortLabelName, singularQuery,
  type PriceRule, type PrinterSettings,
} from '../domain/labels'
import { useApp } from '../ui/app-context'
import { Check, Modal, NumberField, NumInput, SelectField } from '../ui/kit'
import {
  fmtLabelPrice, labelImage, loadPrinterSettings, pairedPrinter, pairPrinter, printDirect, printViaDialog, savePrinterSettings,
  usbSupported, type LabelData, type UsbDevice,
} from '../ui/labelPrint'
import { tx } from '../i18n'

const AVATAR = `${import.meta.env.BASE_URL}assets/brand/bellaflow-beeldmerk-2.png`
const USER_KEY = 'bella-flow-label-user'

interface Row { key: string; articleNumber: string; supplierSku: string; name: string; base: number | null; price: number | null; qty: number }
interface PrintList { id: string; at: string; user: string; rule: PriceRule; rows: Row[]; missing: string[]; capped: boolean }
type Msg = { id: string; from: 'bella' | 'user'; text: string; list?: string }

const ruleText = (r: PriceRule) => [
  r.pct ? tx("prijs {0}{1}%", r.pct > 0 ? '+' : '', String(r.pct).replace('.', ',')) : '',
  r.rounding ? tx("afgerond op ,{0}", r.rounding) : '',
].filter(Boolean).join(', ')

const TEST_ROW = (): Row => ({ key: 'test', articleNumber: 'LOL-TSE-0000000001', supplierSku: '', name: tx("TESTETIKET BELLA FLOW"), base: 123.95, price: 123.95, qty: 1 })

/** Klantenservice-agent op client.bellaflow.es. Voorlopig alleen prijsetiketten voor de DYMO LabelWriter 450 Turbo. */
export function LabelAgent() {
  const { db, s } = useApp()
  const people = s.salespeople.filter((p) => p.is_active)
  const [user, setUser] = useState(() => { try { return localStorage.getItem(USER_KEY) ?? '' } catch { return '' } })
  const userName = people.find((p) => p.id === user)?.name ?? ''
  const pickUser = (id: string) => { setUser(id); try { localStorage.setItem(USER_KEY, id) } catch { /* alleen deze sessie */ } }

  const [msgs, setMsgs] = useState<Msg[]>([])
  const [lists, setLists] = useState<Record<string, PrintList>>({})
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [setup, setSetup] = useState(false)
  const [printer, setPrinter] = useState<UsbDevice | null>(null)
  const [settings, setSettings] = useState<PrinterSettings>(loadPrinterSettings)
  const inputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { pairedPrinter().then(setPrinter).catch(() => {}) }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs])

  const id = () => crypto.randomUUID()
  const say = (text: string, list?: string) => setMsgs((m) => [...m, { id: id(), from: 'bella', text, list }])
  const lastListId = [...msgs].reverse().find((m) => m.list)?.list

  const rowFor = (a: CatalogArticle, rule: PriceRule, qty: number): Row => {
    const base = labelBasePrice(a, s.products, s.suppliers)
    const supplier = s.suppliers.find((x) => x.id === a.supplier_id)
    return { key: a.id, articleNumber: a.article_number, supplierSku: a.supplier_sku, name: shortLabelName(a.name, supplier?.name), base, price: base === null ? null : adjustPrice(base, rule), qty }
  }

  async function findCode(code: string): Promise<CatalogArticle | null> {
    if (/^[A-Z]{3}-[A-Z]{3}-\d{10}$/i.test(code)) return (await db.findArticles({ numbers: [code.toUpperCase()] }))[0] ?? null
    const c = code.toLowerCase()
    const hits = await db.searchArticles({ q: code, limit: 20 })
    return hits.find((a) => a.supplier_sku.toLowerCase() === c || a.ean === code || a.article_number.toLowerCase() === c) ?? null
  }

  async function handle(text: string) {
    const cmd = parseLabelCommand(text)
    const qty = Math.max(1, Math.min(cmd.qty ?? 1, 99))
    if (cmd.test) {
      const list: PrintList = { id: id(), at: new Date().toISOString(), user: userName, rule: { pct: 0, rounding: null }, rows: [TEST_ROW()], missing: [], capped: false }
      setLists((l) => ({ ...l, [list.id]: list }))
      say(tx("Hier is een testetiket met een kader langs de rand. Daarmee zie je of de printer recht en op de goede plek drukt. Klik op Printen."), list.id)
      return
    }
    // Alleen een prijsregel: toepassen op de laatste printlijst.
    if (!cmd.codes.length && !cmd.batches.length && !cmd.query && !ruleIsEmpty(cmd.rule) && lastListId) {
      const prev = lists[lastListId]
      const list: PrintList = { ...prev, id: id(), at: new Date().toISOString(), rule: cmd.rule, rows: prev.rows.map((r) => ({ ...r, price: r.base === null ? null : adjustPrice(r.base, cmd.rule) })) }
      setLists((l) => ({ ...l, [list.id]: list }))
      say(tx("Aangepast: {0}. Dit geldt alleen voor het etiket.", ruleText(cmd.rule)), list.id)
      return
    }
    if (!cmd.codes.length && !cmd.batches.length && !cmd.query) {
      say(tx("Dat begreep ik niet. Noem een artikelnummer, een EAN, een batch of een categorie of serie, eventueel met een prijsaanpassing. Bijvoorbeeld: \"LOL-TSE-0000000012 2x\", \"batch FU2602\" of \"alle tafels +10% afronden ,95\"."))
      return
    }
    const rows: Row[] = []
    const missing: string[] = []
    const notes: string[] = []
    let capped = false
    const add = (a: CatalogArticle) => { if (rows.length >= MAX_LABEL_ROWS) { capped = true; return } if (!rows.some((r) => r.key === a.id)) rows.push(rowFor(a, cmd.rule, qty)) }
    // Batch: alle artikelen waarvan het artikelnummer leverancier zo begint. Inactieve artikelen krijgen geen etiket.
    const batch = async (code: string, explicit: boolean) => {
      const all = await db.findArticles({ skuPrefix: code, limit: 500 })
      if (!all.length) return false
      const active = all.filter((a) => a.active)
      active.forEach(add)
      const off = all.length - active.length
      if (off && !active.length) notes.push(tx("Batch {0}: {1} artikelen gevonden, maar ze staan allemaal op inactief in de catalogus en krijgen geen etiket.", code, off))
      else if (off) notes.push(tx("Batch {0}: {1} actieve artikelen; {2} inactieve artikelen overgeslagen.", code, active.length, off))
      else if (explicit || active.length > 1) notes.push(tx("Batch {0}: {1} artikelen.", code, active.length))
      return true
    }
    for (const code of cmd.batches) if (!(await batch(code, true))) missing.push(code)
    for (const code of cmd.codes) {
      const a = await findCode(code)
      if (a) add(a)
      else if (!(await batch(code, false))) missing.push(code)
    }
    if (cmd.query) {
      let hits = await db.searchArticles({ q: singularQuery(cmd.query), limit: MAX_LABEL_ROWS })
      if (!hits.length) hits = await db.searchArticles({ q: cmd.query, limit: MAX_LABEL_ROWS })
      if (!hits.length) missing.push(cmd.query)
      if (hits.length >= MAX_LABEL_ROWS) capped = true
      hits.forEach(add)
    }
    if (!rows.length) {
      say([...notes, missing.length ? tx("Niets gevonden voor {0}. Controleer het nummer of probeer een ander woord.", missing.join(', ')) : ''].filter(Boolean).join(' '))
      return
    }
    const list: PrintList = { id: id(), at: new Date().toISOString(), user: userName, rule: cmd.rule, rows, missing, capped }
    setLists((l) => ({ ...l, [list.id]: list }))
    const pieces = rows.reduce((n, r) => n + r.qty, 0)
    const parts = [rows.length === 1 ? tx("Klaar: 1 etiket, {0} stuks", pieces) : tx("Klaar: {0} etiketten, {1} stuks", rows.length, pieces)]
    if (!ruleIsEmpty(cmd.rule)) parts[0] += ` ${tx("met {0}", ruleText(cmd.rule))}`
    parts[0] += '.'
    parts.push(...notes)
    if (missing.length) parts.push(tx("{0} niet gevonden.", missing.join(', ')))
    if (capped) parts.push(tx("Ik toon de eerste {0}; maak de opdracht specifieker voor de rest.", MAX_LABEL_ROWS))
    if (rows.some((r) => r.price === null)) parts.push(tx("Bij een artikel zonder prijs vul je de prijs zelf in."))
    parts.push(tx("Klik op Printen."))
    say(parts.join(' '), list.id)
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setMsgs((m) => [...m, { id: id(), from: 'user', text }])
    setInput('')
    setBusy(true)
    try { await handle(text) } catch (err) { say(tx("Dat lukte niet: {0}", err instanceof Error ? err.message : String(err))) } finally { setBusy(false) }
  }
  const prefill = (text: string) => { setInput(text); setTimeout(() => inputRef.current?.focus(), 0) }
  const runNow = (text: string) => { setInput(text); setTimeout(() => inputRef.current?.form?.requestSubmit(), 0) }

  const updateList = (listId: string, rows: Row[]) => setLists((l) => ({ ...l, [listId]: { ...l[listId], rows } }))

  async function doPrint(rows: Row[]) {
    const ready = rows.filter((r) => r.qty > 0)
    if (ready.some((r) => r.price === null)) { say(tx("Vul eerst bij elk artikel een prijs in.")); return }
    const labels = ready.map((r) => ({ data: { name: r.name, price: r.price, articleNumber: r.articleNumber, test: r.key === 'test' } satisfies LabelData, qty: r.qty }))
    if (!labels.length) return
    if (!printer) { setSetup(true); return }
    try {
      await printDirect(printer, labels, settings)
      say(tx("Verstuurd naar de printer: {0} stuks.", labels.reduce((n, l) => n + l.qty, 0)))
    } catch (err) {
      say(tx("De printer gaf een fout: {0}. Kijk onder Printer instellen, of druk af via het printvenster.", err instanceof Error ? err.message : String(err)))
    }
  }
  const dialogPrint = (rows: Row[]) => printViaDialog(rows.filter((r) => r.qty > 0 && r.price !== null).map((r) => ({ data: { name: r.name, price: r.price, articleNumber: r.articleNumber, test: r.key === 'test' }, qty: r.qty })))

  const greeting = userName
    ? tx("Hoi {0}! Ik zet prijsetiketten klaar voor de DYMO: per artikel, meerdere artikelen tegelijk, een hele batch (bijv. \"batch FU2602\") of een hele categorie of serie, met of zonder prijsaanpassing. Wat wil je printen?", userName)
    : tx("Hoi! Ik zet prijsetiketten klaar voor de DYMO: per artikel, meerdere artikelen tegelijk, een hele batch (bijv. \"batch FU2602\") of een hele categorie of serie, met of zonder prijsaanpassing. Wat wil je printen?")

  return (
    <div className="lab">
      <header className="lab-top">
        <img className="lab-logo" src={`${import.meta.env.BASE_URL}assets/brand/bellaflow-logo-small.png`} alt="Bella Flow" />
        <label className="lab-user">
          <span>{tx("Medewerker")}</span>
          <select value={user} onChange={(e) => pickUser(e.target.value)} aria-label={tx("Medewerker")}>
            <option value="">{tx("Kies…")}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </header>

      <main className="lab-chat">
        <div className="lab-hero">
          <img className="lab-avatar-lg" src={AVATAR} alt="" />
          <div className="lab-bubble bella first">
            <div className="lab-who">BELLA · Bella Flow</div>
            {greeting}
          </div>
        </div>
        {msgs.map((m) => (
          <div key={m.id} className={`lab-row ${m.from}`}>
            {m.from === 'bella' && <img className="lab-avatar-sm" src={AVATAR} alt="" />}
            <div className="lab-col">
              <div className={`lab-bubble ${m.from}`}>{m.text}</div>
              {m.list && lists[m.list] && <ListCard list={lists[m.list]} edge={settings.edgeMm} onRows={(rows) => updateList(m.list!, rows)} onPrint={doPrint} onDialog={dialogPrint} />}
            </div>
          </div>
        ))}
        {busy && <div className="lab-row bella"><img className="lab-avatar-sm" src={AVATAR} alt="" /><div className="lab-bubble bella muted">{tx("Even zoeken…")}</div></div>}
        <div ref={endRef} />
      </main>

      <footer className="lab-foot">
        <div className="lab-chips">
          <button className="lab-chip" onClick={() => prefill(tx("print etiket voor "))}>{tx("Etiket per artikel")}</button>
          <button className="lab-chip" onClick={() => prefill(tx("print etiketten voor "))}>{tx("Meerdere artikelen")}</button>
          <button className="lab-chip" onClick={() => prefill(tx("alle "))}>{tx("Per categorie of serie")}</button>
          <button className="lab-chip" onClick={() => prefill(tx("+10% afronden ,95"))}>{tx("Prijzen aanpassen")}</button>
          <button className="lab-chip light" onClick={() => runNow(tx("testetiket"))}>{tx("Testetiket")}</button>
          <button className="lab-chip light" onClick={() => setSetup(true)}><Settings2 size={14} />{tx("Printer instellen")}</button>
        </div>
        <form className="lab-input" onSubmit={submit}>
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder={tx("Bijv. \"print etiketten voor LOL-TSE-0000000012 en 8719128567890\" of \"alle tafels +10%\"")} aria-label={tx("Opdracht")} />
          <button className="btn primary" disabled={busy || !input.trim()}><Send size={16} />{tx("Stuur")}</button>
        </form>
        <div className="lab-note">{tx("Medewerkersmodus · etiketten 89 × 36 mm (DYMO 30321) · prijsaanpassingen gelden alleen op het etiket")}</div>
      </footer>

      {setup && <PrinterSetup printer={printer} settings={settings} onPrinter={setPrinter} onSettings={(v) => { setSettings(v); savePrinterSettings(v) }} onTest={() => doPrint([TEST_ROW()])} onClose={() => setSetup(false)} />}
    </div>
  )
}

function ListCard({ list, edge, onRows, onPrint, onDialog }: { list: PrintList; edge: number; onRows: (rows: Row[]) => void; onPrint: (rows: Row[]) => Promise<void>; onDialog: (rows: Row[]) => Promise<void> }) {
  const pieces = list.rows.reduce((n, r) => n + r.qty, 0)
  const [busy, setBusy] = useState(false)
  const set = (key: string, patch: Partial<Row>) => onRows(list.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const meta = [list.user, new Date(list.at).toLocaleString('nl-NL', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }), ruleIsEmpty(list.rule) ? '' : `${ruleText(list.rule)} ${tx("(alleen op etiket)")}`].filter(Boolean).join(' · ')
  const go = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } finally { setBusy(false) } }
  return (
    <section className="lab-card">
      <div className="lab-card-title">{tx("Printlijst")} · {list.rows.length === 1 ? tx("1 etiket") : tx("{0} etiketten", list.rows.length)}, {tx("{0} stuks", pieces)}</div>
      <div className="small muted">{meta}</div>
      <div className="lab-previews">{list.rows.slice(0, 3).map((r) => <Preview key={r.key} row={r} edge={edge} />)}</div>
      <div className="lab-table-wrap">
        <table className="lab-table">
          <thead><tr><th>{tx("Artikelnummer")}</th><th>{tx("Naam op etiket")}</th><th className="num">{tx("Prijs")}</th><th>{tx("Aantal")}</th><th aria-label={tx("Verwijderen")} /></tr></thead>
          <tbody>{list.rows.map((r) => (
            <tr key={r.key}>
              <td><span className="lab-code">{r.articleNumber}</span>{r.supplierSku && <div className="small muted">{r.supplierSku}</div>}</td>
              <td><input className="lab-name" value={r.name} maxLength={60} onChange={(e) => set(r.key, { name: e.target.value.toUpperCase() })} aria-label={tx("Naam op etiket")} /></td>
              <td className="num">
                {r.base !== null && r.price !== r.base && <s className="muted small">{fmtLabelPrice(r.base)}</s>}{' '}
                <input className="lab-price" type="number" step="0.01" min="0" value={r.price ?? ''} placeholder="0,00" onChange={(e) => set(r.key, { price: e.target.value === '' ? null : Number(e.target.value) })} aria-label={tx("Prijs")} />
              </td>
              <td><NumInput className="lab-qty" step="1" min={0} max={99} value={r.qty} onValue={(n) => set(r.key, { qty: Math.max(0, Math.min(99, Math.floor(n || 0))) })} aria-label={tx("Aantal")} /></td>
              <td><button className="btn icon sm" onClick={() => onRows(list.rows.filter((x) => x.key !== r.key))} aria-label={tx("Verwijderen")}><X size={14} /></button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="lab-actions">
        <button className="btn primary" disabled={busy || !pieces} onClick={() => go(() => onPrint(list.rows))}><Printer size={16} />{tx("Printen ({0})", pieces)}</button>
        <button className="btn" disabled={busy || !list.rows.length} onClick={() => go(() => onPrint([{ ...list.rows[0], qty: 1 }]))}>{tx("Eerste etiket printen")}</button>
        <button className="btn" disabled={busy || !pieces} onClick={() => go(() => onDialog(list.rows))}>{tx("Via printvenster")}</button>
      </div>
      {list.missing.length > 0 && <div className="small muted">{tx("Niet gevonden: {0}", list.missing.join(', '))}</div>}
    </section>
  )
}

function Preview({ row, edge }: { row: Row; edge: number }) {
  const [url, setUrl] = useState('')
  const data = useMemo<LabelData>(() => ({ name: row.name, price: row.price, articleNumber: row.articleNumber, test: row.key === 'test' }), [row.name, row.price, row.articleNumber, row.key])
  useEffect(() => { let live = true; labelImage(data).then((u) => { if (live) setUrl(u) }); return () => { live = false } }, [data, edge])
  return url ? <img className="lab-preview" src={url} alt={`${row.name} ${row.articleNumber}`} /> : <div className="lab-preview" />
}

function PrinterSetup({ printer, settings, onPrinter, onSettings, onTest, onClose }: {
  printer: UsbDevice | null; settings: PrinterSettings; onPrinter: (d: UsbDevice) => void; onSettings: (s: PrinterSettings) => void; onTest: () => void; onClose: () => void
}) {
  const [error, setError] = useState('')
  const connect = async () => {
    setError('')
    try { onPrinter(await pairPrinter()) } catch (e) {
      if (e instanceof Error && e.name === 'NotFoundError') return // venster gesloten zonder keuze
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <Modal title={tx("Printer instellen")} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{tx("Sluiten")}</button>{printer && <button className="btn primary" onClick={onTest}><Printer size={16} />{tx("Testetiket printen")}</button>}</>}>
      <div className="stack">
        {!usbSupported() ? (
          <div className="note warn">{tx("Deze browser kan niet rechtstreeks bij een USB-printer. Gebruik Chrome of Edge op de computer waar de DYMO aan hangt, of druk af via het printvenster.")}</div>
        ) : printer ? (
          <div className="note good">{tx("Gekoppeld: {0}", printer.productName || 'DYMO LabelWriter')}</div>
        ) : (
          <div className="note info">{tx("Sluit de DYMO LabelWriter 450 Turbo met USB aan en koppel hem hier. De browser onthoudt de printer voor deze site; DYMO-software is niet nodig.")}</div>
        )}
        {usbSupported() && <div><button className="btn" onClick={connect}><Usb size={16} />{printer ? tx("Andere printer koppelen") : tx("Printer koppelen")}</button></div>}
        {error && <div className="note bad">{tx("Koppelen lukte niet: {0}", error)}</div>}
        <p className="small muted">{tx("Op Windows houdt het printerstuurprogramma de USB-poort soms vast; dan kan de browser er niet bij. Druk in dat geval af via het printvenster, of laat de poort vrijgeven met het programma Zadig (WinUSB). Op een Mac, Chromebook of Android-tablet werkt het meestal direct.")}</p>
        <div className="form-grid">
          <NumberField label={tx("Verschuiving over de breedte (mm)")} hint={tx("Als de tekst niet op het etiket valt")} value={settings.offsetMm} step="0.5" min={0} onChange={(v) => onSettings({ ...settings, offsetMm: Math.max(0, Math.min(25, v)) })} />
          <NumberField label={tx("Witte rand links en rechts (mm)")} hint={tx("Groter maken als het kader of het logo wordt afgesneden")} value={settings.edgeMm} step="0.5" min={1} onChange={(v) => onSettings({ ...settings, edgeMm: Math.max(1, Math.min(10, v)) })} />
          <SelectField label={tx("Donkerte")} value={settings.density} onChange={(v) => onSettings({ ...settings, density: v })} options={[{ value: 'light', label: tx("Licht") }, { value: 'normal', label: tx("Normaal") }, { value: 'dark', label: tx("Donker") }]} />
        </div>
        <Check label={tx("Etiket 180° draaien")} checked={settings.rotate180} onChange={(v) => onSettings({ ...settings, rotate180: v })} />
        <Check label={tx("Spiegelen")} checked={settings.mirror} onChange={(v) => onSettings({ ...settings, mirror: v })} />
      </div>
    </Modal>
  )
}
