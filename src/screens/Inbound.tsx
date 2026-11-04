import { useState } from 'react'
import { Plus, Truck } from 'lucide-react'
import type { InboundShipment, Snapshot, Transport } from '../data/types'
import { addDays, ordersAffectedByShipment, purchaseKind, shipmentIsOpen, shipmentLoad, shipmentOpenQty, todayISO, transportLoad } from '../domain/calc'
import { assignShipmentToTransport, cancelTransport, closeShipment, createTransport, rescheduleShipment, setShipmentWarehouse, setTransportStatus, updateTransport, type TransportInput } from '../domain/services'
import { tx } from '../i18n'
import { useApp } from '../ui/app-context'
import { AreaField, Empty, fmtDate, fmtShort, Head, Modal, NumberField, Pill, Tabs, TextField, type Tone } from '../ui/kit'
import { KindPill, ShipmentPill } from './Purchases'

const DEFAULT_CAPACITY = 90
const TRANSPORT_STATE: Record<Transport['status'], [string, Tone]> = { planned: ['Laden', 'sell'], departed: ['Onderweg', 'info'], arrived: ['Aangekomen', 'good'], cancelled: ['Geannuleerd', ''] }

type Tab = 'transport' | 'open' | 'done'

function FillBar({ used, capacity }: { used: number; capacity: number }) {
  if (!capacity) return null
  const pct = Math.min(100, (used / capacity) * 100)
  const over = used > capacity
  return (
    <div>
      <div className="fill" role="img" aria-label={tx("{0} van {1} m³ gevuld", used, capacity)}><span style={{ width: `${pct}%`, background: over ? 'var(--bad)' : 'var(--primary)' }} /></div>
      <div className="small" style={over ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>
        {over ? tx("{0} van {1} m³: {2} m³ te veel", used, capacity, Math.round((used - capacity) * 10) / 10) : tx("{0} van {1} m³, nog {2} m³ vrij", used, capacity, Math.round((capacity - used) * 10) / 10)}
      </div>
    </div>
  )
}

const supplierOf = (s: Snapshot, x: InboundShipment) => {
  const po = s.purchase_orders.find((p) => p.id === x.purchase_order_id)!
  return { po, supplier: s.suppliers.find((y) => y.id === po.supplier_id)?.name }
}

export function Inbound() {
  const { s, run } = useApp()
  const [tab, setTab] = useState<Tab>('transport')
  const [move, setMove] = useState<InboundShipment | null>(null)
  const [close, setClose] = useState<InboundShipment | null>(null)
  const [edit, setEdit] = useState<(TransportInput & { id?: string }) | null>(null)
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const today = todayISO()
  const open = s.inbound_shipments.filter(shipmentIsOpen).sort((a, b) => a.expected_date.localeCompare(b.expected_date))
  const done = s.inbound_shipments.filter((x) => !shipmentIsOpen(x)).sort((a, b) => b.expected_date.localeCompare(a.expected_date))
  const rows = tab === 'open' ? open : done
  const affected = move ? ordersAffectedByShipment(s, move.id) : []
  const active = s.transports.filter((t) => t.status === 'planned' || t.status === 'departed').sort((a, b) => a.departure_date.localeCompare(b.departure_date))
  const planned = active.filter((t) => t.status === 'planned')
  const unassigned = open.filter((x) => !x.transport_id)
  const receivers = s.warehouses.filter((w) => w.is_active && w.receives_goods)

  const newTransport = () => {
    const last = [...s.transports].filter((t) => t.status !== 'cancelled').sort((a, b) => b.departure_date.localeCompare(a.departure_date))[0]
    const dep = last && last.departure_date >= today ? addDays(last.departure_date, 7) : addDays(today, 7)
    setEdit({ departure_date: dep, arrival_date: addDays(dep, 3), carrier: last?.carrier ?? '', reference: '', capacity_m3: last?.capacity_m3 ?? DEFAULT_CAPACITY, notes: '' })
  }

  return (
    <>
      <Head title={tx("Gepland transport")} sub={tx("Er wordt elke dag ingekocht en het transport rijdt ongeveer één keer per week. Koppel inkopen aan een vrachtwagen en vul hem af met vulorders voordat hij vertrekt.")}>
        <button className="btn" onClick={newTransport}><Plus size={16} />{tx("Nieuw transport")}</button>
        <a className="btn primary" href={planned[0] ? `#inkoop-nieuw-${planned[0].id}` : '#inkoop-nieuw'}><Plus size={16} />{tx("Vulorder maken")}</a>
      </Head>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: 'transport', label: tx("Transporten"), n: active.length }, { value: 'open', label: tx("Alle open zendingen"), n: open.length }, { value: 'done', label: tx("Afgerond"), n: done.length }]} />

      {tab === 'transport' && <div className="stack">
        {unassigned.length > 0 && (
          <section className="panel">
            <h2>{tx("Ingekocht, nog zonder transport")}</h2>
            {unassigned.map((x) => {
              const { po, supplier } = supplierOf(s, x)
              const load = shipmentLoad(s, x.id)
              return (
                <div className="task" key={x.id} style={{ flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 280px' }}>
                    <div className="task-t"><a className="rowlink" href={`#inkoop-${po.id}`}>{po.number}</a> <KindPill kind={purchaseKind(s, po.id)} /></div>
                    <div className="muted small">{tx("{0}, {1} colli, {2} m³, naar {3}", supplier, load.colli, Math.round(load.m3 * 10) / 10, s.warehouses.find((w) => w.id === x.warehouse_id)?.name)}</div>
                  </div>
                  <select style={{ maxWidth: 260 }} aria-label={tx("Transport voor {0}", po.number)} value="" onChange={(e) => e.target.value && run((db) => assignShipmentToTransport(db, x.id, e.target.value), tx("Gekoppeld aan transport"))}>
                    <option value="">{tx("Koppelen aan transport")}</option>
                    {planned.map((t) => <option key={t.id} value={t.id}>{tx("{0}, vertrek {1}", t.number, fmtDate(t.departure_date))}</option>)}
                  </select>
                </div>
              )
            })}
          </section>
        )}
        {active.length === 0 && <section className="panel"><Empty>{tx("Er staat geen transport gepland. Maak het eerste aan met de knop rechtsboven.")}</Empty></section>}
        {active.map((t) => {
          const load = transportLoad(s, t.id)
          const shipments = s.inbound_shipments.filter((x) => x.transport_id === t.id && x.status !== 'closed')
          const [label, tone] = TRANSPORT_STATE[t.status]
          const late = t.status === 'departed' && t.arrival_date < today && shipments.some(shipmentIsOpen)
          const missedDeparture = t.status === 'planned' && t.departure_date < today
          const perWarehouse = receivers.map((w) => ({ w, m3: shipments.filter((x) => x.warehouse_id === w.id).reduce((n, x) => n + shipmentLoad(s, x.id).m3, 0) })).filter((r) => r.m3 > 0)
          return (
            <section className="panel" key={t.id}>
              <div className="panel-head">
                <div>
                  <h2><Truck size={17} style={{ verticalAlign: -3, marginRight: 7 }} />{t.number} <Pill tone={tone}>{tx(label)}</Pill> {late && <Pill tone="bad">{tx("Te laat")}</Pill>} {missedDeparture && <Pill tone="bad">{tx("Vertrek gemist")}</Pill>}</h2>
                  <div className="small muted">{tx("Vertrek {0}, aankomst {1}", fmtShort(t.departure_date), fmtShort(t.arrival_date))}{t.carrier ? `, ${t.carrier}` : ''}{t.reference ? `, ${t.reference}` : ''}</div>
                </div>
                <div className="btn-row">
                  <button className="btn sm" onClick={() => setEdit({ id: t.id, departure_date: t.departure_date, arrival_date: t.arrival_date, carrier: t.carrier, reference: t.reference, capacity_m3: t.capacity_m3, notes: t.notes })}>{tx("Wijzigen")}</button>
                  {t.status === 'planned' && <a className="btn sm" href={`#inkoop-nieuw-${t.id}`}><Plus size={14} />{tx("Vulorder")}</a>}
                  {t.status === 'planned' && <button className="btn sm primary" disabled={!shipments.length} onClick={() => run((db) => setTransportStatus(db, t.id, 'departed'), tx("{0} is vertrokken", t.number))}>{tx("Vertrokken")}</button>}
                  {t.status === 'departed' && <button className="btn sm primary" onClick={() => run((db) => setTransportStatus(db, t.id, 'arrived'), tx("{0} is aangekomen", t.number))}>{tx("Aangekomen")}</button>}
                  {t.status === 'planned' && <button className="btn sm" onClick={() => run((db) => cancelTransport(db, t.id), tx("Transport geannuleerd"))}>{tx("Annuleren")}</button>}
                </div>
              </div>
              <div className="load-row">
                <FillBar used={load.m3} capacity={t.capacity_m3} />
                <div className="small muted">{tx("{0} colli, {1} kg", load.colli, Math.round(load.kg))}{perWarehouse.length > 0 && <>. {perWarehouse.map((r) => tx("{0} m³ naar {1}", Math.round(r.m3 * 10) / 10, r.w.name)).join(', ')}</>}</div>
              </div>
              {shipments.length === 0 && <Empty>{tx("Nog leeg. Koppel een inkoop of maak een vulorder.")}</Empty>}
              {shipments.length > 0 && <div className="table-wrap"><table>
                <thead><tr><th>{tx("Inkooporder")}</th><th>{tx("Leverancier")}</th><th>{tx("Soort")}</th><th>{tx("Bestemming")}</th><th className="num">{tx("Colli")}</th><th className="num">m³</th><th>{tx("Status")}</th><th></th></tr></thead>
                <tbody>{shipments.map((x) => {
                  const { po, supplier } = supplierOf(s, x)
                  const l = shipmentLoad(s, x.id)
                  const isOpen = shipmentIsOpen(x)
                  return (
                    <tr key={x.id}>
                      <td><a className="rowlink" href={`#inkoop-${po.id}`}>{po.number}</a></td><td>{supplier}</td><td><KindPill kind={purchaseKind(s, po.id)} /></td>
                      <td style={{ minWidth: 180 }}>{isOpen ? (
                        <select aria-label={tx("Bestemming voor {0}", po.number)} value={x.warehouse_id} onChange={(e) => run((db) => setShipmentWarehouse(db, x.id, e.target.value), tx("Bestemming aangepast"))}>
                          {receivers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>) : s.warehouses.find((w) => w.id === x.warehouse_id)?.name}</td>
                      <td className="num">{l.colli}</td><td className="num">{Math.round(l.m3 * 10) / 10}</td><td><ShipmentPill status={x.status} /></td>
                      <td className="num">
                        <div className="btn-row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          {t.status === 'planned' && <button className="btn sm" onClick={() => run((db) => assignShipmentToTransport(db, x.id, null), tx("Zending losgekoppeld"))}>{tx("Loskoppelen")}</button>}
                          {t.status !== 'planned' && isOpen && <a className="btn sm primary" href={`#ontvangst-${x.id}`}>{tx("Ontvangen")}</a>}
                        </div>
                      </td>
                    </tr>
                  )
                })}</tbody>
              </table></div>}
            </section>
          )
        })}
      </div>}

      {tab !== 'transport' && <section className="panel">
        {rows.length === 0 && <Empty>{tab === 'open' ? tx("Er zijn geen zendingen onderweg.") : tx("Er zijn nog geen zendingen afgerond.")}</Empty>}
        {rows.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>{tx("Verwacht")}</th><th>{tx("Inkooporder")}</th><th>{tx("Leverancier")}</th><th>{tx("Transport")}</th><th>{tx("Komt binnen op")}</th><th className="num">{tx("Open")}</th><th>{tx("Status")}</th><th></th></tr></thead>
          <tbody>{rows.map((x) => {
            const { po, supplier } = supplierOf(s, x)
            const isOpen = shipmentIsOpen(x)
            const orders = ordersAffectedByShipment(s, x.id)
            return (
              <tr key={x.id}>
                <td>{fmtDate(x.expected_date)}{isOpen && x.expected_date < today && <div><Pill tone="bad">{tx("Te laat")}</Pill></div>}</td>
                <td><a className="rowlink" href={`#inkoop-${po.id}`}>{po.number}</a>{orders.length > 0 && <div className="muted small">{tx("Klant wacht:")} {orders.map((o) => o.number).join(', ')}</div>}</td>
                <td>{supplier}</td>
                <td>{s.transports.find((t) => t.id === x.transport_id)?.number ?? <span className="muted">{tx("Nog niet gekoppeld")}</span>}</td>
                <td>{s.warehouses.find((w) => w.id === x.warehouse_id)?.name}</td>
                <td className="num">{shipmentOpenQty(s, x.id)}</td>
                <td><ShipmentPill status={x.status} /></td>
                <td className="num">{isOpen && (
                  <div className="btn-row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    {!x.transport_id && <button className="btn sm" onClick={() => { setMove(x); setDate(x.expected_date); setReason('') }}>{tx("Datum verschuiven")}</button>}
                    {x.status === 'partial' && <button className="btn sm" onClick={() => { setClose(x); setReason('') }}>{tx("Rest afsluiten")}</button>}
                    <a className="btn sm primary" href={`#ontvangst-${x.id}`}>{tx("Ontvangen")}</a>
                  </div>
                )}</td>
              </tr>
            )
          })}</tbody>
        </table></div>}
      </section>}

      {edit && <TransportModal value={edit} onClose={() => setEdit(null)} />}
      {move && (
        <Modal title={tx("Leverdatum verschuiven")} onClose={() => setMove(null)} footer={<>
          <button className="btn" onClick={() => setMove(null)}>{tx("Annuleren")}</button>
          <button className="btn primary" onClick={async () => { if (await run((db) => rescheduleShipment(db, move.id, date, reason), tx("Verwachte datum aangepast"))) setMove(null) }}>{tx("Datum opslaan")}</button>
        </>}>
          <div className="form-grid">
            <TextField label={tx("Nieuwe datum")} type="date" value={date} onChange={setDate} />
            <TextField className="span-2" label={tx("Reden")} value={reason} onChange={setReason} placeholder={tx("Bijvoorbeeld vertraging bij transport")} />
          </div>
          {affected.length > 0 && <div className="note warn">{tx("Klant wacht:")} {affected.map((o, i) => <span key={o.id}>{i > 0 && ', '}<a href={`#orders-${o.id}`}>{o.number}</a></span>)}{tx(". Pas daar de beloofde leverdatum aan en informeer de klant.")}</div>}
        </Modal>
      )}
      {close && (
        <Modal title={tx("Rest van de zending afsluiten")} onClose={() => setClose(null)} footer={<>
          <button className="btn" onClick={() => setClose(null)}>{tx("Annuleren")}</button>
          <button className="btn primary" onClick={async () => { if (await run((db) => closeShipment(db, close.id, reason), tx("Zending afgesloten"))) setClose(null) }}>{tx("Zending afsluiten")}</button>
        </>}>
          <p style={{ margin: 0 }}>{tx("Er staan nog")} {shipmentOpenQty(s, close.id)} {tx("stuks open. Na afsluiten worden die niet meer verwacht.")}</p>
          <TextField label={tx("Reden")} value={reason} onChange={setReason} placeholder={tx("Bijvoorbeeld gecrediteerd door leverancier")} />
        </Modal>
      )}
    </>
  )
}

function TransportModal({ value, onClose }: { value: TransportInput & { id?: string }; onClose: () => void }) {
  const { s, run } = useApp()
  const [v, setV] = useState(value)
  const set = (p: Partial<TransportInput>) => setV((x) => ({ ...x, ...p }))
  const affected = value.id && v.arrival_date !== value.arrival_date
    ? s.inbound_shipments.filter((x) => x.transport_id === value.id).flatMap((x) => ordersAffectedByShipment(s, x.id))
    : []
  const save = async () => {
    const { id, ...input } = v
    if (await run((db) => (id ? updateTransport(db, id, input) : createTransport(db, input)), tx("Transport opgeslagen"))) onClose()
  }
  return (
    <Modal title={value.id ? tx("Transport wijzigen") : tx("Nieuw transport")} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx("Annuleren")}</button>
      <button className="btn primary" onClick={save}>{tx("Transport opslaan")}</button>
    </>}>
      <div className="form-grid">
        <TextField label={tx("Vertrek uit Nederland")} type="date" value={v.departure_date} onChange={(d) => set({ departure_date: d })} />
        <TextField label={tx("Aankomst in Spanje")} type="date" value={v.arrival_date} onChange={(d) => set({ arrival_date: d })} />
        <NumberField label={tx("Laadruimte (m³)")} value={v.capacity_m3} min={0} onChange={(n) => set({ capacity_m3: n })} />
        <TextField label={tx("Vervoerder")} value={v.carrier} onChange={(c) => set({ carrier: c })} />
        <TextField label={tx("Referentie")} value={v.reference} onChange={(c) => set({ reference: c })} />
        <AreaField className="span-all" label={tx("Notitie")} value={v.notes} onChange={(c) => set({ notes: c })} />
      </div>
      {value.id && v.arrival_date !== value.arrival_date && <div className="note warn">{tx("Alle openstaande zendingen op dit transport schuiven mee.")}{affected.length > 0 && <> {tx("Klant wacht:")} {[...new Set(affected.map((o) => o.number))].join(', ')}{tx(". Pas daar de beloofde leverdatum aan en informeer de klant.")}</>}</div>}
    </Modal>
  )
}
