// Rapportage, tabblad Leverbaar: match tussen openstaande verkooporders en ontvangen inkoop.
// Welke verkooporders kunnen worden afgeleverd? Daarna gaat het verder in de verkoop-flow (Levering plannen).
import { useState } from 'react'
import { Truck } from 'lucide-react'
import { deliverableReport, type DeliverableState } from '../domain/purchaseFlow'
import { articleNo } from '../domain/calc'
import { tx } from '../i18n'
import { go, useApp } from '../ui/app-context'
import { Empty, fmtDate, Pill, Tabs, type Tone } from '../ui/kit'

type Filter = 'leverbaar' | 'volledig' | 'alle'
const STATE: Record<DeliverableState, [string, Tone]> = { volledig: ['Volledig leverbaar', 'good'], deels: ['Deels leverbaar', 'warn'], nog_niet: ['Nog niet binnen', 'info'] }

export function Deliverable() {
  const { s } = useApp()
  const [filter, setFilter] = useState<Filter>('leverbaar')
  const all = deliverableReport(s)
  const rows = all.filter((r) => filter === 'alle' || (filter === 'volledig' ? r.state === 'volledig' : r.state !== 'nog_niet'))
  const lineOf = (id: string) => s.sales_order_lines.find((l) => l.id === id)!
  const nameOf = (id: string) => s.warehouses.find((w) => w.id === id)?.name ?? ''
  return (
    <section className="panel">
      <div className="panel-head" style={{ alignItems: 'flex-end' }}>
        <Tabs<Filter> value={filter} onChange={setFilter} tabs={[
          { value: 'leverbaar', label: tx("Leverbaar"), n: all.filter((r) => r.state !== 'nog_niet').length },
          { value: 'volledig', label: tx("Volledig leverbaar"), n: all.filter((r) => r.state === 'volledig').length },
          { value: 'alle', label: tx("Alle open verkooporders"), n: all.length },
        ]} />
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>{tx("Openstaande verkooporders naast wat er voor de klant binnen is. Binnen betekent: op voorraad gereserveerd of met een transport ontvangen. Al geplande leveringen tellen niet mee. Plan de levering vanuit de verkooporder.")}</p>
      {rows.length === 0 && <Empty>{tx("Geen verkooporders in dit overzicht.")}</Empty>}
      {rows.length > 0 && <div className="table-wrap"><table>
        <thead><tr><th>{tx("Verkooporder")}</th><th>{tx("Klant")}</th><th>{tx("Binnen, nog te plannen")}</th><th>{tx("Nog niet binnen")}</th><th>{tx("Status")}</th><th></th></tr></thead>
        <tbody>{rows.map((r) => {
          const o = s.sales_orders.find((x) => x.id === r.orderId)!
          const c = s.customers.find((x) => x.id === o.customer_id)
          const [label, tone] = STATE[r.state]
          return (
            <tr key={r.orderId} className="click" onClick={() => go(`orders-${o.id}`)}>
              <td><a className="rowlink" href={`#orders-${o.id}`}>{o.number}</a><div className="muted small">{fmtDate(o.order_date)}{o.promised_date ? tx(", beloofd {0}", fmtDate(o.promised_date)) : ''}</div></td>
              <td>{c?.company || c?.name}<div className="muted small">{o.delivery_city}</div></td>
              <td className="small">{r.ready.length ? r.ready.map((x) => { const l = lineOf(x.lineId); return <div key={x.lineId}>{tx("{0} × {1}", x.qty, l.description)} <span className="sku inline">{articleNo(s, l.product_id)}</span> <span className="muted">{tx("op {0}", nameOf(x.warehouseId))}{x.viaTransport ? tx(", ontvangen met {0}", x.viaTransport) : ''}</span></div> }) : <span className="muted">–</span>}</td>
              <td className="small">{r.waiting.length ? r.waiting.map((x) => { const l = lineOf(x.lineId); return <div key={x.lineId}>{tx("{0} × {1}", x.qty, l.description)} <span className="muted">{x.transport ? tx("{0}, verwacht {1}", x.transport, fmtDate(x.expected)) : tx("nog niet op een transport")}</span></div> }) : <span className="muted">–</span>}{r.planned > 0 && <div className="muted">{tx("{0} al gepland", r.planned)}</div>}</td>
              <td><Pill tone={tone}>{tx(label)}</Pill></td>
              <td>{r.ready.length > 0 && <a className="btn sm primary" href={`#orders-${o.id}`} onClick={(e) => e.stopPropagation()}><Truck size={14} />{tx("Levering plannen")}</a>}</td>
            </tr>
          )
        })}</tbody>
      </table></div>}
    </section>
  )
}
