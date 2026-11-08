import { useMemo, useState } from 'react'
import type { Payment } from '../data/types'
import { inboundWarehouse, round2, todayISO, vatBreakdown, lineTotal } from '../domain/calc'
import { canCredit, creditableAmount, creditableLines, creditSettlement, isCredit, originalMethod } from '../domain/credit'
import { posWarehouse } from '../domain/pos'
import { createCreditInvoice } from '../domain/services'
import { go, useApp } from '../ui/app-context'
import { Empty, eur, fmtDate, Head, NumInput, Pill, pickRow, PickMark, SelectField, TextField, Sku } from '../ui/kit'
import { tx } from '../i18n'

type RefundMethod = Exclude<Payment['method'], 'verrekening'> | 'later'
interface Row { qty: number; warehouse: string }
const REASONS = ['Retour', 'Fout in de factuur', 'Korting achteraf', 'Schade'] as const

/**
 * Creditfactuur maken (factura rectificativa): kies de regels die gecrediteerd worden, per regel of het artikel
 * retour komt in voorraad, eventueel een bedrag zonder artikel (korting of schade), en hoe het geld terug gaat.
 */
export function CreditForm({ invoiceId }: { invoiceId: string }) {
  const { s, run } = useApp()
  const inv = s.invoices.find((i) => i.id === invoiceId)
  const lines = useMemo(() => (inv ? creditableLines(s, inv.id) : []), [s, inv])
  const warehouses = s.warehouses.filter((w) => w.is_active)
  // Voorstel voor de retour: kassa de winkel, anders waar het vandaan kwam, anders het vertrekpunt van de route.
  const defaultWarehouse = (deliveryLineId: string | null) => {
    if (inv?.simplified) return posWarehouse(warehouses)?.id ?? ''
    const from = s.delivery_lines.find((d) => d.id === deliveryLineId)?.warehouse_id
    return (from && warehouses.some((w) => w.id === from) ? from : inboundWarehouse(warehouses)?.id ?? warehouses[0]?.id) ?? ''
  }
  const [rows, setRows] = useState<Record<string, Row>>({})
  const last = s.invoices.reduce((m, i) => (i.invoice_date > m ? i.invoice_date : m), '')
  const [date, setDate] = useState(todayISO() > last ? todayISO() : last)
  const [reason, setReason] = useState('')
  const [extraOn, setExtraOn] = useState(false)
  const [extra, setExtra] = useState({ description: '', amount: 0, vat_rate: 21 })
  const [method, setMethod] = useState<RefundMethod>(() => {
    const m = inv ? originalMethod(s, inv.id) : null
    return m && m !== 'verrekening' ? m : inv?.simplified ? 'contant' : 'overboeking'
  })
  const [reference, setReference] = useState('')

  if (!inv) return <div className="panel">{tx("Factuur niet gevonden.")} <a href="#facturatie">{tx("Terug naar facturatie")}</a>.</div>
  const c = s.customers.find((x) => x.id === inv.customer_id)
  const head = <Head title={tx("Creditfactuur op {0}", inv.number)} back={{ href: `#facturatie-${inv.id}`, label: inv.number }}
    sub={tx("Een factuur kan niet worden gewijzigd. Een retour, een fout of een korting achteraf wordt een creditfactuur met negatieve bedragen, die verwijst naar deze factuur.")} />
  if (isCredit(inv) || !canCredit(s, inv)) return <>{head}<div className="note">{isCredit(inv) ? tx("Een creditfactuur kan zelf niet gecrediteerd worden.") : tx("Deze factuur is al volledig gecrediteerd.")}</div></>

  const toggle = (id: string, remaining: number, dl: string | null, stockable: boolean) => setRows((r) => {
    const n = { ...r }
    if (n[id]) delete n[id]
    else n[id] = { qty: remaining, warehouse: stockable ? defaultWarehouse(dl) : '' }
    return n
  })
  const patch = (id: string, p: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...p } }))
  const allOn = lines.filter((l) => l.remaining > 0).every((l) => rows[l.line.id])
  const selectAll = () => setRows(allOn ? {} : Object.fromEntries(lines.filter((l) => l.remaining > 0).map((l) => [l.line.id, { qty: l.remaining, warehouse: l.stockable ? defaultWarehouse(l.line.delivery_line_id) : '' }])))

  const chosen = lines.filter((l) => rows[l.line.id] && rows[l.line.id].qty > 0)
  const preview = vatBreakdown([
    ...chosen.map((l) => ({ total: lineTotal({ ...l.line, qty: rows[l.line.id].qty }), vat_rate: l.line.vat_rate })),
    ...(extraOn && extra.amount > 0 ? [{ total: round2(extra.amount), vat_rate: extra.vat_rate }] : []),
  ])
  const amount = preview.total
  const room = creditableAmount(s, inv)
  const { settle, refund } = creditSettlement(s, inv, amount)
  const returned = chosen.filter((l) => rows[l.line.id].warehouse).reduce((n, l) => n + rows[l.line.id].qty, 0)

  const submit = async () => {
    let id = ''
    const ok = await run(async (db) => {
      id = await createCreditInvoice(db, {
        invoice_id: inv.id, date, reason,
        lines: chosen.map((l) => ({ invoice_line_id: l.line.id, qty: rows[l.line.id].qty, return_warehouse_id: rows[l.line.id].warehouse || null })),
        extra: extraOn ? extra : null,
        refund: { method, reference },
      })
    }, tx("Creditfactuur gemaakt"))
    if (ok) go(`facturatie-${id}`)
  }

  return (
    <>
      {head}
      <div className="stack">
        <section className="panel">
          <div className="panel-head">
            <h2>{tx("Regels van {0}", inv.number)}</h2>
            <button className="btn sm" onClick={selectAll}>{allOn ? tx("Niets selecteren") : tx("Alles selecteren")}</button>
          </div>
          <p className="small muted">{c?.company || c?.name} · {fmtDate(inv.invoice_date)} · {eur(inv.total)}{inv.issuer === 'hdb' && <> · <Pill tone="info">HDB</Pill></>}. {tx("Klik op de regels die je crediteert. Komt het artikel terug, kies dan de locatie; anders kies Geen retour.")}</p>
          {lines.length === 0 ? <Empty>{tx("Deze factuur heeft geen regels.")}</Empty> : <div className="table-wrap"><table className="queue">
            <thead><tr><th>{tx("Artikel")}</th><th className="num">{tx("Gefactureerd")}</th><th className="num">{tx("Al gecrediteerd")}</th><th className="num">{tx("Crediteren")}</th><th>{tx("Retour in voorraad")}</th><th className="num">{tx("Bedrag")}</th><th aria-label={tx("Selectie")} /></tr></thead>
            <tbody>{lines.map((l) => {
              const r = rows[l.line.id]
              const off = l.remaining === 0
              return (
                <tr key={l.line.id} {...(off ? { className: 'muted' } : pickRow(!!r, () => toggle(l.line.id, l.remaining, l.line.delivery_line_id, l.stockable)))}>
                  <td>{l.line.description}<Sku code={l.line.article_number} /></td>
                  <td className="num">{l.line.qty}</td>
                  <td className="num">{l.credited || <span className="zero">–</span>}</td>
                  <td className="num">{r ? <NumInput className="qty" step="1" min={1} max={l.remaining} value={r.qty} onValue={(n) => patch(l.line.id, { qty: Math.max(0, Math.min(l.remaining, Math.round(n))) })} aria-label={tx("Aantal")} /> : off ? tx("Volledig") : ''}</td>
                  <td>{r && (l.stockable
                    ? <select value={r.warehouse} onChange={(e) => patch(l.line.id, { warehouse: e.target.value })} aria-label={tx("Retour in voorraad")}>
                        <option value="">{tx("Geen retour")}</option>
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    : <span className="small muted">{tx("Geen voorraad")}</span>)}</td>
                  <td className="num">{r ? eur(-lineTotal({ ...l.line, qty: r.qty })) : ''}</td>
                  <PickMark on={!!r} />
                </tr>
              )
            })}</tbody>
          </table></div>}
          <div style={{ marginTop: 12 }}>
            {!extraOn ? <button className="linklike small" onClick={() => setExtraOn(true)}>{tx("+ Bedrag zonder artikel (korting achteraf of schade)")}</button> : (
              <div className="form-grid">
                <TextField label={tx("Omschrijving")} value={extra.description} onChange={(v) => setExtra({ ...extra, description: v })} placeholder={tx("Bijvoorbeeld Vergoeding schade")} />
                <div className="field"><label>{tx("Bedrag incl. IVA")}</label><NumInput step="0.01" min={0} value={extra.amount} onValue={(n) => setExtra({ ...extra, amount: n })} /></div>
                <SelectField label={tx("IVA")} value={String(extra.vat_rate)} onChange={(v) => setExtra({ ...extra, vat_rate: Number(v) })} options={[21, 10, 4, 0].map((r) => ({ value: String(r), label: `${r}%` }))} />
                <div className="field"><label>&nbsp;</label><button className="btn" onClick={() => { setExtraOn(false); setExtra({ description: '', amount: 0, vat_rate: 21 }) }}>{tx("Weghalen")}</button></div>
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <h2>{tx("Creditfactuur")}</h2>
          <div className="form-grid">
            <TextField label={tx("Datum")} type="date" value={date} onChange={setDate} hint={last ? tx("Mag niet voor {0} liggen, de datum van de laatste factuur.", fmtDate(last)) : undefined} />
            <TextField className="span-2" label={tx("Reden (komt op de creditfactuur)")} value={reason} onChange={setReason} placeholder={tx("Bijvoorbeeld Retour, klant wil een andere kleur")} />
          </div>
          <div className="btn-row" style={{ marginTop: 6 }}>{REASONS.map((r) => <button key={r} className="btn sm" onClick={() => setReason(tx(r))}>{tx(r)}</button>)}</div>

          <div className="totals" style={{ marginTop: 18 }}>
            <div><span>{tx("Grondslag")}</span><span>{eur(-preview.base)}</span></div>
            {preview.rates.map((r) => <div key={r.rate}><span>IVA {r.rate}%</span><span>{eur(-r.vat)}</span></div>)}
            <div className="strong"><span>{tx("Totaal creditfactuur")}</span><span>{eur(-amount)}</span></div>
            {settle > 0 && <div><span>{tx("Verrekend met wat open staat op {0}", inv.number)}</span><span>{eur(settle)}</span></div>}
            <div className="grand"><span>{tx("Terug aan de klant")}</span><span>{eur(refund)}</span></div>
          </div>
          {amount > room + 0.005 && <div className="note bad">{tx("Er kan van deze factuur nog maar {0} gecrediteerd worden.", eur(room))}</div>}
          {refund > 0 && <div className="form-grid" style={{ marginTop: 12 }}>
            <SelectField label={tx("Terugbetalen met")} value={method} onChange={setMethod} options={[
              { value: 'contant', label: tx("Contant") }, { value: 'pin', label: tx("Pin") }, { value: 'overboeking', label: tx("Overboeking") }, { value: 'online', label: tx("Online") },
              { value: 'later', label: tx("Later, blijft open als terug te betalen") },
            ]} />
            {method !== 'later' && <TextField label={tx("Referentie")} value={reference} onChange={setReference} />}
          </div>}
          <p className="small muted">{returned > 0 ? tx("{0} stuks komen terug in voorraad (mutatie Retour).", returned) : tx("Er komt niets terug in voorraad.")} {tx("Na het maken staat de creditfactuur vast, net als een factuur.")}</p>
          <div className="btn-row"><button className="btn primary" disabled={amount <= 0 || !reason.trim()} onClick={submit}>{tx("Creditfactuur maken")}</button></div>
        </section>
      </div>
    </>
  )
}
