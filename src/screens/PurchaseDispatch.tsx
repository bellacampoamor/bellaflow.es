import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Printer, Send } from 'lucide-react'
import type { EmailStatus, Snapshot } from '../data/types'
import { addDays, round2, todayISO } from '../domain/calc'
import { dispatchesOf, isDispatched, purchaseJsonFileName, purchaseOrdersOfDay } from '../domain/purchaseExport'
import { purchaseJsonFiles, sendPurchaseOrders } from '../domain/services'
import { tx } from '../i18n'
import { go, useApp } from '../ui/app-context'
import { Empty, eur, fmtDate, Head, Modal, pickRow, PickMark, Pill, type Tone } from '../ui/kit'
import { LabelPill } from './Purchases'

/** Hoe een verzending op het scherm staat. */
export const DISPATCH_STATUS: Record<EmailStatus, [string, Tone]> = {
  sent: ['Verstuurd', 'good'], demo: ['Testversie: niet echt verstuurd', 'info'], pending: ['Wordt verstuurd', 'info'],
  failed: ['Versturen mislukt', 'bad'], no_recipient: ['Geen e-mailadres', 'warn'],
}
const dt = (iso: string) => `${fmtDate(iso)} ${iso.slice(11, 16)}`

/** Laatste verzending van een inkooporder als pil, of "Nog niet verstuurd". */
export function DispatchPill({ s, id }: { s: Snapshot; id: string }) {
  const last = dispatchesOf(s, id)[0]
  if (!last) return <Pill>{tx("Nog niet verstuurd")}</Pill>
  const [label, tone] = DISPATCH_STATUS[last.status]
  return <Pill tone={tone}>{tx(label)}, {dt(localIso(last.created_at))}</Pill>
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Inkooporders van één dag afdrukken (één PDF, elke inkooporder op een eigen pagina) of versturen:
 * per leverancier één JSON-bestand per mail (besluit Rick 7 november 2026). Elke verzending wordt op de inkooporder gelogd.
 */
export function PurchaseDispatch({ date: initialDate }: { date?: string }) {
  const { s, run, toast } = useApp()
  const [date, setDateState] = useState(/^\d{4}-\d{2}-\d{2}$/.test(initialDate ?? '') ? initialDate! : todayISO())
  const pos = useMemo(() => purchaseOrdersOfDay(s, date), [s, date])
  // Standaard geselecteerd: wat nog niet verstuurd is.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(purchaseOrdersOfDay(s, date).filter((p) => !isDispatched(s, p.id)).map((p) => p.id)))
  const [sending, setSending] = useState(false)
  const setDate = (d: string) => {
    setDateState(d)
    setPicked(new Set(purchaseOrdersOfDay(s, d).filter((p) => !isDispatched(s, p.id)).map((p) => p.id)))
    history.replaceState(null, '', `#inkoop-versturen-${d}`)
  }
  const ids = pos.filter((p) => picked.has(p.id)).map((p) => p.id)
  const toggle = (id: string) => setPicked((v) => { const n = new Set(v); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const supplierIds = [...new Set(pos.map((p) => p.supplier_id))]
  const value = (id: string) => round2(s.purchase_order_lines.filter((l) => l.purchase_order_id === id).reduce((n, l) => n + l.qty * l.unit_cost, 0))
  const downloadJson = () => run(async (db) => {
    for (const f of await purchaseJsonFiles(db, date, ids)) download(f.fileName, f.json)
  })
  return (
    <>
      <Head title={tx("Afdrukken en versturen")} sub={tx("Inkooporders van één dag. Selecteer door op de regel te klikken. Afdrukken maakt één PDF met elke inkooporder op een eigen pagina. Versturen mailt per leverancier één JSON-bestand; dat wordt op de inkooporder gelogd.")} back={{ href: '#inkoop', label: tx("Inkooporders") }} />
      <section className="panel">
        <div className="panel-head" style={{ alignItems: 'center' }}>
          <div className="btn-row" style={{ alignItems: 'center' }}>
            <button type="button" className="btn icon" aria-label={tx("Vorige dag")} title={tx("Vorige dag")} onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={16} /></button>
            <input type="date" style={{ width: 'auto' }} aria-label={tx("Besteldatum")} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button type="button" className="btn icon" aria-label={tx("Volgende dag")} title={tx("Volgende dag")} onClick={() => setDate(addDays(date, 1))}><ChevronRight size={16} /></button>
            {date !== todayISO() && <button type="button" className="btn sm" onClick={() => setDate(todayISO())}>{tx("Vandaag")}</button>}
          </div>
          {pos.length > 0 && <button className="btn sm" onClick={() => setPicked(new Set(ids.length === pos.length ? [] : pos.map((p) => p.id)))}>{ids.length === pos.length ? tx("Niets selecteren") : tx("Alles selecteren")}</button>}
        </div>
        {pos.length === 0 && <Empty>{tx("Geen inkooporders met besteldatum {0}. Proforma's en geannuleerde inkooporders worden niet verstuurd.", fmtDate(date))}</Empty>}
        {pos.length > 0 && <>
          <div className="table-wrap"><table className="queue">
            <thead><tr><th>{tx("Inkooporder")}</th><th>{tx("Referentie leverancier")}</th><th className="num">{tx("Regels")}</th><th className="num">{tx("Waarde")}</th><th>{tx("Verstuurd")}</th><th aria-label={tx("Selectie")} /></tr></thead>
            {supplierIds.map((sid) => {
              const sup = s.suppliers.find((x) => x.id === sid)
              const mine = pos.filter((p) => p.supplier_id === sid)
              return (
                <tbody key={sid}>
                  <tr className="queue-head"><td colSpan={6}><strong>{sup?.name}</strong> <span className="muted small">{sup?.email || tx("geen e-mailadres")}, {purchaseJsonFileName(sup, date)}</span></td></tr>
                  {mine.map((po) => (
                    <tr key={po.id} {...pickRow(picked.has(po.id), () => toggle(po.id))}>
                      <td><a className="rowlink" href={`#inkoop-${po.id}`}>{po.number}</a> <LabelPill label={po.label} /></td>
                      <td>{po.supplier_reference || <span className="muted">–</span>}</td>
                      <td className="num">{s.purchase_order_lines.filter((l) => l.purchase_order_id === po.id).length}</td>
                      <td className="num">{eur(value(po.id))}</td>
                      <td><DispatchPill s={s} id={po.id} /></td>
                      <PickMark on={picked.has(po.id)} />
                    </tr>
                  ))}
                </tbody>
              )
            })}
          </table></div>
          <div className="queue-bar">
            <span>{ids.length ? tx("{0} geselecteerd", ids.length) : tx("Nog niets geselecteerd")}</span>
            <div className="btn-row">
              <button className="btn" disabled={!ids.length} onClick={() => go(`inkoop-afdrukken-${date}-${ids.join(',')}`)}><Printer size={16} />{tx("Afdrukken als PDF")}</button>
              <button className="btn" disabled={!ids.length} onClick={() => void downloadJson()} title={tx("Alleen downloaden; dit telt niet als verstuurd.")}><Download size={16} />{tx("JSON downloaden")}</button>
              <button className="btn primary" disabled={!ids.length} onClick={() => setSending(true)}><Send size={16} />{tx("Versturen ({0})", ids.length)}</button>
            </div>
          </div>
        </>}
      </section>
      {sending && <SendModal date={date} ids={ids} onClose={() => setSending(false)} onDone={(failed) => { setSending(false); if (failed) toast(failed, true) }} />}
    </>
  )
}

function SendModal({ date, ids, onClose, onDone }: { date: string; ids: string[]; onClose: () => void; onDone: (failed: string) => void }) {
  const { s, run } = useApp()
  const groups = [...new Set(ids.map((id) => s.purchase_orders.find((p) => p.id === id)!.supplier_id))].map((sid) => ({ sup: s.suppliers.find((x) => x.id === sid), sid, pos: ids.map((id) => s.purchase_orders.find((p) => p.id === id)!).filter((p) => p.supplier_id === sid) }))
  const [to, setTo] = useState<Record<string, string>>(() => Object.fromEntries(groups.map((g) => [g.sid, g.sup?.email ?? ''])))
  const again = ids.filter((id) => isDispatched(s, id)).map((id) => s.purchase_orders.find((p) => p.id === id)!.number)
  const send = async () => {
    let failed = ''
    const ok = await run(async (db) => {
      const results = await sendPurchaseOrders(db, { date, ids, to })
      const bad = results.filter((r) => r.status === 'failed' || r.status === 'no_recipient')
      if (bad.length) failed = tx("Niet verstuurd naar {0}; zie het log op de inkooporder.", bad.map((r) => s.suppliers.find((x) => x.id === r.supplierId)?.name).join(', '))
    }, ids.length === 1 ? tx("Inkooporder verstuurd") : tx("Inkooporders verstuurd"))
    if (ok) onDone(failed)
  }
  return (
    <Modal title={tx("Inkooporders van {0} versturen", fmtDate(date))} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx("Terug")}</button>
      <button className="btn primary" onClick={() => void send()}><Send size={16} />{tx("Versturen")}</button>
    </>}>
      <p className="small muted" style={{ marginTop: 0 }}>{tx("Per leverancier één mail met één JSON-bestand, met een bcc naar de winkel e-mail. Elke verzending komt in het log van de inkooporder.")}</p>
      {groups.map((g) => (
        <div key={g.sid} className="field" style={{ marginBottom: 12 }}>
          <label className="lbl" htmlFor={`to-${g.sid}`}>{tx("{0}: {1}", g.sup?.name ?? '', g.pos.map((p) => p.number).join(', '))}</label>
          <input id={`to-${g.sid}`} type="email" value={to[g.sid] ?? ''} placeholder={tx("E-mailadres leverancier")} onChange={(e) => setTo((v) => ({ ...v, [g.sid]: e.target.value }))} />
          <div className="small muted">{purchaseJsonFileName(g.sup, date)}{!to[g.sid]?.trim() && <> · <span style={{ color: 'var(--bad)' }}>{tx("Zonder adres wordt niets verstuurd; dat wordt wel gelogd.")}</span></>}</div>
        </div>
      ))}
      {again.length > 0 && <div className="note warn">{tx("Al eerder verstuurd: {0}. Opnieuw versturen komt als nieuwe regel in het log.", again.join(', '))}</div>}
    </Modal>
  )
}

/** Log op de inkooporder: elke verzending, met dag, bestand, adres en status. */
export function DispatchLog({ id }: { id: string }) {
  const { s } = useApp()
  const po = s.purchase_orders.find((p) => p.id === id)
  const log = dispatchesOf(s, id)
  if (!po || po.status === 'proforma') return null
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{tx("Verstuurd")}</h2>
        {po.status === 'open' && <a className="btn sm" href={`#inkoop-versturen-${po.order_date}`}><Send size={14} />{log.length ? tx("Opnieuw versturen") : tx("Versturen")}</a>}
      </div>
      {log.length === 0 && <Empty>{tx("Deze inkooporder is nog niet verstuurd.")}</Empty>}
      {log.length > 0 && <div className="table-wrap"><table>
        <thead><tr><th>{tx("Datum en tijd")}</th><th>{tx("Manier")}</th><th>{tx("Bestand")}</th><th>{tx("Naar")}</th><th>{tx("Status")}</th></tr></thead>
        <tbody>{log.map((d) => {
          const [label, tone] = DISPATCH_STATUS[d.status]
          return (
            <tr key={d.id}>
              <td>{dt(localIso(d.created_at))}</td>
              <td>{tx("JSON per mail")}<div className="muted small">{tx("Dag {0}", fmtDate(d.dispatch_date))}</div></td>
              <td className="small">{d.file_name}</td>
              <td>{d.to_email || <span className="muted">–</span>}</td>
              <td><Pill tone={tone}>{tx(label)}</Pill>{d.error && <div className="small" style={{ color: 'var(--bad)' }}>{d.error}</div>}</td>
            </tr>
          )
        })}</tbody>
      </table></div>}
    </section>
  )
}

/** Tijdstip in de tijdzone van de browser, als jjjj-mm-ddTuu:mm. */
function localIso(iso: string) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
