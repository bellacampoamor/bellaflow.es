import { useState } from 'react'
import { ClipboardCheck, Receipt } from 'lucide-react'
import type { EmailStatus } from '../data/types'
import { archiveRows } from '../domain/calc'
import { mailSignedNote } from '../domain/services'
import { useApp } from '../ui/app-context'
import { Empty, fmtDate, Pill, Tabs, type Tone } from '../ui/kit'
import { tx } from '../i18n'

type Tab = 'alles' | 'compleet' | 'factureren'

const MAIL: Record<EmailStatus, [string, Tone]> = {
  pending: ['Mail wordt verstuurd', 'info'], sent: ['Gemaild', 'good'], failed: ['Mail mislukt', 'bad'],
  no_recipient: ['Geen e-mailadres', 'bad'], demo: ['Voorbeeld: niet gemaild', ''],
}

export function Archive() {
  const { s, run } = useApp()
  const [tab, setTab] = useState<Tab>('alles')
  const [q, setQ] = useState('')
  const all = archiveRows(s)
  const customer = (id: string | null) => { const c = s.customers.find((x) => x.id === id); return c?.company || c?.name || '' }
  const t = q.trim().toLowerCase()
  const rows = all.filter((r) => (tab === 'alles' || (tab === 'compleet') === r.complete) && (!t || `${r.order.number} ${customer(r.order.customer_id)} ${r.delivery.number} ${r.delivery.proforma_number ?? ''} ${r.invoice?.number ?? ''}`.toLowerCase().includes(t)))
  return (
    <>
      <section className="panel">
        <div className="panel-head" style={{ alignItems: 'flex-end' }}>
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: 'alles', label: tx("Alles"), n: all.length }, { value: 'compleet', label: tx("Compleet afgewerkt"), n: all.filter((r) => r.complete).length }, { value: 'factureren', label: tx("Nog niet compleet"), n: all.filter((r) => !r.complete).length }]} />
          <input id="archief-zoek" style={{ maxWidth: 280, marginBottom: 14 }} aria-label={tx("Archief doorzoeken")} placeholder={tx("Zoek op nummer of klant")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {rows.length === 0 && <Empty>{tx("Geen verkooporders in dit overzicht.")}</Empty>}
        {rows.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>{tx("Verkooporder")}</th><th>{tx("Orderdatum")}</th><th>{tx("Klant")}</th><th>{tx("Afleverbon")}</th><th>{tx("Afleverdatum")}</th><th>{tx("Proforma")}</th><th>{tx("Factuur")}</th><th>{tx("Factuurdatum")}</th><th>{tx("Printen")}</th></tr></thead>
          <tbody>{rows.map(({ delivery: d, order: o, invoice: i }) => {
            const hasNote = d.method !== 'meenemen'
            const mail = s.email_outbox.find((m) => m.kind !== 'factuur' && m.delivery_id === d.id)
            return (
              <tr key={d.id}>
                <td><a className="rowlink" href={`#orders-${o.id}`}>{o.number}</a></td>
                <td>{fmtDate(o.order_date)}</td>
                <td>{customer(o.customer_id)}</td>
                <td>{hasNote ? <a className="rowlink" href={`#levering-archief-${d.id}`} title={tx("Afleverbon {0} bekijken", d.number)}>{d.number}</a> : d.number}<div>{!hasNote ? <Pill>{tx("Klant haalt op")}</Pill> : d.signature_data ? <Pill tone="good">{tx("Digitaal getekend")}</Pill> : d.signed_note_received ? <Pill tone="good">{tx("Getekend retour")}</Pill> : <Pill tone="warn">{tx("Nog niet retour")}</Pill>}</div>
                  {mail && <div className="mail-state"><Pill tone={MAIL[mail.status][1]}>{tx(MAIL[mail.status][0])}</Pill>{(mail.status === 'failed' || mail.status === 'no_recipient') && <button className="btn sm" title={mail.error} onClick={() => run((db) => mailSignedNote(db, d.id))}>{tx("Opnieuw mailen")}</button>}</div>}</td>
                <td>{fmtDate(d.delivered_at)}</td>
                <td>{d.proforma_number ?? <span className="zero">–</span>}</td>
                <td>{i ? <a className="rowlink" href={`#facturatie-${i.id}`}>{i.number}</a> : <span className="zero">–</span>}</td>
                <td>{i ? fmtDate(i.invoice_date) : <span className="zero">–</span>}</td>
                <td><div className="print-icons">
                  {hasNote && <a className="btn sm" href={`#levering-print-${d.id}`} title={tx("Afleverbon {0} printen", d.number)} aria-label={tx("Afleverbon {0} printen", d.number)}><ClipboardCheck size={15} />{tx("Bon")}</a>}
                  {i && <a className="btn sm" href={`#facturatie-print-${i.id}`} title={tx("Factuur {0} printen", i.number)} aria-label={tx("Factuur {0} printen", i.number)}><Receipt size={15} />{tx("Factuur")}</a>}
                </div></td>
              </tr>
            )
          })}</tbody>
        </table></div>}
      </section>
    </>
  )
}
