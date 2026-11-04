import { useState } from 'react'
import { Plus, Truck } from 'lucide-react'
import type { InboundShipment, Snapshot, Transport } from '../data/types'
import { addDays, ordersAffectedByShipment, shipmentIsOpen, shipmentLoad, todayISO, transportLoad } from '../domain/calc'
import { assignShipmentsToTransport, cancelTransport, closeShipment, createTransport, setShipmentWarehouse, setTransportStatus, updateTransport, type TransportInput } from '../domain/services'
import { tx } from '../i18n'
import { useApp } from '../ui/app-context'
import { AreaField, Empty, fmtDate, fmtShort, Head, Modal, NumberField, Pill, Tabs, TextField, type Tone } from '../ui/kit'
import { LabelPill } from './Purchases'

const DEFAULT_CAPACITY = 90
const TRANSPORT_STATE: Record<Transport['status'], [string, Tone]> = { planned: ['Laden', 'sell'], departed: ['Onderweg', 'info'], arrived: ['Aangekomen', 'good'], cancelled: ['Geannuleerd', ''] }
const round1 = (n: number) => Math.round(n * 10) / 10

function FillBar({ used, capacity }: { used: number; capacity: number }) {
  if (!capacity) return null
  const over = used > capacity
  return (
    <div>
      <div className="fill" role="img" aria-label={tx("{0} van {1} m³ gevuld", used, capacity)}><span style={{ width: `${Math.min(100, (used / capacity) * 100)}%`, background: over ? 'var(--bad)' : 'var(--primary)' }} /></div>
      <div className="small" style={over ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>
        {over ? tx("{0} van {1} m³: {2} m³ te veel", used, capacity, round1(used - capacity)) : tx("{0} van {1} m³, nog {2} m³ vrij", used, capacity, round1(capacity - used))}
      </div>
    </div>
  )
}

/** Eén inkoopregel, met alles wat je op de transportlijst wilt zien. */
export function lineInfo(s: Snapshot, x: InboundShipment) {
  const sl = s.inbound_shipment_lines.find((l) => l.shipment_id === x.id)!
  const pol = s.purchase_order_lines.find((l) => l.id === sl.purchase_order_line_id)!
  const po = s.purchase_orders.find((p) => p.id === pol.purchase_order_id)!
  const sol = s.sales_order_lines.find((l) => l.id === pol.sales_order_line_id)
  return {
    qty: sl.qty, po, product: s.products.find((p) => p.id === pol.product_id), supplier: s.suppliers.find((y) => y.id === po.supplier_id)?.name,
    salesOrder: sol && s.sales_orders.find((o) => o.id === sol.sales_order_id),
  }
}

export function Inbound() {
  const { s, run } = useApp()
  const [tab, setTab] = useState<'plan' | 'done'>('plan')
  const [close, setClose] = useState<InboundShipment | null>(null)
  const [edit, setEdit] = useState<(TransportInput & { id?: string }) | null>(null)
  const [reason, setReason] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState('')
  const today = todayISO()
  const active = s.transports.filter((t) => t.status === 'planned' || t.status === 'departed').sort((a, b) => a.departure_date.localeCompare(b.departure_date))
  const done = s.transports.filter((t) => t.status === 'arrived').sort((a, b) => b.arrival_date.localeCompare(a.arrival_date))
  const planned = active.filter((t) => t.status === 'planned')
  const unassigned = s.inbound_shipments.filter((x) => shipmentIsOpen(x) && !x.transport_id)
  const receivers = s.warehouses.filter((w) => w.is_active && w.receives_goods)
  const chosenTarget = target || planned[0]?.id || ''
  const pickedIds = unassigned.filter((x) => picked.has(x.id)).map((x) => x.id)

  const newTransport = () => {
    const last = [...s.transports].filter((t) => t.status !== 'cancelled').sort((a, b) => b.departure_date.localeCompare(a.departure_date))[0]
    const dep = last && last.departure_date >= today ? addDays(last.departure_date, 7) : addDays(today, 7)
    setEdit({ departure_date: dep, arrival_date: addDays(dep, 3), carrier: last?.carrier ?? '', reference: '', capacity_m3: last?.capacity_m3 ?? DEFAULT_CAPACITY, notes: '' })
  }
  const destination = (x: InboundShipment, label: string) => (
    <select aria-label={label} value={x.warehouse_id} onChange={(e) => run((db) => setShipmentWarehouse(db, x.id, e.target.value), tx("Bestemming aangepast"))}>
      {receivers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
    </select>
  )

  return (
    <>
      <Head title={tx("Gepland transport")} sub={tx("Zodra de transportlijst uit Nederland bekend is, koppel je de inkoopregels aan het transport. De verkooporder toont dan wanneer het product wordt verwacht.")}>
        <button className="btn primary" onClick={newTransport}><Plus size={16} />{tx("Nieuw transport")}</button>
      </Head>
      <Tabs<'plan' | 'done'> value={tab} onChange={setTab} tabs={[{ value: 'plan', label: tx("Inplannen"), n: unassigned.length }, { value: 'done', label: tx("Afgerond"), n: done.length }]} />

      {tab === 'plan' && <div className="stack">
        <section className="panel">
          <h2>{tx("Ingekocht, nog niet ingepland")}</h2>
          {unassigned.length === 0 && <Empty>{tx("Alle ingekochte regels staan op een transport.")}</Empty>}
          {unassigned.length > 0 && <>
            <div className="table-wrap"><table className="queue">
              <thead><tr><th style={{ width: 34 }}><input type="checkbox" aria-label={tx("Alles aanvinken")} checked={pickedIds.length === unassigned.length} onChange={(e) => setPicked(new Set(e.target.checked ? unassigned.map((x) => x.id) : []))} /></th><th>{tx("Inkooporder")}</th><th>{tx("Leverancier")}</th><th>{tx("Product")}</th><th className="num">{tx("Aantal")}</th><th className="num">m³</th><th>{tx("Voor")}</th><th style={{ minWidth: 180 }}>{tx("Bestemming")}</th></tr></thead>
              <tbody>{unassigned.map((x) => {
                const i = lineInfo(s, x)
                return (
                  <tr key={x.id}>
                    <td><input type="checkbox" aria-label={tx("{0} aanvinken", i.product?.name)} checked={picked.has(x.id)} onChange={(e) => setPicked((v) => { const n = new Set(v); if (e.target.checked) n.add(x.id); else n.delete(x.id); return n })} /></td>
                    <td><a className="rowlink" href={`#inkoop-${i.po.id}`}>{i.po.number}</a></td><td>{i.supplier}</td><td className="strong">{i.product?.name}</td><td className="num">{i.qty}</td><td className="num">{round1(shipmentLoad(s, x.id).m3)}</td>
                    <td>{i.salesOrder ? <a className="rowlink" href={`#orders-${i.salesOrder.id}`}>{i.salesOrder.number}</a> : <LabelPill label={i.po.label} />}</td>
                    <td>{destination(x, tx("Bestemming voor {0}", i.product?.name))}</td>
                  </tr>
                )
              })}</tbody>
            </table></div>
            <div className="queue-bar">
              <span>{tx("{0} regels aangevinkt", pickedIds.length)}</span>
              <div className="btn-row">
                <select style={{ width: 'auto' }} aria-label={tx("Koppelen aan transport")} value={chosenTarget} onChange={(e) => setTarget(e.target.value)}>
                  {planned.map((t) => <option key={t.id} value={t.id}>{tx("{0}, vertrek {1}", t.number, fmtDate(t.departure_date))}</option>)}
                </select>
                <button className="btn primary" disabled={!pickedIds.length || !chosenTarget} onClick={async () => { if (await run((db) => assignShipmentsToTransport(db, pickedIds, chosenTarget), tx("Gekoppeld aan transport"))) setPicked(new Set()) }}>{tx("Koppelen aan transport")}</button>
              </div>
            </div>
          </>}
        </section>

        {active.length === 0 && <section className="panel"><Empty>{tx("Er staat geen transport gepland. Maak het eerste aan met de knop rechtsboven.")}</Empty></section>}
        {active.map((t) => {
          const load = transportLoad(s, t.id)
          const lines = s.inbound_shipments.filter((x) => x.transport_id === t.id && x.status !== 'closed')
          const [label, tone] = TRANSPORT_STATE[t.status]
          const late = t.status === 'departed' && t.arrival_date < today && lines.some(shipmentIsOpen)
          const missed = t.status === 'planned' && t.departure_date < today
          const perWarehouse = receivers.map((w) => ({ w, m3: lines.filter((x) => x.warehouse_id === w.id).reduce((n, x) => n + shipmentLoad(s, x.id).m3, 0) })).filter((r) => r.m3 > 0)
          return (
            <section className="panel" key={t.id}>
              <div className="panel-head">
                <div>
                  <h2><Truck size={17} style={{ verticalAlign: -3, marginRight: 7 }} />{t.number} <Pill tone={tone}>{tx(label)}</Pill> {late && <Pill tone="bad">{tx("Te laat")}</Pill>} {missed && <Pill tone="bad">{tx("Vertrek gemist")}</Pill>}</h2>
                  <div className="small muted">{tx("Vertrek {0}, aankomst {1}", fmtShort(t.departure_date), fmtShort(t.arrival_date))}{t.carrier ? `, ${t.carrier}` : ''}</div>
                </div>
                <div className="btn-row">
                  <button className="btn sm" onClick={() => setEdit({ id: t.id, departure_date: t.departure_date, arrival_date: t.arrival_date, carrier: t.carrier, reference: t.reference, capacity_m3: t.capacity_m3, notes: t.notes })}>{tx("Wijzigen")}</button>
                  {t.status === 'planned' && <button className="btn sm primary" disabled={!lines.length} onClick={() => run((db) => setTransportStatus(db, t.id, 'departed'), tx("{0} is vertrokken", t.number))}>{tx("Vertrokken")}</button>}
                  {t.status === 'departed' && <a className="btn sm primary" href={`#ontvangst-${t.id}`}>{tx("Ontvangen")}</a>}
                  {t.status === 'planned' && <button className="btn sm" onClick={() => run((db) => cancelTransport(db, t.id), tx("Transport geannuleerd"))}>{tx("Annuleren")}</button>}
                </div>
              </div>
              <div className="load-row">
                <FillBar used={load.m3} capacity={t.capacity_m3} />
                <div className="small muted">{tx("{0} colli, {1} kg", load.colli, Math.round(load.kg))}{perWarehouse.length > 0 && <>. {perWarehouse.map((r) => tx("{0} m³ naar {1}", round1(r.m3), r.w.name)).join(', ')}</>}</div>
              </div>
              {lines.length === 0 && <Empty>{tx("Nog leeg. Koppel hierboven de inkoopregels.")}</Empty>}
              {lines.length > 0 && <div className="table-wrap"><table>
                <thead><tr><th>{tx("Inkooporder")}</th><th>{tx("Leverancier")}</th><th>{tx("Product")}</th><th className="num">{tx("Aantal")}</th><th className="num">m³</th><th>{tx("Voor")}</th><th style={{ minWidth: 180 }}>{tx("Bestemming")}</th><th></th></tr></thead>
                <tbody>{lines.map((x) => {
                  const i = lineInfo(s, x)
                  const isOpen = shipmentIsOpen(x)
                  return (
                    <tr key={x.id}>
                      <td><a className="rowlink" href={`#inkoop-${i.po.id}`}>{i.po.number}</a></td><td>{i.supplier}</td><td className="strong">{i.product?.name}</td><td className="num">{i.qty}</td><td className="num">{round1(shipmentLoad(s, x.id).m3)}</td>
                      <td>{i.salesOrder ? <a className="rowlink" href={`#orders-${i.salesOrder.id}`}>{i.salesOrder.number}</a> : <LabelPill label={i.po.label} />}</td>
                      <td>{isOpen ? destination(x, tx("Bestemming voor {0}", i.product?.name)) : <>{s.warehouses.find((w) => w.id === x.warehouse_id)?.name} <Pill tone="good">{tx("Ontvangen")}</Pill></>}</td>
                      <td className="num">
                        {t.status === 'planned' && <button className="btn sm" onClick={() => run((db) => assignShipmentsToTransport(db, [x.id], null), tx("Regel losgekoppeld"))}>{tx("Loskoppelen")}</button>}
                        {x.status === 'partial' && <button className="btn sm" onClick={() => { setClose(x); setReason('') }}>{tx("Rest afsluiten")}</button>}
                      </td>
                    </tr>
                  )
                })}</tbody>
              </table></div>}
            </section>
          )
        })}
      </div>}

      {tab === 'done' && <section className="panel">
        {done.length === 0 && <Empty>{tx("Nog geen afgeronde transporten.")}</Empty>}
        {done.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>{tx("Transport")}</th><th>{tx("Vertrek uit Nederland")}</th><th>{tx("Aankomst in Spanje")}</th><th>{tx("Vervoerder")}</th><th className="num">{tx("Colli")}</th><th className="num">m³</th></tr></thead>
          <tbody>{done.map((t) => { const l = transportLoad(s, t.id); return <tr key={t.id}><td className="strong">{t.number}</td><td>{fmtDate(t.departure_date)}</td><td>{fmtDate(t.arrival_date)}</td><td className="muted">{t.carrier || '–'}</td><td className="num">{l.colli}</td><td className="num">{l.m3}</td></tr> })}</tbody>
        </table></div>}
      </section>}

      {edit && <TransportModal value={edit} onClose={() => setEdit(null)} />}
      {close && (
        <Modal title={tx("Rest van de regel afsluiten")} onClose={() => setClose(null)} footer={<>
          <button className="btn" onClick={() => setClose(null)}>{tx("Annuleren")}</button>
          <button className="btn primary" onClick={async () => { if (await run((db) => closeShipment(db, close.id, reason), tx("Regel afgesloten"))) setClose(null) }}>{tx("Regel afsluiten")}</button>
        </>}>
          <p style={{ margin: 0 }}>{tx("Wat nog open staat wordt niet meer verwacht.")}</p>
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
  const moved = value.id && v.arrival_date !== value.arrival_date
  const affected = moved ? s.inbound_shipments.filter((x) => x.transport_id === value.id).flatMap((x) => ordersAffectedByShipment(s, x.id)) : []
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
        <AreaField className="span-all" label={tx("Notitie")} value={v.notes} onChange={(c) => set({ notes: c })} />
      </div>
      {moved && <div className="note warn">{tx("Alle openstaande regels op dit transport schuiven mee.")}{affected.length > 0 && <> {tx("De verwachte datum op deze verkooporders wijzigt mee:")} {[...new Set(affected.map((o) => o.number))].join(', ')}{tx(". Informeer de klant als de beloofde datum niet meer klopt.")}</>}</div>}
    </Modal>
  )
}
