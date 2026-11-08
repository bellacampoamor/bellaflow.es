import { useMemo, useState } from 'react'
import { Lock, Printer } from 'lucide-react'
import type { CashClosing, Language } from '../data/types'
import { round2, todayISO } from '../domain/calc'
import { cashCount, closingDrift, closingOn, closingsOf, countedTotal, DENOMINATIONS, denomKey, isNote, kassaDay, openingFloat, type CashCounts, type KassaDay } from '../domain/cashClosing'
import { imageSrc, issuerInfo, listLanguage, type Issuer } from '../domain/issuers'
import { POS_CUSTOMER_NOTE } from '../domain/pos'
import { closeCashDay } from '../domain/services'
import { getLanguage, tx } from '../i18n'
import { go, useApp } from '../ui/app-context'
import { AreaField, DocPaper, Empty, eur, fmtDate, Head, Modal, NumInput, Tabs, TextField } from '../ui/kit'
import { useNavUi } from '../ui/nav'
import { InvoiceList } from './Reports'

export type KassaTab = 'overzicht' | 'dagafsluiting'
const POS_USER_KEY = 'bella-flow-pos-user'
/** Moment van afsluiten als 08-11-2026 18:42, in elke taal gelijk. */
const stamp = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}` }

/** Beheer > Kassa: het factuuroverzicht van de kassa en de dagafsluiting met kasopmaak, per bedrijf. */
export function KassaAdmin({ tab }: { tab: KassaTab }) {
  return (
    <>
      <Head title={tx("Kassa")} sub={tab === 'dagafsluiting'
        ? tx("Kasopmaak aan het eind van de dag: geteld contant tegenover het systeem, met het verschil. Per bedrijf een eigen dagstaat.")
        : tx("Facturas simplificadas van de kassa, met de betaalwijze. Afdrukken of PDF maakt er een A4-document van.")}>
        {tab === 'overzicht' && <button className="btn primary" onClick={() => window.print()}><Printer size={16} />{tx("Afdrukken of PDF")}</button>}
      </Head>
      <div className="no-print">
        <Tabs<KassaTab> value={tab} onChange={(v) => go(v === 'dagafsluiting' ? 'kassabeheer-dagafsluiting' : 'kassabeheer')} tabs={[{ value: 'overzicht', label: tx("Factuuroverzicht kassa") }, { value: 'dagafsluiting', label: tx("Dagafsluiting") }]} />
      </div>
      {tab === 'overzicht' ? <InvoiceList kassa /> : <DayClose />}
    </>
  )
}

const readUser = () => { try { const v = localStorage.getItem(POS_USER_KEY); return v ? JSON.parse(v) as string : '' } catch { return '' } }

function DayClose() {
  const { s, run } = useApp()
  const today = todayISO()
  const [issuer, setIssuer] = useNavUi<Issuer>('issuer', 'bella')
  const [date, setDate] = useNavUi('closeDate', today)
  const company = s.settings[0]
  const staff = s.salespeople.filter((p) => p.is_active)
  const [user, setUser] = useState(() => { const u = readUser(); return staff.some((p) => p.id === u) ? u : '' })
  const [counts, setCounts] = useState<CashCounts>({})
  const [deposited, setDeposited] = useState(0)
  const [terminal, setTerminal] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)

  const day = useMemo(() => kassaDay(s, issuer, date), [s, issuer, date])
  const closed = closingOn(s, issuer, date)
  const history = closingsOf(s, issuer)
  const opening = openingFloat(s, issuer, date)
  const counted = countedTotal(counts)
  const calc = cashCount({ opening, cash: day.cash, counted, deposited, card: day.card, cardTerminal: terminal })
  const later = history.find((c) => c.business_date > date)
  const info = issuerInfo(company, issuer)
  const needNote = calc.difference !== 0 || (calc.cardDifference ?? 0) !== 0

  const reset = () => { setCounts({}); setDeposited(0); setTerminal(null); setNote('') }
  const pickIssuer = (k: Issuer) => { setIssuer(k); reset() }
  const pickDate = (d: string) => { setDate(d || today); reset() }
  const save = async () => {
    const ok = await run((db) => closeCashDay(db, { issuer, date, salesperson_id: user, counts, deposited, card_terminal: terminal, note }), tx("Dag afgesloten."))
    setConfirm(false)
    if (ok) reset()
  }

  return (
    <div className="stack">
      <section className="panel no-print report-filter">
        <div className="chips">
          {(['bella', 'hdb'] as Issuer[]).map((k) => <button key={k} className={`chip${issuer === k ? ' on' : ''}`} aria-pressed={issuer === k} onClick={() => pickIssuer(k)}>{k === 'hdb' ? `HDB · ${issuerInfo(company, 'hdb').name}` : `Bella · ${company?.company_name ?? ''}`}</button>)}
        </div>
        <div className="report-dates">
          <TextField label={tx("Dag")} type="date" value={date} onChange={pickDate} />
          {date !== today && <button className="btn" onClick={() => pickDate(today)}>{tx("Vandaag")}</button>}
        </div>
      </section>

      {closed ? (
        <ClosedDay closing={closed} day={day} />
      ) : (
        <div className="no-print">
          {date > today && <div className="note warn" style={{ marginBottom: 12 }}>{tx("Een dag in de toekomst kun je niet afsluiten.")}</div>}
          {later && <div className="note warn" style={{ marginBottom: 12 }}>{tx("Er is al een latere dag afgesloten ({0}). Een eerdere dag kan daarna niet meer worden afgesloten.", fmtDate(later.business_date))}</div>}
          <div className="close-grid">
            <section className="panel">
              <h2>{tx("Volgens het systeem")}</h2>
              <p className="small muted" style={{ marginTop: 0 }}>{info.name}{info.tax_id ? ` · CIF ${info.tax_id}` : ''} · {fmtDate(date)}</p>
              <SystemFigures day={day} />
            </section>

            <section className="panel">
              <h2>{tx("Telling contant")}</h2>
              <div className="cash-count">
                {DENOMINATIONS.map((d) => {
                  const k = denomKey(d)
                  const n = counts[k] ?? 0
                  return (
                    <label key={k} className={isNote(d) ? 'cash-row note-row' : 'cash-row'}>
                      <span className="cash-denom">{eur(d)}</span>
                      <NumInput step="1" min={0} max={99999} value={n} onValue={(v) => setCounts((c) => ({ ...c, [k]: Math.max(0, Math.floor(v || 0)) }))} aria-label={tx("Aantal van {0}", eur(d))} />
                      <span className="num muted">{n ? eur(round2(n * d)) : ''}</span>
                    </label>
                  )
                })}
                <div className="cash-row cash-sum"><span>{tx("Geteld contant")}</span><span /><span className="num">{eur(counted)}</span></div>
              </div>
            </section>

            <section className="panel">
              <h2>{tx("Kasopmaak")}</h2>
              <div className="close-lines">
                <Line label={tx("Beginsaldo (wisselgeld)")} value={opening} hint={opening ? tx("Achtergelaten bij de vorige afsluiting.") : tx("Geen eerdere afsluiting: 0.")} />
                <Line label={tx("+ Contant ontvangen")} value={day.cash} />
                <Line label={tx("= Verwacht in de kas")} value={calc.expected} strong />
                <Line label={tx("Geteld contant")} value={counted} />
                <Diff label={tx("Verschil contant")} value={calc.difference} />
              </div>
              <div className="close-lines" style={{ marginTop: 14 }}>
                <Line label={tx("Pin volgens het systeem")} value={day.card} />
                <label className="close-line"><span>{tx("Pin volgens de pinautomaat")}</span>
                  <NumInput step="0.01" min={0} value={terminal} empty={NaN} onValue={(v) => setTerminal(Number.isFinite(v) ? v : null)} placeholder={tx("Niet ingevuld")} aria-label={tx("Pin volgens de pinautomaat")} />
                </label>
                {calc.cardDifference !== null && <Diff label={tx("Verschil pin")} value={calc.cardDifference} />}
              </div>
              <div className="close-lines" style={{ marginTop: 14 }}>
                <label className="close-line"><span>{tx("Afgestort (bank of kluis)")}</span>
                  <NumInput step="0.01" min={0} value={deposited} onValue={(v) => setDeposited(Math.max(0, v || 0))} aria-label={tx("Afgestort (bank of kluis)")} />
                </label>
                <Line label={tx("Blijft in de kas (wisselgeld morgen)")} value={calc.kept} strong bad={calc.kept < 0} />
              </div>
              <AreaField label={needNote ? tx("Toelichting (verplicht bij een verschil)") : tx("Toelichting")} value={note} onChange={setNote} />
              <label className="close-line" style={{ marginTop: 10 }}>
                <span>{tx("Opgemaakt door")}</span>
                <select value={user} onChange={(e) => setUser(e.target.value)} aria-label={tx("Opgemaakt door")}>
                  <option value="">{tx("Kies een medewerker")}</option>
                  {staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn primary" disabled={date > today || !!later} onClick={() => setConfirm(true)}><Lock size={16} />{tx("Dag afsluiten")}</button>
              </div>
            </section>
          </div>
        </div>
      )}

      <section className="panel no-print">
        <h2>{tx("Eerdere afsluitingen")}</h2>
        {history.length === 0 ? <Empty>{tx("Nog geen dag afgesloten voor dit bedrijf.")}</Empty> : (
          <div className="table-wrap"><table className="report-table">
            <thead><tr><th>{tx("Dag")}</th><th>{tx("Opgemaakt door")}</th><th className="num">{tx("Eenvoudige facturen")}</th><th className="num">{tx("Verwacht in de kas")}</th><th className="num">{tx("Geteld")}</th><th className="num">{tx("Verschil")}</th><th className="num">{tx("Afgestort")}</th><th className="num">{tx("Blijft in de kas")}</th></tr></thead>
            <tbody>
              {history.map((c) => (
                <tr key={c.id} className={c.business_date === date ? 'close-hist on' : 'close-hist'} aria-current={c.business_date === date ? 'true' : undefined} onClick={() => pickDate(c.business_date)}>
                  <td>{fmtDate(c.business_date)}</td>
                  <td>{s.salespeople.find((p) => p.id === c.salesperson_id)?.name ?? ''}</td>
                  <td className="num">{c.invoice_count}</td>
                  <td className="num">{eur(c.expected_cash)}</td>
                  <td className="num">{eur(c.counted_cash)}</td>
                  <td className={`num${c.difference ? ' diff-bad' : ''}`}>{eur(c.difference)}</td>
                  <td className="num">{eur(c.deposited)}</td>
                  <td className="num">{eur(c.kept_in_drawer)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      {confirm && (
        <Modal title={tx("Dag afsluiten")} center onClose={() => setConfirm(false)} footer={<>
          <button className="btn" onClick={() => setConfirm(false)}>{tx("Annuleren")}</button>
          <button className="btn primary" onClick={save}><Lock size={16} />{tx("Afsluiten")}</button>
        </>}>
          <p style={{ marginTop: 0 }}>{tx("{0}, {1}. Na afsluiten kun je de kasopmaak niet meer wijzigen.", info.name, fmtDate(date))}</p>
          <div className="close-lines">
            <Line label={tx("Verwacht in de kas")} value={calc.expected} />
            <Line label={tx("Geteld contant")} value={counted} />
            <Diff label={tx("Verschil contant")} value={calc.difference} />
            <Line label={tx("Blijft in de kas (wisselgeld morgen)")} value={calc.kept} />
          </div>
        </Modal>
      )}
    </div>
  )
}

const Line = ({ label, value, hint, strong, bad }: { label: string; value: number; hint?: string; strong?: boolean; bad?: boolean }) => (
  <div className={`close-line${strong ? ' strong' : ''}`}>
    <span>{label}{hint && <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>{hint}</span>}</span>
    <span className={`num${bad ? ' diff-bad' : ''}`}>{eur(value)}</span>
  </div>
)

/** Verschil: 0 is in orde, te weinig of te veel valt op. */
const Diff = ({ label, value }: { label: string; value: number }) => (
  <div className="close-line strong">
    <span>{label}</span>
    <span className={`num ${value === 0 ? 'diff-ok' : 'diff-bad'}`}>{value === 0 ? `${eur(0)} · ${tx("klopt")}` : `${value > 0 ? '+' : ''}${eur(value)} · ${value < 0 ? tx("te weinig") : tx("te veel")}`}</span>
  </div>
)

/** Aantal eenvoudige facturen, met de nummers van/t/m op een eigen regel eronder: blijft passen, ook bij lange nummers. */
const InvoiceCount = ({ n, first, last }: { n: number; first: string; last: string }) => (
  <div className="close-count">
    <div className="close-line"><span>{tx("Eenvoudige facturen")}</span><span className="num">{n}</span></div>
    {n > 0 && <div className="close-range small muted">{first === last ? first : tx("{0} t/m {1}", first, last)}</div>}
  </div>
)

function SystemFigures({ day }: { day: KassaDay }) {
  return (
    <div className="close-lines">
      <InvoiceCount n={day.count} first={day.first} last={day.last} />
      <Line label={tx("Omzet incl. IVA")} value={day.total} strong />
      <Line label={tx("Contant")} value={day.cash} />
      <Line label={tx("Pin")} value={day.card} />
      {day.other !== 0 && <Line label={tx("Overboeking of online")} value={day.other} />}
      {day.open !== 0 && <Line label={tx("Nog open")} value={day.open} bad />}
    </div>
  )
}

/** Een afgesloten dag: op het scherm de kerncijfers, bij afdrukken de dagstaat op A4. */
function ClosedDay({ closing: c, day }: { closing: CashClosing; day: KassaDay }) {
  const { s } = useApp()
  const company = s.settings[0]
  const by = s.salespeople.find((p) => p.id === c.salesperson_id)?.name ?? ''
  const drift = closingDrift(c, day)
  const docLanguage = listLanguage(company?.language_lists, getLanguage())
  return (
    <>
      <section className="panel no-print">
        <div className="report-screen-head">
          <h2>{tx("Afgesloten")}</h2>
          <span className="small muted">{tx("Door {0} op {1}", by, stamp(c.created_at))}</span>
        </div>
        {drift && <div className="note warn" style={{ margin: '8px 0 12px' }}>{tx("Na de afsluiting is er voor deze dag nog iets op de kassa geboekt. De dagstaat toont de stand bij afsluiten; nu: contant {0}, pin {1}, {2} eenvoudige facturen.", eur(day.cash), eur(day.card), day.count)}</div>}
        <div className="close-grid">
          <div className="close-lines">
            <InvoiceCount n={c.invoice_count} first={c.first_invoice} last={c.last_invoice} />
            <Line label={tx("Omzet incl. IVA")} value={c.total} strong />
            <Line label={tx("Contant")} value={c.cash_sales} />
            <Line label={tx("Pin")} value={c.card_sales} />
            {c.other_sales !== 0 && <Line label={tx("Overboeking of online")} value={c.other_sales} />}
          </div>
          <div className="close-lines">
            <Line label={tx("Beginsaldo (wisselgeld)")} value={c.opening_float} />
            <Line label={tx("= Verwacht in de kas")} value={c.expected_cash} strong />
            <Line label={tx("Geteld contant")} value={c.counted_cash} />
            <Diff label={tx("Verschil contant")} value={c.difference} />
            {c.card_terminal !== null && <Diff label={tx("Verschil pin")} value={round2(c.card_terminal - c.card_sales)} />}
          </div>
          <div className="close-lines">
            <Line label={tx("Afgestort (bank of kluis)")} value={c.deposited} />
            <Line label={tx("Blijft in de kas (wisselgeld morgen)")} value={c.kept_in_drawer} strong />
            {c.note && <div className="small" style={{ marginTop: 6 }}><span className="muted">{tx("Toelichting")}: </span>{c.note}</div>}
          </div>
        </div>
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn primary" onClick={() => window.print()}><Printer size={16} />{tx("Dagstaat afdrukken of PDF")}</button>
        </div>
      </section>
      <div className="print-only">
        <DayStatement closing={c} day={day} by={by} language={docLanguage} />
      </div>
    </>
  )
}

// Vaste teksten van de dagstaat, in de taal van de lijsten (Instellingen).
type DocText = Record<'title' | 'date' | 'by' | 'closedAt' | 'sales' | 'invoices' | 'numbers' | 'rate' | 'base' | 'vat' | 'total' | 'payments' | 'cash' | 'card' | 'other' | 'count' | 'opening' | 'cashIn' | 'expected' | 'counted' | 'diff' | 'deposited' | 'kept' | 'cardSys' | 'cardTerm' | 'cardDiff' | 'denoms' | 'denom' | 'qty' | 'amount' | 'note' | 'list' | 'number' | 'customer' | 'method' | 'noCustomer' | 'signBy' | 'signCheck' | 'none' | 'notFilled', string>
const D: Record<Language, DocText> = {
  nl: { title: 'Dagstaat kassa', date: 'Dag', by: 'Opgemaakt door', closedAt: 'Afgesloten op', sales: 'Verkopen', invoices: 'Eenvoudige facturen', numbers: 'Nummers', rate: 'IVA-tarief', base: 'Grondslag', vat: 'IVA', total: 'Totaal incl. IVA', payments: 'Per betaalwijze', cash: 'Contant', card: 'Pin', other: 'Overboeking of online', count: 'Kasopmaak', opening: 'Beginsaldo (wisselgeld)', cashIn: '+ Contant ontvangen', expected: '= Verwacht in de kas', counted: 'Geteld contant', diff: 'Verschil contant', deposited: 'Afgestort (bank of kluis)', kept: 'Blijft in de kas', cardSys: 'Pin volgens het systeem', cardTerm: 'Pin volgens de pinautomaat', cardDiff: 'Verschil pin', denoms: 'Telling per coupure', denom: 'Coupure', qty: 'Aantal', amount: 'Bedrag', note: 'Toelichting', list: 'Eenvoudige facturen van de dag', number: 'Factuurnummer', customer: 'Klant', method: 'Betaalwijze', noCustomer: 'Zonder klantgegevens', signBy: 'Handtekening opgemaakt door', signCheck: 'Handtekening gecontroleerd door', none: 'Geen eenvoudige facturen op deze dag.', notFilled: 'Niet ingevuld' },
  en: { title: 'Daily cash report', date: 'Day', by: 'Counted by', closedAt: 'Closed on', sales: 'Sales', invoices: 'Simplified invoices', numbers: 'Numbers', rate: 'VAT rate', base: 'Taxable base', vat: 'VAT', total: 'Total incl. VAT', payments: 'By payment method', cash: 'Cash', card: 'Card', other: 'Bank transfer or online', count: 'Cash count', opening: 'Opening float', cashIn: '+ Cash received', expected: '= Expected in drawer', counted: 'Cash counted', diff: 'Cash difference', deposited: 'Deposited (bank or safe)', kept: 'Left in drawer', cardSys: 'Card according to system', cardTerm: 'Card according to terminal', cardDiff: 'Card difference', denoms: 'Count by denomination', denom: 'Denomination', qty: 'Quantity', amount: 'Amount', note: 'Explanation', list: 'Simplified invoices of the day', number: 'Invoice number', customer: 'Customer', method: 'Payment', noCustomer: 'No customer details', signBy: 'Signature counted by', signCheck: 'Signature checked by', none: 'No simplified invoices on this day.', notFilled: 'Not filled in' },
  es: { title: 'Arqueo de caja diario', date: 'Día', by: 'Realizado por', closedAt: 'Cerrado el', sales: 'Ventas', invoices: 'Facturas simplificadas', numbers: 'Números', rate: 'Tipo de IVA', base: 'Base imponible', vat: 'IVA', total: 'Total con IVA', payments: 'Por forma de pago', cash: 'Efectivo', card: 'Tarjeta', other: 'Transferencia u online', count: 'Arqueo de caja', opening: 'Saldo inicial (cambio)', cashIn: '+ Efectivo cobrado', expected: '= Previsto en caja', counted: 'Efectivo contado', diff: 'Diferencia de efectivo', deposited: 'Retirado (banco o caja fuerte)', kept: 'Queda en caja', cardSys: 'Tarjeta según el sistema', cardTerm: 'Tarjeta según el datáfono', cardDiff: 'Diferencia de tarjeta', denoms: 'Recuento por billetes y monedas', denom: 'Valor', qty: 'Cantidad', amount: 'Importe', note: 'Observaciones', list: 'Facturas simplificadas del día', number: 'Número de factura', customer: 'Cliente', method: 'Forma de pago', noCustomer: 'Sin datos del cliente', signBy: 'Firma de quien realiza el arqueo', signCheck: 'Firma de quien lo comprueba', none: 'No hay facturas simplificadas en este día.', notFilled: 'Sin rellenar' },
}
const METHODS: Record<Language, Record<string, string>> = {
  nl: { pin: 'Pin', contant: 'Contant', overboeking: 'Overboeking', online: 'Online', open: 'Open' },
  en: { pin: 'Card', contant: 'Cash', overboeking: 'Bank transfer', online: 'Online', open: 'Open' },
  es: { pin: 'Tarjeta', contant: 'Efectivo', overboeking: 'Transferencia', online: 'Online', open: 'Pendiente' },
}

/** De dagstaat op A4, per bedrijf: verkopen, betaalwijzen, kasopmaak, telling per coupure en de facturen van de dag. */
function DayStatement({ closing: c, day, by, language }: { closing: CashClosing; day: KassaDay; by: string; language: Language }) {
  const { s } = useApp()
  const t = D[language]
  const info = issuerInfo(s.settings[0], c.issuer)
  const base = import.meta.env.BASE_URL
  const posCustomers = new Set(s.customers.filter((x) => x.notes === POS_CUSTOMER_NOTE).map((x) => x.id))
  const method = (id: string) => {
    const m = [...new Set(s.payments.filter((p) => p.invoice_id === id).map((p) => p.method as string))]
    return (m.length ? m : ['open']).map((k) => METHODS[language][k] ?? k).join(', ')
  }
  const row = (label: string, value: string, strong = false) => <tr className={strong ? 'report-total' : ''}><td>{label}</td><td className="num">{value}</td></tr>
  const cardDiff = c.card_terminal === null ? null : round2(c.card_terminal - c.card_sales)
  return (
    <DocPaper language={language}><div className="daystate">
      <div className="paper-top report-top">
        <div className="issuer-head">
          {info.logo ? <img className="issuer-logo" src={imageSrc(info.logo, base)} alt={info.name} /> : <h2>{info.name}</h2>}
          <div className="small muted">{info.name}{info.tax_id ? ` · CIF: ${info.tax_id}` : ''}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <h1>{t.title}</h1>
          <div>{t.date}: <b>{fmtDate(c.business_date)}</b></div>
          <div className="small muted">{t.by}: {by}</div>
          <div className="small muted">{t.closedAt}: {stamp(c.created_at)}</div>
        </div>
      </div>

      <div className="daystate-cols">
        <div>
          <h3>{t.sales}</h3>
          <table className="report-table report-doc"><tbody>
            {row(t.invoices, String(c.invoice_count))}
            {c.invoice_count > 0 && row(t.numbers, `${c.first_invoice}${c.last_invoice !== c.first_invoice ? ` – ${c.last_invoice}` : ''}`)}
            {row(t.base, eur(c.base_amount))}
            {row(t.vat, eur(c.vat_amount))}
            {row(t.total, eur(c.total), true)}
          </tbody></table>
          {day.rates.length > 0 && <table className="report-table report-doc" style={{ marginTop: 8 }}>
            <thead><tr><th>{t.rate}</th><th className="num">{t.base}</th><th className="num">{t.vat}</th><th className="num">{t.total}</th></tr></thead>
            <tbody>{day.rates.map((r) => <tr key={r.rate}><td>{r.rate}%</td><td className="num">{eur(r.base)}</td><td className="num">{eur(r.vat)}</td><td className="num">{eur(r.total)}</td></tr>)}</tbody>
          </table>}
          <h3>{t.payments}</h3>
          <table className="report-table report-doc"><tbody>
            {row(t.cash, eur(c.cash_sales))}
            {row(t.card, eur(c.card_sales))}
            {c.other_sales !== 0 && row(t.other, eur(c.other_sales))}
          </tbody></table>
        </div>
        <div>
          <h3>{t.count}</h3>
          <table className="report-table report-doc"><tbody>
            {row(t.opening, eur(c.opening_float))}
            {row(t.cashIn, eur(c.cash_sales))}
            {row(t.expected, eur(c.expected_cash), true)}
            {row(t.counted, eur(c.counted_cash))}
            {row(t.diff, `${c.difference > 0 ? '+' : ''}${eur(c.difference)}`, true)}
            {row(t.deposited, eur(c.deposited))}
            {row(t.kept, eur(c.kept_in_drawer), true)}
          </tbody></table>
          <table className="report-table report-doc" style={{ marginTop: 8 }}><tbody>
            {row(t.cardSys, eur(c.card_sales))}
            {row(t.cardTerm, c.card_terminal === null ? t.notFilled : eur(c.card_terminal))}
            {cardDiff !== null && row(t.cardDiff, `${cardDiff > 0 ? '+' : ''}${eur(cardDiff)}`, true)}
          </tbody></table>
          {c.note && <p className="small"><b>{t.note}:</b> {c.note}</p>}
        </div>
      </div>

      <h3>{t.denoms}</h3>
      <table className="report-table report-doc daystate-denoms">
        <thead><tr><th>{t.denom}</th><th className="num">{t.qty}</th><th className="num">{t.amount}</th><th>{t.denom}</th><th className="num">{t.qty}</th><th className="num">{t.amount}</th></tr></thead>
        <tbody>
          {Array.from({ length: Math.ceil(DENOMINATIONS.length / 2) }, (_, i) => [DENOMINATIONS[i], DENOMINATIONS[i + Math.ceil(DENOMINATIONS.length / 2)]]).map(([a, b]) => (
            <tr key={a}>
              <td>{eur(a)}</td><td className="num">{c.counts[denomKey(a)] ?? 0}</td><td className="num">{eur(round2((c.counts[denomKey(a)] ?? 0) * a))}</td>
              {b !== undefined ? <><td>{eur(b)}</td><td className="num">{c.counts[denomKey(b)] ?? 0}</td><td className="num">{eur(round2((c.counts[denomKey(b)] ?? 0) * b))}</td></> : <><td /><td /><td /></>}
            </tr>
          ))}
          <tr className="report-total"><td colSpan={5}>{t.counted}</td><td className="num">{eur(c.counted_cash)}</td></tr>
        </tbody>
      </table>

      <h3>{t.list}</h3>
      {day.invoices.length === 0 ? <p className="small muted">{t.none}</p> : (
        <table className="report-table report-doc">
          <thead><tr><th>{t.number}</th><th>{t.customer}</th><th>{t.method}</th><th className="num">{t.total}</th></tr></thead>
          <tbody>
            {day.invoices.map((i) => {
              const cu = s.customers.find((x) => x.id === i.customer_id)
              return <tr key={i.id}><td>{i.number}</td><td className="report-customer">{posCustomers.has(i.customer_id) ? t.noCustomer : cu?.company || cu?.name || ''}</td><td>{method(i.id)}</td><td className="num">{eur(i.total)}</td></tr>
            })}
          </tbody>
        </table>
      )}

      <div className="daystate-sign">
        <div><div className="sign-line" />{t.signBy}</div>
        <div><div className="sign-line" />{t.signCheck}</div>
      </div>
    </div></DocPaper>
  )
}
