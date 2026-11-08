import { useState } from 'react'
import { Printer } from 'lucide-react'
import { invoiceReport, periodRange, round2, todayISO, type ReportPeriod } from '../domain/calc'
import { POS_CUSTOMER_NOTE } from '../domain/pos'
import { issuerInfo, listLanguage, type Issuer } from '../domain/issuers'
import type { Language } from '../data/types'
import { getLanguage, tx } from '../i18n'
import { go, useApp } from '../ui/app-context'
import { DocPaper, Empty, eur, fmtDate, Head, Tabs, TextField } from '../ui/kit'
import { Archive } from './Archive'
import { Deliverable } from './Deliverable'

export type ReportTab = 'facturen' | 'kassa' | 'leverbaar' | 'archief'

// Vaste teksten van de afgedrukte lijst, in de taal uit Instellingen.
type ListText = { title: string; titleKassa: string; period: (from: string, to: string) => string; empty: string; number: string; date: string; order: string; customer: string; base: string; vat: string; total: string; sum: (n: number) => string; method: string; noCustomer: string; methods: Record<string, string>; perMethod: string }
const T: Record<Language, ListText> = {
  nl: { title: 'Factuuroverzicht', titleKassa: 'Factuuroverzicht kassa (facturas simplificadas)', period: (a, b) => `Periode ${a} t/m ${b}`, empty: 'Geen facturen in deze periode.', number: 'Factuurnummer', date: 'Datum', order: 'Verkooporder', customer: 'Klant', base: 'Totaal excl. IVA', vat: 'IVA', total: 'Totaal incl. IVA', sum: (n) => `Totaal (${n} ${n === 1 ? 'factuur' : 'facturen'})`, method: 'Betaalwijze', noCustomer: 'Zonder klantgegevens', methods: { pin: 'Pin', contant: 'Contant', overboeking: 'Overboeking', online: 'Online', open: 'Open' }, perMethod: 'Per betaalwijze' },
  en: { title: 'Invoice overview', titleKassa: 'POS invoice overview (simplified invoices)', period: (a, b) => `Period ${a} to ${b}`, empty: 'No invoices in this period.', number: 'Invoice number', date: 'Date', order: 'Sales order', customer: 'Customer', base: 'Total excl. VAT', vat: 'VAT', total: 'Total incl. VAT', sum: (n) => `Total (${n} ${n === 1 ? 'invoice' : 'invoices'})`, method: 'Payment', noCustomer: 'No customer details', methods: { pin: 'Card', contant: 'Cash', overboeking: 'Bank transfer', online: 'Online', open: 'Open' }, perMethod: 'By payment method' },
  es: { title: 'Resumen de facturas', titleKassa: 'Resumen de facturas simplificadas (TPV)', period: (a, b) => `Periodo del ${a} al ${b}`, empty: 'No hay facturas en este periodo.', number: 'Número de factura', date: 'Fecha', order: 'Pedido de venta', customer: 'Cliente', base: 'Total sin IVA', vat: 'IVA', total: 'Total con IVA', sum: (n) => `Total (${n} ${n === 1 ? 'factura' : 'facturas'})`, method: 'Forma de pago', noCustomer: 'Sin datos del cliente', methods: { pin: 'Tarjeta', contant: 'Efectivo', overboeking: 'Transferencia', online: 'Online', open: 'Pendiente' }, perMethod: 'Por forma de pago' },
}

/** Rapportage: lijsten om af te drukken, en het Archief. */
export function Reports({ tab }: { tab: ReportTab }) {
  return (
    <>
      <Head title={tx("Rapportage")} sub={tab === 'archief' ? tx("Alle afgeleverde leveringen met hun afleverbonnen en facturen.") : tab === 'leverbaar' ? tx("Welke verkooporders kunnen worden afgeleverd met wat er binnen is.") : tab === 'kassa' ? tx("Facturas simplificadas van de kassa, met de betaalwijze. Afdrukken of PDF maakt er een A4-document van.") : tx("Kies een periode. Afdrukken of PDF maakt er een A4-document van.")}>
        {(tab === 'facturen' || tab === 'kassa') && <button className="btn primary" onClick={() => window.print()}><Printer size={16} />{tx("Afdrukken of PDF")}</button>}
      </Head>
      <div className="no-print">
        <Tabs<ReportTab> value={tab} onChange={(v) => go(v === 'archief' ? 'archief' : v === 'leverbaar' ? 'rapportage-leverbaar' : v === 'kassa' ? 'rapportage-kassa' : 'rapportage')} tabs={[{ value: 'facturen', label: tx("Factuuroverzicht") }, { value: 'kassa', label: tx("Factuuroverzicht kassa") }, { value: 'leverbaar', label: tx("Leverbaar") }, { value: 'archief', label: tx("Archief") }]} />
      </div>
      {tab === 'facturen' ? <InvoiceList key="f" /> : tab === 'kassa' ? <InvoiceList key="k" kassa /> : tab === 'leverbaar' ? <Deliverable /> : <Archive />}
    </>
  )
}

/** Gewone facturen, of met kassa alleen de facturas simplificadas van de kassa (eigen nummerreeks), met betaalwijze. */
function InvoiceList({ kassa = false }: { kassa?: boolean }) {
  const { s } = useApp()
  const today = todayISO()
  const [period, setPeriod] = useState<ReportPeriod>('maand')
  const [customFrom, setCustomFrom] = useState(`${today.slice(0, 7)}-01`)
  const [customTo, setCustomTo] = useState(today)
  const { from, to } = periodRange(period, today, customFrom, customTo)
  // Kassa: per bedrijf een eigen lijst (HDB valt buiten de boekhouding van Bella).
  const [issuer, setIssuer] = useState<Issuer>('bella')
  const report = invoiceReport(s, from, to, kassa, kassa ? issuer : undefined)
  const options: [ReportPeriod, string][] = [['maand', tx("Deze maand")], ['kwartaal', tx("Laatste 3 maanden")], ['jaar', tx("Dit jaar (YTD)")], ['vrij', tx("Van t/m")]]
  const company = s.settings[0]
  // Op het scherm altijd de schermtaal; het afgedrukte document de taal uit Instellingen (standaard ook de schermtaal).
  const screen = getLanguage()
  const docLanguage = listLanguage(company?.language_lists, screen)
  const posCustomers = new Set(s.customers.filter((c) => c.notes === POS_CUSTOMER_NOTE).map((c) => c.id))
  const isPosCustomer = (id: string) => posCustomers.has(id)
  // Betaalwijze per factuur; niet (volledig) betaald telt als Open.
  const methodOf = (invoiceId: string) => {
    const m = [...new Set(s.payments.filter((p) => p.invoice_id === invoiceId).map((p) => p.method as string))]
    return m.length ? m : ['open']
  }
  const sums = new Map<string, number>()
  if (kassa) for (const { invoice: i } of report.rows) {
    const pays = s.payments.filter((p) => p.invoice_id === i.id)
    for (const p of pays) sums.set(p.method, round2((sums.get(p.method) ?? 0) + p.amount))
    const open = round2(i.total - i.deposit_settled - pays.reduce((n, p) => n + p.amount, 0))
    if (open > 0) sums.set('open', round2((sums.get('open') ?? 0) + open))
  }
  const byMethod = [...sums.entries()]
  const name = kassa ? issuerInfo(company, issuer).name : company?.company_name
  const taxId = kassa ? issuerInfo(company, issuer).tax_id : ''

  /** De tabel zelf, in de taal t; met paper als A4-document, anders in de stijl van de site. */
  const table = (t: ListText, paper: boolean) => (
    <>
      {report.rows.length === 0 && <Empty>{t.empty}</Empty>}
      {report.rows.length > 0 && <div className={paper ? 'table-wrap flush' : 'table-wrap'}><table className={paper ? 'report-table report-doc' : 'report-table'}>
        <thead><tr><th>{t.number}</th><th>{t.date}</th><th>{t.order}</th><th>{t.customer}</th>{kassa && <th>{t.method}</th>}<th className="num">{t.base}</th><th className="num">{t.vat}</th><th className="num">{t.total}</th></tr></thead>
        <tbody>
          {report.rows.map(({ invoice: i, order, customer }) => (
          <tr key={i.id}>
            <td>{paper ? i.number : <a className="rowlink" href={`#facturatie-${i.id}`}>{i.number}</a>}</td>
            <td>{fmtDate(i.invoice_date)}</td>
            <td>{order?.number}</td>
            <td className="report-customer">{kassa && isPosCustomer(i.customer_id) ? t.noCustomer : customer}</td>
            {kassa && <td>{methodOf(i.id).map((m) => t.methods[m] ?? m).join(', ')}</td>}
            <td className="num">{eur(i.base_amount)}</td>
            <td className="num">{eur(i.vat_amount)}</td>
            <td className="num">{eur(i.total)}</td>
          </tr>
          ))}
          <tr className="report-total">
            <td colSpan={kassa ? 5 : 4}>{t.sum(report.rows.length)}</td>
            <td className="num">{eur(report.base)}</td>
            <td className="num">{eur(report.vat)}</td>
            <td className="num">{eur(report.total)}</td>
          </tr>
        </tbody>
      </table></div>}
      {kassa && report.rows.length > 0 && <div className="report-methods">
        <div className="small muted">{t.perMethod}</div>
        {byMethod.map(([m, n]) => <div key={m}><span>{t.methods[m] ?? m}</span><span className="num">{eur(n)}</span></div>)}
      </div>}
    </>
  )
  const ts = T[screen]
  const td = T[docLanguage]
  return (
    <div className="stack">
      <section className="panel no-print report-filter">
        <div className="chips">
          {options.map(([value, label]) => <button key={value} className={`chip${period === value ? ' on' : ''}`} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}
        </div>
        {kassa && <div className="chips" style={{ marginTop: 10 }}>
          {(['bella', 'hdb'] as Issuer[]).map((k) => <button key={k} className={`chip${issuer === k ? ' on' : ''}`} aria-pressed={issuer === k} onClick={() => setIssuer(k)}>{k === 'hdb' ? `HDB · ${issuerInfo(company, 'hdb').name}` : `Bella · ${company?.company_name ?? ''}`}</button>)}
        </div>}
        {period === 'vrij' && <div className="report-dates">
          <TextField label={tx("Van")} type="date" value={customFrom} onChange={setCustomFrom} />
          <TextField label={tx("T/m")} type="date" value={customTo} onChange={setCustomTo} />
        </div>}
      </section>
      {/* Op het scherm: een gewone lijst in de stijl van de site, in de schermtaal. */}
      <section className="panel no-print">
        <div className="report-screen-head">
          <h2>{kassa ? ts.titleKassa : ts.title}</h2>
          <span className="small muted">{name}{taxId ? ` · CIF ${taxId}` : ''} · {ts.period(from ? fmtDate(from) : '–', to ? fmtDate(to) : '–')}</span>
        </div>
        {table(ts, false)}
      </section>
      {/* Alleen bij afdrukken: het A4-document, in de taal uit Instellingen. */}
      <div className="print-only">
        <DocPaper language={docLanguage}>
          <div className="paper-top report-top">
            <div><h2>{name}</h2>{kassa && <div className="small muted">CIF: {taxId}</div>}</div>
            <div style={{ textAlign: 'right' }}>
              <h1>{kassa ? td.titleKassa : td.title}</h1>
              <div className="small muted">{td.period(from ? fmtDate(from) : '–', to ? fmtDate(to) : '–')}</div>
            </div>
          </div>
          {table(td, true)}
        </DocPaper>
      </div>
    </div>
  )
}
