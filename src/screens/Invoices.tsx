import { useEffect, useState } from 'react'
import { FileText, Mail } from 'lucide-react'
import type { Payment } from '../data/types'
import { IS_PRODUCTION, articleNo, deliveryValue, depositAvailable, documentLanguage, hasTaxId, invoiceBalance, invoiceQrUrl, invoiceState, todayISO, uninvoicedDeliveries, vatBreakdown } from '../domain/calc'
import { ensureProformas, invoiceProformas, mailInvoice, payInvoice, refundCredit } from '../domain/services'
import { canCredit, creditsOf, isCredit } from '../domain/credit'
import { go, useApp, useAutoPrint } from '../ui/app-context'
import { Empty, eur, fmtDate, Head, Modal, NumberField, Pill, SelectField, Tabs, TextField, pickRow, PickMark, TaxQr, useScrollToFocus, brandFile } from '../ui/kit'
import { tx } from '../i18n'
import { INVOICE_TEXT, invoiceTitle } from '../domain/noteText'
import { POS_CUSTOMER_NOTE } from '../domain/pos'
import { imageSrc, issuerInfo, issuerOf, legalLine, tradeName } from '../domain/issuers'
import { goesToShopify } from '../domain/shopify'
import { ShopifyStatus } from '../ui/ShopifyStatus'
import { simplifiedPrint } from '../domain/receipt'
import { ReceiptPaper } from './Receipt'
import { PagedDoc } from '../ui/PagedDoc'

const KIND = { deelfactuur: 'Deelfactuur', eindfactuur: 'Eindfactuur', volledig: 'Volledig', creditfactuur: 'Creditfactuur' } as const
const STATE = { betaald: ['Betaald', 'good'], open: ['Open', 'bill'], te_laat: ['Te laat', 'bad'], terugbetalen: ['Terug te betalen', 'warn'] } as const

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
  const rows = [...s.invoices].sort((a, b) => b.number.localeCompare(a.number)).filter((i) => tab === 'all' || invoiceBalance(s, i) !== 0)
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
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'open', label: tx("Openstaand"), n: s.invoices.filter((i) => invoiceBalance(s, i) !== 0).length }, { value: 'all', label: tx("Alle facturen"), n: s.invoices.length }]} />
          {rows.length === 0 && <Empty>{tab === 'open' ? tx("Geen openstaande facturen.") : tx("Nog geen facturen.")}</Empty>}
          {rows.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th aria-label="PDF" /><th>{tx("Factuur")}</th><th>{tx("Datum")}</th><th>{tx("Klant")}</th><th>{tx("Soort")}</th><th className="num">{tx("Totaal")}</th><th className="num">{tx("Verrekend")}</th><th className="num">{tx("Open")}</th><th>{tx("Vervalt")}</th><th>{tx("Status")}</th></tr></thead>
            <tbody>{rows.map((i) => {
              const c = s.customers.find((x) => x.id === i.customer_id)!
              const [label, tone] = STATE[invoiceState(s, i)]
              return (
                <tr key={i.id} className="click" onClick={() => go(`facturatie-${i.id}`)}>
                  <td><a className="pdf-ic" href={`#facturatie-${i.id}`} title={tx("Factuur {0} openen als PDF", i.number)} aria-label={tx("Factuur {0} openen als PDF", i.number)}><FileText size={18} /><span>PDF</span></a></td>
                  <td><a className="rowlink" href={`#facturatie-${i.id}`}>{i.number}</a>{i.issuer === 'hdb' && <> <Pill tone="info">HDB</Pill></>}{isCredit(i) && <> <Pill tone="warn">{tx("Credit")}</Pill></>}</td><td>{fmtDate(i.invoice_date)}</td><td>{c.company || c.name}</td>
                  <td>{tx(KIND[i.kind])}</td><td className="num">{eur(i.total)}</td><td className="num">{i.deposit_settled ? eur(i.deposit_settled) : <span className="zero">–</span>}</td>
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
  // Kassabon: direct afdrukken. A4: pas als de bladen gemeten zijn (logo en lettertype geladen).
  const [sheetsReady, setSheetsReady] = useState(false)
  const onReceipt = !!inv?.simplified && simplifiedPrint(s.settings[0]) === 'bon80'
  useAutoPrint(autoPrint, !!inv && (onReceipt || sheetsReady))
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
  // Eenvoudige factuur (kassa): eigen afdruktaal (standaard Spaans) en de gegevens en het logo van het uitgevende bedrijf.
  const language = documentLanguage(inv.simplified ? co.language_invoice_simplified ?? 'es' : co.language_invoice, inv.language)
  const t = INVOICE_TEXT[language]
  const issuer = inv.simplified ? issuerInfo(co, issuerOf(inv)) : null
  const nif = issuer ? issuer.tax_id : co.tax_id
  // Voet van elke factuur (besluit Rick 8 november 2026): linksonder de QR (alleen gewone factuur, 30 x 30 mm),
  // midden het beeldmerk met de juridische regel van het uitgevende bedrijf, rechtsonder Bella Flow met bellaflow.es.
  const footIssuer = issuer ?? issuerInfo(co, 'bella')
  // Kassabon van 80 mm in plaats van A4, als dat onder Instellingen > Kassa: afdrukken gekozen is (9 november 2026).
  const receipt = !!inv.simplified && simplifiedPrint(co) === 'bon80'
  const bellaLogo = issuerInfo(co, 'bella').logo
  const base = import.meta.env.BASE_URL
  // Facturen van voor het artikelnummer op de factuurregel
  const articleOf = (dl: string | null) => articleNo(s, s.sales_order_lines.find((x) => x.id === s.delivery_lines.find((y) => y.id === dl)?.sales_order_line_id)?.product_id)
  const b = vatBreakdown(lines.map((l) => ({ total: l.line_total, vat_rate: l.vat_rate })))
  const credit = isCredit(inv)
  const original = credit ? s.invoices.find((x) => x.id === inv.credit_of) ?? null : null
  const credits = creditsOf(s, id)
  const pays = s.payments.filter((p) => p.invoice_id === id)
  // Verrekening tussen factuur en creditfactuur staat apart van echte betalingen en terugbetalingen.
  const settled = Math.abs(pays.filter((p) => p.method === 'verrekening').reduce((n, p) => n + p.amount, 0))
  const paid = Math.abs(pays.filter((p) => p.method !== 'verrekening').reduce((n, p) => n + p.amount, 0))
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
      <Head title={inv.number} sub={<>{c.company || c.name} <Pill tone={tone}>{tx(label)}</Pill>{issuer?.key === 'hdb' && <> <Pill tone="info">HDB</Pill></>}</>} back={{ href: '#facturatie', label: tx("Facturatie") }}>
        {!inv.simplified && <a className="btn" href={`#orders-${o.id}`}>{tx("Naar")} {o.number}</a>}
        {canPrint && <button className="btn" onClick={() => window.print()}>{receipt ? tx("Bon afdrukken") : tx("Afdrukken of PDF")}</button>}
        <button className="btn" onClick={() => setMailTo(mail?.to_email || c.email || '')}><Mail size={15} style={{ verticalAlign: -2, marginRight: 4 }} />{mail ? tx("Opnieuw mailen") : tx("Mailen")}</button>
        {!credit && canCredit(s, inv) && <a className="btn" href={`#facturatie-crediteren-${inv.id}`}>{tx("Crediteren of retour")}</a>}
        {!credit && balance > 0 && <button className="btn primary" onClick={() => { setAmount(balance); setPay(true) }}>{tx("Betaling registreren")}</button>}
        {credit && balance < 0 && <button className="btn primary" onClick={() => { setAmount(-balance); setMethod(inv.simplified ? 'contant' : 'overboeking'); setPay(true) }}>{tx("Terugbetaling registreren")}</button>}
      </Head>
      {goesToShopify(inv) && <div className="no-print" style={{ marginBottom: 12 }}><ShopifyStatus invoiceId={inv.id} /></div>}
      {original && goesToShopify(original) && <div className="note warn no-print" style={{ marginBottom: 12 }}>{tx("Een creditfactuur van HDB gaat niet automatisch naar Shopify. Verwerk de retour of terugbetaling in Shopify bij de bestelling van {0}.", original.number)} <ShopifyStatus invoiceId={original.id} /></div>}
      {mail && <div className="no-print" style={{ marginBottom: 12 }}><Pill tone={MAIL_STATE[mail.status][1]}>{tx(MAIL_STATE[mail.status][0], mail.to_email)}</Pill>{mail.status === 'failed' && mail.error && <span className="small muted"> {mail.error}</span>}</div>}
      {original && <div className="note no-print" style={{ marginBottom: 12 }}>{tx("Creditfactuur op factuur")} <a href={`#facturatie-${original.id}`}>{original.number}</a>. {tx("Reden")}: {inv.credit_reason}</div>}
      {credits.length > 0 && <div className="note no-print" style={{ marginBottom: 12 }}>{tx("Gecrediteerd met")} {credits.map((c, n) => <span key={c.id}>{n > 0 && ', '}<a href={`#facturatie-${c.id}`}>{c.number}</a> ({eur(c.total)})</span>)}</div>}
      {!inv.simplified && !hasTaxId(nif) && <div className="note warn no-print" style={{ marginBottom: 12 }}>{tx("De QR-code op deze factuur klopt pas als het CIF is ingevuld onder Instellingen.")}</div>}
      {receipt && issuer ? (
        <ReceiptPaper language={language} t={t} title={invoiceTitle(t, inv)} inv={inv} issuer={issuer} base={base} lines={lines} articleOf={(l) => articleOf(l.delivery_line_id)}
          productOf={(code) => s.products.find((x) => x.sku === code || x.catalog_article_number === code)}
          rates={b.rates} customer={c.notes !== POS_CUSTOMER_NOTE ? c : null} seller={s.salespeople.find((x) => x.id === o.salesperson_id)?.name ?? ''}
          original={original} pays={pays} balance={balance} credit={credit} />
      ) : (
      <PagedDoc language={language} cols={7} onReady={() => setSheetsReady(true)}
        foot={<div className="invoice-foot">
          <div className="invoice-foot-qr">{!inv.simplified && <TaxQr url={invoiceQrUrl({ nif, number: inv.number, date: inv.invoice_date, total: inv.total }, IS_PRODUCTION)} />}</div>
          <div className="issuer-foot">
            {footIssuer.mark && <img src={imageSrc(footIssuer.mark, base)} alt="" />}
            <span>{legalLine(footIssuer)}</span>
          </div>
          <div className="doc-credit"><img src={brandFile('bellaflow-beeldmerk-small.png')} alt="Bella Flow" /><span>bellaflow.es</span></div>
        </div>}
        head={<>
        <div className="paper-top invoice-top">
          {issuer ? (
            <div className="issuer-head">
              {issuer.logo ? <img className="issuer-logo" src={imageSrc(issuer.logo, base)} alt={issuer.name} /> : <h2 style={{ fontSize: '1.3rem' }}>{issuer.name}</h2>}
              {(issuer.phone || issuer.email) && <div className="small muted">{[issuer.phone, issuer.email].filter(Boolean).join(', ')}</div>}
            </div>
          ) : (
          <div className="issuer-head">
            {/* Gewone factuur van Bella: het logo van Bella linksboven (besluit Rick 8 november 2026), daaronder adres en CIF. */}
            {bellaLogo ? <img className="issuer-logo" src={imageSrc(bellaLogo, base)} alt={tradeName(co)} /> : <h2 style={{ fontSize: '1.3rem' }}>{tradeName(co)}</h2>}
            <div className="small muted">{[co.address, `${co.postal_code} ${co.city}`.trim(), co.province, co.phone, co.email].filter(Boolean).join(', ')}<br />{t.tax}: {co.tax_id}</div>
          </div>
          )}
          <div style={{ textAlign: 'right' }}>
            <h1 style={{ fontSize: '1.45rem' }}>{invoiceTitle(t, inv)}</h1>
            <div className="strong">{inv.number}</div>
            <div className="small muted">{t.date}: {fmtDate(inv.invoice_date)}<br />{!inv.simplified && <>{t.due}: {fmtDate(inv.due_date)}<br /></>}{!inv.simplified && <>{t.order}: {o.number}{o.customer_reference ? ` (${o.customer_reference})` : ''}</>}</div>
          </div>
        </div>
        {original && <p className="small" style={{ margin: '0 0 18px' }}><strong>{t.corrects} {original.number}</strong> {t.of_date} {fmtDate(original.invoice_date)}. {t.reason}: {inv.credit_reason}</p>}
        {c.notes !== POS_CUSTOMER_NOTE && <div style={{ marginBottom: 22 }}>
          <div className="small muted">{t.to}</div>
          <div className="strong">{c.company || c.name}</div>
          <div className="small">{c.address}<br />{c.postal_code} {c.city}, {c.country}{c.tax_id && <><br />{t.tax}: {c.tax_id}</>}</div>
        </div>}
        </>}
        contHead={
          /* Vervolgblad: korte kop met afzender, klant (niet bij kassaverkoop zonder klant), titel, nummer en datum. */
          <div className="paper-top invoice-top" style={{ marginBottom: 18 }}>
            <div>
              <div className="strong">{issuer ? issuer.name : tradeName(co)}</div>
              {c.notes !== POS_CUSTOMER_NOTE && <div className="small">{t.to}: {c.company || c.name}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="strong">{invoiceTitle(t, inv)} {inv.number}</div>
              <div className="small muted">{t.date}: {fmtDate(inv.invoice_date)}</div>
            </div>
          </div>
        }
        colgroup={<colgroup><col style={{ width: '17%' }} /><col /><col style={{ width: '8%' }} /><col style={{ width: '13%' }} /><col style={{ width: '8%' }} /><col style={{ width: '7%' }} /><col style={{ width: '14%' }} /></colgroup>}
        thead={<tr><th>{t.code}</th><th>{t.desc}</th><th className="num">{t.qty}</th><th className="num">{t.price}</th><th className="num">{t.disc}</th><th className="num">{t.vat}</th><th className="num">{t.total}</th></tr>}
        rows={lines.map((l) => ({ key: l.id, amount: l.line_total, cells: <><td>{l.article_number || articleOf(l.delivery_line_id)}</td><td>{l.description}</td><td className="num">{l.qty}</td><td className="num">{eur(l.unit_price)}</td><td className="num">{l.discount_pct ? `${l.discount_pct}%` : ''}</td><td className="num">{l.vat_rate}%</td><td className="num">{eur(l.line_total)}</td></> }))}
        totals={<>
        <div className="totals" style={{ marginTop: 18 }}>
          <div><span>{t.base}</span><span>{eur(inv.base_amount)}</span></div>
          {b.rates.map((r) => <div key={r.rate}><span>{t.vat} {r.rate}%</span><span>{eur(r.vat)}</span></div>)}
          <div className="strong"><span>{t.total}</span><span>{eur(inv.total)}</span></div>
          {inv.deposit_settled > 0 && <div><span>{t.deposit}</span><span>−{eur(inv.deposit_settled)}</span></div>}
          {credit ? <>
            {settled > 0 && <div><span>{t.settled} {original?.number}</span><span>{eur(settled)}</span></div>}
            {paid > 0 && <div><span>{t.refunded}</span><span>{eur(paid)}</span></div>}
            <div className="grand"><span>{t.to_refund}</span><span>{eur(-balance)}</span></div>
          </> : <>
            {settled > 0 && <div><span>{t.settled_credit} {credits.map((x) => x.number).join(', ')}</span><span>−{eur(settled)}</span></div>}
            {paid > 0 && <div><span>{t.paid}</span><span>−{eur(paid)}</span></div>}
            <div className="grand"><span>{t.due_amt}</span><span>{eur(balance)}</span></div>
          </>}
        </div>
        {!inv.simplified && !credit && <p className="small muted" style={{ marginTop: 26, marginBottom: 0 }}>{t.pay}: {co.iban}{co.invoice_footer ? <><br />{co.invoice_footer}</> : ''}</p>}
        {issuer?.key === 'bella' && co.invoice_footer && <p className="small muted" style={{ marginTop: 26, marginBottom: 0 }}>{co.invoice_footer}</p>}
        </>} />
      )}
      {mailTo !== null && (
        <Modal title={tx("Factuur mailen")} onClose={() => setMailTo(null)} footer={<>
          <button className="btn" onClick={() => setMailTo(null)}>{tx("Annuleren")}</button>
          <button className="btn primary" onClick={sendMail}>{tx("Versturen")}</button>
        </>}>
          <TextField label={tx("E-mailadres")} type="email" value={mailTo} onChange={setMailTo} hint={tx("De factuur gaat als pdf mee, met een kopie (bcc) naar de winkel.")} />
        </Modal>
      )}
      {pay && (
        <Modal title={credit ? tx("Terugbetaling registreren") : tx("Betaling registreren")} onClose={() => setPay(false)} footer={<>
          <button className="btn" onClick={() => setPay(false)}>{tx("Annuleren")}</button>
          <button className="btn primary" onClick={async () => {
            const m = method === 'verrekening' ? 'overboeking' : method
            const ok = credit
              ? await run((db) => refundCredit(db, { invoice_id: id, amount, method: m, paid_at: date, reference: ref }), tx("Terugbetaling geregistreerd"))
              : await run((db) => payInvoice(db, { invoice_id: id, amount, method, paid_at: date, reference: ref }), tx("Betaling geregistreerd"))
            if (ok) setPay(false)
          }}>{credit ? tx("Terugbetaling registreren") : tx("Betaling registreren")}</button>
        </>}>
          <div className="form-grid">
            <NumberField label={tx("Bedrag")} value={amount} step="0.01" min={0} onChange={setAmount} hint={credit ? tx("Terug te betalen: {0}", eur(-balance)) : tx("Open: {0}", eur(balance))} />
            <SelectField label={tx("Betaalwijze")} value={method} onChange={setMethod} options={[{ value: 'overboeking', label: tx("Overboeking") }, { value: 'pin', label: tx("Pin") }, { value: 'contant', label: tx("Contant") }, { value: 'online', label: tx("Online") }]} />
            <TextField label={tx("Datum")} type="date" value={date} onChange={setDate} />
            <TextField label={tx("Referentie")} value={ref} onChange={setRef} />
          </div>
        </Modal>
      )}
    </>
  )
}
