import { useState } from 'react'
import type { Language, Payment, SalesOrder } from '../data/types'
import { deliveryValue, depositAvailable, invoiceBalance, invoiceState, todayISO, uninvoicedDeliveries, vatBreakdown } from '../domain/calc'
import { createInvoice, payInvoice } from '../domain/services'
import { go, useApp } from '../ui/app-context'
import { Check, Empty, eur, fmtDate, Head, Modal, NumberField, Pill, SelectField, Tabs, TextField } from '../ui/kit'

const STATE = { betaald: ['Betaald', 'good'], open: ['Open', 'bill'], te_laat: ['Te laat', 'bad'] } as const

export function Invoices() {
  const { s, run } = useApp()
  const [tab, setTab] = useState<'open' | 'all'>('open')
  const [make, setMake] = useState<{ order: SalesOrder; ids: string[] } | null>(null)
  const pending = s.sales_orders.filter((o) => o.status === 'open' && uninvoicedDeliveries(s, o.id).length)
  const rows = [...s.invoices].sort((a, b) => b.number.localeCompare(a.number)).filter((i) => tab === 'all' || invoiceBalance(s, i) > 0)
  const mode = s.settings[0]?.invoice_mode ?? 'manual'
  return (
    <>
      <Head title="Facturatie" sub="Deelleveringen worden bij afmelden direct gefactureerd. Vooruitbetalingen worden verrekend.">
        <SelectField label="Hele leveringen factureren" value={mode} onChange={(v) => run((db) => db.update('settings', 'default', { invoice_mode: v }), v === 'auto' ? 'Hele leveringen worden nu automatisch gefactureerd' : 'Hele leveringen factureer je nu zelf')} options={[{ value: 'manual', label: 'Handmatig' }, { value: 'auto', label: 'Automatisch bij levering' }]} />
      </Head>
      <div className="stack">
        <section className="panel">
          <h2>Geleverd, nog te factureren</h2>
          {pending.length === 0 && <Empty>Alle leveringen zijn gefactureerd.</Empty>}
          {pending.map((o) => {
            const ds = uninvoicedDeliveries(s, o.id)
            const c = s.customers.find((x) => x.id === o.customer_id)!
            const dep = depositAvailable(s, o.id)
            return (
              <div className="task" key={o.id} style={{ flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 300px' }}>
                  <div className="task-t"><a className="rowlink" href={`#orders-${o.id}`}>{o.number}</a>, {c.company || c.name}</div>
                  {ds.map((d) => <div className="small" key={d.id}>{d.number}, geleverd {fmtDate(d.delivered_at)}: <span className="num">{eur(deliveryValue(s, d.id))}</span></div>)}
                  {dep > 0 && <div className="muted small">{eur(dep)} vooruitbetaald, nog te verrekenen</div>}
                </div>
                <div className="actions">
                  {ds.length > 1 && ds.map((d) => <button className="btn sm" key={d.id} onClick={() => setMake({ order: o, ids: [d.id] })}>Alleen {d.number}</button>)}
                  <button className="btn sm primary" onClick={() => setMake({ order: o, ids: ds.map((d) => d.id) })}>Factuur maken</button>
                </div>
              </div>
            )
          })}
        </section>
        <section className="panel">
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'open', label: 'Openstaand', n: s.invoices.filter((i) => invoiceBalance(s, i) > 0).length }, { value: 'all', label: 'Alle facturen', n: s.invoices.length }]} />
          {rows.length === 0 && <Empty>{tab === 'open' ? 'Geen openstaande facturen.' : 'Nog geen facturen.'}</Empty>}
          {rows.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th>Factuur</th><th>Datum</th><th>Klant</th><th>Soort</th><th className="num">Totaal</th><th className="num">Verrekend</th><th className="num">Open</th><th>Vervalt</th><th>Status</th></tr></thead>
            <tbody>{rows.map((i) => {
              const c = s.customers.find((x) => x.id === i.customer_id)!
              const [label, tone] = STATE[invoiceState(s, i)]
              return (
                <tr key={i.id} className="click" onClick={() => go(`facturatie-${i.id}`)}>
                  <td><a className="rowlink" href={`#facturatie-${i.id}`}>{i.number}</a></td><td>{fmtDate(i.invoice_date)}</td><td>{c.company || c.name}</td>
                  <td>{i.kind[0].toUpperCase() + i.kind.slice(1)}</td><td className="num">{eur(i.total)}</td><td className="num">{i.deposit_settled ? eur(i.deposit_settled) : <span className="zero">–</span>}</td>
                  <td className="num">{eur(invoiceBalance(s, i))}</td><td>{fmtDate(i.due_date)}</td><td><Pill tone={tone}>{label}</Pill></td>
                </tr>
              )
            })}</tbody>
          </table></div>}
        </section>
      </div>
      {make && <MakeInvoiceModal {...make} onClose={() => setMake(null)} />}
    </>
  )
}

function MakeInvoiceModal({ order, ids, onClose }: { order: SalesOrder; ids: string[]; onClose: () => void }) {
  const { s, run } = useApp()
  const last = s.invoices.reduce((m, i) => (i.invoice_date > m ? i.invoice_date : m), '')
  const [date, setDate] = useState(todayISO() > last ? todayISO() : last)
  const available = depositAvailable(s, order.id)
  const [settle, setSettle] = useState(available > 0)
  const value = ids.reduce((n, id) => n + deliveryValue(s, id), 0)
  const settled = settle ? Math.min(available, value) : 0
  const create = async () => {
    let id = ''
    const ok = await run(async (db) => { id = await createInvoice(db, { sales_order_id: order.id, delivery_ids: ids, invoice_date: date, settle_deposit: settle }) }, 'Factuur gemaakt')
    if (ok) { onClose(); go(`facturatie-${id}`) }
  }
  return (
    <Modal title="Factuur maken" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuleren</button>
      <button className="btn primary" onClick={create}>Factuur maken</button>
    </>}>
      <TextField label="Factuurdatum" type="date" value={date} onChange={setDate} hint={last ? `Mag niet voor ${fmtDate(last)} liggen, de datum van de laatste factuur.` : undefined} />
      {available > 0 && <Check label={`Vooruitbetaling verrekenen (${eur(available)} beschikbaar)`} checked={settle} onChange={setSettle} />}
      <div className="totals" style={{ maxWidth: 'none' }}>
        <div><span>Factuurbedrag incl. IVA</span><span>{eur(value)}</span></div>
        {settled > 0 && <div><span>Verrekend</span><span>−{eur(settled)}</span></div>}
        <div className="grand"><span>Te betalen</span><span>{eur(value - settled)}</span></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Na het maken staat de factuur vast en kan hij niet meer worden gewijzigd.</p>
    </Modal>
  )
}

const T: Record<Language, Record<string, string>> = {
  es: { title: 'Factura', deelfactuur: 'Factura parcial', eindfactuur: 'Factura final', volledig: 'Factura', date: 'Fecha', due: 'Vencimiento', order: 'Pedido', to: 'Facturar a', desc: 'Descripción', qty: 'Cant.', price: 'Precio', disc: 'Dto.', total: 'Total', base: 'Base imponible', vat: 'IVA', deposit: 'Anticipo aplicado', paid: 'Pagado', due_amt: 'Importe a pagar', pay: 'Pago por transferencia a', tax: 'NIF' },
  nl: { title: 'Factuur', deelfactuur: 'Deelfactuur', eindfactuur: 'Eindfactuur', volledig: 'Factuur', date: 'Datum', due: 'Vervaldatum', order: 'Order', to: 'Factuur aan', desc: 'Omschrijving', qty: 'Aantal', price: 'Prijs', disc: 'Korting', total: 'Totaal', base: 'Grondslag', vat: 'IVA', deposit: 'Vooruitbetaling verrekend', paid: 'Betaald', due_amt: 'Te betalen', pay: 'Betaling per overboeking op', tax: 'NIF' },
  en: { title: 'Invoice', deelfactuur: 'Partial invoice', eindfactuur: 'Final invoice', volledig: 'Invoice', date: 'Date', due: 'Due date', order: 'Order', to: 'Bill to', desc: 'Description', qty: 'Qty', price: 'Price', disc: 'Disc.', total: 'Total', base: 'Tax base', vat: 'IVA', deposit: 'Advance applied', paid: 'Paid', due_amt: 'Amount due', pay: 'Pay by bank transfer to', tax: 'Tax ID' },
}

export function InvoiceDetail({ id }: { id: string }) {
  const { s, run } = useApp()
  const inv = s.invoices.find((i) => i.id === id)
  const [pay, setPay] = useState(false)
  const [amount, setAmount] = useState(() => (inv ? invoiceBalance(s, inv) : 0))
  const [method, setMethod] = useState<Payment['method']>('overboeking')
  const [date, setDate] = useState(todayISO())
  const [ref, setRef] = useState('')
  if (!inv) return <div className="panel">Factuur niet gevonden. <a href="#facturatie">Terug naar facturatie</a>.</div>
  const c = s.customers.find((x) => x.id === inv.customer_id)!
  const o = s.sales_orders.find((x) => x.id === inv.sales_order_id)!
  const lines = s.invoice_lines.filter((l) => l.invoice_id === id)
  const co = s.settings[0]
  const t = T[inv.language]
  const b = vatBreakdown(lines.map((l) => ({ total: l.line_total, vat_rate: l.vat_rate })))
  const paid = s.payments.filter((p) => p.invoice_id === id).reduce((n, p) => n + p.amount, 0)
  const balance = invoiceBalance(s, inv)
  const [label, tone] = STATE[invoiceState(s, inv)]
  const canPrint = !import.meta.env.VITE_PREVIEW
  return (
    <>
      <Head title={inv.number} sub={<>{c.company || c.name} <Pill tone={tone}>{label}</Pill></>} back={{ href: '#facturatie', label: 'Facturatie' }}>
        <a className="btn" href={`#orders-${o.id}`}>Naar {o.number}</a>
        {canPrint && <button className="btn" onClick={() => window.print()}>Afdrukken of PDF</button>}
        {balance > 0 && <button className="btn primary" onClick={() => { setAmount(balance); setPay(true) }}>Betaling registreren</button>}
      </Head>
      <div className="paper">
        <div className="paper-top">
          <div>
            <h2 style={{ fontSize: '1.3rem' }}>{co.company_name}</h2>
            <div className="small muted">{[co.address, `${co.postal_code} ${co.city}`.trim(), co.province, co.phone, co.email].filter(Boolean).join(', ')}<br />{t.tax}: {co.tax_id}</div>
          </div>
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
          <thead><tr><th>{t.desc}</th><th className="num">{t.qty}</th><th className="num">{t.price}</th><th className="num">{t.disc}</th><th className="num">{t.vat}</th><th className="num">{t.total}</th></tr></thead>
          <tbody>{lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="num">{l.qty}</td><td className="num">{eur(l.unit_price)}</td><td className="num">{l.discount_pct ? `${l.discount_pct}%` : ''}</td><td className="num">{l.vat_rate}%</td><td className="num">{eur(l.line_total)}</td></tr>)}</tbody>
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
      </div>
      {pay && (
        <Modal title="Betaling registreren" onClose={() => setPay(false)} footer={<>
          <button className="btn" onClick={() => setPay(false)}>Annuleren</button>
          <button className="btn primary" onClick={async () => { if (await run((db) => payInvoice(db, { invoice_id: id, amount, method, paid_at: date, reference: ref }), 'Betaling geregistreerd')) setPay(false) }}>Betaling registreren</button>
        </>}>
          <div className="form-grid">
            <NumberField label="Bedrag" value={amount} step="0.01" min={0} onChange={setAmount} hint={`Open: ${eur(balance)}`} />
            <SelectField label="Betaalwijze" value={method} onChange={setMethod} options={[{ value: 'overboeking', label: 'Overboeking' }, { value: 'pin', label: 'Pin' }, { value: 'contant', label: 'Contant' }, { value: 'online', label: 'Online' }]} />
            <TextField label="Datum" type="date" value={date} onChange={setDate} />
            <TextField label="Referentie" value={ref} onChange={setRef} />
          </div>
        </Modal>
      )}
    </>
  )
}
