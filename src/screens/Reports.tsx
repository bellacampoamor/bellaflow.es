import { useState } from 'react'
import { Printer } from 'lucide-react'
import { invoiceReport, periodRange, todayISO, type ReportPeriod } from '../domain/calc'
import type { Language } from '../data/types'
import { tx } from '../i18n'
import { go, useApp } from '../ui/app-context'
import { DocPaper, Empty, eur, fmtDate, Head, Tabs, TextField } from '../ui/kit'
import { Archive } from './Archive'

export type ReportTab = 'facturen' | 'archief'

// Vaste teksten van de afgedrukte lijst, in de taal uit Beheer.
const T: Record<Language, { title: string; period: (from: string, to: string) => string; empty: string; number: string; date: string; order: string; customer: string; base: string; vat: string; total: string; sum: (n: number) => string }> = {
  nl: { title: 'Factuuroverzicht', period: (a, b) => `Periode ${a} t/m ${b}`, empty: 'Geen facturen in deze periode.', number: 'Factuurnummer', date: 'Datum', order: 'Verkooporder', customer: 'Klant', base: 'Totaal excl. IVA', vat: 'IVA', total: 'Totaal incl. IVA', sum: (n) => `Totaal (${n} ${n === 1 ? 'factuur' : 'facturen'})` },
  en: { title: 'Invoice overview', period: (a, b) => `Period ${a} to ${b}`, empty: 'No invoices in this period.', number: 'Invoice number', date: 'Date', order: 'Sales order', customer: 'Customer', base: 'Total excl. VAT', vat: 'VAT', total: 'Total incl. VAT', sum: (n) => `Total (${n} ${n === 1 ? 'invoice' : 'invoices'})` },
  es: { title: 'Resumen de facturas', period: (a, b) => `Periodo del ${a} al ${b}`, empty: 'No hay facturas en este periodo.', number: 'Número de factura', date: 'Fecha', order: 'Pedido de venta', customer: 'Cliente', base: 'Total sin IVA', vat: 'IVA', total: 'Total con IVA', sum: (n) => `Total (${n} ${n === 1 ? 'factura' : 'facturas'})` },
}

/** Rapportage: lijsten om af te drukken, en het Archief. */
export function Reports({ tab }: { tab: ReportTab }) {
  return (
    <>
      <Head title={tx("Rapportage")} sub={tab === 'archief' ? tx("Alle afgeleverde leveringen met hun afleverbonnen en facturen.") : tx("Kies een periode en druk de lijst af.")}>
        {tab === 'facturen' && <button className="btn primary" onClick={() => window.print()}><Printer size={16} />{tx("Afdrukken of PDF")}</button>}
      </Head>
      <div className="no-print">
        <Tabs<ReportTab> value={tab} onChange={(v) => go(v === 'archief' ? 'archief' : 'rapportage')} tabs={[{ value: 'facturen', label: tx("Factuuroverzicht") }, { value: 'archief', label: tx("Archief") }]} />
      </div>
      {tab === 'facturen' ? <InvoiceList /> : <Archive />}
    </>
  )
}

function InvoiceList() {
  const { s } = useApp()
  const today = todayISO()
  const [period, setPeriod] = useState<ReportPeriod>('maand')
  const [customFrom, setCustomFrom] = useState(`${today.slice(0, 7)}-01`)
  const [customTo, setCustomTo] = useState(today)
  const { from, to } = periodRange(period, today, customFrom, customTo)
  const report = invoiceReport(s, from, to)
  const options: [ReportPeriod, string][] = [['maand', tx("Deze maand")], ['kwartaal', tx("Laatste 3 maanden")], ['jaar', tx("Dit jaar (YTD)")], ['vrij', tx("Van t/m")]]
  const company = s.settings[0]
  const language = company?.language_reports ?? 'nl'
  const t = T[language]
  return (
    <div className="stack">
      <section className="panel no-print report-filter">
        <div className="chips">
          {options.map(([value, label]) => <button key={value} className={`chip${period === value ? ' on' : ''}`} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}
        </div>
        {period === 'vrij' && <div className="report-dates">
          <TextField label={tx("Van")} type="date" value={customFrom} onChange={setCustomFrom} />
          <TextField label={tx("T/m")} type="date" value={customTo} onChange={setCustomTo} />
        </div>}
      </section>
      <DocPaper language={language}>
        <div className="paper-top">
          <div><h2>{company?.company_name}</h2></div>
          <div style={{ textAlign: 'right' }}>
            <h1>{t.title}</h1>
            <div className="small muted">{t.period(from ? fmtDate(from) : '–', to ? fmtDate(to) : '–')}</div>
          </div>
        </div>
        {report.rows.length === 0 && <Empty>{t.empty}</Empty>}
        {report.rows.length > 0 && <div className="table-wrap flush"><table className="report-table">
          <thead><tr><th>{t.number}</th><th>{t.date}</th><th>{t.order}</th><th>{t.customer}</th><th className="num">{t.base}</th><th className="num">{t.vat}</th><th className="num">{t.total}</th></tr></thead>
          <tbody>
            {report.rows.map(({ invoice: i, order, customer }) => (
            <tr key={i.id}>
              <td><a className="rowlink" href={`#facturatie-${i.id}`}>{i.number}</a></td>
              <td>{fmtDate(i.invoice_date)}</td>
              <td>{order?.number}</td>
              <td>{customer}</td>
              <td className="num">{eur(i.base_amount)}</td>
              <td className="num">{eur(i.vat_amount)}</td>
              <td className="num">{eur(i.total)}</td>
            </tr>
            ))}
            <tr className="report-total">
              <td colSpan={4}>{t.sum(report.rows.length)}</td>
              <td className="num">{eur(report.base)}</td>
              <td className="num">{eur(report.vat)}</td>
              <td className="num">{eur(report.total)}</td>
            </tr>
          </tbody>

        </table></div>}
      </DocPaper>
    </div>
  )
}
