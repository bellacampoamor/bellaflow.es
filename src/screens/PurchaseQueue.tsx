import { useMemo, useState } from 'react'
import { ArrowRight, Check as CheckIcon } from 'lucide-react'
import { articleNo, inboundWarehouse, linePurchaseStatus, linesToPurchase, round2, todayISO } from '../domain/calc'
import { convertLinesToPurchaseOrders } from '../domain/services'
import { tx } from '../i18n'
import { useApp } from '../ui/app-context'
import { Empty, eur, fmtDate, Modal, pickRow, Sku, TextField } from '../ui/kit'

/** Regels van verkooporders die nog ingekocht moeten worden, klaar om door te zetten naar een leverancier. */
export function PurchaseQueue({ onDone }: { onDone: () => void }) {
  const { s, run } = useApp()
  const today = todayISO()
  const queue = linesToPurchase(s)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [filterSupplier, setFilterSupplier] = useState('')
  const [onlyToday, setOnlyToday] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const productOf = (id: string) => s.products.find((p) => p.id === id)
  const supplierFor = (l: { id: string; product_id: string }) => productOf(l.product_id)?.supplier_id ?? ''
  const orderOf = (id: string) => s.sales_orders.find((o) => o.id === id)!

  const shown = queue.filter((l) => (!filterSupplier || supplierFor(l) === filterSupplier) && (!onlyToday || orderOf(l.sales_order_id).order_date === today))
  const groups = useMemo(() => {
    const ids = [...new Set(shown.map((l) => l.sales_order_id))]
    return ids.map((id) => ({ order: orderOf(id), lines: shown.filter((l) => l.sales_order_id === id) })).sort((a, b) => a.order.number.localeCompare(b.order.number))
  }, [shown.map((l) => l.id).join()]) // eslint-disable-line

  const chosen = queue.filter((l) => selected.has(l.id))
  const toggleOpen = (id: string) => setOpen((v) => { const next = new Set(v); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const shownIds = shown.map((l) => l.id)
  const allShown = shownIds.length > 0 && shownIds.every((id) => selected.has(id))
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
          <h2>{tx("Verkooporders zonder Inkooporders")}</h2>
          <div className="small muted">{tx("Klik op een regel om die te selecteren. De driehoek klapt een verkooporder open of dicht. Per leverancier ontstaat één inkooporder.")}</div>
        </div>
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <select style={{ width: 'auto', minHeight: 32 }} aria-label={tx("Filter op leverancier")} value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)}>
            <option value="">{tx("Alle leveranciers")}</option>
            {s.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={onlyToday} onChange={(e) => setOnlyToday(e.target.checked)} />{tx("Alleen van vandaag")}</label>
          <button className="btn sm" onClick={() => toggle(shownIds, !allShown)}>{allShown ? tx("Niets selecteren") : tx("Alles selecteren")}</button>
        </div>
      </div>
      {groups.length === 0 && <Empty>{queue.length ? tx("Geen regels met dit filter.") : tx("Alle verkooporders zijn doorgezet. Nieuwe regels op bestelling verschijnen hier vanzelf.")}</Empty>}
      {groups.length > 0 && <div className="table-wrap"><table className="queue">
        <thead><tr><th style={{ width: 44 }} aria-label={tx("Open of dicht")}></th><th>{tx("Verkooporder of product")}</th><th>{tx("Uitvoering")}</th><th className="num">{tx("Aantal")}</th><th>{tx("Leverancier")}</th><th className="num">{tx("Inkoopprijs")}</th><th style={{ width: 34 }} aria-label={tx("Geselecteerd")}></th></tr></thead>
        {groups.map(({ order, lines }) => {
          const ids = lines.map((l) => l.id)
          const count = ids.filter((id) => selected.has(id)).length
          const all = count === ids.length
          const isOpen = open.has(order.id)
          const customer = s.customers.find((c) => c.id === order.customer_id)
          return (
            <tbody key={order.id}>
              <tr {...pickRow(all, () => toggle(ids, !all), `queue-head${!all && count ? ' partly' : ''}`)}>
                <td><button type="button" className={`tri${isOpen ? ' open' : ''}`} aria-expanded={isOpen} aria-label={isOpen ? tx("{0} dichtklappen", order.number) : tx("{0} openklappen", order.number)} onClick={(e) => { e.stopPropagation(); toggleOpen(order.id) }}><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M1 3h10L6 10z" fill="currentColor" /></svg></button></td>
                <td colSpan={2}><a className="rowlink" href={`#orders-${order.id}`}>{order.number}</a> <span className="muted small">{customer?.company || customer?.name}, {fmtDate(order.order_date)}{order.promised_date ? tx(", beloofd {0}", fmtDate(order.promised_date)) : ''}</span></td>
                <td colSpan={3} className="muted small">{count && !all ? tx("{0} van {1} regels geselecteerd", count, ids.length) : ids.length === 1 ? tx("1 regel") : tx("{0} regels", ids.length)}</td>
                <td>{all && <CheckIcon size={16} />}</td>
              </tr>
              {isOpen && lines.map((l) => {
                const bought = linePurchaseStatus(s, l.id).purchased
                const on = selected.has(l.id)
                return (
                  <tr key={l.id} {...pickRow(on, () => toggle([l.id], !on))}>
                    <td></td>
                    <td className="strong">{l.description}<Sku code={articleNo(s, l.product_id)} /></td>
                    <td className="muted">{l.options || '–'}</td>
                    <td className="num">{l.qty}{bought > 0 && <div className="muted small">{tx("{0} al ingekocht", bought)}</div>}</td>
                    <td>{s.suppliers.find((x) => x.id === supplierFor(l))?.name ?? <a href="#beheer" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--bad)' }}>{tx("Geen leverancier bij dit artikel")}</a>}</td>
                    <td className="num">{eur(productOf(l.product_id)?.purchase_price ?? 0)}</td>
                    <td>{on && <CheckIcon size={16} />}</td>
                  </tr>
                )
              })}
            </tbody>
          )
        })}
      </table></div>}
      {queue.length > 0 && (
        <div className="queue-bar">
          <span>{missing && <strong style={{ color: 'var(--bad)' }}>{tx("Een geselecteerd artikel heeft geen leverancier.")} </strong>}{chosen.length ? tx("{0} geselecteerd, voor {1} leverancier(s)", chosen.length, supplierCount) : tx("Nog niets geselecteerd")}</span>
          <button className="btn primary" disabled={!chosen.length || missing} onClick={() => setConfirm(true)}>{tx("Doorzetten naar inkooporder")}<ArrowRight size={16} /></button>
        </div>
      )}
      {confirm && <ConvertModal lines={chosen.map((l) => ({ id: l.id, qty: l.qty, product_id: l.product_id, supplier_id: supplierFor(l), sales_order_id: l.sales_order_id, description: l.description, options: l.options }))} onClose={() => setConfirm(false)} onDone={() => {
        setSelected(new Set()); setConfirm(false); onDone()
      }} run={run} />}
    </section>
  )
}

function ConvertModal({ lines, onClose, onDone, run }: { lines: { id: string; qty: number; product_id: string; supplier_id: string; sales_order_id: string; description: string; options: string }[]; onClose: () => void; onDone: () => void; run: ReturnType<typeof useApp>['run'] }) {
  const { s } = useApp()
  const today = todayISO()
  const [date, setDate] = useState(today)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const lineCost = (l: { qty: number; product_id: string }) => l.qty * (s.products.find((p) => p.id === l.product_id)?.purchase_price ?? 0)
  const perSupplier = [...new Set(lines.map((l) => l.supplier_id))].map((id) => {
    const rows = lines.filter((l) => l.supplier_id === id)
    const orders = [...new Set(rows.map((l) => l.sales_order_id))].map((orderId) => ({ order: s.sales_orders.find((o) => o.id === orderId)!, lines: rows.filter((l) => l.sales_order_id === orderId) })).sort((a, b) => a.order.number.localeCompare(b.order.number))
    return { id, name: s.suppliers.find((x) => x.id === id)?.name, count: rows.length, value: round2(rows.reduce((n, l) => n + lineCost(l), 0)), orders }
  })
  const toggleOpen = (id: string) => setOpen((v) => { const next = new Set(v); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const save = async () => {
    const ok = await run((db) => convertLinesToPurchaseOrders(db, { lines: lines.map((l) => ({ sales_order_line_id: l.id })), order_date: date }), perSupplier.length === 1 ? tx("Inkooporder aangemaakt") : tx("{0} inkooporders aangemaakt", perSupplier.length))
    if (ok) onDone()
  }
  return (
    <Modal wide title={tx("Doorzetten naar inkooporder")} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx("Annuleren")}</button>
      <button className="btn primary" onClick={save}>{perSupplier.length === 1 ? tx("Inkooporder aanmaken") : tx("{0} inkooporders aanmaken", perSupplier.length)}</button>
    </>}>
      <div className="table-wrap flush convert-list"><table>
        <thead><tr><th>{tx("Leverancier")}</th><th className="num">{tx("Aantal")}</th><th className="num">{tx("Waarde")}</th></tr></thead>
        {perSupplier.map((x) => {
          const isOpen = open.has(x.id)
          return (
            <tbody key={x.id}>
              <tr className="click" onClick={() => toggleOpen(x.id)}>
                <td className="strong"><span className="convert-sup"><button type="button" className={`tri${isOpen ? ' open' : ''}`} aria-expanded={isOpen} aria-label={isOpen ? tx("{0} dichtklappen", x.name) : tx("{0} openklappen", x.name)} onClick={(e) => { e.stopPropagation(); toggleOpen(x.id) }}><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M1 3h10L6 10z" fill="currentColor" /></svg></button>{x.name}</span></td>
                <td className="num muted small">{x.count === 1 ? tx("1 regel") : tx("{0} regels", x.count)}</td>
                <td className="num strong">{eur(x.value)}</td>
              </tr>
              {isOpen && x.orders.flatMap(({ order, lines: rows }) => {
                const customer = s.customers.find((c) => c.id === order.customer_id)
                return [
                  <tr key={order.id} className="convert-order"><td colSpan={3}><span className="strong">{order.number}</span> <span className="muted small">{customer?.company || customer?.name}</span></td></tr>,
                  ...rows.map((l) => (
                    <tr key={l.id} className="convert-line">
                      <td>{l.description}<Sku code={articleNo(s, l.product_id)} />{l.options && <div className="muted small">{l.options}</div>}</td>
                      <td className="num">{l.qty}</td>
                      <td className="num">{eur(round2(lineCost(l)))}</td>
                    </tr>
                  )),
                ]
              })}
            </tbody>
          )
        })}
      </table></div>
      <div className="form-grid">
        <div className="field"><span className="lbl">{tx("Bestemming")}</span><div style={{ minHeight: 38, display: 'flex', alignItems: 'center' }}>{inboundWarehouse(s.warehouses)?.name}</div></div>
        <TextField label={tx("Besteldatum")} type="date" value={date} onChange={setDate} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>{tx("Koppel de regels aan een transport in stap 2 zodra de transportlijst bekend is.")}</p>
    </Modal>
  )
}
