import { useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { addDays, linePurchaseStatus, linesToPurchase, round2, todayISO } from '../domain/calc'
import { convertLinesToPurchaseOrders } from '../domain/services'
import { tx } from '../i18n'
import { useApp } from '../ui/app-context'
import { Empty, eur, fmtDate, Modal, SelectField, TextField } from '../ui/kit'

/** Regels van verkooporders die nog ingekocht moeten worden, klaar om door te zetten naar een leverancier. */
export function PurchaseQueue({ onDone }: { onDone: () => void }) {
  const { s, run } = useApp()
  const today = todayISO()
  const queue = linesToPurchase(s)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [suppliers, setSuppliers] = useState<Record<string, string>>({})
  const [filterSupplier, setFilterSupplier] = useState('')
  const [onlyToday, setOnlyToday] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const productOf = (id: string) => s.products.find((p) => p.id === id)
  const supplierFor = (l: { id: string; product_id: string }) => suppliers[l.id] ?? productOf(l.product_id)?.supplier_id ?? ''
  const orderOf = (id: string) => s.sales_orders.find((o) => o.id === id)!

  const shown = queue.filter((l) => (!filterSupplier || supplierFor(l) === filterSupplier) && (!onlyToday || orderOf(l.sales_order_id).order_date === today))
  const groups = useMemo(() => {
    const ids = [...new Set(shown.map((l) => l.sales_order_id))]
    return ids.map((id) => ({ order: orderOf(id), lines: shown.filter((l) => l.sales_order_id === id) })).sort((a, b) => a.order.number.localeCompare(b.order.number))
  }, [shown.map((l) => l.id).join()]) // eslint-disable-line

  const chosen = queue.filter((l) => selected.has(l.id))
  const toggle = (ids: string[], on: boolean) => setSelected((v) => {
    const next = new Set(v)
    for (const id of ids) { if (on) next.add(id); else next.delete(id) }
    return next
  })
  const supplierCount = new Set(chosen.map(supplierFor)).size
  const missing = chosen.some((l) => !supplierFor(l))

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{tx("Door te zetten vanuit verkooporders")}</h2>
          <div className="small muted">{tx("Vink aan wat je wilt inkopen. Per leverancier ontstaat één inkooporder.")}</div>
        </div>
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <select style={{ width: 'auto', minHeight: 32 }} aria-label={tx("Filter op leverancier")} value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)}>
            <option value="">{tx("Alle leveranciers")}</option>
            {s.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={onlyToday} onChange={(e) => setOnlyToday(e.target.checked)} />{tx("Alleen van vandaag")}</label>
          <button className="btn sm" onClick={() => toggle(shown.map((l) => l.id), true)}>{tx("Alles aanvinken")}</button>
        </div>
      </div>
      {groups.length === 0 && <Empty>{queue.length ? tx("Geen regels met dit filter.") : tx("Alle verkooporders zijn doorgezet. Nieuwe regels op bestelling verschijnen hier vanzelf.")}</Empty>}
      {groups.length > 0 && <div className="table-wrap"><table className="queue">
        <thead><tr><th style={{ width: 34 }}></th><th>{tx("Product")}</th><th>{tx("Uitvoering")}</th><th className="num">{tx("Aantal")}</th><th style={{ minWidth: 190 }}>{tx("Leverancier")}</th><th className="num">{tx("Inkoopprijs")}</th></tr></thead>
        {groups.map(({ order, lines }) => {
          const ids = lines.map((l) => l.id)
          const all = ids.every((id) => selected.has(id))
          const customer = s.customers.find((c) => c.id === order.customer_id)
          return (
            <tbody key={order.id}>
              <tr className="queue-head">
                <td><input type="checkbox" aria-label={tx("Hele verkooporder {0}", order.number)} checked={all} onChange={(e) => toggle(ids, e.target.checked)} /></td>
                <td colSpan={5}><a className="rowlink" href={`#orders-${order.id}`}>{order.number}</a> <span className="muted small">{customer?.company || customer?.name}, {fmtDate(order.order_date)}{order.promised_date ? tx(", beloofd {0}", fmtDate(order.promised_date)) : ''}</span></td>
              </tr>
              {lines.map((l) => {
                const bought = linePurchaseStatus(s, l.id).purchased
                return (
                  <tr key={l.id}>
                    <td><input type="checkbox" aria-label={tx("{0} aanvinken", l.description)} checked={selected.has(l.id)} onChange={(e) => toggle([l.id], e.target.checked)} /></td>
                    <td className="strong">{l.description}</td>
                    <td className="muted">{l.options || '–'}</td>
                    <td className="num">{l.qty}{bought > 0 && <div className="muted small">{tx("{0} al ingekocht", bought)}</div>}</td>
                    <td><select aria-label={tx("Leverancier voor {0}", l.description)} value={supplierFor(l)} onChange={(e) => setSuppliers((v) => ({ ...v, [l.id]: e.target.value }))}>
                      <option value="">{tx("Kies een leverancier")}</option>
                      {s.suppliers.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select></td>
                    <td className="num">{eur(productOf(l.product_id)?.purchase_price ?? 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          )
        })}
      </table></div>}
      {queue.length > 0 && (
        <div className="queue-bar">
          <span>{chosen.length ? tx("{0} aangevinkt, voor {1} leverancier(s)", chosen.length, supplierCount) : tx("Nog niets aangevinkt")}</span>
          <button className="btn primary" disabled={!chosen.length || missing} onClick={() => setConfirm(true)}>{tx("Doorzetten naar inkooporder")}<ArrowRight size={16} /></button>
        </div>
      )}
      {confirm && <ConvertModal lines={chosen.map((l) => ({ id: l.id, qty: l.qty, product_id: l.product_id, supplier_id: supplierFor(l) }))} onClose={() => setConfirm(false)} onDone={() => {
        setSelected(new Set()); setConfirm(false); onDone()
      }} run={run} />}
    </section>
  )
}

function ConvertModal({ lines, onClose, onDone, run }: { lines: { id: string; qty: number; product_id: string; supplier_id: string }[]; onClose: () => void; onDone: () => void; run: ReturnType<typeof useApp>['run'] }) {
  const { s } = useApp()
  const today = todayISO()
  const planned = s.transports.filter((t) => t.status === 'planned').sort((a, b) => a.departure_date.localeCompare(b.departure_date))
  const receivers = s.warehouses.filter((w) => w.is_active && w.receives_goods)
  const [transport, setTransport] = useState(planned.find((t) => t.departure_date >= today)?.id ?? '')
  const [warehouse, setWarehouse] = useState(receivers.find((w) => w.is_route_origin)?.id ?? receivers[0]?.id ?? '')
  const [date, setDate] = useState(today)
  const [expected, setExpected] = useState(addDays(today, 21))
  const perSupplier = [...new Set(lines.map((l) => l.supplier_id))].map((id) => {
    const rows = lines.filter((l) => l.supplier_id === id)
    return { id, name: s.suppliers.find((x) => x.id === id)?.name, count: rows.length, value: round2(rows.reduce((n, l) => n + l.qty * (s.products.find((p) => p.id === l.product_id)?.purchase_price ?? 0), 0)) }
  })
  const save = async () => {
    const ok = await run((db) => convertLinesToPurchaseOrders(db, { lines: lines.map((l) => ({ sales_order_line_id: l.id, supplier_id: l.supplier_id })), order_date: date, transport_id: transport || null, warehouse_id: warehouse, expected_date: expected }), perSupplier.length === 1 ? tx("Inkooporder aangemaakt") : tx("{0} inkooporders aangemaakt", perSupplier.length))
    if (ok) onDone()
  }
  return (
    <Modal title={tx("Doorzetten naar inkooporder")} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx("Annuleren")}</button>
      <button className="btn primary" onClick={save}>{perSupplier.length === 1 ? tx("Inkooporder aanmaken") : tx("{0} inkooporders aanmaken", perSupplier.length)}</button>
    </>}>
      <div className="table-wrap flush"><table>
        <thead><tr><th>{tx("Leverancier")}</th><th className="num">{tx("Regels")}</th><th className="num">{tx("Waarde")}</th></tr></thead>
        <tbody>{perSupplier.map((x) => <tr key={x.id}><td className="strong">{x.name}</td><td className="num">{x.count}</td><td className="num">{eur(x.value)}</td></tr>)}</tbody>
      </table></div>
      <div className="form-grid">
        <SelectField className="span-2" label={tx("Transport naar Spanje")} value={transport} onChange={setTransport} options={[{ value: '', label: tx("Nog niet gekoppeld") }, ...planned.map((t) => ({ value: t.id, label: tx("{0}, vertrek {1}, aankomst {2}", t.number, fmtDate(t.departure_date), fmtDate(t.arrival_date)) }))]} />
        <SelectField label={tx("Bestemming")} value={warehouse} onChange={setWarehouse} options={receivers.map((w) => ({ value: w.id, label: w.name }))} />
        <TextField label={tx("Besteldatum")} type="date" value={date} onChange={setDate} />
        {!transport && <TextField label={tx("Verwacht op")} type="date" value={expected} onChange={setExpected} />}
      </div>
    </Modal>
  )
}
