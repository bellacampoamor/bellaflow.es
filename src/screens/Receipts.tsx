import { useState } from 'react'
import { PackageCheck, Split, Trash2 } from 'lucide-react'
import { openLinesOnTransport, shipmentLineOpen, todayISO } from '../domain/calc'
import { receiveGoods } from '../domain/services'
import { tx } from '../i18n'
import { go, useApp } from '../ui/app-context'
import { AreaField, Empty, fmtDate, Head, Pill, TextField } from '../ui/kit'

function TransportPicker({ value }: { value: string }) {
  const { s } = useApp()
  const options = s.transports.filter((t) => t.status !== 'cancelled' && s.inbound_shipments.some((x) => x.transport_id === t.id)).sort((a, b) => b.arrival_date.localeCompare(a.arrival_date))
  return (
    <div className="field" style={{ maxWidth: 420, marginBottom: 16 }}>
      <label htmlFor="receipt-transport">{tx("Transport")}</label>
      <select id="receipt-transport" value={value} onChange={(e) => e.target.value && go(`ontvangst-${e.target.value}`)}>
        <option value="">{tx("Kies een transport")}</option>
        {options.map((t) => <option key={t.id} value={t.id}>{tx("{0}, aankomst {1}", t.number, fmtDate(t.arrival_date))}</option>)}
      </select>
    </div>
  )
}

/** Signaallijst: wat er op dit transport binnenkomt, naast wat daarvan al verkocht is. */
function SignalList({ transportId }: { transportId: string }) {
  const { s } = useApp()
  const lines = s.inbound_shipments.filter((x) => x.transport_id === transportId).flatMap((x) => s.inbound_shipment_lines.filter((l) => l.shipment_id === x.id).map((l) => {
    const pol = s.purchase_order_lines.find((p) => p.id === l.purchase_order_line_id)!
    const sol = s.sales_order_lines.find((y) => y.id === pol.sales_order_line_id)
    const so = sol && s.sales_orders.find((o) => o.id === sol.sales_order_id)
    return {
      id: l.id, qty: l.qty, po: s.purchase_orders.find((p) => p.id === pol.purchase_order_id)!, product: s.products.find((p) => p.id === pol.product_id)?.name,
      sol, so, customer: so && s.customers.find((c) => c.id === so.customer_id), destination: s.warehouses.find((w) => w.id === x.warehouse_id)?.name, status: x.status,
    }
  })).sort((a, b) => a.po.number.localeCompare(b.po.number))
  const sold = lines.filter((l) => l.so).length
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <h2>{tx("Signaallijst")}</h2>
        <span className="small muted">{tx("{0} regels, waarvan {1} al verkocht", lines.length, sold)}</span>
      </div>
      <div className="table-wrap"><table className="signal">
        <thead>
          <tr><th colSpan={4} className="signal-group">{tx("Binnengekomen via inkoop")}</th><th colSpan={6} className="signal-group sold">{tx("Verkocht aan")}</th><th></th></tr>
          <tr><th>{tx("Inkooporder")}</th><th>{tx("Inkoopdatum")}</th><th>{tx("Product")}</th><th className="num">{tx("Aantal")}</th><th className="sold">{tx("Verkooporder")}</th><th>{tx("Datum")}</th><th>{tx("Product")}</th><th className="num">{tx("Aantal")}</th><th>{tx("Klant")}</th><th>{tx("Plaats")}</th><th>{tx("Status")}</th></tr>
        </thead>
        <tbody>{lines.map((l) => (
          <tr key={l.id}>
            <td><a className="rowlink" href={`#inkoop-${l.po.id}`}>{l.po.number}</a></td><td>{fmtDate(l.po.order_date)}</td><td className="strong">{l.product}</td><td className="num">{l.qty}</td>
            {l.so ? <>
              <td className="sold"><a className="rowlink" href={`#orders-${l.so.id}`}>{l.so.number}</a></td><td>{fmtDate(l.so.order_date)}</td><td>{l.sol!.description}{l.sol!.options && <div className="muted small">{l.sol!.options}</div>}</td><td className="num">{l.sol!.qty}</td>
              <td>{l.customer?.company || l.customer?.name}</td><td>{l.customer?.city}</td>
            </> : <td className="sold muted" colSpan={6}>{tx("Niet verkocht, voor {0}", l.destination)}</td>}
            <td>{l.status === 'received' ? <Pill tone="good">{tx("Binnen")}</Pill> : l.status === 'closed' ? <Pill>{tx("Afgesloten")}</Pill> : l.status === 'partial' ? <Pill tone="warn">{tx("Niet compleet")}</Pill> : <Pill tone="info">{tx("Verwacht")}</Pill>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </section>
  )
}

export function Receipts() {
  const { s } = useApp()
  const today = todayISO()
  const expected = s.transports.filter((t) => t.status !== 'cancelled' && openLinesOnTransport(s, t.id).length > 0).sort((a, b) => a.arrival_date.localeCompare(b.arrival_date))
  const history = [...s.goods_receipts].sort((a, b) => b.received_date.localeCompare(a.received_date) || b.number.localeCompare(a.number))
  return (
    <>
      <Head title={tx("Goederenontvangst")} sub={tx("Boek per transport in wat er binnenkomt, op de locatie waar het echt ligt. Eén regel mag over meerdere locaties verdeeld worden.")} />
      <TransportPicker value="" />
      <div className="stack">
        <section className="panel">
          <h2>{tx("Te ontvangen transporten")}</h2>
          {expected.length === 0 && <Empty>{tx("Er wordt niets verwacht. Plan eerst inkoopregels in op een transport.")}</Empty>}
          {expected.map((t) => {
            const lines = openLinesOnTransport(s, t.id)
            return (
              <a key={t.id} className="task" href={`#ontvangst-${t.id}`}>
                <div>
                  <div className="task-t">{t.number}</div>
                  <div className="muted small">{tx("{0} regels, {1} stuks", lines.length, lines.reduce((n, l) => n + shipmentLineOpen(s, l.id), 0))}{t.carrier ? `, ${t.carrier}` : ''}</div>
                </div>
                <Pill tone={t.arrival_date < today ? 'bad' : ''}>{fmtDate(t.arrival_date)}</Pill>
              </a>
            )
          })}
        </section>
        <section className="panel">
          <h2>{tx("Eerdere ontvangsten")}</h2>
          {history.length === 0 && <Empty>{tx("Nog niets ontvangen.")}</Empty>}
          {history.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th>{tx("Nummer")}</th><th>{tx("Datum")}</th><th>{tx("Transport")}</th><th>{tx("Pakbon")}</th><th>{tx("Verdeling over locaties")}</th><th className="num">{tx("Ontvangen")}</th></tr></thead>
            <tbody>{history.map((r) => {
              const lines = s.goods_receipt_lines.filter((l) => l.receipt_id === r.id)
              const perW = new Map<string, number>()
              for (const l of lines) perW.set(l.warehouse_id, (perW.get(l.warehouse_id) ?? 0) + l.qty_received)
              return (
                <tr key={r.id}>
                  <td className="strong">{r.number}</td><td>{fmtDate(r.received_date)}</td>
                  <td>{s.transports.find((t) => t.id === r.transport_id)?.number ?? '–'}</td><td className="muted">{r.delivery_note || '–'}</td>
                  <td className="small">{[...perW].filter(([, n]) => n > 0).map(([w, n]) => tx("{0} op {1}", n, s.warehouses.find((y) => y.id === w)?.name)).join(', ')}{r.notes && <div className="muted">{r.notes}</div>}</td>
                  <td className="num">{lines.reduce((n, l) => n + l.qty_received, 0)}</td>
                </tr>
              )
            })}</tbody>
          </table></div>}
        </section>
      </div>
    </>
  )
}

interface Row { key: number; shipment_line_id: string; warehouse_id: string; qty_received: number; qty_damaged: number; location_bin: string }
let k = 1

export function ReceiptForm({ transportId }: { transportId: string }) {
  const { s, run } = useApp()
  const transport = s.transports.find((t) => t.id === transportId)
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [by, setBy] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<Row[]>(() => openLinesOnTransport(s, transportId).map((l) => ({
    key: k++, shipment_line_id: l.id, warehouse_id: s.inbound_shipments.find((x) => x.id === l.shipment_id)?.warehouse_id ?? '', qty_received: shipmentLineOpen(s, l.id), qty_damaged: 0, location_bin: '',
  })))
  if (!transport) return <div className="panel">{tx("Transport niet gevonden.")} <a href="#ontvangst">{tx("Terug naar ontvangst")}</a>.</div>
  const warehouses = s.warehouses.filter((w) => w.is_active && w.receives_goods)
  const lineInfo = (lineId: string) => {
    const sl = s.inbound_shipment_lines.find((l) => l.id === lineId)!
    const pol = s.purchase_order_lines.find((l) => l.id === sl.purchase_order_line_id)!
    return { p: s.products.find((y) => y.id === pol.product_id)!, pol, po: s.purchase_orders.find((x) => x.id === pol.purchase_order_id)! }
  }
  const patch = (key: number, p: Partial<Row>) => setRows((v) => v.map((r) => r.key === key ? { ...r, ...p } : r))
  const split = (r: Row) => {
    const other = warehouses.find((w) => w.id !== r.warehouse_id)?.id ?? r.warehouse_id
    const half = Math.floor(r.qty_received / 2)
    setRows((v) => v.flatMap((y) => y.key === r.key ? [{ ...y, qty_received: r.qty_received - half }, { key: k++, shipment_line_id: r.shipment_line_id, warehouse_id: other, qty_received: half, qty_damaged: 0, location_bin: '' }] : [y]))
  }
  const totals = new Map<string, number>()
  for (const r of rows) totals.set(r.warehouse_id, (totals.get(r.warehouse_id) ?? 0) + r.qty_received)
  const received = new Map<string, number>()
  for (const r of rows) received.set(r.shipment_line_id, (received.get(r.shipment_line_id) ?? 0) + r.qty_received)
  const missing = [...received].reduce((n, [id, got]) => n + Math.max(0, shipmentLineOpen(s, id) - got), 0)
  const save = async () => {
    const ok = await run((db) => receiveGoods(db, { transport_id: transportId, received_date: date, delivery_note: note, received_by: by, notes, rows: rows.map(({ key: _k, ...r }) => r) }), tx("Goederen ingeboekt, voorraad bijgewerkt"))
    if (ok) go('ontvangst')
  }
  return (
    <>
      <Head title={tx("Ontvangst {0}", transport.number)} sub={tx("Verwacht op {0}.", fmtDate(transport.arrival_date))} back={{ href: '#ontvangst', label: tx("Goederenontvangst") }} />
      <TransportPicker value={transportId} />
      <SignalList transportId={transportId} />
      {rows.length === 0 && <div className="note">{tx("Alles op dit transport is al ontvangen.")}</div>}
      {rows.length > 0 && <div className="stack">
        <section className="panel">
          <h2>{tx("Pakbon")}</h2>
          <div className="form-grid">
            <TextField label={tx("Ontvangstdatum")} type="date" value={date} onChange={setDate} />
            <TextField label={tx("Pakbonnummer")} value={note} onChange={setNote} />
            <TextField label={tx("Ontvangen door")} value={by} onChange={setBy} />
          </div>
        </section>
        <section className="panel">
          <h2>{tx("Wat is er binnengekomen?")}</h2>
          <p className="muted small" style={{ marginTop: -6 }}>{tx("Vul per regel in wat er daadwerkelijk is ontvangen. Wat ontbreekt blijft open staan.")}</p>
          <div className="table-wrap"><table>
            <thead><tr><th style={{ minWidth: 200 }}>{tx("Product")}</th><th>{tx("Inkooporder")}</th><th className="num">{tx("Besteld")}</th><th style={{ minWidth: 190 }}>{tx("Locatie")}</th><th>{tx("Ontvangen")}</th><th>{tx("Plek in magazijn")}</th><th></th></tr></thead>
            <tbody>{rows.map((r, i) => {
              const { p, pol, po } = lineInfo(r.shipment_line_id)
              const first = rows.findIndex((y) => y.shipment_line_id === r.shipment_line_id) === i
              const sol = pol.sales_order_line_id && s.sales_order_lines.find((l) => l.id === pol.sales_order_line_id)
              const so = sol && s.sales_orders.find((o) => o.id === sol.sales_order_id)
              return (
                <tr key={r.key}>
                  <td>{first ? <><span className="strong">{p.name}</span>{so && <div className="small"><Pill tone="sell">{tx("Voor {0}", so.number)}</Pill></div>}</> : <span className="muted small">{tx("zelfde product")}</span>}</td>
                  <td className="muted">{first ? po.number : ''}</td>
                  <td className="num">{first ? shipmentLineOpen(s, r.shipment_line_id) : ''}</td>
                  <td><select aria-label={tx("Magazijn voor {0}", p.name)} value={r.warehouse_id} onChange={(e) => patch(r.key, { warehouse_id: e.target.value })}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></td>
                  <td><input className="qty" aria-label={tx("Ontvangen {0}", p.name)} type="number" min={0} value={r.qty_received} onChange={(e) => patch(r.key, { qty_received: Number(e.target.value) })} /></td>
                  <td><input aria-label={tx("Locatie {0}", p.name)} value={r.location_bin} placeholder={tx("Bijv. A-12")} onChange={(e) => patch(r.key, { location_bin: e.target.value })} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => split(r)}><Split size={14} />{tx("Verdelen")}</button>
                    {!first && <button className="btn icon" aria-label={tx("Rij verwijderen")} onClick={() => setRows((v) => v.filter((y) => y.key !== r.key))}><Trash2 size={16} /></button>}
                  </td>
                </tr>
              )
            })}</tbody>
          </table></div>
          <div className="note" style={{ marginTop: 14 }}>
            {tx("Wordt ingeboekt:")} {[...totals].filter(([, n]) => n > 0).map(([w, n]) => tx("{0} op {1}", n, s.warehouses.find((y) => y.id === w)?.name)).join(', ') || tx("nog niets")}.
            {missing > 0 && tx(" {0} stuks niet ontvangen, die blijven open staan.", missing)}
          </div>
        </section>
        <section className="panel"><AreaField label={tx("Opmerkingen")} value={notes} onChange={setNotes} /></section>
        <div className="sticky-save">
          <a className="btn" href="#ontvangst">{tx("Annuleren")}</a>
          <button className="btn primary" onClick={save}><PackageCheck size={16} />{tx("Goederen inboeken")}</button>
        </div>
      </div>}
    </>
  )
}
