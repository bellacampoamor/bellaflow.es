import { useState } from 'react'
import { CalendarClock, Check as CheckIcon, ChevronDown, ChevronUp, ClipboardCheck, FileText, Map as MapIcon, Route, Truck } from 'lucide-react'
import { geocodeAddress, travelMatrix, type TravelMatrix } from '../data/geo'
import type { Delivery, SalesOrder } from '../data/types'
import { deliveryIsOpen, invoicesOnDelivery, isPartialDelivery, onHandMap, stockKey, todayISO } from '../domain/calc'
import { googleMapsRouteUrl, MAPS_MAX_WAYPOINTS, optimizeRoute, tourCost, type Point } from '../domain/route'
import { cancelDelivery, markDelivered, markReady, rescheduleDelivery, saveRouteOrder, setDeliveryInTransit, setOrderCoordinates } from '../domain/services'
import { go, useApp } from '../ui/app-context'
import { Check, Empty, fmtDate, fmtShort, Head, Modal, Pill, Tabs, TextField } from '../ui/kit'

const METHOD = { meenemen: 'Klant haalt op', vervoerder: 'Vervoerder', eigen_team: 'Eigen team' }
const coords = (o: SalesOrder): Point | null => (o.delivery_latitude != null && o.delivery_longitude != null ? { latitude: o.delivery_latitude, longitude: o.delivery_longitude } : null)

/** Rekenresultaat per dag; de matrix blijft bewaard zodat handmatig schuiven de totalen bijwerkt. */
interface DayRoute { ids: string[]; matrix: TravelMatrix }

export function Deliveries() {
  const { s, run, toast } = useApp()
  const [tab, setTab] = useState<'planning' | 'done'>('planning')
  const [finish, setFinish] = useState<Delivery | null>(null)
  const [move, setMove] = useState<Delivery | null>(null)
  const [prepare, setPrepare] = useState<Delivery | null>(null)
  const [routes, setRoutes] = useState<Record<string, DayRoute>>({})
  const [busy, setBusy] = useState('')
  const [notFound, setNotFound] = useState<string[]>([])
  const [manual, setManual] = useState<Record<string, string>>({})
  const today = todayISO()
  const planning = s.deliveries.filter(deliveryIsOpen)
  const done = s.deliveries.filter((d) => d.status === 'delivered' || d.status === 'cancelled').sort((a, b) => (b.delivered_at ?? b.planned_date).localeCompare(a.delivered_at ?? a.planned_date))
  const days = [...new Set(planning.map((d) => d.planned_date))].sort()
  const hand = onHandMap(s)
  const origin = s.warehouses.find((w) => w.is_route_origin && w.latitude != null && w.longitude != null)
  const originPoint: Point | null = origin ? { latitude: origin.latitude!, longitude: origin.longitude! } : null
  const orderOf = (d: Delivery) => s.sales_orders.find((x) => x.id === d.sales_order_id)!

  const byPosition = (a: Delivery, b: Delivery) => (a.route_position ?? 999) - (b.route_position ?? 999) || a.number.localeCompare(b.number)
  const dayStops = (day: string) => planning.filter((d) => d.planned_date === day && d.method === 'eigen_team').sort(byPosition)

  const calculate = async (day: string) => {
    if (!originPoint) return toast('Stel onder Beheer een magazijn met coördinaten in als vertrekpunt.', true)
    setBusy(day)
    try {
      const stops = dayStops(day)
      const missing: string[] = []
      const points = new Map<string, Point>()
      // Eén adres tegelijk: de openbare adresservice staat niet meer dan één verzoek per seconde toe.
      for (const d of stops) {
        const o = orderOf(d)
        let p = coords(o)
        if (!p) {
          p = await geocodeAddress([o.delivery_address, o.delivery_postal_code, o.delivery_city].filter(Boolean).join(', '))
          if (p) await run((db) => setOrderCoordinates(db, o.id, p!.latitude, p!.longitude))
          else missing.push(o.id)
          await new Promise((r) => setTimeout(r, 1100))
        }
        if (p) points.set(d.id, p)
      }
      setNotFound(missing)
      const routable = stops.filter((d) => points.has(d.id))
      if (missing.length) toast(`${missing.length === 1 ? 'Eén adres is' : `${missing.length} adressen zijn`} niet gevonden. Vul de locatie handmatig in en bereken opnieuw.`, true)
      if (!routable.length) return
      const matrix = await travelMatrix([originPoint, ...routable.map((d) => points.get(d.id)!)])
      const order = optimizeRoute(matrix.minutes)
      const ids = order.map((i) => routable[i - 1].id)
      const rest = stops.filter((d) => !points.has(d.id)).map((d) => d.id)
      const ok = await run((db) => saveRouteOrder(db, [...ids, ...rest]), missing.length ? undefined : 'Rijvolgorde opgeslagen')
      if (ok) setRoutes((v) => ({ ...v, [day]: { ids: routable.map((d) => d.id), matrix } }))
    } finally { setBusy('') }
  }

  const shift = (day: string, id: string, dir: -1 | 1) => {
    const ids = dayStops(day).map((d) => d.id)
    const i = ids.indexOf(id), j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    void run((db) => saveRouteOrder(db, ids))
  }

  const summary = (day: string) => {
    const r = routes[day]
    if (!r) return null
    const ids = dayStops(day).map((d) => d.id).filter((id) => r.ids.includes(id))
    if (ids.length !== r.ids.length) return null
    const order = ids.map((id) => r.ids.indexOf(id) + 1)
    return { km: Math.round(tourCost(r.matrix.km, order)), min: Math.round(tourCost(r.matrix.minutes, order)), source: r.matrix.source }
  }
  const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} u ${m % 60} min` : `${m} min`)

  const renderCard = (d: Delivery, position?: { day: string; nr: number; last: boolean }) => {
    const o = orderOf(d)
    const c = s.customers.find((x) => x.id === o.customer_id)!
    const lines = s.delivery_lines.filter((l) => l.delivery_id === d.id)
    const total = s.deliveries.filter((x) => x.sales_order_id === o.id && x.status !== 'cancelled').length
    const needsNote = d.method !== 'meenemen'
    const card = (
      <div className="task" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <div className="task-t">{d.number} <a className="small" href={`#orders-${o.id}`} style={{ fontWeight: 500 }}>{o.number}</a> {total > 1 && <Pill>Deellevering {d.sequence} van {total}</Pill>}{' '}
            {d.status === 'ready' && <Pill tone="good">Klaargezet</Pill>} {d.status === 'in_transit' && <Pill tone="info">Onderweg</Pill>}{' '}
            {d.status !== 'planned' && needsNote && !d.note_printed_at && <Pill tone="warn">Bon nog niet afgedrukt</Pill>}
          </div>
          <div className="small">{c.company || c.name}{o.fulfilment !== 'meenemen' ? `, ${o.delivery_address}, ${o.delivery_city}` : ''}{o.delivery_phone ? `, ${o.delivery_phone}` : ''}</div>
          <div className="muted small">{METHOD[d.method]}{d.carrier && d.carrier !== METHOD[d.method] ? ` (${d.carrier})` : ''}{d.time_slot ? `, ${d.time_slot}` : ''}{o.needs_assembly ? ', montage' : ''}{o.floor ? `, ${o.floor}` : ''}{o.has_elevator ? ', lift' : ''}</div>
          <div className="small" style={{ marginTop: 5 }}>{lines.map((l) => {
            const sol = s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)!
            const have = hand.get(stockKey(sol.product_id, l.warehouse_id)) ?? 0
            return <div key={l.id}>{l.qty} × {sol.description} <span className="muted">uit {s.warehouses.find((w) => w.id === l.warehouse_id)?.name}</span>{have < l.qty && <span style={{ color: 'var(--bad)' }}> (maar {have} aanwezig)</span>}</div>
          })}</div>
          {notFound.includes(o.id) && (
            <div className="btn-row" style={{ marginTop: 6, alignItems: 'center' }}>
              <span className="small" style={{ color: 'var(--bad)' }}>Adres niet gevonden.</span>
              <input style={{ maxWidth: 210, minHeight: 30 }} aria-label={`Locatie voor ${d.number}`} placeholder="37.9113, -0.7436" value={manual[o.id] ?? ''} onChange={(e) => setManual((v) => ({ ...v, [o.id]: e.target.value }))} />
              <button className="btn sm" onClick={async () => {
                const [a, b] = (manual[o.id] ?? '').split(',').map((x) => Number(x.trim()))
                if (await run((db) => setOrderCoordinates(db, o.id, a, b), 'Locatie opgeslagen')) setNotFound((v) => v.filter((x) => x !== o.id))
              }}>Locatie opslaan</button>
            </div>
          )}
        </div>
        <div className="btn-row">
          <button className="btn sm" onClick={() => setMove(d)}><CalendarClock size={14} />Verschuiven</button>
          {d.status !== 'planned' && needsNote && <a className="btn sm" href={`#levering-${d.id}`}><FileText size={14} />Afleverbon</a>}
          {d.status === 'planned' && needsNote && <button className="btn sm primary" onClick={() => setPrepare(d)}><ClipboardCheck size={14} />Klaarzetten</button>}
          {d.status === 'ready' && needsNote && <button className="btn sm" onClick={() => run((db) => setDeliveryInTransit(db, d.id), `${d.number} is onderweg`)}><Truck size={14} />Onderweg</button>}
          {(d.status !== 'planned' || !needsNote) && <button className="btn sm primary" onClick={() => setFinish(d)}><CheckIcon size={14} />Geleverd</button>}
        </div>
      </div>
    )
    if (!position) return <div key={d.id}>{card}</div>
    return (
      <div className="stop" key={d.id}>
        <div className="stop-nr">
          <button className="btn icon" aria-label={`${d.number} eerder in de route`} disabled={position.nr === 1} onClick={() => shift(position.day, d.id, -1)}><ChevronUp size={16} /></button>
          <b>{position.nr}</b>
          <button className="btn icon" aria-label={`${d.number} later in de route`} disabled={position.last} onClick={() => shift(position.day, d.id, 1)}><ChevronDown size={16} /></button>
        </div>
        {card}
      </div>
    )
  }

  return (
    <>
      <Head title="Levering aan klant" sub="Plan per dag de beste rijroute, zet de order klaar en druk de afleverbon af. De klant tekent bij aflevering voor ontvangst." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'planning', label: 'Planning', n: planning.length }, { value: 'done', label: 'Afgerond', n: done.length }]} />
      {tab === 'planning' && <div className="stack">
        {days.length === 0 && <section className="panel"><Empty>Er staat niets gepland. Plan een levering vanuit een order.</Empty></section>}
        {days.map((day) => {
          const stops = dayStops(day)
          const others = planning.filter((d) => d.planned_date === day && d.method !== 'eigen_team').sort(byPosition)
          const sum = summary(day)
          const mapPoints = stops.map((d) => coords(orderOf(d))).filter(Boolean) as Point[]
          const positioned = stops.some((d) => d.route_position != null)
          return (
            <section className="panel" key={day}>
              <div className="panel-head"><h2>{fmtShort(day)}</h2>{day < today ? <Pill tone="bad">Te laat</Pill> : day === today ? <Pill tone="warn">Vandaag</Pill> : null}</div>
              {stops.length > 0 && (
                <div className="route-bar">
                  <div>
                    <strong>Eigen team: {stops.length} {stops.length === 1 ? 'stop' : 'stops'}</strong>, heen en terug vanaf {origin?.name ?? 'magazijn (nog in te stellen)'}
                    {sum && <div className="small">{sum.km} km, {hours(sum.min)} rijden{sum.source === 'schatting' ? ', geschat: de routeservice was niet bereikbaar' : ''}. Tijd bij de klant niet meegerekend.</div>}
                    {positioned && stops.some((d) => d.time_slot) && <div className="small muted">De volgorde houdt geen rekening met tijdvakken.</div>}
                  </div>
                  <div className="btn-row">
                    {originPoint && mapPoints.length > 0 && mapPoints.length <= MAPS_MAX_WAYPOINTS && <a className="btn sm" href={googleMapsRouteUrl(originPoint, mapPoints)} target="_blank" rel="noreferrer"><MapIcon size={14} />Open in Google Maps</a>}
                    <button className="btn sm primary" disabled={busy === day} onClick={() => calculate(day)}><Route size={14} />{busy === day ? 'Route berekenen…' : 'Beste route berekenen'}</button>
                  </div>
                </div>
              )}
              {stops.map((d, i) => renderCard(d, { day, nr: i + 1, last: i === stops.length - 1 }))}
              {others.map((d) => renderCard(d))}
            </section>
          )
        })}
      </div>}
      {tab === 'done' && <section className="panel">
        {done.length === 0 && <Empty>Nog geen afgeronde leveringen.</Empty>}
        {done.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>Levering</th><th>Order</th><th>Klant</th><th>Datum</th><th>Getekend door</th><th>Bon</th><th>Status</th></tr></thead>
          <tbody>{done.map((d) => {
            const o = orderOf(d)
            const c = s.customers.find((x) => x.id === o.customer_id)!
            return <tr key={d.id}><td className="strong">{d.number}</td><td><a className="rowlink" href={`#orders-${o.id}`}>{o.number}</a></td><td>{c.company || c.name}</td><td>{fmtDate(d.delivered_at ?? d.planned_date)}</td><td className="muted">{d.signed_by || '–'}</td>
              <td>{d.method !== 'meenemen' && d.status === 'delivered' ? <a className="small" href={`#levering-${d.id}`}>{d.signed_note_received ? 'Getekend retour' : 'Nog niet retour'}</a> : '–'}</td>
              <td>{d.status === 'delivered' ? <Pill tone="good">Geleverd</Pill> : <Pill>Geannuleerd</Pill>}</td></tr>
          })}</tbody>
        </table></div>}
      </section>}
      {prepare && <PrepareModal d={prepare} onClose={() => setPrepare(null)} />}
      {finish && <FinishModal d={finish} onClose={() => setFinish(null)} />}
      {move && <MoveModal d={move} onClose={() => setMove(null)} />}
    </>
  )
}

function PrepareModal({ d, onClose }: { d: Delivery; onClose: () => void }) {
  const { s, run } = useApp()
  const lines = s.delivery_lines.filter((l) => l.delivery_id === d.id)
  const hand = onHandMap(s)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [approver, setApprover] = useState('')
  const all = lines.every((l) => checked[l.id])
  return (
    <Modal title={`${d.number} klaarzetten`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuleren</button>
      <button className="btn primary" disabled={!all} onClick={async () => {
        if (await run((db) => markReady(db, d.id, { approved_by: approver, date: todayISO() }), 'Akkoord. Druk nu de afleverbon af')) { onClose(); go(`levering-${d.id}`) }
      }}>Akkoord en naar afleverbon</button>
    </>}>
      <p className="small muted" style={{ margin: 0 }}>Vink af wat klaarstaat en is gecontroleerd.</p>
      <div className="stack" style={{ gap: 2 }}>{lines.map((l) => {
        const sol = s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)!
        const have = hand.get(stockKey(sol.product_id, l.warehouse_id)) ?? 0
        return <Check key={l.id} checked={!!checked[l.id]} onChange={(v) => setChecked((c) => ({ ...c, [l.id]: v }))}
          label={`${l.qty} × ${sol.description}${sol.options ? ` (${sol.options})` : ''}, ${s.warehouses.find((w) => w.id === l.warehouse_id)?.name}: ${have} aanwezig`} />
      })}</div>
      <TextField label="Akkoord bevonden door" value={approver} onChange={setApprover} />
    </Modal>
  )
}

function FinishModal({ d, onClose }: { d: Delivery; onClose: () => void }) {
  const { s, run } = useApp()
  const [date, setDate] = useState(todayISO())
  const [signed, setSigned] = useState('')
  const [received, setReceived] = useState(false)
  const auto = invoicesOnDelivery(s, d)
  const partial = isPartialDelivery(s, d)
  const needsNote = d.method !== 'meenemen'
  return (
    <Modal title={`${d.number} afmelden`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuleren</button>
      <button className="btn primary" onClick={async () => { if (await run((db) => markDelivered(db, d.id, { date, signed_by: signed, signed_note_received: received }), auto ? 'Geleverd en gefactureerd' : 'Geleverd. Klaar om te factureren')) onClose() }}>Levering afmelden</button>
    </>}>
      <div className="form-grid">
        <TextField label="Geleverd op" type="date" value={date} onChange={setDate} />
        <TextField className="span-2" label={needsNote ? 'Afleverbon ondertekend door' : 'Opgehaald door'} value={signed} onChange={setSigned} />
      </div>
      {needsNote && <Check label="Getekende afleverbon is terug op kantoor" checked={received} onChange={setReceived} />}
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
