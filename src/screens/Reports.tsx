import { useState } from 'react'
import { Printer } from 'lucide-react'
import { invoiceReport, periodRange, todayISO, type ReportPeriod } from '../domain/calc'
import { getLanguage, tx } from '../i18n'
import { go, useApp } from '../ui/app-context'
import { DocPaper, Empty, eur, fmtDate, Head, Tabs, TextField } from '../ui/kit'
import { Archive } from './Archive'

export type ReportTab = 'facturen' | 'archief'

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
      <DocPaper language={getLanguage()}>
        <div className="paper-top">
          <div><h2>{company?.company_name}</h2></div>
          <div style={{ textAlign: 'right' }}>
            <h1>{tx("Factuuroverzicht")}</h1>
            <div className="small muted">{tx("Periode {0} t/m {1}", from ? fmtDate(from) : '–', to ? fmtDate(to) : '–')}</div>
          </div>
        </div>
        {report.rows.length === 0 && <Empty>{tx("Geen facturen in deze periode.")}</Empty>}
        {report.rows.length > 0 && <div className="table-wrap flush"><table className="report-table">
          <thead><tr><th>{tx("Factuurnummer")}</th><th>{tx("Datum")}</th><th>{tx("Verkooporder")}</th><th>{tx("Klant")}</th><th className="num">{tx("Totaal excl. IVA")}</th><th className="num">{tx("IVA")}</th><th className="num">{tx("Totaal incl. IVA")}</th></tr></thead>
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
              <td colSpan={4}>{report.rows.length === 1 ? tx("Totaal (1 factuur)") : tx("Totaal ({0} facturen)", report.rows.length)}</td>
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
