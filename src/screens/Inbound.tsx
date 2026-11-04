import { useState } from 'react'
import type { InboundShipment } from '../data/types'
import { ordersAffectedByShipment, shipmentIsOpen, shipmentOpenQty, todayISO } from '../domain/calc'
import { closeShipment, rescheduleShipment } from '../domain/services'
import { useApp } from '../ui/app-context'
import { Empty, fmtDate, Head, Modal, Pill, Tabs, TextField } from '../ui/kit'
import { ShipmentPill } from './Purchases'

export function Inbound() {
  const { s, run } = useApp()
  const [tab, setTab] = useState<'open' | 'done'>('open')
  const [move, setMove] = useState<InboundShipment | null>(null)
  const [close, setClose] = useState<InboundShipment | null>(null)
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const today = todayISO()
  const open = s.inbound_shipments.filter(shipmentIsOpen).sort((a, b) => a.expected_date.localeCompare(b.expected_date))
  const done = s.inbound_shipments.filter((x) => !shipmentIsOpen(x)).sort((a, b) => b.expected_date.localeCompare(a.expected_date))
  const rows = tab === 'open' ? open : done
  const affected = move ? ordersAffectedByShipment(s, move.id) : []

  return (
    <>
      <Head title="Inkomende leveringen" sub="Alle zendingen van leveranciers, ook als een bestelling in delen binnenkomt." />
      <section className="panel">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'open', label: 'Onderweg', n: open.length }, { value: 'done', label: 'Afgerond', n: done.length }]} />
        {rows.length === 0 && <Empty>{tab === 'open' ? 'Er zijn geen zendingen onderweg.' : 'Er zijn nog geen zendingen afgerond.'}</Empty>}
        {rows.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>Verwacht</th><th>Inkooporder</th><th>Leverancier</th><th>Zending</th><th>Komt binnen op</th><th className="num">Open</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map((x) => {
            const po = s.purchase_orders.find((p) => p.id === x.purchase_order_id)!
            const total = s.inbound_shipments.filter((y) => y.purchase_order_id === po.id).length
            const isOpen = shipmentIsOpen(x)
            const orders = ordersAffectedByShipment(s, x.id)
            return (
              <tr key={x.id}>
                <td>{fmtDate(x.expected_date)}{isOpen && x.expected_date < today && <div><Pill tone="bad">Te laat</Pill></div>}{x.expected_date !== x.original_date && <div className="muted small">was {fmtDate(x.original_date)}</div>}</td>
                <td><a className="rowlink" href={`#inkoop-${po.id}`}>{po.number}</a>{orders.length > 0 && <div className="muted small">Klant wacht: {orders.map((o) => o.number).join(', ')}</div>}</td>
                <td>{s.suppliers.find((y) => y.id === po.supplier_id)?.name}</td>
                <td>{x.sequence} van {total}</td>
                <td>{s.warehouses.find((w) => w.id === x.warehouse_id)?.name}</td>
                <td className="num">{shipmentOpenQty(s, x.id)}</td>
                <td><ShipmentPill status={x.status} /></td>
                <td className="num">{isOpen && (
                  <div className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    <button className="btn sm" onClick={() => { setMove(x); setDate(x.expected_date); setReason('') }}>Datum verschuiven</button>
                    {x.status === 'partial' && <button className="btn sm" onClick={() => { setClose(x); setReason('') }}>Rest afsluiten</button>}
                    <a className="btn sm primary" href={`#ontvangst-${x.id}`}>Ontvangen</a>
                  </div>
                )}</td>
              </tr>
            )
          })}</tbody>
        </table></div>}
      </section>

      {move && (
        <Modal title="Leverdatum verschuiven" onClose={() => setMove(null)} footer={<>
          <button className="btn" onClick={() => setMove(null)}>Annuleren</button>
          <button className="btn primary" onClick={async () => { if (await run((db) => rescheduleShipment(db, move.id, date, reason), 'Verwachte datum aangepast')) setMove(null) }}>Datum opslaan</button>
        </>}>
          <div className="form-grid">
            <TextField label="Nieuwe datum" type="date" value={date} onChange={setDate} />
            <TextField className="span-2" label="Reden" value={reason} onChange={setReason} placeholder="Bijvoorbeeld vertraging bij transport" />
          </div>
          {affected.length > 0 && (
            <div className="note warn">
              Dit raakt {affected.length === 1 ? 'een klantorder' : `${affected.length} klantorders`}: {affected.map((o, i) => <span key={o.id}>{i > 0 && ', '}<a href={`#orders-${o.id}`}>{o.number}</a></span>)}. Pas daar de beloofde leverdatum aan en informeer de klant.
            </div>
          )}
        </Modal>
      )}
      {close && (
        <Modal title="Rest van de zending afsluiten" onClose={() => setClose(null)} footer={<>
          <button className="btn" onClick={() => setClose(null)}>Annuleren</button>
          <button className="btn primary" onClick={async () => { if (await run((db) => closeShipment(db, close.id, reason), 'Zending afgesloten')) setClose(null) }}>Zending afsluiten</button>
        </>}>
          <p style={{ margin: 0 }}>Er staan nog {shipmentOpenQty(s, close.id)} stuks open. Na afsluiten worden die niet meer verwacht.</p>
          <TextField label="Reden" value={reason} onChange={setReason} placeholder="Bijvoorbeeld gecrediteerd door leverancier" />
        </Modal>
      )}
    </>
  )
}
