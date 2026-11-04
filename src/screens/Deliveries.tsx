import { useState } from 'react'
import { CalendarClock, Check as CheckIcon, Truck } from 'lucide-react'
import type { Delivery } from '../data/types'
import { invoicesOnDelivery, isPartialDelivery, onHandMap, stockKey, todayISO } from '../domain/calc'
import { cancelDelivery, markDelivered, rescheduleDelivery, setDeliveryInTransit } from '../domain/services'
import { useApp } from '../ui/app-context'
import { Check, Empty, fmtDate, fmtShort, Head, Modal, Pill, Tabs, TextField } from '../ui/kit'

const METHOD = { meenemen: 'Klant haalt op', vervoerder: 'Vervoerder', eigen_team: 'Eigen team' }

export function Deliveries() {
  const { s, run } = useApp()
  const [tab, setTab] = useState<'planning' | 'done'>('planning')
  const [finish, setFinish] = useState<Delivery | null>(null)
  const [move, setMove] = useState<Delivery | null>(null)
  const today = todayISO()
  const planning = s.deliveries.filter((d) => d.status === 'planned' || d.status === 'in_transit').sort((a, b) => a.planned_date.localeCompare(b.planned_date))
  const done = s.deliveries.filter((d) => d.status === 'delivered' || d.status === 'cancelled').sort((a, b) => (b.delivered_at ?? b.planned_date).localeCompare(a.delivered_at ?? a.planned_date))
  const days = [...new Set(planning.map((d) => d.planned_date))]
  const hand = onHandMap(s)

  const card = (d: Delivery) => {
    const o = s.sales_orders.find((x) => x.id === d.sales_order_id)!
    const c = s.customers.find((x) => x.id === o.customer_id)!
    const lines = s.delivery_lines.filter((l) => l.delivery_id === d.id)
    const total = s.deliveries.filter((x) => x.sales_order_id === o.id && x.status !== 'cancelled').length
    return (
      <div key={d.id} className="task" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <div className="task-t">{d.number} <a className="small" href={`#orders-${o.id}`} style={{ fontWeight: 500 }}>{o.number}</a> {total > 1 && <Pill>Deellevering {d.sequence} van {total}</Pill>} {d.status === 'in_transit' && <Pill tone="info">Onderweg</Pill>}</div>
          <div className="small">{c.company || c.name}{o.fulfilment !== 'meenemen' ? `, ${o.delivery_address}, ${o.delivery_city}` : ''}{o.delivery_phone ? `, ${o.delivery_phone}` : ''}</div>
          <div className="muted small">{METHOD[d.method]}{d.carrier ? ` (${d.carrier})` : ''}{d.time_slot ? `, ${d.time_slot}` : ''}{o.needs_assembly ? ', montage' : ''}{o.floor ? `, ${o.floor}` : ''}{o.has_elevator ? ', lift' : ''}</div>
          <div className="small" style={{ marginTop: 5 }}>{lines.map((l) => {
            const sol = s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)!
            const have = hand.get(stockKey(sol.product_id, l.warehouse_id)) ?? 0
            return <div key={l.id}>{l.qty} × {sol.description} <span className="muted">uit {s.warehouses.find((w) => w.id === l.warehouse_id)?.name}</span>{have < l.qty && <span style={{ color: 'var(--bad)' }}> (maar {have} aanwezig)</span>}</div>
          })}</div>
        </div>
        <div className="actions">
          <button className="btn sm" onClick={() => setMove(d)}><CalendarClock size={14} />Verschuiven</button>
          {d.status === 'planned' && <button className="btn sm" onClick={() => run((db) => setDeliveryInTransit(db, d.id), `${d.number} is onderweg`)}><Truck size={14} />Onderweg</button>}
          <button className="btn sm primary" onClick={() => setFinish(d)}><CheckIcon size={14} />Geleverd</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <Head title="Levering aan klant" sub="De planning per dag, inclusief deelleveringen. Afmelden boekt de voorraad af en maakt de levering klaar om te factureren." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'planning', label: 'Planning', n: planning.length }, { value: 'done', label: 'Afgerond', n: done.length }]} />
      {tab === 'planning' && <div className="stack">
        {days.length === 0 && <section className="panel"><Empty>Er staat niets gepland. Plan een levering vanuit een order.</Empty></section>}
        {days.map((day) => (
          <section className="panel" key={day}>
            <div className="panel-head"><h2>{fmtShort(day)}</h2>{day < today ? <Pill tone="bad">Te laat</Pill> : day === today ? <Pill tone="warn">Vandaag</Pill> : null}</div>
            {planning.filter((d) => d.planned_date === day).map(card)}
          </section>
        ))}
      </div>}
      {tab === 'done' && <section className="panel">
        {done.length === 0 && <Empty>Nog geen afgeronde leveringen.</Empty>}
        {done.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>Levering</th><th>Order</th><th>Klant</th><th>Datum</th><th>Getekend door</th><th>Status</th></tr></thead>
          <tbody>{done.map((d) => {
            const o = s.sales_orders.find((x) => x.id === d.sales_order_id)!
            const c = s.customers.find((x) => x.id === o.customer_id)!
            return <tr key={d.id}><td className="strong">{d.number}</td><td><a className="rowlink" href={`#orders-${o.id}`}>{o.number}</a></td><td>{c.company || c.name}</td><td>{fmtDate(d.delivered_at ?? d.planned_date)}</td><td className="muted">{d.signed_by || '–'}</td><td>{d.status === 'delivered' ? <Pill tone="good">Geleverd</Pill> : <Pill>Geannuleerd</Pill>}</td></tr>
          })}</tbody>
        </table></div>}
      </section>}
      {finish && <FinishModal d={finish} onClose={() => setFinish(null)} />}
      {move && <MoveModal d={move} onClose={() => setMove(null)} />}
    </>
  )
}

function FinishModal({ d, onClose }: { d: Delivery; onClose: () => void }) {
  const { s, run } = useApp()
  const today = todayISO()
  const [date, setDate] = useState(today)
  const [signed, setSigned] = useState('')
  const auto = invoicesOnDelivery(s, d)
  const partial = isPartialDelivery(s, d)
  return (
    <Modal title={`${d.number} afmelden`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuleren</button>
      <button className="btn primary" onClick={async () => { if (await run((db) => markDelivered(db, d.id, { date, signed_by: signed }), auto ? 'Geleverd en gefactureerd' : 'Geleverd. Klaar om te factureren')) onClose() }}>Levering afmelden</button>
    </>}>
      <div className="form-grid">
        <TextField label="Geleverd op" type="date" value={date} onChange={setDate} />
        <TextField className="span-2" label="Getekend door" value={signed} onChange={setSigned} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>De voorraad wordt afgeboekt.{partial ? ' De factuur voor deze deellevering wordt direct gemaakt.' : auto ? ' De factuur wordt automatisch gemaakt.' : ''}</p>
    </Modal>
  )
}
function MoveModal({ d, onClose }: { d: Delivery; onClose: () => void }) {
  const { run } = useApp()
  const [date, setDate] = useState(d.planned_date)
  const [reason, setReason] = useState('')
  const [notified, setNotified] = useState(false)
  return (
    <Modal title={`${d.number} verschuiven`} onClose={onClose} footer={<>
      <button className="btn danger" onClick={async () => { if (await run((db) => cancelDelivery(db, d.id), 'Levering geannuleerd')) onClose() }}>Levering annuleren</button>
      <button className="btn" onClick={onClose}>Terug</button>
      <button className="btn primary" onClick={async () => { if (await run((db) => rescheduleDelivery(db, d.id, { new_date: date, reason, customer_notified: notified }), 'Levering verschoven')) onClose() }}>Datum opslaan</button>
    </>}>
      <div className="form-grid">
        <TextField label="Nieuwe datum" type="date" value={date} onChange={setDate} />
        <TextField className="span-2" label="Reden" value={reason} onChange={setReason} />
      </div>
      <Check label="Klant is geïnformeerd" checked={notified} onChange={setNotified} />
    </Modal>
  )
}
