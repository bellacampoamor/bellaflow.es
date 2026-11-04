import { useState } from 'react'
import { Plus, Split, Trash2 } from 'lucide-react'
import { shipmentIsOpen, shipmentLineOpen, shipmentOpenQty, todayISO } from '../domain/calc'
import { receiveGoods } from '../domain/services'
import { go, useApp } from '../ui/app-context'
import { Empty, fmtDate, Head, Pill, TextField, AreaField } from '../ui/kit'
import { tx } from '../i18n'

export function Receipts() {
  const { s } = useApp()
  const today = todayISO()
  const expected = s.inbound_shipments.filter(shipmentIsOpen).sort((a, b) => a.expected_date.localeCompare(b.expected_date))
  const history = [...s.goods_receipts].sort((a, b) => b.received_date.localeCompare(a.received_date) || b.number.localeCompare(a.number))
  return (
    <>
      <Head title={tx("Goederenontvangst")} sub={tx("Boek binnengekomen goederen in op het magazijn waar ze echt liggen. Eén zending mag over meerdere magazijnen verdeeld worden.")} />
      <div className="stack">
        <section className="panel">
          <h2>{tx("Te ontvangen")}</h2>
          {expected.length === 0 && <Empty>{tx("Er wordt niets verwacht.")}</Empty>}
          {expected.map((x) => {
            const po = s.purchase_orders.find((p) => p.id === x.purchase_order_id)!
            const late = x.expected_date < today
            return (
              <a key={x.id} className="task" href={`#ontvangst-${x.id}`}>
                <div>
                  <div className="task-t">{po.number}{tx(", zending")} {x.sequence}</div>
                  <div className="muted small">{s.suppliers.find((y) => y.id === po.supplier_id)?.name}, {shipmentOpenQty(s, x.id)} {tx("stuks open, verwacht op")} {s.warehouses.find((w) => w.id === x.warehouse_id)?.name}</div>
                </div>
                <Pill tone={late ? 'bad' : ''}>{fmtDate(x.expected_date)}</Pill>
              </a>
            )
          })}
        </section>
        <section className="panel">
          <h2>{tx("Eerdere ontvangsten")}</h2>
          {history.length === 0 && <Empty>{tx("Nog niets ontvangen.")}</Empty>}
          {history.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th>{tx("Nummer")}</th><th>{tx("Datum")}</th><th>{tx("Inkooporder")}</th><th>{tx("Pakbon")}</th><th>{tx("Verdeling over locaties")}</th><th className="num">{tx("Goed")}</th><th className="num">{tx("Schade")}</th></tr></thead>
            <tbody>{history.map((r) => {
              const lines = s.goods_receipt_lines.filter((l) => l.receipt_id === r.id)
              const x = s.inbound_shipments.find((y) => y.id === r.shipment_id)!
              const po = s.purchase_orders.find((p) => p.id === x.purchase_order_id)!
              const perW = new Map<string, number>()
              for (const l of lines) perW.set(l.warehouse_id, (perW.get(l.warehouse_id) ?? 0) + l.qty_received)
              return (
                <tr key={r.id}>
                  <td className="strong">{r.number}</td><td>{fmtDate(r.received_date)}</td>
                  <td><a className="rowlink" href={`#inkoop-${po.id}`}>{po.number}</a></td><td className="muted">{r.delivery_note || '–'}</td>
                  <td className="small">{[...perW].filter(([, n]) => n > 0).map(([w, n]) => tx("{0} op {1}", n, s.warehouses.find((y) => y.id === w)?.name)).join(', ')}{r.notes && <div className="muted">{r.notes}</div>}</td>
                  <td className="num">{lines.reduce((n, l) => n + l.qty_received, 0)}</td>
                  <td className="num">{lines.reduce((n, l) => n + l.qty_damaged, 0) || <span className="zero">0</span>}</td>
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

export function ReceiptForm({ shipmentId }: { shipmentId: string }) {
  const { s, run } = useApp()
  const x = s.inbound_shipments.find((y) => y.id === shipmentId)
  const lines = s.inbound_shipment_lines.filter((l) => l.shipment_id === shipmentId)
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [by, setBy] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<Row[]>(() => lines.filter((l) => shipmentLineOpen(s, l.id) > 0).map((l) => ({
    key: k++, shipment_line_id: l.id, warehouse_id: x?.warehouse_id ?? '', qty_received: shipmentLineOpen(s, l.id), qty_damaged: 0, location_bin: '',
  })))
  if (!x) return <div className="panel">{tx("Zending niet gevonden.")} <a href="#ontvangst">{tx("Terug naar ontvangst")}</a>.</div>
  const po = s.purchase_orders.find((p) => p.id === x.purchase_order_id)!
  const warehouses = s.warehouses.filter((w) => w.is_active && w.receives_goods)
  const productOf = (lineId: string) => {
    const sl = s.inbound_shipment_lines.find((l) => l.id === lineId)!
    const pol = s.purchase_order_lines.find((l) => l.id === sl.purchase_order_line_id)!
    return { p: s.products.find((y) => y.id === pol.product_id)!, pol }
  }
  const patch = (key: number, p: Partial<Row>) => setRows((v) => v.map((r) => r.key === key ? { ...r, ...p } : r))
  const split = (r: Row) => {
    const other = warehouses.find((w) => w.id !== r.warehouse_id)?.id ?? r.warehouse_id
    const half = Math.floor(r.qty_received / 2)
    setRows((v) => v.flatMap((y) => y.key === r.key ? [{ ...y, qty_received: r.qty_received - half }, { key: k++, shipment_line_id: r.shipment_line_id, warehouse_id: other, qty_received: half, qty_damaged: 0, location_bin: '' }] : [y]))
  }
  const totals = new Map<string, number>()
  for (const r of rows) totals.set(r.warehouse_id, (totals.get(r.warehouse_id) ?? 0) + r.qty_received)
  const damaged = rows.reduce((n, r) => n + r.qty_damaged, 0)
  const isOpen = shipmentIsOpen(x)

  const save = async () => {
    const ok = await run((db) => receiveGoods(db, { shipment_id: x.id, received_date: date, delivery_note: note, received_by: by, notes, rows: rows.map(({ key: _k, ...r }) => r) }), tx("Goederen ingeboekt, voorraad bijgewerkt"))
    if (ok) go('ontvangst')
  }

  return (
    <>
      <Head title={tx("Ontvangst {0}, zending {1}", po.number, x.sequence)} sub={tx("{0}. Verwacht op {1}.", s.suppliers.find((y) => y.id === po.supplier_id)?.name, fmtDate(x.expected_date))} back={{ href: '#ontvangst', label: tx("Goederenontvangst") }} />
      {!isOpen && <div className="note" style={{ marginBottom: 16 }}>{tx("Deze zending is al volledig verwerkt.")}</div>}
      {isOpen && <div className="stack">
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
          <p className="muted small" style={{ marginTop: -6 }}>{tx("Ingevuld met wat er nog open staat. Beschadigde stuks komen niet in de voorraad en blijven open staan bij de leverancier. Gebruik \"Verdelen\" als een regel op meerdere locaties wordt gelost.")}</p>
          <div className="table-wrap"><table>
            <thead><tr><th style={{ minWidth: 200 }}>{tx("Product")}</th><th className="num">{tx("Open")}</th><th style={{ minWidth: 190 }}>{tx("Magazijn")}</th><th>{tx("Goed")}</th><th>{tx("Schade")}</th><th>{tx("Locatie in magazijn")}</th><th></th></tr></thead>
            <tbody>{rows.map((r, i) => {
              const { p, pol } = productOf(r.shipment_line_id)
              const firstOfLine = rows.findIndex((y) => y.shipment_line_id === r.shipment_line_id) === i
              const sol = pol.sales_order_line_id && s.sales_order_lines.find((l) => l.id === pol.sales_order_line_id)
              const so = sol && s.sales_orders.find((o) => o.id === sol.sales_order_id)
              return (
                <tr key={r.key}>
                  <td>{firstOfLine ? <><span className="strong">{p.name}</span>{p.colli > 1 && <div className="muted small">{p.colli} {tx("colli per stuk")}</div>}{so && <div className="small"><Pill tone="sell">{tx("Voor")} {so.number}</Pill></div>}</> : <span className="muted small">{tx("zelfde product")}</span>}</td>
                  <td className="num">{firstOfLine ? shipmentLineOpen(s, r.shipment_line_id) : ''}</td>
                  <td><select aria-label={tx("Magazijn voor {0}", p.name)} value={r.warehouse_id} onChange={(e) => patch(r.key, { warehouse_id: e.target.value })}>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select></td>
                  <td><input className="qty" aria-label={tx("Goed ontvangen {0}", p.name)} type="number" min={0} value={r.qty_received} onChange={(e) => patch(r.key, { qty_received: Number(e.target.value) })} /></td>
                  <td><input className="qty" aria-label={tx("Schade {0}", p.name)} type="number" min={0} value={r.qty_damaged} onChange={(e) => patch(r.key, { qty_damaged: Number(e.target.value) })} /></td>
                  <td><input aria-label={tx("Locatie {0}", p.name)} value={r.location_bin} placeholder={tx("Bijv. A-12")} onChange={(e) => patch(r.key, { location_bin: e.target.value })} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => split(r)}><Split size={14} />{tx("Verdelen")}</button>
                    {!firstOfLine && <button className="btn icon" aria-label={tx("Rij verwijderen")} onClick={() => setRows((v) => v.filter((y) => y.key !== r.key))}><Trash2 size={16} /></button>}
                  </td>
                </tr>
              )
            })}</tbody>
          </table></div>
          <div className="note" style={{ marginTop: 14 }}>
            {tx("Wordt ingeboekt:")} {[...totals].filter(([, n]) => n > 0).map(([w, n]) => tx("{0} op {1}", n, s.warehouses.find((y) => y.id === w)?.name)).join(', ') || tx("nog niets")}.
            {damaged > 0 && tx(" {0} met schade, niet in voorraad.", damaged)}
          </div>
        </section>
        <section className="panel"><AreaField label={tx("Opmerkingen")} value={notes} onChange={setNotes} /></section>
        <div className="sticky-save">
          <a className="btn" href="#ontvangst">{tx("Annuleren")}</a>
          <button className="btn primary" onClick={save}><Plus size={16} />{tx("Goederen inboeken")}</button>
        </div>
      </div>}
    </>
  )
}
