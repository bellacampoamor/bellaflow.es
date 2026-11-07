import { useEffect, useState } from 'react'
import { FileText, Mail } from 'lucide-react'
import type { Payment } from '../data/types'
import { IS_PRODUCTION, articleNo, deliveryValue, depositAvailable, documentLanguage, hasTaxId, invoiceBalance, invoiceQrUrl, invoiceState, todayISO, uninvoicedDeliveries, vatBreakdown } from '../domain/calc'
import { ensureProformas, invoiceProformas, mailInvoice, payInvoice } from '../domain/services'
import { go, useApp, useAutoPrint } from '../ui/app-context'
import { Empty, eur, fmtDate, Head, Modal, NumberField, Pill, SelectField, Tabs, TextField, DocPaper, pickRow, PickMark, TaxQr, useScrollToFocus } from '../ui/kit'
import { tx } from '../i18n'
import { INVOICE_TEXT } from '../domain/noteText'

const STATE = { betaald: ['Betaald', 'good'], open: ['Open', 'bill'], te_laat: ['Te laat', 'bad'] } as const

/** focus: levering (PF) waar het scherm naartoe scrolt; die staat meteen geselecteerd om te factureren. */
export function Invoices({ focus }: { focus?: string }) {
  const { s, run } = useApp()
  const [tab, setTab] = useState<'open' | 'all'>('open')
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(focus ? [focus] : []))
  useScrollToFocus(focus ? `pf-${focus}` : null)
  const [confirm, setConfirm] = useState(false)
  const proformas = s.sales_orders.filter((o) => o.status === 'open').flatMap((o) => uninvoicedDeliveries(s, o.id).map((d) => ({ d, o, c: s.customers.find((x) => x.id === o.customer_id)! }))).sort((a, b) => a.d.number.localeCompare(b.d.number))
  const chosen = proformas.filter((p) => ticked.has(p.d.id))
  const allTicked = proformas.length > 0 && chosen.length === proformas.length
  const toggle = (id: string, on: boolean) => setTicked((v) => { const n = new Set(v); if (on) n.add(id); else n.delete(id); return n })
  const rows = [...s.invoices].sort((a, b) => b.number.localeCompare(a.number)).filter((i) => tab === 'all' || invoiceBalance(s, i) > 0)
  const missing = s.deliveries.some((d) => d.status === 'delivered' && !d.proforma_number) && proformas.some((p) => !p.d.proforma_number)
  useEffect(() => { if (missing) void run((db) => ensureProformas(db)) }, [missing, run])
  return (
    <>
      <Head title={tx("Facturatie")} back={{ href: '#orders', label: tx("Verkooporders") }} sub={tx("Elke afgemelde levering krijgt een proforma. Klik op de regels die je wilt factureren: pas dan ontstaat de factuur. Vooruitbetalingen worden verrekend.")} />
      <div className="stack">
        <section className="panel">
          <div className="panel-head">
            <h2>{tx("Proforma's, klaar om te factureren")}</h2>
            {proformas.length > 0 && <div className="btn-row">
              <button className="btn sm" onClick={() => setTicked(allTicked ? new Set() : new Set(proformas.map((p) => p.d.id)))}>{allTicked ? tx("Niets selecteren") : tx("Alles selecteren")}</button>
              <button className="btn sm primary" disabled={!chosen.length} onClick={() => setConfirm(true)}>{tx("Factureren")}{chosen.length ? ` (${chosen.length})` : ''}</button>
            </div>}
          </div>
          {proformas.length === 0 && <Empty>{tx("Er staan geen proforma's klaar.")}</Empty>}
          {proformas.length > 0 && <div className="table-wrap"><table className="queue">
            <thead><tr><th>{tx("Proforma")}</th><th>{tx("Verkooporder")}</th><th>{tx("Klant")}</th><th>{tx("Levering")}</th><th>{tx("Geleverd")}</th><th className="num">{tx("Bedrag")}</th><th className="num">{tx("Te verrekenen")}</th><th aria-label={tx("Selectie")} /></tr></thead>
            <tbody>{proformas.map(({ d, o, c }) => {
              const dep = depositAvailable(s, o.id)
              return (
                <tr key={d.id} id={`pf-${d.id}`} {...pickRow(ticked.has(d.id), () => toggle(d.id, !ticked.has(d.id)))}>
                  <td className="strong">{d.proforma_number ?? '…'}</td><td><a className="rowlink" href={`#orders-${o.id}`}>{o.number}</a></td><td>{c.company || c.name}</td><td>{d.number}</td><td>{fmtDate(d.delivered_at)}</td>
                  <td className="num">{eur(deliveryValue(s, d.id))}</td><td className="num">{dep > 0 ? eur(dep) : <span className="zero">–</span>}</td>
                  <PickMark on={ticked.has(d.id)} />
                </tr>
              )
            })}</tbody>
          </table></div>}
        </section>
        <section className="panel">
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'open', label: tx("Openstaand"), n: s.invoices.filter((i) => invoiceBalance(s, i) > 0).length }, { value: 'all', label: tx("Alle facturen"), n: s.invoices.length }]} />
          {rows.length === 0 && <Empty>{tab === 'open' ? tx("Geen openstaande facturen.") : tx("Nog geen facturen.")}</Empty>}
          {rows.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th aria-label="PDF" /><th>{tx("Factuur")}</th><th>{tx("Datum")}</th><th>{tx("Klant")}</th><th>{tx("Soort")}</th><th className="num">{tx("Totaal")}</th><th className="num">{tx("Verrekend")}</th><th className="num">{tx("Open")}</th><th>{tx("Vervalt")}</th><th>{tx("Status")}</th></tr></thead>
            <tbody>{rows.map((i) => {
              const c = s.customers.find((x) => x.id === i.customer_id)!
              const [label, tone] = STATE[invoiceState(s, i)]
              return (
                <tr key={i.id} className="click" onClick={() => go(`facturatie-${i.id}`)}>
                  <td><a className="pdf-ic" href={`#facturatie-${i.id}`} title={tx("Factuur {0} openen als PDF", i.number)} aria-label={tx("Factuur {0} openen als PDF", i.number)}><FileText size={18} /><span>PDF</span></a></td>
                  <td><a className="rowlink" href={`#facturatie-${i.id}`}>{i.number}</a></td><td>{fmtDate(i.invoice_date)}</td><td>{c.company || c.name}</td>
                  <td>{tx(i.kind[0].toUpperCase() + i.kind.slice(1))}</td><td className="num">{eur(i.total)}</td><td className="num">{i.deposit_settled ? eur(i.deposit_settled) : <span className="zero">–</span>}</td>
                  <td className="num">{eur(invoiceBalance(s, i))}</td><td>{fmtDate(i.due_date)}</td><td><Pill tone={tone}>{tx(label)}</Pill></td>
                </tr>
              )
            })}</tbody>
          </table></div>}
        </section>
      </div>
      {confirm && <InvoiceProformasModal ids={chosen.map((p) => p.d.id)} onClose={() => setConfirm(false)} onDone={() => { setConfirm(false); setTicked(new Set()) }} />}
    </>
  )
}

function InvoiceProformasModal({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const { s, run } = useApp()
  const last = s.invoices.reduce((m, i) => (i.invoice_date > m ? i.invoice_date : m), '')
  const [date, setDate] = useState(todayISO() > last ? todayISO() : last)
  const value = ids.reduce((n, id) => n + deliveryValue(s, id), 0)
  const create = async () => {
    if (await run((db) => invoiceProformas(db, { delivery_ids: ids, invoice_date: date }), ids.length === 1 ? tx("Factuur gemaakt") : tx("{0} facturen gemaakt", ids.length))) onDone()
  }
  return (
    <Modal title={tx("Factureren")} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx("Annuleren")}</button>
      <button className="btn primary" onClick={create}>{ids.length === 1 ? tx("1 factuur maken") : tx("{0} facturen maken", ids.length)}</button>
    </>}>
      <TextField label={tx("Factuurdatum")} type="date" value={date} onChange={setDate} hint={last ? tx("Mag niet voor {0} liggen, de datum van de laatste factuur.", fmtDate(last)) : undefined} />
      <div className="totals" style={{ maxWidth: 'none' }}>
        <div className="grand"><span>{tx("Totaal incl. IVA")}</span><span>{eur(value)}</span></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{tx("Vooruitbetalingen worden verrekend. Na het maken staan de facturen vast en kunnen ze niet meer worden gewijzigd.")}</p>
    </Modal>
  )
}


export function InvoiceDetail({ id, autoPrint = false }: { id: string; autoPrint?: boolean }) {
  const { s, run, toast } = useApp()
  const inv = s.invoices.find((i) => i.id === id)
  useAutoPrint(autoPrint, !!inv)
  const [pay, setPay] = useState(false)
  const [amount, setAmount] = useState(() => (inv ? invoiceBalance(s, inv) : 0))
  const [method, setMethod] = useState<Payment['method']>('overboeking')
  const [date, setDate] = useState(todayISO())
  const [ref, setRef] = useState('')
  const [mailTo, setMailTo] = useState<string | null>(null)
  if (!inv) return <div className="panel">{tx("Factuur niet gevonden.")} <a href="#facturatie">{tx("Terug naar facturatie")}</a>.</div>
  const c = s.customers.find((x) => x.id === inv.customer_id)!
  const o = s.sales_orders.find((x) => x.id === inv.sales_order_id)!
  const lines = s.invoice_lines.filter((l) => l.invoice_id === id)
  const co = s.settings[0]
  const language = documentLanguage(co.language_invoice, inv.language)
  const t = INVOICE_TEXT[language]
  // Facturen van voor het artikelnummer op de factuurregel
  const articleOf = (dl: string | null) => articleNo(s, s.sales_order_lines.find((x) => x.id === s.delivery_lines.find((y) => y.id === dl)?.sales_order_line_id)?.product_id)
  const b = vatBreakdown(lines.map((l) => ({ total: l.line_total, vat_rate: l.vat_rate })))
  const paid = s.payments.filter((p) => p.invoice_id === id).reduce((n, p) => n + p.amount, 0)
  const balance = invoiceBalance(s, inv)
  const [label, tone] = STATE[invoiceState(s, inv)]
  const canPrint = !import.meta.env.VITE_PREVIEW
  const mail = s.email_outbox.find((m) => m.kind === 'factuur' && m.invoice_id === id)
  const MAIL_STATE = { sent: ['Gemaild naar {0}', 'good'], demo: ['Testversie: niet echt gemaild naar {0}', 'info'], pending: ['Wordt gemaild naar {0}', 'info'], failed: ['Mailen mislukt', 'bad'], no_recipient: ['Geen e-mailadres', 'warn'] } as const
  const sendMail = async () => {
    let result = ''
    const ok = await run(async (db) => { result = await mailInvoice(db, id, mailTo ?? '') })
    if (ok) { setMailTo(null); toast(result === 'failed' ? tx("Mailen is mislukt. Zie de melding bij de factuur.") : result === 'demo' ? tx("Testversie: de mail is niet echt verstuurd.") : tx("Factuur gemaild"), result === 'failed') }
  }
  return (
    <>
      <Head title={inv.number} sub={<>{c.company || c.name} <Pill tone={tone}>{tx(label)}</Pill></>} back={{ href: '#facturatie', label: tx("Facturatie") }}>
        <a className="btn" href={`#orders-${o.id}`}>{tx("Naar")} {o.number}</a>
        {canPrint && <button className="btn" onClick={() => window.print()}>{tx("Afdrukken of PDF")}</button>}
        <button className="btn" onClick={() => setMailTo(mail?.to_email || c.email || '')}><Mail size={15} style={{ verticalAlign: -2, marginRight: 4 }} />{mail ? tx("Opnieuw mailen") : tx("Mailen")}</button>
        {balance > 0 && <button className="btn primary" onClick={() => { setAmount(balance); setPay(true) }}>{tx("Betaling registreren")}</button>}
      </Head>
      {mail && <div className="no-print" style={{ marginBottom: 12 }}><Pill tone={MAIL_STATE[mail.status][1]}>{tx(MAIL_STATE[mail.status][0], mail.to_email)}</Pill>{mail.status === 'failed' && mail.error && <span className="small muted"> {mail.error}</span>}</div>}
      {!hasTaxId(co.tax_id) && <div className="note warn no-print" style={{ marginBottom: 12 }}>{tx("De QR-code op deze factuur klopt pas als het CIF is ingevuld onder Beheer.")}</div>}
      <DocPaper language={language}>
        <div className="paper-top invoice-top">
          <div>
            <h2 style={{ fontSize: '1.3rem' }}>{co.company_name}</h2>
            <div className="small muted">{[co.address, `${co.postal_code} ${co.city}`.trim(), co.province, co.phone, co.email].filter(Boolean).join(', ')}<br />{t.tax}: {co.tax_id}</div>
          </div>
          <TaxQr url={invoiceQrUrl({ nif: co.tax_id, number: inv.number, date: inv.invoice_date, total: inv.total }, IS_PRODUCTION)} />
          <div style={{ textAlign: 'right' }}>
            <h1 style={{ fontSize: '1.45rem' }}>{t[inv.kind]}</h1>
            <div className="strong">{inv.number}</div>
            <div className="small muted">{t.date}: {fmtDate(inv.invoice_date)}<br />{t.due}: {fmtDate(inv.due_date)}<br />{t.order}: {o.number}{o.customer_reference ? ` (${o.customer_reference})` : ''}</div>
          </div>
        </div>
        <div style={{ marginBottom: 22 }}>
          <div className="small muted">{t.to}</div>
          <div className="strong">{c.company || c.name}</div>
          <div className="small">{c.address}<br />{c.postal_code} {c.city}, {c.country}{c.tax_id && <><br />{t.tax}: {c.tax_id}</>}</div>
        </div>
        <div className="table-wrap flush"><table>
          <thead><tr><th>{t.code}</th><th>{t.desc}</th><th className="num">{t.qty}</th><th className="num">{t.price}</th><th className="num">{t.disc}</th><th className="num">{t.vat}</th><th className="num">{t.total}</th></tr></thead>
          <tbody>{lines.map((l) => <tr key={l.id}><td>{l.article_number || articleOf(l.delivery_line_id)}</td><td>{l.description}</td><td className="num">{l.qty}</td><td className="num">{eur(l.unit_price)}</td><td className="num">{l.discount_pct ? `${l.discount_pct}%` : ''}</td><td className="num">{l.vat_rate}%</td><td className="num">{eur(l.line_total)}</td></tr>)}</tbody>
        </table></div>
        <div className="totals" style={{ marginTop: 18 }}>
          <div><span>{t.base}</span><span>{eur(inv.base_amount)}</span></div>
          {b.rates.map((r) => <div key={r.rate}><span>{t.vat} {r.rate}%</span><span>{eur(r.vat)}</span></div>)}
          <div className="strong"><span>{t.total}</span><span>{eur(inv.total)}</span></div>
          {inv.deposit_settled > 0 && <div><span>{t.deposit}</span><span>−{eur(inv.deposit_settled)}</span></div>}
          {paid > 0 && <div><span>{t.paid}</span><span>−{eur(paid)}</span></div>}
          <div className="grand"><span>{t.due_amt}</span><span>{eur(balance)}</span></div>
        </div>
        <p className="small muted" style={{ marginTop: 26, marginBottom: 0 }}>{t.pay}: {co.iban}{co.invoice_footer ? <><br />{co.invoice_footer}</> : ''}</p>
      </DocPaper>
      {mailTo !== null && (
        <Modal title={tx("Factuur mailen")} onClose={() => setMailTo(null)} footer={<>
          <button className="btn" onClick={() => setMailTo(null)}>{tx("Annuleren")}</button>
          <button className="btn primary" onClick={sendMail}>{tx("Versturen")}</button>
        </>}>
          <TextField label={tx("E-mailadres")} type="email" value={mailTo} onChange={setMailTo} hint={tx("De factuur gaat als pdf mee, met een kopie (bcc) naar de winkel.")} />
        </Modal>
      )}
      {pay && (
        <Modal title={tx("Betaling registreren")} onClose={() => setPay(false)} footer={<>
          <button className="btn" onClick={() => setPay(false)}>{tx("Annuleren")}</button>
          <button className="btn primary" onClick={async () => { if (await run((db) => payInvoice(db, { invoice_id: id, amount, method, paid_at: date, reference: ref }), tx("Betaling geregistreerd"))) setPay(false) }}>{tx("Betaling registreren")}</button>
        </>}>
          <div className="form-grid">
            <NumberField label={tx("Bedrag")} value={amount} step="0.01" min={0} onChange={setAmount} hint={tx("Open: {0}", eur(balance))} />
            <SelectField label={tx("Betaalwijze")} value={method} onChange={setMethod} options={[{ value: 'overboeking', label: tx("Overboeking") }, { value: 'pin', label: tx("Pin") }, { value: 'contant', label: tx("Contant") }, { value: 'online', label: tx("Online") }]} />
            <TextField label={tx("Datum")} type="date" value={date} onChange={setDate} />
            <TextField label={tx("Referentie")} value={ref} onChange={setRef} />
          </div>
        </Modal>
      )}
    </>
  )
}
