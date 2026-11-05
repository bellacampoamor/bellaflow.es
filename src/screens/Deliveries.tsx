import { useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { CalendarClock, Check as CheckIcon, ChevronDown, ChevronUp, ClipboardCheck, FileText, GripVertical, Map as MapIcon, PackageCheck, Route, Smartphone, Truck } from 'lucide-react'
import { geocodeAddress, travelMatrix, type TravelMatrix } from '../data/geo'
import type { Delivery, SalesOrder } from '../data/types'
import { articleNo, deliveryIsOpen, onHandMap, stockKey, todayISO } from '../domain/calc'
import { googleMapsRouteUrl, MAPS_MAX_WAYPOINTS, optimizeRoute, tourCost, type Point } from '../domain/route'
import { cancelDelivery, markDeliveriesReady, markDelivered, rescheduleDelivery, saveRouteOrder, setDeliveryInTransit, setOrderCoordinates } from '../domain/services'
import { go, useApp } from '../ui/app-context'
import { useRouteDrag } from '../ui/useRouteDrag'
import { Check, Empty, fmtDate, fmtShort, Head, Modal, Pill, Tabs, TextField, pickRow, PickMark } from '../ui/kit'
import { tx } from '../i18n'

const METHOD = { meenemen: 'Klant haalt op', vervoerder: 'Vervoerder' }
const coords = (o: SalesOrder): Point | null => (o.delivery_latitude != null && o.delivery_longitude != null ? { latitude: o.delivery_latitude, longitude: o.delivery_longitude } : null)/** Rekenresultaat per dag; de matrix blijft bewaard zodat handmatig schuiven de totalen bijwerkt. */

/** Rekenresultaat per dag; de matrix blijft bewaard zodat handmatig schuiven de totalen bijwerkt. */
interface DayRoute { ids: string[]; matrix: TravelMatrix }

export function Deliveries() {
  const { s, run, toast } = useApp()
  const [tab, setTab] = useState<'planning' | 'done'>('planning')
  const [finish, setFinish] = useState<Delivery | null>(null)
  const [move, setMove] = useState<Delivery | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [preparing, setPreparing] = useState(false)
  // Na slepen in de route telt de klik niet als selectie.
  const pressY = useRef(0)
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

  const { begin, rowState } = useRouteDrag((_day, ids) => run((db) => saveRouteOrder(db, ids)))

  const calculate = async (day: string) => {
    if (!originPoint) return toast(tx("Stel onder Beheer een magazijn met coördinaten in als vertrekpunt."), true)
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
      if (missing.length) toast(tx("{0} niet gevonden. Vul de locatie handmatig in en bereken opnieuw.", missing.length === 1 ? tx("Eén adres is") : tx("{0} adressen zijn", missing.length)), true)
      if (!routable.length) return
      const matrix = await travelMatrix([originPoint, ...routable.map((d) => points.get(d.id)!)])
      const order = optimizeRoute(matrix.minutes)
      const ids = order.map((i) => routable[i - 1].id)
      const rest = stops.filter((d) => !points.has(d.id)).map((d) => d.id)
      const ok = await run((db) => saveRouteOrder(db, [...ids, ...rest]), missing.length ? undefined : tx("Rijvolgorde opgeslagen"))
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
  const hours = (m: number) => (m >= 60 ? tx("{0} u {1} min", Math.floor(m / 60), m % 60) : tx("{0} min", m))

  const digital = s.settings[0]?.delivery_note_mode === 'digitaal'
  const usesApp = (d: Delivery) => digital && d.method === 'eigen_team'
  const canPrepare = (d: Delivery) => d.status === 'planned' && d.method !== 'meenemen'
  const chosen = planning.filter((d) => canPrepare(d) && picked.has(d.id)).sort((a, b) => a.planned_date.localeCompare(b.planned_date) || byPosition(a, b))
  const togglePick = (id: string) => setPicked((v) => { const n = new Set(v); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const pickProps = (d: Delivery) => {
    if (!canPrepare(d)) return { className: '' }
    const props = pickRow(picked.has(d.id), () => togglePick(d.id), 'pick-card')
    return {
      ...props,
      onPointerDownCapture: (e: PointerEvent<HTMLElement>) => { pressY.current = e.clientY },
      onClick: (e: MouseEvent<HTMLElement>) => { if (Math.abs(e.clientY - pressY.current) < 5) props.onClick(e) },
    }
  }

  const renderCard = (d: Delivery, position?: { day: string; index: number; ids: string[] }) => {
    const o = orderOf(d)
    const c = s.customers.find((x) => x.id === o.customer_id)!
    const lines = s.delivery_lines.filter((l) => l.delivery_id === d.id)
    const total = s.deliveries.filter((x) => x.sales_order_id === o.id && x.status !== 'cancelled').length
    const needsNote = d.method !== 'meenemen'
    const card = (
      <div className="task" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <div className="task-t">{picked.has(d.id) && canPrepare(d) && <CheckIcon size={15} style={{ verticalAlign: -2, marginRight: 4 }} />}{d.number} <a className="small" href={`#orders-${o.id}`} style={{ fontWeight: 500 }}>{o.number}</a> {total > 1 && <Pill>{tx("Deellevering")} {d.sequence} {tx("van")} {total}</Pill>}{' '}
            {d.status === 'ready' && <Pill tone="good">{tx("Klaargezet")}</Pill>} {d.status === 'in_transit' && <Pill tone="info">{tx("Onderweg")}</Pill>}{' '}
            {d.status !== 'planned' && needsNote && !usesApp(d) && !d.note_printed_at && <Pill tone="warn">{tx("Bon nog niet afgedrukt")}</Pill>}
          </div>
          <div className="small">{c.company || c.name}{o.fulfilment !== 'meenemen' ? `, ${o.delivery_address}, ${o.delivery_city}` : ''}{o.delivery_phone ? `, ${o.delivery_phone}` : ''}</div>
          <div className="muted small">{[
            d.method !== 'eigen_team' ? tx(METHOD[d.method]) + (d.carrier && d.carrier !== METHOD[d.method] ? ` (${d.carrier})` : '') : '',
            o.needs_assembly ? tx("montage") : '', o.floor, o.has_elevator ? tx("lift") : '',
          ].filter(Boolean).join(', ')}</div>
          <div className="small" style={{ marginTop: 5 }}>{lines.map((l) => {
            const sol = s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)!
            const have = hand.get(stockKey(sol.product_id, l.warehouse_id)) ?? 0
            return <div key={l.id}>{l.qty} {tx("×")} {sol.description} <span className="sku inline">{articleNo(s, sol.product_id)}</span> <span className="muted">{tx("uit")} {s.warehouses.find((w) => w.id === l.warehouse_id)?.name}</span>{have < l.qty && <span style={{ color: 'var(--bad)' }}> {tx("(maar")} {have} {tx("aanwezig)")}</span>}</div>
          })}</div>
          {notFound.includes(o.id) && (
            <div className="btn-row" style={{ marginTop: 6, alignItems: 'center' }}>
              <span className="small" style={{ color: 'var(--bad)' }}>{tx("Adres niet gevonden.")}</span>
              <input style={{ maxWidth: 210, minHeight: 30 }} aria-label={tx("Locatie voor {0}", d.number)} placeholder="37.9113, -0.7436" value={manual[o.id] ?? ''} onChange={(e) => setManual((v) => ({ ...v, [o.id]: e.target.value }))} />
              <button className="btn sm" onClick={async () => {
                const [a, b] = (manual[o.id] ?? '').split(',').map((x) => Number(x.trim()))
                if (await run((db) => setOrderCoordinates(db, o.id, a, b), tx("Locatie opgeslagen"))) setNotFound((v) => v.filter((x) => x !== o.id))
              }}>{tx("Locatie opslaan")}</button>
            </div>
          )}
        </div>
        <div className="btn-row">
          <button className="btn sm" onClick={() => setMove(d)}><CalendarClock size={14} />{tx("Verschuiven")}</button>
          {d.status !== 'planned' && needsNote && <a className="btn sm" href={`#levering-${d.id}`}><FileText size={14} />{tx("Afleverbon")}</a>}
          {d.status === 'ready' && needsNote && !usesApp(d) && <button className="btn sm" onClick={() => run((db) => setDeliveryInTransit(db, d.id), tx("{0} is onderweg", d.number))}><Truck size={14} />{tx("Onderweg")}</button>}
          {(d.status !== 'planned' || !needsNote) && <button className="btn sm primary" onClick={() => setFinish(d)}><PackageCheck size={14} />{tx("Afmelden als geleverd")}</button>}
        </div>
      </div>
    )
    const pick = pickProps(d)
    if (!position) return <div key={d.id} {...pick}>{card}</div>
    const { day, index, ids } = position
    const row = rowState(day, d.id, index)
    return (
      <div {...pick} className={`stop${row.dragging ? ' dragging' : ''}${row.active ? ' shifting' : ''}${pick.className ? ` ${pick.className}` : ''}`} key={d.id} style={row.active ? { transform: `translateY(${row.y}px)` } : undefined} onPointerDown={(e) => begin(e, day, d.id, ids)}>
        {ids.length > 1 && <span className="stop-grip" title={tx("Sleep om de volgorde in de route te wijzigen")} aria-hidden="true"><GripVertical size={16} /></span>}
        <div className="stop-nr">
          <button className="btn icon" aria-label={tx("{0} eerder in de route", d.number)} disabled={index === 0} onClick={() => shift(day, d.id, -1)}><ChevronUp size={16} /></button>
          <b>{row.nr}</b>
          <button className="btn icon" aria-label={tx("{0} later in de route", d.number)} disabled={index === ids.length - 1} onClick={() => shift(day, d.id, 1)}><ChevronDown size={16} /></button>
        </div>
        {card}
      </div>
    )
  }

  return (
    <>
      <Head title={tx("Levering aan klant")} sub={tx("Plan per dag de beste rijroute, zet de verkooporder klaar en druk de afleverbon af. De klant tekent bij aflevering voor ontvangst.")} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'planning', label: tx("Planning"), n: planning.length }, { value: 'done', label: tx("Afgerond"), n: done.length }]} />
      {tab === 'planning' && <div className="stack">
        {days.length === 0 && <section className="panel"><Empty>{tx("Er staat niets gepland. Plan een levering vanuit een verkooporder.")}</Empty></section>}
        {days.map((day) => {
          const stops = dayStops(day)
          const others = planning.filter((d) => d.planned_date === day && d.method !== 'eigen_team').sort(byPosition)
          const sum = summary(day)
          const selectable = [...stops, ...others].filter(canPrepare)
          const allPicked = selectable.length > 0 && selectable.every((d) => picked.has(d.id))
          const mapPoints = stops.map((d) => coords(orderOf(d))).filter(Boolean) as Point[]
          return (
            <section className="panel" key={day}>
              <div className="panel-head"><h2>{fmtShort(day)}</h2><div className="btn-row" style={{ alignItems: 'center' }}>{day < today ? <Pill tone="bad">{tx("Te laat")}</Pill> : day === today ? <Pill tone="warn">{tx("Vandaag")}</Pill> : null}{selectable.length > 0 && <button className="btn sm" onClick={() => setPicked((v) => { const n = new Set(v); for (const d of selectable) { if (allPicked) n.delete(d.id); else n.add(d.id) } return n })}>{allPicked ? tx("Niets selecteren") : tx("Alles selecteren")}</button>}</div></div>
              {stops.length > 0 && (
                <div className="route-bar">
                  <div>
                    <strong>{tx("Bezorgroute:")} {stops.length} {stops.length === 1 ? 'stop' : 'stops'}</strong>{tx(", heen en terug vanaf")} {origin?.name ?? tx("magazijn (nog in te stellen)")}
                    {sum && <div className="small">{sum.km} {tx("km,")} {hours(sum.min)} {tx("rijden")}{sum.source === 'schatting' ? tx(", geschat: de routeservice was niet bereikbaar") : ''}{tx(". Tijd bij de klant niet meegerekend.")}</div>}
                  </div>
                  <div className="btn-row">
                    {digital && <a className="btn sm" href="#chauffeur"><Smartphone size={14} />{tx("Chauffeursapp")}</a>}
                    {originPoint && mapPoints.length > 0 && mapPoints.length <= MAPS_MAX_WAYPOINTS && <a className="btn sm" href={googleMapsRouteUrl(originPoint, mapPoints)} target="_blank" rel="noreferrer"><MapIcon size={14} />{tx("Open in Google Maps")}</a>}
                    <button className="btn sm primary" disabled={busy === day} onClick={() => calculate(day)}><Route size={14} />{busy === day ? tx("Route berekenen…") : tx("Beste route berekenen")}</button>
                  </div>
                </div>
              )}
              <div className="stops">{stops.map((d, i) => renderCard(d, { day, index: i, ids: stops.map((x) => x.id) }))}</div>
              {others.map((d) => renderCard(d))}
            </section>
          )
        })}
        {planning.some(canPrepare) && <div className="queue-bar panel-bar">
          <span>{chosen.length ? tx("{0} geselecteerd", chosen.length) : tx("Klik op een levering om die te selecteren.")}</span>
          <button className="btn primary" disabled={!chosen.length} onClick={() => setPreparing(true)}><ClipboardCheck size={16} />{tx("Klaarzetten")}{chosen.length ? ` (${chosen.length})` : ''}</button>
        </div>}
      </div>}
      {tab === 'done' && <section className="panel">
        {done.length === 0 && <Empty>{tx("Nog geen afgeronde leveringen.")}</Empty>}
        {done.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>{tx("Levering")}</th><th>{tx("Verkooporder")}</th><th>{tx("Klant")}</th><th>{tx("Datum")}</th><th>{tx("Getekend door")}</th><th>{tx("Bon")}</th><th>{tx("Status")}</th></tr></thead>
          <tbody>{done.map((d) => {
            const o = orderOf(d)
            const c = s.customers.find((x) => x.id === o.customer_id)!
            return <tr key={d.id}><td className="strong">{d.number}</td><td><a className="rowlink" href={`#orders-${o.id}`}>{o.number}</a></td><td>{c.company || c.name}</td><td>{fmtDate(d.delivered_at ?? d.planned_date)}</td><td className="muted">{d.signed_by || '–'}</td>
              <td>{d.method !== 'meenemen' && d.status === 'delivered' ? <a className="small" href={`#levering-${d.id}`}>{d.signature_data ? tx("Digitaal getekend") : d.signed_note_received ? tx("Getekend retour") : tx("Nog niet retour")}</a> : '–'}</td>
              <td>{d.status === 'delivered' ? <Pill tone="good">{tx("Geleverd")}</Pill> : <Pill>{tx("Geannuleerd")}</Pill>}</td></tr>
          })}</tbody>
        </table></div>}
      </section>}
      {preparing && <PrepareModal deliveries={chosen} onClose={() => setPreparing(false)} onDone={() => setPicked(new Set())} />}
      {finish && <FinishModal d={finish} onClose={() => setFinish(null)} />}
      {move && <MoveModal d={move} onClose={() => setMove(null)} />}
    </>
  )
}

function PrepareModal({ deliveries, onClose, onDone }: { deliveries: Delivery[]; onClose: () => void; onDone: () => void }) {
  const { s, run } = useApp()
  const digitalMode = s.settings[0]?.delivery_note_mode === 'digitaal'
  const usesApp = (d: Delivery) => digitalMode && d.method === 'eigen_team'
  const groups = deliveries.map((d) => ({ d, lines: s.delivery_lines.filter((l) => l.delivery_id === d.id) }))
  const lineIds = groups.flatMap((g) => g.lines.map((l) => l.id))
  const hand = onHandMap(s)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [approver, setApprover] = useState('')
  const all = lineIds.every((id) => checked[id])
  const single = deliveries.length === 1 ? deliveries[0] : null
  const allDigital = deliveries.every(usesApp)
  const confirm = async () => {
    const done = allDigital ? (single ? tx("Klaargezet. De bezorging staat klaar in de chauffeursapp") : tx("{0} klaargezet. De bezorgingen staan klaar in de chauffeursapp", deliveries.length))
      : single ? tx("Akkoord. Druk nu de afleverbon af") : tx("{0} klaargezet. Druk nu de afleverbonnen af", deliveries.length)
    if (!await run((db) => markDeliveriesReady(db, deliveries.map((d) => d.id), { approved_by: approver, date: todayISO() }), done)) return
    onDone(); onClose()
    if (single && !allDigital) go(`levering-${single.id}`)
  }
  return (
    <Modal wide={!single} title={single ? tx("{0} klaarzetten", single.number) : tx("{0} leveringen klaarzetten", deliveries.length)} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx("Annuleren")}</button>
      <button className="btn primary" disabled={!all} onClick={confirm}>{single && !allDigital ? tx("Akkoord en naar afleverbon") : tx("Akkoord")}</button>
    </>}>
      <div className="panel-head" style={{ margin: 0 }}>
        <p className="small muted" style={{ margin: 0 }}>{tx("Klik op de regels die klaarstaan en zijn gecontroleerd.")}</p>
        {lineIds.length > 1 && <button className="btn sm" onClick={() => setChecked(all ? {} : Object.fromEntries(lineIds.map((id) => [id, true])))}>{all ? tx("Niets selecteren") : tx("Alles selecteren")}</button>}
      </div>
      <div className="table-wrap flush convert-list"><table className="queue">{groups.map(({ d, lines }) => {
        const o = s.sales_orders.find((x) => x.id === d.sales_order_id)
        const c = s.customers.find((x) => x.id === o?.customer_id)
        return <tbody key={d.id}>
          {!single && <tr className="queue-head"><td colSpan={2}><span className="strong">{d.number}</span> <span className="muted small">{o?.number}, {c?.company || c?.name}</span></td></tr>}
          {lines.map((l) => {
            const sol = s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)!
            const have = hand.get(stockKey(sol.product_id, l.warehouse_id)) ?? 0
            return <tr key={l.id} {...pickRow(!!checked[l.id], () => setChecked((v) => ({ ...v, [l.id]: !v[l.id] })))}><td>{tx("{0} × {1}{2}, {3}: {4} aanwezig", l.qty, `${articleNo(s, sol.product_id)} ${sol.description}`.trim(), sol.options ? ` (${sol.options})` : '', s.warehouses.find((w) => w.id === l.warehouse_id)?.name, have)}</td><PickMark on={!!checked[l.id]} /></tr>
          })}
        </tbody>
      })}</table></div>
      <TextField label={tx("Akkoord bevonden door")} value={approver} onChange={setApprover} />
    </Modal>
  )
}

function FinishModal({ d, onClose }: { d: Delivery; onClose: () => void }) {
  const { s, run } = useApp()
  const [date, setDate] = useState(todayISO())
  const [signed, setSigned] = useState('')
  const [received, setReceived] = useState(false)
  const needsNote = d.method !== 'meenemen'
  return (
    <Modal title={tx("{0} afmelden", d.number)} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx("Annuleren")}</button>
      <button className="btn primary" onClick={async () => { if (await run((db) => markDelivered(db, d.id, { date, signed_by: signed, signed_note_received: received }), tx("Geleverd. De proforma staat klaar onder Facturatie"))) onClose() }}>{tx("Levering afmelden")}</button>
    </>}>
      <div className="form-grid">
        <TextField label={tx("Geleverd op")} type="date" value={date} onChange={setDate} />
        <TextField className="span-2" label={needsNote ? tx("Afleverbon ondertekend door") : tx("Opgehaald door")} value={signed} onChange={setSigned} />
      </div>
      {needsNote && <Check label={tx("Getekende afleverbon is terug op kantoor")} checked={received} onChange={setReceived} />}
      <p className="small muted" style={{ margin: 0 }}>{tx("De voorraad wordt afgeboekt en er komt een proforma klaar te staan onder Facturatie.")}</p>
    </Modal>
  )
}

function MoveModal({ d, onClose }: { d: Delivery; onClose: () => void }) {
  const { run } = useApp()
  const [date, setDate] = useState(d.planned_date)
  const [reason, setReason] = useState('')
  const [notified, setNotified] = useState(false)
  return (
    <Modal title={tx("{0} verschuiven", d.number)} onClose={onClose} footer={<>
      <button className="btn danger" onClick={async () => { if (await run((db) => cancelDelivery(db, d.id), tx("Levering geannuleerd"))) onClose() }}>{tx("Levering annuleren")}</button>
      <button className="btn" onClick={onClose}>{tx("Terug")}</button>
      <button className="btn primary" onClick={async () => { if (await run((db) => rescheduleDelivery(db, d.id, { new_date: date, reason, customer_notified: notified }), tx("Levering verschoven"))) onClose() }}>{tx("Datum opslaan")}</button>
    </>}>
      <div className="form-grid">
        <TextField label={tx("Nieuwe datum")} type="date" value={date} onChange={setDate} />
        <TextField className="span-2" label={tx("Reden")} value={reason} onChange={setReason} />
      </div>
      <Check label={tx("Klant is geïnformeerd")} checked={notified} onChange={setNotified} />
    </Modal>
  )
}
